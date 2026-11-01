/**
 * 项目路由
 * 项目是"人脉的容器"：一个项目里谁负责、谁把关、谁引荐
 */
import { Router } from 'express';
import { all, get, run, transaction } from '../db/driver.js';
import { isValidEnum, enumValues, enumLabel } from '../lib/enums.js';
import {
  findProjects, countProjects, getProject, personProjects, projectStats, projectGraph,
} from '../lib/projects.js';

const router = Router();

/* ---------------- 校验 ---------------- */

function checkEnum(res, field, value, label) {
  if (!value) return true;
  if (isValidEnum(field, value)) return true;
  res.status(400).json({
    error: `${label}取值非法：${value}；合法值：${enumValues(field).join(' / ')}`,
  });
  return false;
}

function normalizeProject(b = {}) {
  return {
    name: (b.name || '').trim(),
    code: b.code?.trim() || null,
    project_type: b.project_type || 'other',
    status: b.status || 'active',
    owner_org_id: b.owner_org_id ? Number(b.owner_org_id) : null,
    our_role: b.our_role?.trim() || null,
    region: b.region?.trim() || null,
    amount: b.amount === '' || b.amount === undefined || b.amount === null ? null : Number(b.amount),
    start_date: b.start_date || null,
    end_date: b.end_date || null,
    milestone: b.milestone?.trim() || null,
    is_key: b.is_key ? 1 : 0,
    remark: b.remark?.trim() || null,
  };
}

/* ---------------- 列表 ---------------- */

router.get('/', (req, res) => {
  const { keyword, status, person_id, key_only, org_id, limit, offset } = req.query;
  const opts = {
    keyword: keyword?.trim() || null,
    status: status?.trim() || null,
    personId: person_id ? Number(person_id) : null,
    keyOnly: key_only === '1' || key_only === 'true',
    orgId: org_id ? Number(org_id) : null,
  };
  const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const skip = Math.max(Number(offset) || 0, 0);

  const items = findProjects({ ...opts, limit: size, offset: skip }).map((p) => ({
    ...p,
    status_label: enumLabel('project_status', p.status),
    project_type_label: enumLabel('project_type', p.project_type),
  }));

  res.json({ total: countProjects(opts), items, offset: skip });
});

/* ---------------- 概览（必须放在 /:id 之前） ---------------- */

router.get('/stats', (req, res) => {
  res.json(projectStats());
});

/* ---------------- 新建 ---------------- */

router.post('/', (req, res) => {
  const d = normalizeProject(req.body);
  if (!d.name) return res.status(400).json({ error: '项目名称必填' });
  if (!checkEnum(res, 'project_type', d.project_type, '项目类型')) return;
  if (!checkEnum(res, 'project_status', d.status, '项目状态')) return;
  if (d.owner_org_id && !get('SELECT 1 FROM organizations WHERE id = ?', [d.owner_org_id])) {
    return res.status(400).json({ error: '业主单位不存在' });
  }

  const info = run(
    `INSERT INTO projects
       (name, code, project_type, status, owner_org_id, our_role, region, amount,
        start_date, end_date, milestone, is_key, remark)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [d.name, d.code, d.project_type, d.status, d.owner_org_id, d.our_role, d.region,
     d.amount, d.start_date, d.end_date, d.milestone, d.is_key, d.remark]
  );
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

/* ---------------- 详情 ---------------- */

router.get('/:id', (req, res) => {
  const p = getProject(Number(req.params.id));
  if (!p) return res.status(404).json({ error: '项目不存在' });
  p.status_label = enumLabel('project_status', p.status);
  p.project_type_label = enumLabel('project_type', p.project_type);
  res.json(p);
});

/* ---------------- 编辑 ---------------- */

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const exist = get('SELECT * FROM projects WHERE id = ?', [id]);
  if (!exist) return res.status(404).json({ error: '项目不存在' });

  const d = normalizeProject({ ...exist, ...req.body });
  if (!d.name) return res.status(400).json({ error: '项目名称必填' });
  if (!checkEnum(res, 'project_type', d.project_type, '项目类型')) return;
  if (!checkEnum(res, 'project_status', d.status, '项目状态')) return;

  run(
    `UPDATE projects SET
       name=?, code=?, project_type=?, status=?, owner_org_id=?, our_role=?, region=?,
       amount=?, start_date=?, end_date=?, milestone=?, is_key=?, remark=?,
       updated_at=datetime('now','localtime')
     WHERE id=?`,
    [d.name, d.code, d.project_type, d.status, d.owner_org_id, d.our_role, d.region,
     d.amount, d.start_date, d.end_date, d.milestone, d.is_key, d.remark, id]
  );
  res.json({ ok: true, id });
});

/* ---------------- 删除 ---------------- */

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const exist = get('SELECT 1 FROM projects WHERE id = ?', [id]);
  if (!exist) return res.status(404).json({ error: '项目不存在' });
  run('DELETE FROM projects WHERE id = ?', [id]);
  res.json({ ok: true, deleted: 1 });
});

/* ---------------- 成员 ---------------- */

/** 添加成员，同一人重复添加则更新角色 */
router.post('/:id/members', (req, res) => {
  const projectId = Number(req.params.id);
  if (!get('SELECT 1 FROM projects WHERE id = ?', [projectId])) {
    return res.status(404).json({ error: '项目不存在' });
  }

  const b = req.body || {};
  const personId = Number(b.person_id);
  if (!personId) return res.status(400).json({ error: 'person_id 必填' });
  if (!get('SELECT 1 FROM persons WHERE id = ?', [personId])) {
    return res.status(400).json({ error: '联系人不存在' });
  }

  const roleType = b.role_type || 'other';
  if (!checkEnum(res, 'project_role', roleType, '项目角色')) return;

  const exist = get(
    'SELECT * FROM project_members WHERE project_id = ? AND person_id = ?',
    [projectId, personId]
  );

  if (exist) {
    run(
      `UPDATE project_members SET role_type=?, role_title=?, duty=?, is_key=?, note=?
        WHERE id=?`,
      [roleType, b.role_title?.trim() || null, b.duty?.trim() || null,
       b.is_key ? 1 : 0, b.note?.trim() || null, exist.id]
    );
    return res.json({ ok: true, id: exist.id, updated: true });
  }

  const info = run(
    `INSERT INTO project_members (project_id, person_id, role_type, role_title, duty, is_key, note)
     VALUES (?,?,?,?,?,?,?)`,
    [projectId, personId, roleType, b.role_title?.trim() || null,
     b.duty?.trim() || null, b.is_key ? 1 : 0, b.note?.trim() || null]
  );
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

/** 修改成员角色 */
router.patch('/:id/members/:memberId', (req, res) => {
  const projectId = Number(req.params.id);
  const memberId = Number(req.params.memberId);
  const exist = get(
    'SELECT * FROM project_members WHERE id = ? AND project_id = ?',
    [memberId, projectId]
  );
  if (!exist) return res.status(404).json({ error: '成员不存在' });

  const b = { ...exist, ...req.body };
  if (!checkEnum(res, 'project_role', b.role_type, '项目角色')) return;

  run(
    `UPDATE project_members SET role_type=?, role_title=?, duty=?, is_key=?, note=? WHERE id=?`,
    [b.role_type || 'other', b.role_title?.trim() || null, b.duty?.trim() || null,
     b.is_key ? 1 : 0, b.note?.trim() || null, memberId]
  );
  res.json({ ok: true, id: memberId });
});

/** 移除成员 */
router.delete('/:id/members/:memberId', (req, res) => {
  const info = run(
    'DELETE FROM project_members WHERE id = ? AND project_id = ?',
    [Number(req.params.memberId), Number(req.params.id)]
  );
  if (!info.changes) return res.status(404).json({ error: '成员不存在' });
  res.json({ ok: true, deleted: info.changes });
});

/** 批量把人员加进项目：导入/选人后一次提交 */
router.post('/:id/members/batch', (req, res) => {
  const projectId = Number(req.params.id);
  if (!get('SELECT 1 FROM projects WHERE id = ?', [projectId])) {
    return res.status(404).json({ error: '项目不存在' });
  }
  const list = Array.isArray(req.body?.members) ? req.body.members : [];
  if (!list.length) return res.status(400).json({ error: 'members 不能为空' });

  const results = [];
  transaction(() => {
    for (const m of list) {
      const personId = Number(m.person_id);
      if (!personId || !get('SELECT 1 FROM persons WHERE id = ?', [personId])) {
        results.push({ person_id: personId, result: 'failed', message: '联系人不存在' });
        continue;
      }
      const roleType = isValidEnum('project_role', m.role_type) && m.role_type ? m.role_type : 'other';
      const exist = get(
        'SELECT id FROM project_members WHERE project_id = ? AND person_id = ?',
        [projectId, personId]
      );
      if (exist) {
        results.push({ person_id: personId, result: 'skipped', message: '已在项目中' });
        continue;
      }
      run(
        `INSERT INTO project_members (project_id, person_id, role_type, role_title, duty, is_key)
         VALUES (?,?,?,?,?,?)`,
        [projectId, personId, roleType, m.role_title?.trim() || null,
         m.duty?.trim() || null, m.is_key ? 1 : 0]
      );
      results.push({ person_id: personId, result: 'added' });
    }
  });

  res.json({
    ok: true,
    summary: {
      added: results.filter((r) => r.result === 'added').length,
      skipped: results.filter((r) => r.result === 'skipped').length,
      failed: results.filter((r) => r.result === 'failed').length,
    },
    results,
  });
});

/* ---------------- 局部关系网 ---------------- */

router.get('/:id/graph', (req, res) => {
  const g = projectGraph(Number(req.params.id));
  if (!g) return res.status(404).json({ error: '项目不存在' });
  res.json(g);
});

/* ---------------- 可选人员池：项目加人时用 ---------------- */

router.get('/:id/candidates', (req, res) => {
  const projectId = Number(req.params.id);
  const keyword = req.query.keyword?.trim() || '';
  let sql = `
    SELECT p.id, p.name, p.is_key_contact, p.is_self,
           (SELECT o.name FROM employments e JOIN organizations o ON o.id = e.org_id
             WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS org_name,
           (SELECT e.position FROM employments e
             WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS position_and_more,
           EXISTS (SELECT 1 FROM project_members pm
                    WHERE pm.project_id = ? AND pm.person_id = p.id) AS joined
      FROM persons p
     WHERE p.is_self = 0`;
  const params = [projectId];
  if (keyword) {
    sql += ` AND (p.name LIKE ? OR EXISTS (
               SELECT 1 FROM employments e2 JOIN organizations o2 ON o2.id = e2.org_id
                WHERE e2.person_id = p.id AND o2.name LIKE ?))`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  sql += ' ORDER BY joined ASC, p.is_key_contact DESC, p.updated_at DESC LIMIT 60';

  res.json({ items: all(sql, params).map((r) => ({ ...r, joined: !!r.joined })) });
});

export default router;
