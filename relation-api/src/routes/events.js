/**
 * 接触事件路由 —— "记录我在工作中接触的人"的直接落地
 */
import { Router } from 'express';
import { all, get, run } from '../db/driver.js';
import { isValidEnum, enumValues } from '../lib/enums.js';
import { pendingEvents, coldContacts } from '../lib/queries.js';
import { canWritePerson, personScope } from '../lib/scope.js';

const router = Router();

/** 记录一次接触，自动关联其现任单位 */
router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.person_id) return res.status(400).json({ error: 'person_id 必填' });
  if (!b.event_date) return res.status(400).json({ error: 'event_date 必填' });

  const person = get('SELECT id FROM persons WHERE id = ?', [Number(b.person_id)]);
  if (!person) return res.status(404).json({ error: '联系人不存在' });
  if (!canWritePerson(req.ctx, Number(b.person_id))) {
    return res.status(403).json({ error: '这是别人共享给你的数据，只能查看，不能记录接触' });
  }

  if (b.scene && !isValidEnum('scene', b.scene)) {
    return res.status(400).json({
      error: `scene 取值非法：${b.scene}；合法值：${enumValues('scene').join(' / ')}`,
    });
  }

  // 未指定单位则自动取任职
  let orgId = b.org_id ? Number(b.org_id) : null;
  if (!orgId) {
    const emp = get(
      'SELECT org_id FROM employments WHERE person_id = ? AND is_current = 1 LIMIT 1',
      [Number(b.person_id)]
    );
    orgId = emp?.org_id ?? null;
  }

  const info = run(
    `INSERT INTO contact_events (person_id, org_id, event_date, scene, subject, next_action, next_date)
     VALUES (?,?,?,?,?,?,?)`,
    [Number(b.person_id), orgId, b.event_date, b.scene || null,
     b.subject || null, b.next_action || null, b.next_date || null]
  );

  res.status(201).json({
    ok: true,
    id: info.lastInsertRowid,
    org_id: orgId,
    auto_org: !b.org_id && !!orgId,
  });
});

/** 事件列表 */
router.get('/', (req, res) => {
  const { person_id, limit } = req.query;
  let sql = `SELECT ce.*, p.name AS person_name, o.name AS org_name
             FROM contact_events ce
             JOIN persons p ON p.id = ce.person_id
             LEFT JOIN organizations o ON o.id = ce.org_id
             WHERE ${personScope(req.ctx, 'p').sql}`;
  const params = [...personScope(req.ctx, 'p').params];
  if (person_id) { sql += ' AND ce.person_id = ?'; params.push(Number(person_id)); }
  sql += ' ORDER BY ce.event_date DESC LIMIT ?';
  params.push(Math.min(Number(limit) || 50, 200));
  res.json({ items: all(sql, params) });
});

/** 待办跟进：逾期 / 今日 / 未来 N 天 */
router.get('/pending', (req, res) => {
  res.json(pendingEvents(Number(req.query.days) || 7, req.ctx));
});

/** 冷接触提醒 */
router.get('/cold', (req, res) => {
  res.json({ items: coldContacts(Number(req.query.days) || 30, req.ctx) });
});

/** 勾选完成 */
router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const exist = get('SELECT id, person_id FROM contact_events WHERE id = ?', [id]);
  if (!exist) return res.status(404).json({ error: '事件不存在' });
  if (!canWritePerson(req.ctx, exist.person_id)) {
    return res.status(403).json({ error: '这条记录属于别人共享的数据，不能修改' });
  }

  const b = req.body || {};
  const fields = [];
  const params = [];
  if (b.is_done !== undefined) { fields.push('is_done = ?'); params.push(b.is_done ? 1 : 0); }
  if (b.subject !== undefined) { fields.push('subject = ?'); params.push(b.subject); }
  if (b.next_action !== undefined) { fields.push('next_action = ?'); params.push(b.next_action); }
  if (b.next_date !== undefined) { fields.push('next_date = ?'); params.push(b.next_date); }

  if (!fields.length) return res.status(400).json({ error: '没有可更新的字段' });
  params.push(id);
  run(`UPDATE contact_events SET ${fields.join(', ')} WHERE id = ?`, params);
  res.json({ ok: true });
});

/** 删除 */
router.delete('/:id', (req, res) => {
  const row = get('SELECT person_id FROM contact_events WHERE id = ?', [Number(req.params.id)]);
  if (row && !canWritePerson(req.ctx, row.person_id)) {
    return res.status(403).json({ error: '这条记录属于别人共享的数据，不能删除' });
  }
  const info = run('DELETE FROM contact_events WHERE id = ?', [Number(req.params.id)]);
  if (!info.changes) return res.status(404).json({ error: '事件不存在' });
  res.json({ ok: true });
});

export default router;
