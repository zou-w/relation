/**
 * 核心查询层：把数据模型的能力封装成可复用函数
 * 这些查询就是"关系的关系为我所用"的产品化表达
 */
import { all, get, run } from '../db/driver.js';
import { decrypt, maskPhone } from './crypto.js';
import { enumLabel } from './enums.js';
import { personProjects } from './projects.js';
import { computeCrossOrg } from './cross-org.js';

/** 把联系人行解密并补充当前任职信息 */
function hydratePerson(row, opts = {}) {
  if (!row) return null;
  const p = { ...row };
  p.phone = opts.mask ? maskPhone(decrypt(p.phone)) : decrypt(p.phone);
  p.wechat = decrypt(p.wechat);
  return p;
}

/* ============================================================
 * 1. 联系人
 * ============================================================ */

/** 拼装联系人筛选条件，findPersons 与 countPersons 共用 */
function personWhere({ keyword, keyOnly, orgId, hasAttr, missingPhone } = {}) {
  let sql = ' WHERE 1=1';
  const params = [];

  if (keyword) {
    sql += ` AND (p.name LIKE ? OR p.title LIKE ? OR p.remark LIKE ?
              OR EXISTS (SELECT 1 FROM employments e2
                         JOIN organizations o2 ON o2.id = e2.org_id
                         WHERE e2.person_id = p.id
                           AND (o2.name LIKE ? OR o2.alias LIKE ?)))`;
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw, kw, kw);
  }
  if (keyOnly) sql += ' AND p.is_key_contact = 1';
  if (orgId) {
    sql += ` AND EXISTS (SELECT 1 FROM employments e3
              WHERE e3.person_id = p.id AND e3.org_id = ? AND e3.is_current = 1)`;
    params.push(orgId);
  }
  if (hasAttr) {
    sql += ' AND EXISTS (SELECT 1 FROM person_attributes pa WHERE pa.person_id = p.id)';
  }
  if (missingPhone) {
    sql += " AND (p.phone IS NULL OR p.phone = '') AND p.is_self = 0";
  }

  return { sql, params };
}

export function findPersons({ keyword, keyOnly, orgId, hasAttr, missingPhone, limit = 50, offset = 0 }) {
  const where = personWhere({ keyword, keyOnly, orgId, hasAttr, missingPhone });

  const sql = `
    SELECT p.*,
           (SELECT o.name FROM employments e JOIN organizations o ON o.id = e.org_id
            WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS org_name,
           (SELECT e.position FROM employments e
            WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS position,
           (SELECT COUNT(*) FROM person_attributes pa WHERE pa.person_id = p.id) AS attr_count
    FROM persons p
    ${where.sql}
    ORDER BY p.is_self DESC, p.is_key_contact DESC, p.updated_at DESC, p.id DESC
    LIMIT ? OFFSET ?
  `;

  return all(sql, [...where.params, limit, offset]).map((r) => hydratePerson(r));
}

/** 与 findPersons 同条件的总数，用于分页 */
export function countPersons(opts = {}) {
  const where = personWhere(opts);
  return get(`SELECT COUNT(*) AS n FROM persons p ${where.sql}`, where.params)?.n || 0;
}

export function getPerson(id) {
  const row = get('SELECT * FROM persons WHERE id = ?', [id]);
  if (!row) return null;
  const person = hydratePerson(row);

  person.employments = all(
    `SELECT e.*, o.name AS org_name, o.org_type, o.region, o.level
     FROM employments e JOIN organizations o ON o.id = e.org_id
     WHERE e.person_id = ? ORDER BY e.is_current DESC, e.start_date DESC`,
    [id]
  );

  person.attributes = all(
    'SELECT * FROM person_attributes WHERE person_id = ? ORDER BY attr_type, weight DESC',
    [id]
  );

  person.relations = all(
    `SELECT r.*, p.name AS other_name,
            (SELECT o.name FROM employments e JOIN organizations o ON o.id = e.org_id
             WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS other_org
     FROM relations r
     JOIN persons p ON p.id = CASE WHEN r.from_person = ? THEN r.to_person ELSE r.from_person END
     WHERE r.from_person = ? OR r.to_person = ?`,
    [id, id, id]
  );

  person.events = all(
    'SELECT * FROM contact_events WHERE person_id = ? ORDER BY event_date DESC LIMIT 50',
    [id]
  );

  // 关系标上"是否跨单位"，详情页一眼看出这条关系是不是跨单位认识
  if (person.relations.length) {
    const involved = [...new Set(person.relations.flatMap((r) => [r.from_person, r.to_person]))];
    const emps = all(
      `SELECT e.id, e.person_id, e.org_id, e.is_current FROM employments e
        WHERE e.is_current = 1 AND e.person_id IN (${involved.map(() => '?').join(',')})`,
      involved
    );
    const flags = computeCrossOrg(person.relations, emps, all('SELECT id, name FROM organizations'));
    person.relations = person.relations.map((r) => {
      const f = flags.get(r.id) || {};
      return { ...r, is_cross_org: f.cross ? 1 : 0, cross_reason: f.reason || 'unknown' };
    });
  }

  // 参与的项目：项目是把关系落地的事由，详情页要能看到
  person.projects = personProjects(id).map((p) => ({
    ...p,
    status_label: enumLabel('project_status', p.status),
    role_label: enumLabel('project_role', p.role_type),
  }));

  return person;
}

/**
 * 按名称查找组织，没有则创建（供快速录入使用）
 * 返回 org_id
 */
export function ensureOrg(orgName) {
  if (!orgName) return null;
  const exist = get('SELECT id FROM organizations WHERE name = ? OR alias = ?', [orgName, orgName]);
  if (exist) return exist.id;
  const info = run('INSERT INTO organizations (name) VALUES (?)', [orgName]);
  return info.lastInsertRowid;
}

/* ============================================================
 * 2. 资源检索（第一价值：借资源）
 * ============================================================ */

export function searchResources({ keyword, attrType, minWeight = 1, limit = 50 }) {
  let sql = `
    SELECT pa.*, p.name AS person_name, p.title, p.is_key_contact,
           (SELECT o.name FROM employments e JOIN organizations o ON o.id = e.org_id
            WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS org_name,
           (SELECT e.power_level FROM employments e
            WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS power_level
    FROM person_attributes pa
    JOIN persons p ON p.id = pa.person_id
    WHERE pa.weight >= ?
  `;
  const params = [minWeight];

  if (keyword) {
    sql += ' AND (pa.attr_value LIKE ? OR pa.note LIKE ?)';
    const kw = `%${keyword}%`;
    params.push(kw, kw);
  }
  if (attrType) {
    sql += ' AND pa.attr_type = ?';
    params.push(attrType);
  }
  sql += ' ORDER BY pa.weight DESC, p.is_key_contact DESC LIMIT ?';
  params.push(limit);

  return all(sql, params);
}

/** 圈子渗透度：按圈子聚合人数与覆盖情况 */
export function sphereStats() {
  return all(`
    SELECT attr_value AS sphere,
           COUNT(*) AS total,
           SUM(CASE WHEN p.is_key_contact = 1 THEN 1 ELSE 0 END) AS key_count,
           GROUP_CONCAT(p.name, '、') AS members
    FROM person_attributes pa
    JOIN persons p ON p.id = pa.person_id
    WHERE pa.attr_type = 'sphere'
    GROUP BY attr_value
    ORDER BY total DESC
  `);
}

/* ============================================================
 * 3. 触达路径（关系的关系）
 * ============================================================ */

/**
 * 找"我 → 中间人 → 目标"的两跳路径
 * 一跳：直接认识
 * 二跳：我认识 A，A 与目标有关系
 */
export function findPaths(targetId, maxHops = 2) {
  const self = get('SELECT id, name FROM persons WHERE is_self = 1 LIMIT 1');
  const target = get('SELECT id, name FROM persons WHERE id = ?', [targetId]);
  if (!self || !target) return { self, target, paths: [] };

  const paths = [];

  // 一跳直达
  const direct = get(
    `SELECT * FROM relations
     WHERE (from_person = ? AND to_person = ?) OR (from_person = ? AND to_person = ?)`,
    [self.id, targetId, targetId, self.id]
  );
  if (direct) {
    paths.push({
      hops: 1,
      via: null,
      relation: direct.relation_type,
      strength: direct.strength,
      influence: direct.influence,
      desc: `我 直接认识 ${target.name}`,
    });
  }

  // 二跳：我认识的人与目标有关系
  if (maxHops >= 2) {
    const rows = all(
      `WITH my_network AS (
         SELECT CASE WHEN from_person = ? THEN to_person ELSE from_person END AS pid,
                relation_type, strength, influence
         FROM relations WHERE from_person = ? OR to_person = ?
       ),
       target_network AS (
         SELECT CASE WHEN from_person = ? THEN to_person ELSE from_person END AS pid,
                relation_type, strength, influence
         FROM relations WHERE from_person = ? OR to_person = ?
       )
       SELECT mn.pid AS via_id, p.name AS via_name,
              mn.relation_type AS my_rel, mn.strength AS my_strength,
              tn.relation_type AS their_rel, tn.influence AS their_influence,
              (SELECT o.name FROM employments e JOIN organizations o ON o.id = e.org_id
               WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS via_org
       FROM my_network mn
       JOIN target_network tn ON tn.pid = mn.pid
       JOIN persons p ON p.id = mn.pid
       WHERE mn.pid != ? AND mn.pid != ?`,
      [self.id, self.id, self.id, targetId, targetId, targetId, self.id, targetId]
    );

    const targetName = target.name;
    for (const r of rows) {
      paths.push({
        hops: 2,
        via: { id: r.via_id, name: r.via_name, org: r.via_org },
        myRelation: r.my_rel,
        theirRelation: r.their_rel,
        strength: r.my_strength,
        influence: r.their_influence,
        score: (r.my_strength || 3) + (r.their_influence || 3),
        desc: `我 → ${r.via_name}${r.via_org ? `(${r.via_org})` : ''} → ${targetName}`,
      });
    }
    paths.sort((a, b) => (b.score || 99) - (a.score || 99));
  }

  // 标注每条路径里"跨单位"的那一跳：这种中间人正是打通两个单位的关键
  const targetOrg = get(
    `SELECT o.id, o.name FROM employments e JOIN organizations o ON o.id = e.org_id
     WHERE e.person_id = ? AND e.is_current = 1 LIMIT 1`,
    [targetId]
  ) || get(
    `SELECT o.id, o.name FROM employments e JOIN organizations o ON o.id = e.org_id
     WHERE e.person_id = ? ORDER BY e.is_current DESC, e.id ASC LIMIT 1`,
    [targetId]
  );
  for (const p of paths) {
    p.crossOrg = p.hops === 1
      ? false
      : !!(p.via.org && targetOrg?.name && p.via.org !== targetOrg.name);
  }

  // 跨单位的人优先排在前面：同样两跳，能跨过去的那条价值更高
  paths.sort((a, b) => (Number(b.crossOrg) - Number(a.crossOrg)) || ((b.score || 0) - (a.score || 0)));

  // 跨单位认识清单（两人都在图谱里即可）
  const allRels = all('SELECT * FROM relations');
  const flags = computeCrossOrg(
    allRels,
    all('SELECT id, person_id, org_id, is_current FROM employments WHERE is_current = 1'),
    all('SELECT id, name FROM organizations'),
    { names: new Map(all('SELECT id, name FROM persons').map((p) => [p.id, p.name])) }
  );
  const crossList = allRels
    .filter((r) => flags.get(r.id)?.cross)
    .map((r) => {
      const f = flags.get(r.id);
      return {
        id: r.id,
        relationType: r.relation_type,
        label: enumLabel('relation_type', r.relation_type),
        fromName: f.fromName,
        toName: f.toName,
        fromPerson: r.from_person,
        toPerson: r.to_person,
        fromOrg: f.fromOrg,
        toOrg: f.toOrg,
      };
    });

  return { self, target, targetOrg: targetOrg || null, paths, crossList };
}

/** 按组织找抓手：某单位我能通过谁搭上线 */
export function orgReach(orgId) {
  const org = get('SELECT * FROM organizations WHERE id = ?', [orgId]);
  if (!org) return null;

  const insiders = all(
    `SELECT p.id, p.name, p.is_key_contact, e.position, e.power_level
     FROM employments e JOIN persons p ON p.id = e.person_id
     WHERE e.org_id = ? AND e.is_current = 1`,
    [orgId]
  );

  const reachable = insiders.map((p) => ({
    ...p,
    paths: findPaths(p.id).paths,
  }));

  return { org, insiders, reachable };
}

/* ============================================================
 * 4. 影响力：谁能影响目标
 * ============================================================ */

export function influencers(targetId) {
  return all(
    `SELECT r.*, p.name AS person_name, p.is_key_contact,
            (SELECT o.name FROM employments e JOIN organizations o ON o.id = e.org_id
             WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS org_name
     FROM relations r JOIN persons p ON p.id = r.from_person
     WHERE r.to_person = ? AND r.influence >= 3
     ORDER BY r.influence DESC`,
    [targetId]
  );
}

/* ============================================================
 * 5. 接触与提醒
 * ============================================================ */

/** 待办跟进：区分逾期 / 今日 / 未来 N 天 */
export function pendingEvents(days = 7) {
  const rows = all(
    `SELECT ce.*, p.name AS person_name, o.name AS org_name,
            CAST(julianday(ce.next_date) - julianday(date('now','localtime')) AS INTEGER) AS days_left
     FROM contact_events ce
     JOIN persons p ON p.id = ce.person_id
     LEFT JOIN organizations o ON o.id = ce.org_id
     WHERE ce.is_done = 0 AND ce.next_date IS NOT NULL
     ORDER BY ce.next_date ASC`
  );

  const overdue = [];
  const today = [];
  const upcoming = [];
  for (const r of rows) {
    if (r.days_left < 0) overdue.push(r);
    else if (r.days_left === 0) today.push(r);
    else if (r.days_left <= days) upcoming.push(r);
  }
  return { overdue, today, upcoming, total: rows.length };
}

/** 冷接触：多久没联系 / 从未接触 */
export function coldContacts(days = 30) {
  return all(
    `SELECT p.id, p.name, p.is_key_contact,
            (SELECT o.name FROM employments e JOIN organizations o ON o.id = e.org_id
             WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS org_name,
            (SELECT MAX(event_date) FROM contact_events ce WHERE ce.person_id = p.id) AS last_contact,
            CASE WHEN EXISTS (SELECT 1 FROM contact_events ce2 WHERE ce2.person_id = p.id)
                 THEN CAST(julianday(date('now','localtime')) -
                      julianday((SELECT MAX(event_date) FROM contact_events ce3 WHERE ce3.person_id = p.id))
                      AS INTEGER)
                 ELSE NULL END AS days_since
     FROM persons p
     WHERE p.is_self = 0
       AND (NOT EXISTS (SELECT 1 FROM contact_events ce4 WHERE ce4.person_id = p.id)
            OR julianday(date('now','localtime')) -
               julianday((SELECT MAX(event_date) FROM contact_events ce5 WHERE ce5.person_id = p.id)) >= ?)
     ORDER BY p.is_key_contact DESC, days_since DESC`,
    [days]
  );
}

/* ============================================================
 * 6. 关系网图谱
 * ============================================================ */

export function graphData({ keyOnly = false, limit = 200, withProjects = true, crossOnly = false } = {}) {
  const personWhere = keyOnly ? 'WHERE p.is_key_contact = 1 OR p.is_self = 1' : '';
  let persons = all(
    `SELECT p.id, p.name, p.is_key_contact, p.is_self, p.title,
            (SELECT o.id FROM employments e JOIN organizations o ON o.id = e.org_id
             WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS org_id,
            (SELECT o.name FROM employments e JOIN organizations o ON o.id = e.org_id
             WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS org_name,
            (SELECT e.power_level FROM employments e
             WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS power_level
     FROM persons p ${personWhere}
     ORDER BY p.is_self DESC, p.is_key_contact DESC
     LIMIT ?`,
    [limit]
  );

  let idSet = new Set(persons.map((p) => p.id));

  // 只看跨单位关系：把参与的人与单位补全，再裁掉无关节点
  let crossOnlyApplied = false;
  if (crossOnly) {
    crossOnlyApplied = true;
    const allPersons = all(
      `SELECT p.id, p.name, p.is_key_contact, p.is_self, p.title,
              (SELECT o.id FROM employments e JOIN organizations o ON o.id = e.org_id
               WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS org_id,
              (SELECT o.name FROM employments e JOIN organizations o ON o.id = e.org_id
               WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS org_name,
              (SELECT e.power_level FROM employments e
               WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS power_level
       FROM persons p ${personWhere}
       ORDER BY p.is_self DESC, p.is_key_contact DESC
       LIMIT ?`,
      [limit]
    );
    const allRels = all('SELECT * FROM relations');
    const allEmps = all(
      `SELECT e.id, e.person_id, e.org_id, e.is_current FROM employments e WHERE e.is_current = 1`
    );
    const allOrgs = all('SELECT id, name FROM organizations');
    const flags = computeCrossOrg(allRels, allEmps, allOrgs);
    const keep = new Set();
    for (const r of allRels) {
      if (flags.get(r.id)?.cross) {
        keep.add(r.from_person);
        keep.add(r.to_person);
      }
    }
    persons = allPersons.filter((p) => keep.has(p.id));
    idSet = new Set(persons.map((p) => p.id));
  }
  const orgIds = [...new Set(persons.map((p) => p.org_id).filter(Boolean))];

  const orgs = orgIds.length
    ? all(
        `SELECT * FROM organizations WHERE id IN (${orgIds.map(() => '?').join(',')})`,
        orgIds
      )
    : [];

  const personIds = persons.map((p) => p.id);
  const inList = personIds.length ? personIds.map(() => '?').join(',') : 'NULL';

  const rels = all(
    `SELECT r.* FROM relations r
     WHERE r.from_person IN (${inList})
       AND r.to_person IN (${inList})`,
    [...personIds, ...personIds]
  ).filter((r) => idSet.has(r.from_person) && idSet.has(r.to_person));

  const emps = all(
    `SELECT e.*, p.name AS person_name, o.name AS org_name
     FROM employments e
     JOIN persons p ON p.id = e.person_id
     JOIN organizations o ON o.id = e.org_id
     WHERE e.is_current = 1
       AND e.person_id IN (${inList})`,
    personIds
  );

  // 项目节点：只带成员落在当前节点集里的项目，避免出现悬空边
  const projectNodes = [];
  const projectEdges = [];
  if (withProjects && !crossOnly && persons.length) {
    const pids = persons.map((p) => p.id);
    const rows = all(
      `SELECT pr.id AS project_id, pr.name, pr.status, pr.is_key,
              pm.id AS member_id, pm.person_id, pm.role_type, pm.role_title
         FROM projects pr
         JOIN project_members pm ON pm.project_id = pr.id
        WHERE pm.person_id IN (${pids.map(() => '?').join(',')})`,
      pids
    );

    const seen = new Map();
    for (const r of rows) {
      if (!seen.has(r.project_id)) {
        seen.set(r.project_id, {
          id: `j${r.project_id}`,
          kind: 'project',
          label: r.name,
          status: r.status,
          isKey: !!r.is_key,
        });
      }
      projectEdges.push({
        id: `jm${r.member_id}`,
        source: `p${r.person_id}`,
        target: `j${r.project_id}`,
        kind: 'project',
        label: r.role_title || enumLabel('project_role', r.role_type),
        roleType: r.role_type,
      });
    }
    projectNodes.push(...seen.values());
  }

  const nodes = [
    ...persons.map((p) => ({
      id: `p${p.id}`,
      kind: 'person',
      label: p.name,
      isKey: !!p.is_key_contact,
      isSelf: !!p.is_self,
      orgName: p.org_name,
      powerLevel: p.power_level,
    })),
    ...orgs.map((o) => ({
      id: `o${o.id}`,
      kind: 'org',
      label: o.name,
      orgType: o.org_type,
      isKey: !!o.is_key_org,
    })),
    ...projectNodes,
  ];

  // 跨单位认识：两个不同单位的人之间的非工作关系，标出来单独渲染
  const flags = computeCrossOrg(rels, emps, orgs, {
    names: new Map(persons.map((p) => [p.id, p.name])),
  });
  const nameOf = new Map(persons.map((p) => [p.id, p.name]));
  const crossPairs = [];
  let crossCount = 0;

  const edges = [
    ...rels.map((r) => {
      const f = flags.get(r.id) || {};
      if (f.cross) {
        crossCount += 1;
        crossPairs.push({
          id: r.id,
          from: `p${r.from_person}`,
          to: `p${r.to_person}`,
          fromName: nameOf.get(r.from_person) || '',
          toName: nameOf.get(r.to_person) || '',
          fromOrg: f.fromOrg,
          toOrg: f.toOrg,
          relationType: r.relation_type,
          label: enumLabel('relation_type', r.relation_type),
        });
      }
      return {
        id: `r${r.id}`,
        source: `p${r.from_person}`,
        target: `p${r.to_person}`,
        kind: 'relation',
        label: r.relation_type,
        strength: r.strength,
        influence: r.influence,
        crossOrg: !!f.cross,
        crossReason: f.reason || 'unknown',
      };
    }),
    ...emps.map((e) => ({
      id: `eo${e.id}`,
      source: `p${e.person_id}`,
      target: `o${e.org_id}`,
      kind: 'employment',
      label: e.position || '',
      powerLevel: e.power_level,
    })),
    ...projectEdges,
  ];

  // 是否"跨越单位"：这条关系连接了两个人所在的不同单位
  const nodeOrg = new Map(persons.map((p) => [p.id, p.org_id || null]));
  for (const e of edges) {
    if (e.kind !== 'relation') continue;
    const a = nodeOrg.get(Number(String(e.source).replace('p', '')));
    const b = nodeOrg.get(Number(String(e.target).replace('p', '')));
    e.spansOrg = !!a && !!b && a !== b;
  }

  return {
    nodes,
    edges,
    crossOnly: crossOnlyApplied,
    cross: { count: crossCount, pairs: crossPairs },
  };
}

/** 首页统计概览 */
export function stats() {
  const one = (sql, p = []) => Object.values(get(sql, p) || {})[0] ?? 0;
  return {
    persons: one('SELECT COUNT(*) FROM persons WHERE is_self = 0'),
    keyContacts: one('SELECT COUNT(*) FROM persons WHERE is_key_contact = 1'),
    orgs: one('SELECT COUNT(*) FROM organizations'),
    relations: one('SELECT COUNT(*) FROM relations'),
    events: one('SELECT COUNT(*) FROM contact_events'),
    pending: one('SELECT COUNT(*) FROM contact_events WHERE is_done = 0 AND next_date IS NOT NULL'),
    resources: one('SELECT COUNT(*) FROM person_attributes'),
    projects: one('SELECT COUNT(*) FROM projects'),
  };
}
