/**
 * 超级管理员后台
 * - 账号管理：新建 / 停用 / 改角色 / 重置密码 / 删除
 * - 登录信息：最后登录时间、活跃会话、IP
 * - 数据共享：把某个账号的数据（全部或指定联系人）授权给另一个账号看
 */
import { Router } from 'express';
import { all, get, run, transaction } from '../db/driver.js';
import { createUser, hashPassword, publicUser } from '../lib/auth.js';
import { adminOnly } from '../middleware/auth.js';

const router = Router();
router.use(adminOnly);

const num = (v) => Number(v) || 0;

function userStats(userId) {
  const uid = String(userId);
  const one = (sql, p = []) => Object.values(get(sql, p) || {})[0] ?? 0;
  return {
    persons: one('SELECT COUNT(*) FROM persons WHERE owner_id = ? AND is_self = 0', [uid]),
    orgs: one('SELECT COUNT(*) FROM organizations WHERE owner_id = ?', [uid]),
    projects: one('SELECT COUNT(*) FROM projects WHERE owner_id = ?', [uid]),
    relations: one('SELECT COUNT(*) FROM relations WHERE owner_id = ?', [uid]),
    shared_out: one('SELECT COUNT(*) FROM data_shares WHERE owner_id = ?', [uid]),
    shared_in: one('SELECT COUNT(*) FROM data_shares WHERE grantee_id = ?', [uid]),
  };
}

/* ---------------- 账号 ---------------- */

router.get('/users', (req, res) => {
  const keyword = req.query.q?.trim();
  let where = ' WHERE 1=1';
  const params = [];
  if (keyword) {
    where += ' AND (u.username LIKE ? OR u.display_name LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const rows = all(
    `SELECT u.*,
            (SELECT COUNT(*) FROM sessions s
              WHERE s.user_id = u.id AND s.expires_at > datetime('now','localtime')) AS active_sessions
       FROM users u ${where} ORDER BY u.id`,
    params
  );

  res.json({
    total: rows.length,
    items: rows.map((r) => ({
      ...publicUser(r),
      active_sessions: r.active_sessions,
      stats: userStats(r.id),
    })),
  });
});

router.post('/users', (req, res, next) => {
  try {
    const b = req.body || {};
    const user = createUser({
      username: b.username,
      password: b.password,
      displayName: b.display_name,
      role: b.role === 'super_admin' ? 'super_admin' : 'user',
      status: b.status === 'disabled' ? 'disabled' : 'active',
      phone: b.phone || null,
      remark: b.remark || null,
      createdBy: req.ctx.userId,
    });
    res.status(201).json({ ok: true, user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

router.patch('/users/:id', (req, res, next) => {
  try {
    const id = num(req.params.id);
    const user = get('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: '账号不存在' });

    const b = req.body || {};
    const fields = [];
    const params = [];

    if (b.display_name !== undefined) { fields.push('display_name = ?'); params.push(String(b.display_name).trim().slice(0, 40)); }
    if (b.phone !== undefined) { fields.push('phone = ?'); params.push(String(b.phone).trim().slice(0, 30)); }
    if (b.remark !== undefined) { fields.push('remark = ?'); params.push(String(b.remark).slice(0, 200)); }

    if (b.status !== undefined) {
      if (!['active', 'disabled'].includes(b.status)) throw Object.assign(new Error('状态取值非法'), { status: 400 });
      if (id === req.user.id && b.status === 'disabled') {
        return res.status(400).json({ error: '不能停用自己当前登录的账号' });
      }
      fields.push('status = ?'); params.push(b.status);
      if (b.status === 'disabled') {
        // 停用即踢下线
        run('DELETE FROM sessions WHERE user_id = ?', [id]);
      }
    }

    if (b.role !== undefined) {
      if (!['user', 'super_admin'].includes(b.role)) {
        return res.status(400).json({ error: '角色取值非法' });
      }
      if (user.role === 'super_admin' && b.role !== 'super_admin') {
        const admins = get("SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin' AND status = 'active'")?.n || 0;
        if (admins <= 1) return res.status(400).json({ error: '至少要保留一个可用的超级管理员' });
      }
      fields.push('role = ?'); params.push(b.role);
    }

    if (!fields.length) return res.status(400).json({ error: '没有可更新的字段' });
    params.push(id);
    run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true, user: publicUser(get('SELECT * FROM users WHERE id = ?', [id])) });
  } catch (e) {
    next(e);
  }
});

router.post('/users/:id/password', (req, res, next) => {
  try {
    const id = num(req.params.id);
    const user = get('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: '账号不存在' });
    const pw = String(req.body?.password || '');
    if (pw.length < 6) return res.status(400).json({ error: '新密码至少 6 位' });

    run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(pw), id]);
    // 重置密码后强制重新登录
    run('DELETE FROM sessions WHERE user_id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.delete('/users/:id', (req, res) => {
  const id = num(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: '不能删除自己' });
  const user = get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) return res.status(404).json({ error: '账号不存在' });
  if (user.role === 'super_admin') {
    const admins = get("SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin'")?.n || 0;
    if (admins <= 1) return res.status(400).json({ error: '至少要保留一个超级管理员' });
  }

  // 账号删除后，名下数据不删：先转交给当前超管，避免联系人变成"无主数据"
  transaction(() => {
    const uid = String(id);
    for (const table of ['persons', 'organizations', 'projects', 'relations']) {
      run(`UPDATE ${table} SET owner_id = ? WHERE owner_id = ?`, [req.ctx.userId, uid]);
    }
    run('DELETE FROM data_shares WHERE owner_id = ? OR grantee_id = ?', [uid, uid]);
    run('DELETE FROM sessions WHERE user_id = ?', [id]);
    run('DELETE FROM users WHERE id = ?', [id]);
  });

  res.json({ ok: true, transferred_to: req.ctx.userId });
});

/* ---------------- 登录信息 ---------------- */

router.get('/sessions', (req, res) => {
  const rows = all(
    `SELECT s.token, s.created_at, s.expires_at, s.user_agent, s.ip,
            u.id AS user_id, u.username, u.display_name
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.expires_at > datetime('now','localtime')
      ORDER BY s.created_at DESC
      LIMIT 30`
  );
  res.json({
    items: rows.map((r) => ({
      ...r,
      // token 只回前 8 位，够辨认，不把凭证完整发给前端
      token: `${r.token.slice(0, 8)}…`,
    })),
  });
});

/* ---------------- 数据共享 ---------------- */

router.get('/shares', (req, res) => {
  const rows = all(
    `SELECT ds.*,
            ou.username AS owner_name, ou.display_name AS owner_display,
            gu.username AS grantee_name, gu.display_name AS grantee_display,
            p.name AS person_name
       FROM data_shares ds
       LEFT JOIN users ou ON CAST(ou.id AS TEXT) = ds.owner_id
       LEFT JOIN users gu ON CAST(gu.id AS TEXT) = ds.grantee_id
       LEFT JOIN persons p ON p.id = ds.person_id
      ORDER BY ds.created_at DESC, ds.id DESC`
  );
  res.json({ items: rows });
});

router.post('/shares', (req, res, next) => {
  try {
    const b = req.body || {};
    const ownerId = String(num(b.owner_id));
    const granteeId = String(num(b.grantee_id));
    if (!ownerId || !granteeId || ownerId === '0' || granteeId === '0') {
      return res.status(400).json({ error: '请选择数据所有者和被共享人' });
    }
    if (ownerId === granteeId) {
      return res.status(400).json({ error: '不能把数据共享给本人' });
    }
    if (!get('SELECT 1 FROM users WHERE id = ?', [Number(ownerId)])) {
      return res.status(404).json({ error: '数据所有者不存在' });
    }
    if (!get('SELECT 1 FROM users WHERE id = ?', [Number(granteeId)])) {
      return res.status(404).json({ error: '被共享人不存在' });
    }

    const personId = b.person_id ? num(b.person_id) : null;
    if (personId) {
      const p = get('SELECT owner_id FROM persons WHERE id = ?', [personId]);
      if (!p) return res.status(404).json({ error: '联系人不存在' });
      if (String(p.owner_id) !== ownerId) {
        return res.status(400).json({ error: '这个人不属于所选的数据所有者' });
      }
    }

    const dup = get(
      `SELECT id FROM data_shares
        WHERE owner_id = ? AND grantee_id = ? AND COALESCE(person_id, 0) = COALESCE(?, 0)`,
      [ownerId, granteeId, personId]
    );
    if (dup) return res.status(409).json({ error: '这条共享已经存在', id: dup.id });

    const info = run(
      `INSERT INTO data_shares (owner_id, grantee_id, person_id, granted_by, note)
       VALUES (?,?,?,?,?)`,
      [ownerId, granteeId, personId, req.ctx.userId, b.note || null]
    );
    res.status(201).json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    next(e);
  }
});

router.delete('/shares/:id', (req, res) => {
  const info = run('DELETE FROM data_shares WHERE id = ?', [num(req.params.id)]);
  if (!info.changes) return res.status(404).json({ error: '共享记录不存在' });
  res.json({ ok: true });
});

/** 某账号名下的联系人，供共享时挑选 */
router.get('/users/:id/persons', (req, res) => {
  const uid = String(num(req.params.id));
  res.json({
    items: all(
      `SELECT id, name, is_key_contact,
              (SELECT o.name FROM employments e JOIN organizations o ON o.id = e.org_id
                WHERE e.person_id = persons.id AND e.is_current = 1 LIMIT 1) AS org_name
         FROM persons WHERE owner_id = ? AND is_self = 0 ORDER BY id`,
      [uid]
    ),
  });
});

export default router;
