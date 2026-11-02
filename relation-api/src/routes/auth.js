/**
 * 登录 / 注册 / 当前账号
 */
import { Router } from 'express';
import { all, get, run } from '../db/driver.js';
import {
  login, createUser, logout, changePassword, publicUser, getUserByToken,
} from '../lib/auth.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

/** 公开注册：只能注册普通账号，超管由后台创建 */
router.post('/register', (req, res, next) => {
  try {
    const b = req.body || {};
    const user = createUser({
      username: b.username,
      password: b.password,
      displayName: b.display_name,
      role: 'user',
      phone: b.phone || null,
      remark: b.remark || null,
      createdBy: 'register',
    });
    // 注册即登录，少一次输入
    const session = login({
      username: user.username,
      password: b.password,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    res.status(201).json({ ok: true, ...session });
  } catch (e) {
    next(e);
  }
});

router.post('/login', (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: '请输入用户名和密码' });
    }
    const session = login({
      username, password,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    res.json({ ok: true, ...session });
  } catch (e) {
    next(e);
  }
});

/** 当前登录人：附上"我录了多少人 / 别人共享给我多少" */
router.get('/me', authRequired, (req, res) => {
  const uid = req.ctx.userId;
  const n = (sql, p = []) => Object.values(get(sql, p) || {})[0] ?? 0;

  const ownPersons = n('SELECT COUNT(*) FROM persons WHERE owner_id = ? AND is_self = 0', [uid]);
  const sharedToMe = n('SELECT COUNT(*) FROM data_shares WHERE grantee_id = ?', [uid]);
  const sharedByMe = n('SELECT COUNT(*) FROM data_shares WHERE owner_id = ?', [uid]);
  const sharedPersons = n(
    `SELECT COUNT(DISTINCT p.id) FROM persons p
      WHERE p.owner_id != ? AND (
        p.owner_id IN (SELECT owner_id FROM data_shares WHERE grantee_id = ? AND person_id IS NULL)
        OR p.id IN (SELECT person_id FROM data_shares WHERE grantee_id = ? AND person_id IS NOT NULL))`,
    [uid, uid, uid]
  );

  res.json({
    user: publicUser(req.user),
    stats: {
      own_persons: ownPersons,
      shared_persons: sharedPersons,
      shares_to_me: sharedToMe,
      shares_by_me: sharedByMe,
    },
  });
});

router.post('/logout', authRequired, (req, res) => {
  logout(req.authToken);
  res.json({ ok: true });
});

router.patch('/password', authRequired, (req, res, next) => {
  try {
    const { old_password, new_password } = req.body || {};
    changePassword(req.user.id, old_password, new_password);
    // 改密后把当前会话之外的全部清掉
    run('DELETE FROM sessions WHERE user_id = ? AND token != ?', [req.user.id, req.authToken]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** 更新自己的显示名 / 电话 / 备注（账号资料，不涉及数据权限） */
router.patch('/profile', authRequired, (req, res) => {
  const b = req.body || {};
  const fields = [];
  const params = [];
  if (b.display_name !== undefined) { fields.push('display_name = ?'); params.push(String(b.display_name).trim().slice(0, 40)); }
  if (b.phone !== undefined) { fields.push('phone = ?'); params.push(String(b.phone).trim().slice(0, 30)); }
  if (b.remark !== undefined) { fields.push('remark = ?'); params.push(String(b.remark).slice(0, 200)); }
  if (!fields.length) return res.status(400).json({ error: '没有可更新的字段' });
  params.push(req.user.id);
  run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
  res.json({ ok: true, user: publicUser(get('SELECT * FROM users WHERE id = ?', [req.user.id])) });
});

/** 供前端启动时静默校验 token 是否还有效 */
router.get('/check', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const user = getUserByToken(token);
  if (!user) return res.status(401).json({ ok: false });
  res.json({ ok: true, user: publicUser(user) });
});

export default router;
