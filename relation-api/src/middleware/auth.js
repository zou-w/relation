/**
 * 登录校验中间件
 * 所有 /api 业务接口默认都要登录；只有 /api/auth/* 与 health / enums 公开
 */
import { getUserByToken } from '../lib/auth.js';
import { makeCtx } from '../lib/scope.js';

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const user = getUserByToken(token);
  if (!user) {
    return res.status(401).json({ error: '登录已失效，请重新登录', code: 'UNAUTHORIZED' });
  }
  req.user = user;
  req.authToken = token;
  req.ctx = makeCtx(user);
  next();
}

export function adminOnly(req, res, next) {
  if (!req.ctx?.isAdmin) {
    return res.status(403).json({ error: '仅超级管理员可以操作', code: 'FORBIDDEN' });
  }
  next();
}
