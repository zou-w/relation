/**
 * 联系人路由
 */
import { Router } from 'express';
import { all, get, run, transaction } from '../db/driver.js';
import { encrypt, decrypt, maskPhone } from '../lib/crypto.js';
import { isValidEnum, enumValues } from '../lib/enums.js';
import { findPersons, countPersons, getPerson, ensureOrg } from '../lib/queries.js';
import { canWritePerson, personScope } from '../lib/scope.js';

const router = Router();

/** 校验枚举字段，非法则抛错 */
function checkEnum(field, value, label) {
  if (!isValidEnum(field, value)) {
    const err = new Error(`${label || field} 取值非法：${value}；合法值：${enumValues(field).join(' / ')}`);
    err.status = 400;
    throw err;
  }
}

/* ---------------- 查人 ---------------- */
router.get('/', (req, res) => {
  const { keyword, key_only, org_id, has_attr, missing_phone, limit, offset, page, page_size } = req.query;

  const kw = keyword?.trim() || null;
  const keyOnly = key_only === '1' || key_only === 'true';
  const hasAttr = has_attr === '1' || has_attr === 'true';
  const missingPhone = missing_phone === '1' || missing_phone === 'true';
  const orgId = org_id ? Number(org_id) : null;

  // 两种分页写法都支持：limit/offset 或 page/page_size
  let size;
  let skip;
  if (page_size !== undefined) {
    size = Math.min(Math.max(Number(page_size) || 50, 1), 500);
    skip = (Math.max(Number(page) || 1, 1) - 1) * size;
  } else {
    size = Math.min(Math.max(Number(limit) || 50, 1), 500);
    skip = Math.max(Number(offset) || 0, 0);
  }

  const base = { keyword: kw, keyOnly, orgId, hasAttr, missingPhone };
  const items = findPersons({ ...base, limit: size, offset: skip }, req.ctx);
  const total = countPersons(base, req.ctx);

  res.json({ total, items, page_size: size, offset: skip });
});

/* ---------------- 快速录入 ---------------- */
router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) {
    return res.status(400).json({ error: '姓名(name) 必填' });
  }

  checkEnum('met_way', b.met_way, '认识途径');
  checkEnum('power_level', b.power_level, '权力角色');
  checkEnum('sensitivity', b.sensitivity, '涉敏等级');

  // 「我」是触达路径的起点，一个账号只允许一个
  const wantSelf = b.is_self === true || b.is_self === 1 || b.is_self === '1';
  if (wantSelf) {
    const exists = get('SELECT id FROM persons WHERE owner_id = ? AND is_self = 1', [req.ctx.userId]);
    if (exists) {
      return res.status(400).json({ error: '你已经有「我」这个节点了，不能重复创建' });
    }
  }

  const result = transaction(() => {
    const p = run(
      `INSERT INTO persons (name, title, gender, phone, wechat, email, birthday,
                            met_way, is_key_contact, sensitivity, remark, is_self, owner_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        String(b.name).trim(),
        b.title || b.position || null,
        b.gender || 'unknown',
        encrypt(b.phone),
        encrypt(b.wechat),
        b.email || null,
        b.birthday || null,
        b.met_way || null,
        b.is_key_contact ? 1 : 0,
        b.sensitivity || 'normal',
        b.remark || null,
        wantSelf ? 1 : 0,
        req.ctx.userId,
      ]
    );
    const personId = p.lastInsertRowid;

    let orgId = null;
    if (b.org_name) {
      orgId = ensureOrg(String(b.org_name).trim(), req.ctx);
      run(
        `INSERT INTO employments (person_id, org_id, position, department, power_level, is_current)
         VALUES (?,?,?,?,?,1)`,
        [personId, orgId, b.position || b.title || null, b.department || null, b.power_level || 'unknown']
      );
    }

    // 可选：记录一条"认识"事件
    if (b.met_date) {
      run(
        `INSERT INTO contact_events (person_id, org_id, event_date, scene, subject)
         VALUES (?,?,?,?,?)`,
        [personId, orgId, b.met_date, b.scene || null, b.remark || '首次认识']
      );
    }

    return { id: personId, org_id: orgId };
  });

  res.status(201).json({ ok: true, ...result });
});

/* ---------------- 批量删除 ---------------- */
router.post('/batch-delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) return res.status(400).json({ error: '请提供要删除的 ids' });
  if (ids.length > 500) return res.status(400).json({ error: '单次最多删除 500 人' });

  const placeholders = ids.map(() => '?').join(',');
  // 本人节点保护 + 只允许删自己的数据（超管例外）
  const selfs = all(`SELECT id FROM persons WHERE id IN (${placeholders}) AND is_self = 1`, ids);
  const owned = req.ctx.isAdmin
    ? ids
    : all(`SELECT id FROM persons WHERE id IN (${placeholders}) AND owner_id = ?`, [...ids, req.ctx.userId]).map((r) => r.id);
  const deletable = owned.filter((id) => !selfs.some((s) => s.id === id));

  let deleted = 0;
  if (deletable.length) {
    const ph = deletable.map(() => '?').join(',');
    const info = run(`DELETE FROM persons WHERE id IN (${ph})`, deletable);
    deleted = info.changes;
  }

  res.json({
    ok: true,
    deleted,
    skippedSelf: selfs.map((s) => s.id),
  });
});

/* ---------------- 详情 ---------------- */
router.get('/:id', (req, res) => {
  const p = getPerson(Number(req.params.id), req.ctx);
  if (!p) return res.status(404).json({ error: '联系人不存在，或没有查看权限' });
  res.json(p);
});

/* ---------------- 补全 / 编辑 ---------------- */
router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const exist = get('SELECT * FROM persons WHERE id = ?', [id]);
  if (!exist) return res.status(404).json({ error: '联系人不存在' });
  if (!canWritePerson(req.ctx, id)) {
    return res.status(403).json({ error: '这是别人共享给你的数据，只能查看，不能修改' });
  }

  const b = req.body || {};
  checkEnum('met_way', b.met_way, '认识途径');
  checkEnum('sensitivity', b.sensitivity, '涉敏等级');

  const fields = [];
  const params = [];
  const set = (col, val) => { fields.push(`${col} = ?`); params.push(val); };

  if (b.name !== undefined) set('name', b.name);
  if (b.title !== undefined) set('title', b.title);
  if (b.gender !== undefined) set('gender', b.gender);
  if (b.phone !== undefined) set('phone', encrypt(b.phone));
  if (b.wechat !== undefined) set('wechat', encrypt(b.wechat));
  if (b.email !== undefined) set('email', b.email);
  if (b.birthday !== undefined) set('birthday', b.birthday);
  if (b.met_way !== undefined) set('met_way', b.met_way);
  if (b.is_key_contact !== undefined) set('is_key_contact', b.is_key_contact ? 1 : 0);
  if (b.sensitivity !== undefined) set('sensitivity', b.sensitivity);
  if (b.remark !== undefined) set('remark', b.remark);
  if (b.is_self !== undefined) {
    const on = b.is_self === true || b.is_self === 1 || b.is_self === '1';
    if (on) {
      // 换本人节点：同一个人只能有一个「我」
      run('UPDATE persons SET is_self = 0 WHERE owner_id = ? AND id != ?', [exist.owner_id, id]);
    }
    set('is_self', on ? 1 : 0);
  }

  // 任职变更
  if (b.org_name) {
    const orgId = ensureOrg(b.org_name, req.ctx);
    run('UPDATE employments SET is_current = 0, end_date = date(\'now\',\'localtime\') WHERE person_id = ? AND is_current = 1', [id]);
    run(
      `INSERT INTO employments (person_id, org_id, position, department, power_level, is_current)
       VALUES (?,?,?,?,?,1)`,
      [id, orgId, b.position || b.title || null, b.department || null, b.power_level || 'unknown']
    );
  } else if (b.position !== undefined) {
    run('UPDATE employments SET position = ? WHERE person_id = ? AND is_current = 1', [b.position, id]);
  }

  if (fields.length) {
    fields.push("updated_at = datetime('now','localtime')");
    params.push(id);
    run(`UPDATE persons SET ${fields.join(', ')} WHERE id = ?`, params);
  }

  res.json({ ok: true, person: getPerson(id, req.ctx) });
});

/* ---------------- 删除 ---------------- */
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const exist = get('SELECT id, is_self FROM persons WHERE id = ?', [id]);
  if (!exist) return res.status(404).json({ error: '联系人不存在' });
  if (!canWritePerson(req.ctx, id)) {
    return res.status(403).json({ error: '这是别人共享给你的数据，不能删除' });
  }
  if (exist.is_self) return res.status(400).json({ error: '不能删除本人节点' });
  run('DELETE FROM persons WHERE id = ?', [id]);
  res.json({ ok: true });
});

/* ---------------- 一跳邻居（图谱按需加载） ---------------- */
router.get('/:id/neighbors', (req, res) => {
  const id = Number(req.params.id);
  const scope = personScope(req.ctx, 'p');
  const person = get(`SELECT p.id, p.name FROM persons p WHERE p.id = ? AND ${scope.sql}`, [id, ...scope.params]);
  if (!person) return res.status(404).json({ error: '联系人不存在，或没有查看权限' });

  const neighbors = all(
    `SELECT DISTINCT p.id, p.name, p.is_key_contact,
            r.relation_type, r.strength, r.influence,
            (SELECT o.name FROM employments e JOIN organizations o ON o.id = e.org_id
             WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS org_name
     FROM relations r
     JOIN persons p ON p.id = CASE WHEN r.from_person = ? THEN r.to_person ELSE r.from_person END
     WHERE r.from_person = ? OR r.to_person = ?`,
    [id, id, id]
  );

  const orgs = all(
    `SELECT o.id, o.name, o.org_type, e.position, e.power_level
     FROM employments e JOIN organizations o ON o.id = e.org_id
     WHERE e.person_id = ? AND e.is_current = 1`,
    [id]
  );

  res.json({ person, neighbors, orgs });
});

/* ---------------- 资源画像打标 ---------------- */
router.post('/:id/attributes', (req, res) => {
  const id = Number(req.params.id);
  if (!get('SELECT id FROM persons WHERE id = ?', [id])) {
    return res.status(404).json({ error: '联系人不存在' });
  }
  if (!canWritePerson(req.ctx, id)) {
    return res.status(403).json({ error: '这是别人共享给你的数据，只能查看' });
  }
  const b = req.body || {};
  if (!b.attr_type || !b.attr_value) {
    return res.status(400).json({ error: 'attr_type 与 attr_value 必填' });
  }
  checkEnum('attr_type', b.attr_type, '画像类型');

  const info = run(
    'INSERT INTO person_attributes (person_id, attr_type, attr_value, weight, note) VALUES (?,?,?,?,?)',
    [id, b.attr_type, String(b.attr_value).trim(), Math.min(Math.max(Number(b.weight) || 3, 1), 5), b.note || null]
  );
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

router.delete('/:id/attributes/:attrId', (req, res) => {
  if (!canWritePerson(req.ctx, Number(req.params.id))) {
    return res.status(403).json({ error: '这是别人共享给你的数据，只能查看' });
  }
  const info = run('DELETE FROM person_attributes WHERE id = ? AND person_id = ?',
    [Number(req.params.attrId), Number(req.params.id)]);
  if (!info.changes) return res.status(404).json({ error: '画像不存在' });
  res.json({ ok: true });
});

export default router;
