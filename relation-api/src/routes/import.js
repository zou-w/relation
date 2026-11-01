/**
 * Excel 批量导入
 *
 * 流程：下载模板 → 上传预检（不写库）→ 确认导入
 * 预检与导入复用同一套解析逻辑，保证「看到的」就是「写进去的」
 */
import { Router } from 'express';
import express from 'express';
import { run, get, transaction } from '../db/driver.js';
import { encrypt } from '../lib/crypto.js';
import { ensureOrg } from '../lib/queries.js';
import { buildTemplate, templateMeta } from '../lib/excel-template.js';
import { parseWorkbook } from '../lib/excel-parse.js';

const router = Router();

/** 接收二进制 xlsx（不走 multipart，零额外依赖） */
const rawBody = express.raw({
  type: ['application/octet-stream', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
  limit: '12mb',
});

function assertXlsx(req) {
  if (!req.body || !Buffer.isBuffer(req.body) || req.body.length < 100) {
    const err = new Error('没有收到文件内容，请重新选择文件');
    err.status = 400;
    throw err;
  }
  // xlsx 本质是 zip，魔数 PK\x03\x04
  if (!(req.body[0] === 0x50 && req.body[1] === 0x4b)) {
    const err = new Error('这不是一个 .xlsx 文件。如果是 .xls 或 .csv，请先用 Excel 另存为 .xlsx');
    err.status = 400;
    throw err;
  }
}

/* ============================================================
 * 模板下载
 * ========================================================== */
router.get('/template', async (req, res, next) => {
  try {
    const buf = await buildTemplate();
    const filename = '人脉关系网-联系人导入模板.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="contacts-import-template.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  } catch (e) {
    next(e);
  }
});

/** 模板字段清单，前端用来渲染"填写要求" */
router.get('/fields', (req, res) => {
  res.json({ fields: templateMeta(), maxRows: 500 });
});

/* ============================================================
 * 预检：只解析、只校验，不写库
 * ========================================================== */
router.post('/preview', rawBody, async (req, res, next) => {
  try {
    assertXlsx(req);
    const result = await parseWorkbook(req.body, { checkDuplicate: true });
    res.json({
      ok: true,
      summary: result.summary,
      rows: result.rows.map((r) => ({
        rowNumber: r.rowNumber,
        status: r.status,
        action: r.action,
        matchedId: r.matchedId,
        errors: r.errors,
        warnings: r.warnings,
        // 手机号在预检里回显脱敏，避免明文在浏览器/日志里多留一份
        preview: {
          name: r.data.name || r.raw.name || '',
          org_name: r.data.org_name,
          position: r.data.position,
          phone: r.data.phone ? r.data.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : null,
          is_key_contact: r.data.is_key_contact,
          attrs: r.data.attrs,
        },
      })),
    });
  } catch (e) {
    next(e);
  }
});

/* ============================================================
 * 执行导入
 * mode: skip（跳过已存在，默认） | update（更新已存在）
 * ========================================================== */
router.post('/execute', rawBody, async (req, res, next) => {
  try {
    assertXlsx(req);
    const mode = req.query.mode === 'update' ? 'update' : 'skip';
    const { rows, summary } = await parseWorkbook(req.body, { checkDuplicate: true });

    const errors = rows.filter((r) => r.status === 'error');
    if (errors.length && req.query.skip_invalid !== '1') {
      return res.status(400).json({
        error: `有 ${errors.length} 行存在必填项或格式问题，请修正后再导入`,
        summary,
        failedRows: errors.map((r) => ({ rowNumber: r.rowNumber, errors: r.errors })),
      });
    }

    const results = [];

    for (const r of rows) {
      if (r.status === 'error') {
        results.push({ rowNumber: r.rowNumber, name: r.raw.name, result: 'failed', message: r.errors.join('；') });
        continue;
      }
      if (r.action === 'duplicate-in-file') {
        results.push({ rowNumber: r.rowNumber, name: r.data.name, result: 'skipped', message: '文件内重复' });
        continue;
      }
      if (r.action === 'update' && mode === 'skip') {
        results.push({ rowNumber: r.rowNumber, name: r.data.name, result: 'skipped', message: '已存在，按策略跳过', id: r.matchedId });
        continue;
      }

      try {
        const out = transaction(() => (
          r.action === 'update'
            ? updatePerson(r.matchedId, r.data)
            : createPerson(r.data)
        ));
        results.push({
          rowNumber: r.rowNumber,
          name: r.data.name,
          result: r.action === 'update' ? 'updated' : 'created',
          id: out,
        });
      } catch (e) {
        results.push({
          rowNumber: r.rowNumber,
          name: r.data.name,
          result: 'failed',
          message: e.message || '写入失败',
        });
      }
    }

    const count = (k) => results.filter((x) => x.result === k).length;
    res.json({
      ok: true,
      mode,
      summary: {
        ...summary,
        created: count('created'),
        updated: count('updated'),
        skipped: count('skipped'),
        failed: count('failed'),
      },
      results,
    });
  } catch (e) {
    next(e);
  }
});

/* ============================================================
 * 写入实现
 * ========================================================== */
function createPerson(d) {
  const info = run(
    `INSERT INTO persons (name, title, gender, phone, wechat, email, birthday,
                          met_way, is_key_contact, sensitivity, remark)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      d.name,
      d.position || null,
      d.gender || 'unknown',
      encrypt(d.phone),
      encrypt(d.wechat),
      d.email || null,
      d.birthday || null,
      d.met_way || null,
      d.is_key_contact ? 1 : 0,
      d.sensitivity || 'normal',
      d.remark || null,
    ]
  );
  const id = info.lastInsertRowid;

  if (d.org_name) {
    const orgId = ensureOrg(d.org_name);
    run(
      `INSERT INTO employments (person_id, org_id, position, department, power_level, is_current)
       VALUES (?,?,?,?,?,1)`,
      [id, orgId, d.position || null, d.department || null, d.power_level || 'unknown']
    );
  }

  insertAttrs(id, d.attrs);
  return id;
}

function updatePerson(id, d) {
  const fields = [];
  const params = [];
  const set = (col, val) => { fields.push(`${col} = ?`); params.push(val); };

  // 只覆盖 Excel 里填了的字段，留空视为"不修改"
  if (d.name) set('name', d.name);
  if (d.position) set('title', d.position);
  if (d.phone) set('phone', encrypt(d.phone));
  if (d.wechat) set('wechat', encrypt(d.wechat));
  if (d.email) set('email', d.email);
  if (d.birthday) set('birthday', d.birthday);
  if (d.met_way) set('met_way', d.met_way);
  if (d.sensitivity) set('sensitivity', d.sensitivity);
  if (d.remark) set('remark', d.remark);
  if (d.is_key_contact_set) set('is_key_contact', d.is_key_contact ? 1 : 0);

  if (fields.length) {
    fields.push("updated_at = datetime('now','localtime')");
    params.push(id);
    run(`UPDATE persons SET ${fields.join(', ')} WHERE id = ?`, params);
  }

  // 单位变了才动任职，避免无意义的任职记录
  if (d.org_name) {
    const cur = get(
      `SELECT o.name FROM employments e JOIN organizations o ON o.id = e.org_id
        WHERE e.person_id = ? AND e.is_current = 1 LIMIT 1`,
      [id]
    );
    if (!cur || cur.name !== d.org_name) {
      const orgId = ensureOrg(d.org_name);
      run(`UPDATE employments SET is_current = 0, end_date = date('now','localtime')
            WHERE person_id = ? AND is_current = 1`, [id]);
      run(
        `INSERT INTO employments (person_id, org_id, position, department, power_level, is_current)
         VALUES (?,?,?,?,?,1)`,
        [id, orgId, d.position || null, d.department || null, d.power_level || 'unknown']
      );
    } else if (d.position || d.department || d.power_level) {
      run(
        `UPDATE employments SET position = COALESCE(?, position),
                                department = COALESCE(?, department),
                                power_level = COALESCE(?, power_level)
          WHERE person_id = ? AND is_current = 1`,
        [d.position || null, d.department || null, d.power_level || null, id]
      );
    }
  }

  insertAttrs(id, d.attrs);
  return id;
}

/** 追加资源标签，已存在同名标签则跳过，避免越导越多 */
function insertAttrs(personId, attrs) {
  if (!attrs?.length) return;

  const existing = get(
    `SELECT group_concat(attr_value, '\u0001') AS s
       FROM person_attributes
      WHERE person_id = ? AND attr_type = 'resource'`,
    [personId]
  );
  const have = new Set(existing?.s ? existing.s.split('\u0001') : []);

  for (const value of attrs) {
    if (have.has(value)) continue;
    run(
      `INSERT INTO person_attributes (person_id, attr_type, attr_value, weight, note)
       VALUES (?, 'resource', ?, 3, 'Excel 导入')`,
      [personId, value]
    );
  }
}

export default router;
