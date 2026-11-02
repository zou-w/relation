/**
 * Excel 解析与校验
 *
 * 原则：宽进严出
 * - 尽量容忍用户的小毛病（多余空格、全角符号、手机号带横杠）
 * - 真正影响数据质量的问题才拦下来（姓名缺失、枚举不认识）
 * - 能自动修正的给 warning，让用户知道但不用返工
 */
import ExcelJS from 'exceljs';
import { COLUMNS } from './excel-template.js';
import { enumKey, enumLabels } from './enums.js';
import { all } from '../db/driver.js';
import { personScope } from './scope.js';

const MAX_ROWS = 500;
const MAX_ATTRS = 8;

/* ============================================================
 * 单元格取值：兼容富文本、超链接、公式、日期、数字
 * ========================================================== */
function cellText(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('').trim();
    if (v.text) return String(v.text).trim();
    if (v.result !== undefined) return String(v.result).trim();
    if (v.hyperlink) return String(v.hyperlink).trim();
  }
  return String(v).trim();
}

/** 表头文本归一：去掉 * 号、空格、全角括号 */
function normHeader(s) {
  return String(s || '')
    .replace(/[*＊\s]/g, '')
    .replace(/[（）()]/g, '')
    .trim();
}

/* ============================================================
 * 定位表头
 * 允许用户在表格上方插入说明行，因此在前 12 行里找「姓名」列
 * ========================================================== */
function locateHeader(ws) {
  const maxScan = Math.min(12, ws.rowCount || 12);
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r);
    let hit = false;
    const mapping = {};
    for (let c = 1; c <= Math.max(ws.columnCount || 0, COLUMNS.length); c++) {
      const text = normHeader(cellText(row.getCell(c)));
      if (!text) continue;
      const col = COLUMNS.find((x) => normHeader(x.header) === text);
      if (col) mapping[col.key] = c;
      if (col?.key === 'name') hit = true;
    }
    if (hit) return { headerRow: r, mapping };
  }
  return null;
}

/* ============================================================
 * 字段归一化
 * ========================================================== */
function normalizePhone(raw) {
  const s = String(raw || '').replace(/[\s\-－—()（）]/g, '');
  if (!s) return { value: null };
  // Excel 有时把长数字转成科学计数法
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return checkPhone(String(Math.round(n)));
  }
  return checkPhone(s);
}

function checkPhone(s) {
  const digits = s.replace(/\D/g, '');
  if (/^1[3-9]\d{9}$/.test(digits)) return { value: digits };
  if (digits.length === 11) return { value: digits, warning: `手机号「${s}」号段不常见，已按原样保存` };
  return { value: digits || s, warning: `手机号「${s}」不是 11 位，已按原样保存` };
}

function normalizeDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return { value: null };
  const m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (!m) return { value: s, warning: `出生日期「${s}」格式不规范，建议用 YYYY-MM-DD` };
  const [, y, mo, d] = m;
  const mm = Number(mo);
  const dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
    return { value: s, warning: `出生日期「${s}」不是一个有效日期` };
  }
  return { value: `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}` };
}

function normalizeGender(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'unknown';
  if (['男', 'male', 'm', '先生'].includes(s)) return 'male';
  if (['女', 'female', 'f', '女士'].includes(s)) return 'female';
  return 'unknown';
}

function normalizeBool(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 0;
  return ['是', 'y', 'yes', 'true', '1', '重点', '√'].includes(s) ? 1 : 0;
}

function splitAttrs(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  return [...new Set(
    s.split(/[、,，;；/|｜]+/).map((x) => x.trim()).filter(Boolean)
  )].slice(0, MAX_ATTRS);
}

/* ============================================================
 * 主解析流程
 * ========================================================== */
export async function parseWorkbook(buffer, { checkDuplicate = true, ctx = null } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = wb.getWorksheet('联系人') || wb.worksheets[0];
  if (!ws) {
    const err = new Error('文件里没有找到任何工作表');
    err.status = 400;
    throw err;
  }

  const located = locateHeader(ws);
  if (!located) {
    const err = new Error('没找到表头。请使用官方模板，确保存在「姓名」列');
    err.status = 400;
    throw err;
  }
  const { headerRow, mapping } = located;

  // 缺少的列：提示但继续
  const missing = COLUMNS.filter((c) => c.required && !mapping[c.key]).map((c) => c.header);
  if (missing.length) {
    const err = new Error(`模板缺少必填列：${missing.join('、')}`);
    err.status = 400;
    throw err;
  }

  /* -------- 读取原始行 -------- */
  const rawRows = [];
  const lastRow = Math.min(ws.rowCount, headerRow + MAX_ROWS + 50);

  for (let r = headerRow + 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const rec = {};
    let hasAny = false;
    for (const col of COLUMNS) {
      const c = mapping[col.key];
      const text = c ? cellText(row.getCell(c)) : '';
      rec[col.key] = text;
      if (text) hasAny = true;
    }
    if (!hasAny) continue;
    // 显式示例行：整行跳过
    if (/^示例/.test(rec.name) || (rec.remark && rec.remark.includes('示例行'))) continue;
    rawRows.push({ rowNumber: r, rec });
  }

  if (!rawRows.length) {
    const err = new Error('文件里没有数据。请从第 4 行开始填写联系人');
    err.status = 400;
    throw err;
  }
  if (rawRows.length > MAX_ROWS) {
    const err = new Error(`单次最多导入 ${MAX_ROWS} 行，当前 ${rawRows.length} 行。请拆分文件`);
    err.status = 400;
    throw err;
  }

  /* -------- 已有数据索引（用于判重） -------- */
  let existingIndex = new Map();
  if (checkDuplicate) {
    const ps = personScope(ctx, 'p');
    const rows = all(`
      SELECT p.id, p.name,
             (SELECT o.name FROM employments e JOIN organizations o ON o.id = e.org_id
              WHERE e.person_id = p.id AND e.is_current = 1 LIMIT 1) AS org_name
        FROM persons p
       WHERE p.is_self = 0 AND ${ps.sql}
    `, ps.params);
    for (const r of rows) {
      existingIndex.set(`${(r.name || '').trim()}||${(r.org_name || '').trim()}`, r.id);
    }
  }

  /* -------- 逐行校验 -------- */
  const seenInFile = new Map();
  const rows = rawRows.map(({ rowNumber, rec }) => {
    const errors = [];
    const warnings = [];
    const data = {};

    // 姓名
    const name = (rec.name || '').replace(/\s+/g, '');
    if (!name) errors.push('姓名不能为空');
    else if (name.length > 40) errors.push('姓名超过 40 个字');
    else if (/^[\d.]+$/.test(name)) errors.push('姓名疑似数字，请确认');
    else data.name = name;

    // 单位 / 职务 / 部门
    data.org_name = (rec.org_name || '').trim() || null;
    data.position = (rec.position || '').trim() || null;
    data.department = (rec.department || '').trim() || null;

    // 枚举：权力角色 / 认识途径 / 涉敏等级
    for (const key of ['power_level', 'met_way', 'sensitivity']) {
      const raw = (rec[key] || '').trim();
      if (!raw) { data[key] = null; continue; }
      const v = enumKey(key, raw);
      if (v === undefined) {
        errors.push(`${COLUMNS.find((c) => c.key === key)?.header}「${raw}」不认识，可选：${enumLabels(key).join(' / ')}`);
      } else {
        data[key] = v;
      }
    }

    // 手机号 / 微信 / 邮箱
    const phone = normalizePhone(rec.phone);
    data.phone = phone.value;
    if (phone.warning) warnings.push(phone.warning);

    data.wechat = (rec.wechat || '').trim() || null;

    const email = (rec.email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      warnings.push(`邮箱「${email}」格式可能不对，已按原样保存`);
    }
    data.email = email || null;

    // 性别 / 重点 / 生日 / 备注
    data.gender = normalizeGender(rec.gender);
    const keyRaw = String(rec.is_key_contact || '').trim();
    data.is_key_contact = normalizeBool(keyRaw);
    // 区分「没填」和「填了否」，否则更新时无法把重点人物降级
    data.is_key_contact_set = !!keyRaw;

    const bd = normalizeDate(rec.birthday);
    data.birthday = bd.value;
    if (bd.warning) warnings.push(bd.warning);

    data.remark = (rec.remark || '').trim() || null;
    data.attrs = splitAttrs(rec.attrs);
    if ((rec.attrs || '').split(/[、,，;；/|｜]+/).filter(Boolean).length > MAX_ATTRS) {
      warnings.push(`资源标签超过 ${MAX_ATTRS} 个，只保留前 ${MAX_ATTRS} 个`);
    }

    /* ---- 判重 ---- */
    let action = 'create';
    let matchedId = null;

    if (data.name) {
      const key = `${data.name}||${data.org_name || ''}`;
      const fileHit = seenInFile.get(key);
      if (fileHit) {
        action = 'duplicate-in-file';
        warnings.push(`与第 ${fileHit} 行重复（姓名 + 单位相同）`);
      } else {
        seenInFile.set(key, rowNumber);
      }

      if (action === 'create' && checkDuplicate) {
        // 先按「姓名 + 单位」精确匹配
        let hit = existingIndex.get(key);
        // 退一步：同名且单位都为空的
        if (!hit) {
          const nameOnly = [...existingIndex.entries()].find(([k]) => k.startsWith(`${data.name}||`));
          if (nameOnly && !data.org_name) hit = nameOnly[1];
        }
        if (hit) {
          action = 'update';
          matchedId = hit;
        }
      }
    }

    const status = errors.length ? 'error' : warnings.length ? 'warning' : 'ok';

    return {
      rowNumber,
      status,
      action,
      matchedId,
      errors,
      warnings,
      data,
      raw: rec,
    };
  });

  /* -------- 汇总 -------- */
  const summary = {
    total: rows.length,
    ok: rows.filter((r) => r.status === 'ok').length,
    warning: rows.filter((r) => r.status === 'warning').length,
    error: rows.filter((r) => r.status === 'error').length,
    create: rows.filter((r) => r.action === 'create' && r.status !== 'error').length,
    update: rows.filter((r) => r.action === 'update' && r.status !== 'error').length,
    duplicateInFile: rows.filter((r) => r.action === 'duplicate-in-file').length,
  };

  return { rows, summary, headerRow, columns: COLUMNS.map((c) => c.header) };
}
