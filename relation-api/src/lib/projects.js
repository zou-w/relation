/**
 * 项目查询层
 * 项目是把"关系"落到"具体事由"上的抓手：谁在哪个项目里担什么角色
 */
import { all, get } from '../db/driver.js';
import { decrypt } from './crypto.js';
import { enumLabel } from './enums.js';

/** 拼装筛选条件，列表与计数共用 */
function projectWhere({ keyword, status, personId, keyOnly, orgId } = {}) {
  let sql = ' WHERE 1=1';
  const params = [];

  if (keyword) {
    sql += ` AND (pr.name LIKE ? OR pr.code LIKE ? OR pr.remark LIKE ?
              OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = pr.owner_org_id AND o.name LIKE ?)
              OR EXISTS (SELECT 1 FROM project_members pm JOIN persons p ON p.id = pm.person_id
                         WHERE pm.project_id = pr.id AND p.name LIKE ?))`;
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw, kw, kw);
  }
  if (status) {
    sql += ' AND pr.status = ?';
    params.push(status);
  }
  if (keyOnly) sql += ' AND pr.is_key = 1';
  if (orgId) {
    sql += ' AND pr.owner_org_id = ?';
    params.push(orgId);
  }
  if (personId) {
    sql += ' AND EXISTS (SELECT 1 FROM project_members pm2 WHERE pm2.project_id = pr.id AND pm2.person_id = ?)';
    params.push(personId);
  }

  return { sql, params };
}

/** 项目列表：带成员数、关键成员名、业主单位 */
export function findProjects({
  keyword, status, personId, keyOnly, orgId, limit = 50, offset = 0,
} = {}) {
  const where = projectWhere({ keyword, status, personId, keyOnly, orgId });

  const rows = all(
    `SELECT pr.*,
            o.name AS owner_org_name,
            (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = pr.id) AS member_count,
            (SELECT GROUP_CONCAT(p.name, '、') FROM project_members pm
               JOIN persons p ON p.id = pm.person_id
              WHERE pm.project_id = pr.id AND pm.role_type = 'leader') AS leaders
       FROM projects pr
       LEFT JOIN organizations o ON o.id = pr.owner_org_id
       ${where.sql}
      ORDER BY CASE pr.status WHEN 'active' THEN 1 WHEN 'bidding' THEN 2
                              WHEN 'planning' THEN 3 WHEN 'closed' THEN 4 ELSE 5 END,
               pr.is_key DESC, pr.updated_at DESC, pr.id DESC
      LIMIT ? OFFSET ?`,
    [...where.params, limit, offset]
  );

  return rows.map((r) => ({
    ...r,
    leader_names: r.leaders || '',
  }));
}

export function countProjects(opts = {}) {
  const where = projectWhere(opts);
  return get(`SELECT COUNT(*) AS n FROM projects pr ${where.sql}`, where.params)?.n || 0;
}

/** 项目详情：含业主单位与全部成员（按角色排序） */
export function getProject(id) {
  const project = get(
    `SELECT pr.*, o.name AS owner_org_name, o.org_type AS owner_org_type,
            o.region AS owner_region
       FROM projects pr
       LEFT JOIN organizations o ON o.id = pr.owner_org_id
      WHERE pr.id = ?`,
    [id]
  );
  if (!project) return null;

  project.members = all(
    `SELECT pm.*, p.name, p.title, p.is_key_contact, p.is_self, p.phone, p.email, p.remark AS person_remark,
            (SELECT o.name FROM employments e JOIN organizations o ON o.id = e.org_id
              WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS org_name,
            (SELECT e.position FROM employments e
              WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS position
       FROM project_members pm
       JOIN persons p ON p.id = pm.person_id
      WHERE pm.project_id = ?
      ORDER BY CASE pm.role_type
                 WHEN 'leader' THEN 1 WHEN 'business' THEN 2 WHEN 'technical' THEN 3
                 WHEN 'approver' THEN 4 WHEN 'resource' THEN 5 WHEN 'advisor' THEN 6 ELSE 7 END,
               pm.is_key DESC, pm.id`,
    [id]
  ).map((m) => ({
    ...m,
    phone: decrypt(m.phone),
    role_label: enumLabel('project_role', m.role_type),
  }));

  project.role_stats = summarizeRoles(project.members);
  project.member_count = project.members.length;
  return project;
}

/** 按角色聚合人数，用于卡片摘要 */
function summarizeRoles(members) {
  const map = new Map();
  for (const m of members) {
    map.set(m.role_type, (map.get(m.role_type) || 0) + 1);
  }
  return [...map.entries()].map(([role_type, count]) => ({
    role_type,
    count,
    role_label: enumLabel('project_role', role_type),
  }));
}

/** 某人参与的项目 */
export function personProjects(personId) {
  return all(
    `SELECT pr.id, pr.name, pr.status, pr.project_type, pr.is_key,
            pm.role_type, pm.role_title, pm.duty, pm.is_key AS member_is_key,
            o.name AS owner_org_name
       FROM project_members pm
       JOIN projects pr ON pr.id = pm.project_id
       LEFT JOIN organizations o ON o.id = pr.owner_org_id
      WHERE pm.person_id = ?
      ORDER BY pr.is_key DESC, pr.updated_at DESC`,
    [personId]
  );
}

/** 项目概览统计 */
export function projectStats() {
  const one = (sql, p = []) => Object.values(get(sql, p) || {})[0] ?? 0;
  return {
    total: one('SELECT COUNT(*) FROM projects'),
    active: one("SELECT COUNT(*) FROM projects WHERE status IN ('active','bidding')"),
    keyProjects: one('SELECT COUNT(*) FROM projects WHERE is_key = 1'),
    members: one('SELECT COUNT(DISTINCT person_id) FROM project_members'),
    // 项目里出现、但平时没标重点的人 —— 容易被忽略的关键人
    hiddenKeys: one(`SELECT COUNT(DISTINCT pm.person_id) FROM project_members pm
                     JOIN persons p ON p.id = pm.person_id
                     WHERE pm.is_key = 1 AND p.is_key_contact = 0`),
  };
}

/**
 * 单个项目的关系网：项目节点 + 成员 + 成员所属单位 + 成员之间已有的人际关系
 * 用于项目详情页的局部图谱
 */
export function projectGraph(projectId) {
  const project = get(
    `SELECT pr.*, o.name AS owner_org_name FROM projects pr
       LEFT JOIN organizations o ON o.id = pr.owner_org_id
      WHERE pr.id = ?`,
    [projectId]
  );
  if (!project) return null;

  const members = all(
    `SELECT pm.id AS member_id, pm.role_type, pm.role_title, pm.is_key AS member_is_key,
            p.id, p.name, p.is_key_contact, p.is_self,
            (SELECT o.id FROM employments e JOIN organizations o ON o.id = e.org_id
              WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS org_id,
            (SELECT o.name FROM employments e JOIN organizations o ON o.id = e.org_id
              WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS org_name
       FROM project_members pm
       JOIN persons p ON p.id = pm.person_id
      WHERE pm.project_id = ?`,
    [projectId]
  );

  const personIds = members.map((m) => m.id);
  const orgIds = [...new Set(members.map((m) => m.org_id).filter(Boolean))];

  const orgs = orgIds.length
    ? all(`SELECT id, name, org_type FROM organizations WHERE id IN (${orgIds.map(() => '?').join(',')})`, orgIds)
    : [];

  const rels = personIds.length
    ? all(
        `SELECT * FROM relations
          WHERE from_person IN (${personIds.map(() => '?').join(',')})
            AND to_person IN (${personIds.map(() => '?').join(',')})`,
        [...personIds, ...personIds]
      )
    : [];

  const nodes = [
    {
      id: `j${project.id}`,
      kind: 'project',
      label: project.name,
      status: project.status,
      isKey: !!project.is_key,
    },
    ...members.map((m) => ({
      id: `p${m.id}`,
      kind: 'person',
      label: m.name,
      isKey: !!m.is_key_contact,
      isSelf: !!m.is_self,
      orgName: m.org_name,
      roleType: m.role_type,
      roleTitle: m.role_title,
    })),
    ...orgs.map((o) => ({ id: `o${o.id}`, kind: 'org', label: o.name, orgType: o.org_type })),
  ];

  const edges = [
    ...members.map((m) => ({
      id: `jm${m.member_id}`,
      source: `p${m.id}`,
      target: `j${project.id}`,
      kind: 'project',
      label: m.role_title || enumLabel('project_role', m.role_type),
      roleType: m.role_type,
    })),
    ...members
      .filter((m) => m.org_id)
      .map((m) => ({
        id: `eo-m${m.member_id}`,
        source: `p${m.id}`,
        target: `o${m.org_id}`,
        kind: 'employment',
        label: '',
      })),
    ...rels.map((r) => ({
      id: `r${r.id}`,
      source: `p${r.from_person}`,
      target: `p${r.to_person}`,
      kind: 'relation',
      label: enumLabel('relation_type', r.relation_type),
      strength: r.strength,
      influence: r.influence,
    })),
  ];

  return {
    project: {
      id: project.id,
      name: project.name,
      status: project.status,
      owner_org_name: project.owner_org_name,
      member_count: members.length,
    },
    nodes,
    edges,
  };
}
