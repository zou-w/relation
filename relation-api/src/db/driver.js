/**
 * 数据库双驱动封装
 * 优先 better-sqlite3（性能更好），装不上自动回退 Node 内置 node:sqlite（零依赖）
 * 对内统一暴露：all / get / run / transaction
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '../..');

const DB_PATH = process.env.DB_PATH || join(ROOT, 'data', 'relation.db');

let driver = null;
let raw = null;

/**
 * 初始化连接。同步完成，避免 ESM 与原生模块的顶层 await 兼容问题。
 */
export function initDB() {
  mkdirSync(dirname(DB_PATH), { recursive: true });

  let Better = null;
  if (process.env.DB_DRIVER !== 'node') {
    try {
      const req = createRequire(import.meta.url);
      Better = req('better-sqlite3');
    } catch {
      Better = null; // 未安装或编译失败，走内置驱动
    }
  }

  if (Better) {
    raw = new Better(DB_PATH);
    driver = 'better-sqlite3';
  } else {
    // node:sqlite 是同步 API，但模块加载是异步的
    // 这里用 createRequire 拿不到 ESM builtin，改用同步 require 兜底
    // 实际在 server.js 中会 await initDBAsync()，这里抛错提示
    throw new Error('NEED_ASYNC_INIT');
  }

  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA journal_mode = WAL');
  return driver;
}

/** 异步初始化（内置驱动走这条路） */
export async function initDBAsync() {
  mkdirSync(dirname(DB_PATH), { recursive: true });

  let Better = null;
  if (process.env.DB_DRIVER !== 'node') {
    try {
      const req = createRequire(import.meta.url);
      Better = req('better-sqlite3');
    } catch {
      Better = null;
    }
  }

  if (Better) {
    raw = new Better(DB_PATH);
    driver = 'better-sqlite3';
  } else {
    const { DatabaseSync } = await import('node:sqlite');
    raw = new DatabaseSync(DB_PATH);
    driver = 'node:sqlite';
  }

  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA journal_mode = WAL');
  return driver;
}

export function getDriver() {
  if (!raw) throw new Error('数据库未初始化，请先调用 initDBAsync()');
  return driver;
}

/** 建表（读取 schema.sql） */
export function createSchema() {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  raw.exec(sql);
  return true;
}

/**
 * 参数归一化：node:sqlite 拒绝绑定 undefined，
 * 同时拒绝 boolean / 对象等非标量类型，这里统一转换
 */
function normalize(params = []) {
  return params.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  });
}

/** 查询多行 */
export function all(sql, params = []) {
  return raw.prepare(sql).all(...normalize(params));
}

/** 查询单行 */
export function get(sql, params = []) {
  return raw.prepare(sql).get(...normalize(params)) ?? null;
}

/** 执行写操作 */
export function run(sql, params = []) {
  const r = raw.prepare(sql).run(...normalize(params));
  return {
    changes: Number(r.changes),
    lastInsertRowid: Number(r.lastInsertRowid),
  };
}

/**
 * 事务包装：两种驱动 API 不同（better-sqlite3 有 transaction()，内置没有）
 * 统一用 BEGIN/COMMIT 手动管理
 */
export function transaction(fn) {
  raw.exec('BEGIN');
  try {
    const result = fn();
    raw.exec('COMMIT');
    return result;
  } catch (e) {
    try { raw.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

export function rawDB() {
  return raw;
}

export function closeDB() {
  try { raw?.close(); } catch { /* ignore */ }
}

export { DB_PATH };
