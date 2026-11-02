/**
 * 账号与会话
 * - 口令用 scrypt 加盐哈希，永不存明文
 * - 登录签发 Bearer Token，落 sessions 表，30 天有效
 * - 首次启动若无账号，生成一个超级管理员（admin / admin123，可用环境变量覆盖）
 */
import crypto from 'node:crypto';
import { all, get, run, transaction } from '../db/driver.js';

const SESSION_DAYS = 30;
const MIN_PASSWORD = 6;

/** scrypt$N$salt$hash */
export function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plain), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(plain, stored) {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const [, n, saltHex, hashHex] = parts;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expect = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(plain), salt, expect.length, {
      N: Number(n) || 16384, r: 8, p: 1,
    });
    return actual.length === expect.length && crypto.timingSafeEqual(actual, expect);
  } catch {
    return false;
  }
}

function badRequest(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name || row.username,
    role: row.role,
    status: row.status,
    phone: row.phone || '',
    remark: row.remark || '',
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  };
}

/** 用户名只允许字母/数字/下划线，避免登录框里出现奇怪字符 */
export function isValidUsername(v) {
  return /^[a-zA-Z0-9_]{3,32}$/.test(String(v || ''));
}

export function createUser({
  username, password, displayName, role = 'user', status = 'active',
  phone = null, remark = null, createdBy = null,
} = {}) {
  const name = String(username || '').trim();
  if (!isValidUsername(name)) {
    throw badRequest('用户名需为 3-32 位字母、数字或下划线');
  }
  if (String(password || '').length < MIN_PASSWORD) {
    throw badRequest(`密码至少 ${MIN_PASSWORD} 位`);
  }
  if (role !== 'user' && role !== 'super_admin') throw badRequest('角色取值非法');
  if (status !== 'active' && status !== 'disabled') throw badRequest('状态取值非法');

  if (get('SELECT id FROM users WHERE username = ? COLLATE NOCASE', [name])) {
    throw badRequest('这个用户名已被占用', 409);
  }

  const info = run(
    `INSERT INTO users (username, display_name, password_hash, role, status, phone, remark, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [name, displayName?.trim() || name, hashPassword(password), role, status, phone, remark, createdBy]
  );
  return get('SELECT * FROM users WHERE id = ?', [info.lastInsertRowid]);
}

/**
 * 每个账号都需要一个「我」节点：
 * 关系图的中心、触达路径（我→A→B）的起点都靠它。
 * 已有则复用，避免重复创建。
 */
export function ensureSelfPerson(userId, displayName = '我') {
  const uid = String(userId);
  const exists = get('SELECT id FROM persons WHERE owner_id = ? AND is_self = 1', [uid]);
  if (exists) return exists.id;
  const info = run(
    `INSERT INTO persons (name, title, is_self, owner_id, remark)
     VALUES (?,?,1,?,?)`,
    [String(displayName || '我').trim() || '我', '本人', uid, '关系网的中心节点']
  );
  return info.lastInsertRowid;
}

/** 登录：账号 + 口令 → 会话 token */
export function login({ username, password, userAgent, ip } = {}) {
  const user = get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [String(username || '').trim()]);
  // 账号不存在与密码错误给同一个提示，避免被枚举账号
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw badRequest('用户名或密码不正确', 401);
  }
  if (user.status !== 'active') throw badRequest('账号已被停用，请联系管理员', 403);

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = get("SELECT datetime('now','localtime', ?) AS t", [`+${SESSION_DAYS} days`]).t;
  run(
    'INSERT INTO sessions (token, user_id, expires_at, user_agent, ip) VALUES (?,?,?,?,?)',
    [token, user.id, expiresAt, String(userAgent || '').slice(0, 200), String(ip || '').slice(0, 60)]
  );
  run("UPDATE users SET last_login_at = datetime('now','localtime') WHERE id = ?", [user.id]);
  // 顺手清掉过期会话，避免表一直长
  run("DELETE FROM sessions WHERE expires_at < datetime('now','localtime')");
  // 每个账号只保留最近 3 个会话：既够多设备用，又不会让"在线设备"列表刷屏
  const keep = all(
    'SELECT token FROM sessions WHERE user_id = ? ORDER BY rowid DESC LIMIT 3',
    [user.id]
  ).map((r) => r.token);
  if (keep.length) {
    run(
      `DELETE FROM sessions WHERE user_id = ? AND token NOT IN (${keep.map(() => '?').join(',')})`,
      [user.id, ...keep]
    );
  }

  return { token, expires_at: expiresAt, user: publicUser({ ...user, last_login_at: new Date().toISOString() }) };
}

export function getUserByToken(token) {
  if (!token) return null;
  const row = get(
    `SELECT u.*, s.expires_at FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > datetime('now','localtime')
      LIMIT 1`,
    [token]
  );
  if (!row) return null;
  if (row.status !== 'active') return null;
  return row;
}

export function logout(token) {
  if (token) run('DELETE FROM sessions WHERE token = ?', [token]);
  return true;
}

export function changePassword(userId, oldPassword, newPassword) {
  const user = get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) throw badRequest('账号不存在', 404);
  if (!verifyPassword(oldPassword, user.password_hash)) throw badRequest('原密码不正确', 400);
  if (String(newPassword || '').length < MIN_PASSWORD) throw badRequest(`新密码至少 ${MIN_PASSWORD} 位`);
  run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(newPassword), userId]);
  // 改密后其他设备上的会话立即失效，只保留当前这次
  return true;
}

/** 历史数据迁移：老库没有 owner_id 列时补上，并把 'me' 的数据交给第一个超管 */
export function migrateLegacyData() {
  const cols = all('PRAGMA table_info(relations)');
  if (!cols.some((c) => c.name === 'owner_id')) {
    run("ALTER TABLE relations ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'me'");
  }

  const admin = get("SELECT id FROM users WHERE role = 'super_admin' ORDER BY id LIMIT 1");
  if (!admin) return;
  const owner = String(admin.id);
  transaction(() => {
    run("UPDATE persons SET owner_id = ? WHERE owner_id = 'me'", [owner]);
    run("UPDATE organizations SET owner_id = ? WHERE owner_id = 'me'", [owner]);
    run("UPDATE projects SET owner_id = ? WHERE owner_id = 'me'", [owner]);
    run("UPDATE relations SET owner_id = ? WHERE owner_id = 'me'", [owner]);
  });
}

/** 首次启动：没有账号则建一个超管，避免系统直接把所有人挡在门外 */
export function ensureDefaultAdmin() {
  const n = get('SELECT COUNT(*) AS n FROM users')?.n || 0;
  if (n > 0) return null;

  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const user = createUser({
    username,
    password,
    displayName: '超级管理员',
    role: 'super_admin',
    createdBy: 'system',
  });
  console.warn(`[auth] 已创建超级管理员：${username} / ${password}（请登录后立即修改密码）`);
  return user;
}
