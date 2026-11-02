/**
 * 关系路由（人↔人、组织↔组织）
 */
import { Router } from 'express';
import { all, get, run } from '../db/driver.js';
import { isValidEnum, enumValues } from '../lib/enums.js';
import { canReadPerson, relationScope, orgScope } from '../lib/scope.js';

const router = Router();

/** 关系列表 */
router.get('/', (req, res) => {
  const { person_id, limit } = req.query;
  let sql = `SELECT r.*, pf.name AS from_name, pt.name AS to_name
             FROM relations r
             JOIN persons pf ON pf.id = r.from_person
             JOIN persons pt ON pt.id = r.to_person
             WHERE ${relationScope(req.ctx, 'r').sql}`;
  const params = [...relationScope(req.ctx, 'r').params];
  if (person_id) {
    sql += ' AND (r.from_person = ? OR r.to_person = ?)';
    params.push(Number(person_id), Number(person_id));
  }
  sql += ' ORDER BY r.influence DESC LIMIT ?';
  params.push(Math.min(Number(limit) || 100, 500));
  res.json({ items: all(sql, params) });
});

/** 建立人↔人关系 */
router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.from_person || !b.to_person) {
    return res.status(400).json({ error: 'from_person 与 to_person 必填' });
  }
  if (!b.relation_type) return res.status(400).json({ error: 'relation_type 必填' });

  if (!isValidEnum('relation_type', b.relation_type)) {
    return res.status(400).json({
      error: `relation_type 取值非法：${b.relation_type}；合法值：${enumValues('relation_type').join(' / ')}`,
    });
  }

  const from = canReadPerson(req.ctx, Number(b.from_person));
  const to = canReadPerson(req.ctx, Number(b.to_person));
  if (!from || !to) return res.status(404).json({ error: '联系人不存在，或没有查看权限' });
  if (Number(b.from_person) === Number(b.to_person)) {
    return res.status(400).json({ error: '不能和自己建立关系' });
  }

  const dup = get(
    `SELECT id FROM relations
     WHERE ((from_person = ? AND to_person = ?) OR (from_person = ? AND to_person = ?))
       AND relation_type = ?`,
    [b.from_person, b.to_person, b.to_person, b.from_person, b.relation_type]
  );
  if (dup) return res.status(409).json({ error: '这两人已有同类关系', id: dup.id });

  const clamp = (v, d) => Math.min(Math.max(Number(v) || d, 1), 5);
  const info = run(
    `INSERT INTO relations (from_person, to_person, relation_type, direction, strength, influence, introducer_id, note, owner_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [Number(b.from_person), Number(b.to_person), b.relation_type,
     b.direction || 'two-way', clamp(b.strength, 3), clamp(b.influence, 3),
     b.introducer_id || null, b.note || null, req.ctx.userId]
  );
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const exist = get('SELECT id, owner_id FROM relations WHERE id = ?', [id]);
  if (!exist) return res.status(404).json({ error: '关系不存在' });
  if (!req.ctx.isAdmin && String(exist.owner_id) !== req.ctx.userId) {
    return res.status(403).json({ error: '这条关系不是你录入的，不能修改' });
  }

  const b = req.body || {};
  if (b.relation_type && !isValidEnum('relation_type', b.relation_type)) {
    return res.status(400).json({ error: `relation_type 非法：${enumValues('relation_type').join(' / ')}` });
  }
  const fields = [];
  const params = [];
  const clamp = (v, d) => Math.min(Math.max(Number(v) || d, 1), 5);
  if (b.relation_type !== undefined) { fields.push('relation_type = ?'); params.push(b.relation_type); }
  if (b.strength !== undefined) { fields.push('strength = ?'); params.push(clamp(b.strength, 3)); }
  if (b.influence !== undefined) { fields.push('influence = ?'); params.push(clamp(b.influence, 3)); }
  if (b.direction !== undefined) { fields.push('direction = ?'); params.push(b.direction); }
  if (b.note !== undefined) { fields.push('note = ?'); params.push(b.note); }

  if (!fields.length) return res.status(400).json({ error: '没有可更新的字段' });
  params.push(id);
  run(`UPDATE relations SET ${fields.join(', ')} WHERE id = ?`, params);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const row = get('SELECT owner_id FROM relations WHERE id = ?', [Number(req.params.id)]);
  if (row && !req.ctx.isAdmin && String(row.owner_id) !== req.ctx.userId) {
    return res.status(403).json({ error: '这条关系不是你录入的，不能删除' });
  }
  const info = run('DELETE FROM relations WHERE id = ?', [Number(req.params.id)]);
  if (!info.changes) return res.status(404).json({ error: '关系不存在' });
  res.json({ ok: true });
});

/* ---------------- 组织间关系 ---------------- */
router.get('/org', (req, res) => {
  res.json({
    items: all(`SELECT r.*, of.name AS from_name, ot.name AS to_name
                FROM org_relations r
                JOIN organizations of ON of.id = r.from_org
                JOIN organizations ot ON ot.id = r.to_org
                WHERE ${orgScope(req.ctx, 'of').sql} AND ${orgScope(req.ctx, 'ot').sql}`,
      [...orgScope(req.ctx, 'of').params, ...orgScope(req.ctx, 'ot').params]),
  });
});

router.post('/org', (req, res) => {
  const b = req.body || {};
  if (!b.from_org || !b.to_org || !b.relation_type) {
    return res.status(400).json({ error: 'from_org / to_org / relation_type 必填' });
  }
  const os = orgScope(req.ctx, 'o');
  for (const id of [b.from_org, b.to_org]) {
    const row = get(`SELECT o.id FROM organizations o WHERE o.id = ? AND ${os.sql}`, [Number(id), ...os.params]);
    if (!row) return res.status(404).json({ error: '组织不存在，或没有查看权限' });
  }
  if (!isValidEnum('org_relation_type', b.relation_type)) {
    return res.status(400).json({
      error: `relation_type 非法：${enumValues('org_relation_type').join(' / ')}`,
    });
  }
  const info = run(
    'INSERT INTO org_relations (from_org, to_org, relation_type, note) VALUES (?,?,?,?)',
    [Number(b.from_org), Number(b.to_org), b.relation_type, b.note || null]
  );
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

export default router;
