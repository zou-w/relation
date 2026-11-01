/**
 * 组织路由
 */
import { Router } from 'express';
import { all, get, run } from '../db/driver.js';
import { isValidEnum, enumValues } from '../lib/enums.js';

const router = Router();

/** 组织列表 / 搜索 */
router.get('/', (req, res) => {
  const { q, org_type, limit } = req.query;
  let sql = `SELECT o.*,
                    (SELECT COUNT(*) FROM employments e
                     WHERE e.org_id = o.id AND e.is_current = 1) AS person_count,
                    (SELECT name FROM organizations po WHERE po.id = o.parent_org_id) AS parent_name
             FROM organizations o WHERE 1=1`;
  const params = [];
  if (q) {
    sql += ' AND (o.name LIKE ? OR o.alias LIKE ? OR o.business LIKE ?)';
    const kw = `%${q}%`;
    params.push(kw, kw, kw);
  }
  if (org_type) { sql += ' AND o.org_type = ?'; params.push(org_type); }
  sql += ' ORDER BY person_count DESC, o.name LIMIT ?';
  params.push(Math.min(Number(limit) || 50, 200));

  res.json({ items: all(sql, params) });
});

/** 新建组织 */
router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name 必填' });
  if (b.org_type && !isValidEnum('org_type', b.org_type)) {
    return res.status(400).json({
      error: `org_type 取值非法：${b.org_type}；合法值：${enumValues('org_type').join(' / ')}`,
    });
  }
  const info = run(
    `INSERT INTO organizations (name, alias, org_type, level, region, parent_org_id, address, business, is_key_org, remark)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [b.name, b.alias || null, b.org_type || 'enterprise', b.level || null, b.region || null,
     b.parent_org_id || null, b.address || null, b.business || null, b.is_key_org ? 1 : 0, b.remark || null]
  );
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

/** 组织详情：含本单位所有在任人员 */
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const org = get('SELECT * FROM organizations WHERE id = ?', [id]);
  if (!org) return res.status(404).json({ error: '组织不存在' });

  org.persons = all(
    `SELECT p.id, p.name, p.is_key_contact, p.title,
            e.position, e.department, e.power_level, e.is_current
     FROM employments e JOIN persons p ON p.id = e.person_id
     WHERE e.org_id = ? AND e.is_current = 1
     ORDER BY CASE e.power_level WHEN 'decision' THEN 1 WHEN 'approval' THEN 2
              WHEN 'operator' THEN 3 ELSE 4 END`,
    [id]
  );

  org.children = all('SELECT id, name, org_type FROM organizations WHERE parent_org_id = ?', [id]);
  org.parent = org.parent_org_id
    ? get('SELECT id, name, org_type FROM organizations WHERE id = ?', [org.parent_org_id])
    : null;

  res.json(org);
});

export default router;
