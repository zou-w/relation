/**
 * Excel 导入模板生成
 *
 * 设计要点：
 * 1. 表头带 * 标注必填，必填列浅红底、非必填浅灰底，一眼可辨
 * 2. 每个表头挂批注（鼠标悬停看填写规则）
 * 3. 枚举列做下拉数据验证，避免用户手填出错
 * 4. 独立的「填写说明」工作表：字段清单 + 完整示例
 * 5. 冻结表头，长表格滚动时列名始终可见
 */
import ExcelJS from 'exceljs';
import { ENUMS } from './enums.js';

/** 表头所在行（1-based）；第 1 行大标题，第 2 行提示条，第 3 行表头 */
export const HEADER_ROW = 3;
/** 数据起始行 */
export const DATA_START_ROW = 4;
/** 预留可填写行数 */
const BLANK_ROWS = 500;

/* ============================================================
 * 列定义：模板与解析共用同一份，避免两边字段对不上
 * ========================================================== */
export const COLUMNS = [
  {
    key: 'name',
    header: '姓名',
    required: true,
    width: 14,
    hint: '必填。填真实姓名，导入时按「姓名 + 单位」判断是否重复。',
    example: '张建国',
  },
  {
    key: 'org_name',
    header: '单位名称',
    required: false,
    width: 26,
    hint: '填全称，如「市住房和城乡建设局」。单位不存在时自动创建。',
    example: '市住房和城乡建设局',
  },
  {
    key: 'position',
    header: '职务',
    required: false,
    width: 16,
    hint: '具体职务，如「副局长」「规划处处长」。',
    example: '副局长',
  },
  {
    key: 'department',
    header: '部门',
    required: false,
    width: 16,
    hint: '所在处室 / 部门，如「建筑市场监管处」。',
    example: '建筑市场监管处',
  },
  {
    key: 'power_level',
    header: '权力角色',
    required: false,
    width: 14,
    hint: '从下拉选择。决策人＝能拍板；审批人＝能签字；经办人＝具体办事；协助方＝外围帮忙。',
    example: '决策人',
    enum: 'power_level',
  },
  {
    key: 'phone',
    header: '手机号',
    required: false,
    width: 16,
    hint: '11 位数字。入库时自动 AES-256-GCM 加密存储。',
    example: '13800001111',
  },
  {
    key: 'wechat',
    header: '微信号',
    required: false,
    width: 16,
    hint: '微信号或备注名。同样加密存储。',
    example: 'zhangjg_88',
  },
  {
    key: 'email',
    header: '邮箱',
    required: false,
    width: 22,
    hint: '格式 name@domain.com。',
    example: 'zhangjg@example.gov.cn',
  },
  {
    key: 'gender',
    header: '性别',
    required: false,
    width: 10,
    hint: '填「男」或「女」，留空视为未知。',
    example: '男',
    options: ['男', '女', '未知'],
  },
  {
    key: 'met_way',
    header: '认识途径',
    required: false,
    width: 14,
    hint: '从下拉选择，用于分析你的关系来源结构。',
    example: '工作往来',
    enum: 'met_way',
  },
  {
    key: 'is_key_contact',
    header: '是否重点',
    required: false,
    width: 11,
    hint: '填「是」或「否」。重点人物会在图谱和列表里高亮。',
    example: '是',
    options: ['是', '否'],
  },
  {
    key: 'sensitivity',
    header: '涉敏等级',
    required: false,
    width: 12,
    hint: '普通 / 涉敏 / 高度敏感。影响导出与展示时的脱敏策略。',
    example: '普通',
    enum: 'sensitivity',
  },
  {
    key: 'birthday',
    header: '出生日期',
    required: false,
    width: 14,
    hint: '格式 YYYY-MM-DD，如 1975-03-12。仅用于记忆提醒。',
    example: '1975-03-12',
  },
  {
    key: 'attrs',
    header: '资源标签',
    required: false,
    width: 30,
    hint: '这个人手上有什么资源，多个用顿号分隔，如「消防审批、招投标」。最多 8 个。',
    example: '消防审批、招投标、施工许可',
  },
  {
    key: 'remark',
    header: '备注',
    required: false,
    width: 32,
    hint: '自由填写。建议写成「与谁熟、能办什么事、禁忌是什么」。',
    example: '与其处长是校友，办事爽快，忌周一上午找',
  },
];

/* ============================================================
 * 配色
 * ========================================================== */
const COLOR = {
  brand: 'FF2563EB',
  brandDark: 'FF1D4ED8',
  requiredBg: 'FFFDF1F1',
  requiredText: 'FFC0392B',
  normalBg: 'FFF4F6FA',
  normalText: 'FF334155',
  border: 'FFD8DEE9',
  hintText: 'FF94A3B8',
  exampleBg: 'FFF8FAFC',
};

/** 取某列的下拉选项（中文标签） */
function optionsOf(col) {
  if (col.options) return col.options;
  if (col.enum) return Object.values(ENUMS[col.enum]?.values || {});
  return null;
}

/** 取某列的取值说明，用于批注补充合法值 */
function optionsHint(col) {
  const opts = optionsOf(col);
  if (!opts) return '';
  return `\n可选值：${opts.join(' / ')}`;
}

/**
 * 生成导入模板
 * @returns {Promise<Buffer>}
 */
export async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = '人脉关系网';
  wb.created = new Date();

  const ws = wb.addWorksheet('联系人', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: HEADER_ROW, activeCell: 'A4' }],
    properties: { defaultRowHeight: 20 },
  });

  const lastCol = COLUMNS.length;

  /* ---------- 第 1 行：标题 ---------- */
  ws.mergeCells(1, 1, 1, lastCol);
  const title = ws.getCell(1, 1);
  title.value = '人脉关系网 · 联系人导入模板';
  title.font = { name: '微软雅黑', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.brand } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 38;

  /* ---------- 第 2 行：提示条 ---------- */
  ws.mergeCells(2, 1, 2, lastCol);
  const tip = ws.getCell(2, 1);
  tip.value = '带 * 的列为必填项　|　下拉列请点单元格右侧箭头选择，不要手动输入　|　灰色示例仅供参考，请勿直接填写到本表　|　第 4 行起为数据区';
  tip.font = { name: '微软雅黑', size: 10, color: { argb: 'FF8A5A00' } };
  tip.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } };
  tip.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 26;

  /* ---------- 第 3 行：表头 ---------- */
  const headerRow = ws.getRow(HEADER_ROW);
  headerRow.height = 34;

  COLUMNS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.required ? `${col.header} *` : col.header;

    cell.font = {
      name: '微软雅黑',
      size: 11,
      bold: true,
      color: { argb: col.required ? COLOR.requiredText : COLOR.normalText },
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: col.required ? COLOR.requiredBg : COLOR.normalBg },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: COLOR.border } },
      left: { style: 'thin', color: { argb: COLOR.border } },
      bottom: { style: 'medium', color: { argb: col.required ? COLOR.requiredText : COLOR.border } },
      right: { style: 'thin', color: { argb: COLOR.border } },
    };

    // 批注：悬停看填写规则
    cell.note = {
      texts: [{
        font: { name: '微软雅黑', size: 9 },
        text: `${col.required ? '【必填】' : '【选填】'}${col.hint}${optionsHint(col)}`,
      }],
      margins: { insetmode: 'custom', inset: [0.13, 0.13, 0.13, 0.13] },
    };

    ws.getColumn(i + 1).width = col.width;
  });

  /* ---------- 数据区样式与数据校验 ---------- */
  for (let r = DATA_START_ROW; r < DATA_START_ROW + BLANK_ROWS; r++) {
    const row = ws.getRow(r);
    row.height = 20;

    COLUMNS.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      // 文本格式，避免手机号被 Excel 转成科学计数法
      cell.numFmt = '@';
      cell.font = { name: '微软雅黑', size: 10.5 };
      cell.alignment = { vertical: 'middle', wrapText: false };
      cell.border = {
        top: { style: 'hair', color: { argb: 'FFE9EDF3' } },
        left: { style: 'hair', color: { argb: 'FFE9EDF3' } },
        bottom: { style: 'hair', color: { argb: 'FFE9EDF3' } },
        right: { style: 'hair', color: { argb: 'FFE9EDF3' } },
      };

      const opts = optionsOf(col);
      if (opts) {
        cell.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`"${opts.join(',')}"`],
          showErrorMessage: true,
          errorStyle: 'stop',
          errorTitle: '取值不合法',
          error: `「${col.header}」只能填：${opts.join(' / ')}`,
          showInputMessage: true,
          promptTitle: col.header,
          prompt: col.hint.slice(0, 100),
        };
      }
    });
  }

  /* ---------- 示例行（浅灰斜体，明确标注） ---------- */
  // 放在数据区之外的第 5 行不合适，改为在说明页展示；这里给首行做占位提示
  ws.getCell(DATA_START_ROW, 1).note = {
    texts: [{ font: { name: '微软雅黑', size: 9 }, text: '从这一行开始逐行填写，一行一位联系人。' }],
  };

  /* ---------- 工作表：填写说明 ---------- */
  const guide = wb.addWorksheet('填写说明', {
    views: [{ state: 'frozen', ySplit: 3 }],
  });

  guide.mergeCells('A1:F1');
  const gTitle = guide.getCell('A1');
  gTitle.value = '字段填写说明';
  gTitle.font = { name: '微软雅黑', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
  gTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.brand } };
  gTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  guide.getRow(1).height = 34;

  guide.mergeCells('A2:F2');
  const gSub = guide.getCell('A2');
  gSub.value = '导入前请通读本页。姓名必填，其余留空不影响导入；下拉列填中文即可，系统自动转换。';
  gSub.font = { name: '微软雅黑', size: 10, color: { argb: 'FF8A5A00' } };
  gSub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } };
  gSub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  guide.getRow(2).height = 24;

  const gHeaders = ['列名', '是否必填', '填写格式', '说明', '可选值 / 示例', '示例'];
  const gRow = guide.getRow(3);
  gRow.height = 26;
  gHeaders.forEach((h, i) => {
    const c = gRow.getCell(i + 1);
    c.value = h;
    c.font = { name: '微软雅黑', size: 10.5, bold: true, color: { argb: COLOR.normalText } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.normalBg } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    c.border = {
      top: { style: 'thin', color: { argb: COLOR.border } },
      left: { style: 'thin', color: { argb: COLOR.border } },
      bottom: { style: 'thin', color: { argb: COLOR.border } },
      right: { style: 'thin', color: { argb: COLOR.border } },
    };
  });

  COLUMNS.forEach((col, idx) => {
    const r = guide.getRow(4 + idx);
    r.height = 30;
    const opts = optionsOf(col);
    const values = [
      col.header,
      col.required ? '必填' : '选填',
      col.key === 'birthday' ? 'YYYY-MM-DD'
        : col.key === 'phone' ? '11 位数字'
          : col.key === 'email' ? '邮箱格式'
            : col.key === 'attrs' ? '顿号分隔'
              : opts ? '下拉选择' : '文本',
      col.hint,
      opts ? opts.join(' / ') : '—',
      col.example,
    ];
    values.forEach((v, i) => {
      const c = r.getCell(i + 1);
      c.value = v;
      c.font = {
        name: '微软雅黑',
        size: 10,
        bold: i === 0,
        color: { argb: i === 1 && col.required ? COLOR.requiredText : 'FF334155' },
      };
      c.alignment = { vertical: 'middle', wrapText: true, horizontal: i === 1 || i === 2 ? 'center' : 'left' };
      c.border = {
        top: { style: 'hair', color: { argb: 'FFE9EDF3' } },
        left: { style: 'hair', color: { argb: 'FFE9EDF3' } },
        bottom: { style: 'hair', color: { argb: 'FFE9EDF3' } },
        right: { style: 'hair', color: { argb: 'FFE9EDF3' } },
      };
    });
  });

  [12, 10, 14, 52, 40, 24].forEach((w, i) => { guide.getColumn(i + 1).width = w; });

  /* ---------- 说明页底部：分行示例 ---------- */
  const startIdx = 4 + COLUMNS.length + 1;
  guide.mergeCells(startIdx, 1, startIdx, 6);
  const exTitle = guide.getCell(startIdx, 1);
  exTitle.value = '填写示例（表格里一行就是这样一位联系人）';
  exTitle.font = { name: '微软雅黑', size: 11, bold: true, color: { argb: COLOR.brandDark } };
  exTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  guide.getRow(startIdx).height = 28;

  // 15 列挤在一行会被裁切，按 4 组拆开，每组一行
  const groups = [
    ['姓名', 'name', '单位名称', 'org_name', '职务', 'position', '部门', 'department'],
    ['权力角色', 'power_level', '手机号', 'phone', '微信号', 'wechat', '邮箱', 'email'],
    ['性别', 'gender', '认识途径', 'met_way', '是否重点', 'is_key_contact', '涉敏等级', 'sensitivity'],
    ['出生日期', 'birthday', '资源标签', 'attrs', '备注', 'remark'],
  ];

  groups.forEach((g, gi) => {
    const row = guide.getRow(startIdx + 1 + gi);
    guide.mergeCells(startIdx + 1 + gi, 1, startIdx + 1 + gi, 6);
    const cell = guide.getCell(startIdx + 1 + gi, 1);

    const parts = [];
    for (let i = 0; i < g.length; i += 2) {
      const label = g[i];
      const key = g[i + 1];
      const col = COLUMNS.find((c) => c.key === key);
      parts.push(`${label}：${col?.example ?? ''}`);
    }
    cell.value = parts.join('　　');
    cell.font = { name: '微软雅黑', size: 9.5, color: { argb: 'FF334155' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.exampleBg } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    cell.border = {
      top: { style: 'hair', color: { argb: 'FFE9EDF3' } },
      left: { style: 'hair', color: { argb: 'FFE9EDF3' } },
      bottom: { style: 'hair', color: { argb: 'FFE9EDF3' } },
      right: { style: 'hair', color: { argb: 'FFE9EDF3' } },
    };
    row.height = 24;
  });

  /* ---------- 底部：导入规则 ---------- */
  const ruleIdx = startIdx + groups.length + 2;
  guide.mergeCells(ruleIdx, 1, ruleIdx + 5, 6);
  const rules = guide.getCell(ruleIdx, 1);
  rules.value = [
    '导入规则',
    '1. 姓名必填；姓名与单位都相同的记录，按你选择的策略「跳过」或「更新」。',
    '2. 单位不存在时自动创建；同一人重复导入不会产生重复组织。',
    '3. 手机号、微信号入库前自动加密，页面上按权限展示。',
    '4. 资源标签按顿号「、」或逗号分隔，每个都会成为一条独立的资源画像。',
    '5. 单次最多导入 500 行；文件格式仅支持 .xlsx。',
  ].join('\n');
  rules.font = { name: '微软雅黑', size: 10, color: { argb: 'FF334155' } };
  rules.alignment = { vertical: 'top', wrapText: true, indent: 1 };
  guide.getRow(ruleIdx).height = 130;

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/**
 * 模板字段清单（供前端展示，避免硬编码）
 */
export function templateMeta() {
  return COLUMNS.map((c) => ({
    key: c.key,
    header: c.header,
    required: !!c.required,
    hint: c.hint,
    example: c.example,
    options: optionsOf(c),
  }));
}
