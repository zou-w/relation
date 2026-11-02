/**
 * 数据可见范围
 *
 * 规则（一句话）：
 * - 超级管理员：全部可见、可改
 * - 普通账号：自己的数据 + 别人共享给自己的数据（共享只读）
 *
 * 共享粒度两种：整份数据（person_id 为空）或指定联系人。
 * 单位 / 项目跟着"人"走：能看到人，就能看到他的任职单位与参与项目，否则图谱会断。
 */
import { get } from '../db/driver.js';

export function makeCtx(user) {
  if (!user) return null;
  return {
    userId: String(user.id),
    username: user.username,
    role: user.role,
    isAdmin: user.role === 'super_admin',
  };
}

/** 人员可见条件，拼进 WHERE */
export function personScope(ctx, alias = 'p') {
  if (!ctx || ctx.isAdmin) return { sql: '1=1', params: [] };
  return {
    sql: `(${alias}.owner_id = ?
           OR ${alias}.owner_id IN (
                SELECT ds.owner_id FROM data_shares ds
                 WHERE ds.grantee_id = ? AND ds.person_id IS NULL)
           OR ${alias}.id IN (
                SELECT ds2.person_id FROM data_shares ds2
                 WHERE ds2.grantee_id = ? AND ds2.person_id IS NOT NULL))`,
    params: [ctx.userId, ctx.userId, ctx.userId],
  };
}

/** 可见人员的子查询，供单位 / 项目 / 关系复用 */
export function visiblePersonIds(ctx) {
  const s = personScope(ctx, 'pv');
  return { sql: `SELECT pv.id FROM persons pv WHERE ${s.sql}`, params: s.params };
}

export function orgScope(ctx, alias = 'o') {
  if (!ctx || ctx.isAdmin) return { sql: '1=1', params: [] };
  const vp = visiblePersonIds(ctx);
  return {
    sql: `(${alias}.owner_id = ?
           OR ${alias}.id IN (
                SELECT e.org_id FROM employments e
                 WHERE e.person_id IN (${vp.sql})))`,
    params: [ctx.userId, ...vp.params],
  };
}

export function projectScope(ctx, alias = 'pr') {
  if (!ctx || ctx.isAdmin) return { sql: '1=1', params: [] };
  const vp = visiblePersonIds(ctx);
  const os = orgScope(ctx, 'ov');
  return {
    sql: `(${alias}.owner_id = ?
           OR ${alias}.owner_org_id IN (
                SELECT ov.id FROM organizations ov WHERE ${os.sql})
           OR ${alias}.id IN (
                SELECT pm.project_id FROM project_members pm
                 WHERE pm.person_id IN (${vp.sql})))`,
    params: [ctx.userId, ...os.params, ...vp.params],
  };
}

/** 关系只有两端的人都在可见范围内才出现（避免"半条边"） */
export function relationScope(ctx, fromAlias = 'r') {
  if (!ctx || ctx.isAdmin) return { sql: '1=1', params: [] };
  const vp = visiblePersonIds(ctx);
  return {
    sql: `(${fromAlias}.from_person IN (${vp.sql}) AND ${fromAlias}.to_person IN (${vp.sql}))`,
    params: [...vp.params, ...vp.params],
  };
}

/* ---------------- 写权限：只有自己的数据能改，超管例外 ---------------- */

export function canWritePerson(ctx, personId) {
  if (!ctx) return false;
  const row = get('SELECT owner_id FROM persons WHERE id = ?', [personId]);
  if (!row) return false;
  return ctx.isAdmin || String(row.owner_id) === ctx.userId;
}

export function canReadPerson(ctx, personId) {
  if (!ctx) return false;
  if (ctx.isAdmin) return !!get('SELECT 1 FROM persons WHERE id = ?', [personId]);
  const s = personScope(ctx, 'p');
  return !!get(`SELECT 1 FROM persons p WHERE p.id = ? AND ${s.sql}`, [personId, ...s.params]);
}

export function canWriteOrg(ctx, orgId) {
  if (!ctx) return false;
  const row = get('SELECT owner_id FROM organizations WHERE id = ?', [orgId]);
  if (!row) return false;
  return ctx.isAdmin || String(row.owner_id) === ctx.userId;
}

export function canWriteProject(ctx, projectId) {
  if (!ctx) return false;
  const row = get('SELECT owner_id FROM projects WHERE id = ?', [projectId]);
  if (!row) return false;
  return ctx.isAdmin || String(row.owner_id) === ctx.userId;
}

/** 数据是不是"别人共享给我的"——只读，前端要标出来 */
export function isForeign(ctx, ownerId) {
  return !!ctx && !ctx.isAdmin && String(ownerId) !== ctx.userId;
}
