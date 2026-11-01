/**
 * 枚举字典：应用层维护，便于随时调整而不用改表
 */

export const ENUMS = {
  met_way: {
    label: '认识途径',
    values: {
      work: '工作往来',
      refer: '他人引荐',
      conference: '会议活动',
      dinner: '饭局',
      visit: '主动拜访',
      classmate: '同学',
      alumni: '校友',
      hometown: '同乡',
      online: '线上',
      other: '其他',
    },
  },
  relation_type: {
    label: '关系类型',
    values: {
      superior: '上下级',
      colleague: '同事',
      introducer: '引荐人',
      classmate: '同学',
      relative: '亲属',
      cooperation: '合作',
      friend: '朋友',
    },
  },
  power_level: {
    label: '权力角色',
    values: {
      decision: '决策人',
      approval: '审批人',
      operator: '经办人',
      support: '协助方',
      unknown: '未明确',
    },
  },
  org_type: {
    label: '组织类型',
    values: {
      gov: '政府机关',
      enterprise: '企业',
      institution: '事业单位',
      association: '协会/商会',
      other: '其他',
    },
  },
  attr_type: {
    label: '资源画像类型',
    values: {
      resource: '资源',
      sphere: '圈子',
      tag: '标签',
      influence: '影响力领域',
      channel: '渠道',
    },
  },
  scene: {
    label: '接触场景',
    values: {
      meeting: '会议',
      dinner: '饭局',
      visit: '拜访',
      call: '电话',
      wechat: '微信',
      other: '其他',
    },
  },
  sensitivity: {
    label: '涉敏等级',
    values: {
      normal: '普通',
      sensitive: '涉敏',
      secret: '高度敏感',
    },
  },
  org_relation_type: {
    label: '组织关系',
    values: {
      parent: '上级单位',
      subsidiary: '下级单位',
      cooperation: '合作关系',
      supervise: '监管关系',
      competition: '竞争关系',
    },
  },
  project_type: {
    label: '项目类型',
    values: {
      gov_tender: '政府招投标',
      enterprise: '企业合作',
      research: '课题研究',
      internal: '内部建设',
      other: '其他',
    },
  },
  project_status: {
    label: '项目状态',
    values: {
      planning: '筹备中',
      bidding: '投标中',
      active: '进行中',
      closed: '已结项',
      lost: '已失单',
    },
  },
  project_role: {
    label: '项目角色',
    values: {
      leader: '项目负责人',
      business: '商务对接',
      technical: '技术负责',
      approver: '审批把关',
      resource: '资源引荐',
      advisor: '顾问专家',
      other: '其他参与',
    },
  },
};

/** 校验枚举值是否合法 */
export function isValidEnum(field, value) {
  if (value === null || value === undefined || value === '') return true;
  const def = ENUMS[field];
  if (!def) return true;
  return Object.prototype.hasOwnProperty.call(def.values, value);
}

/** 返回某字段的合法取值列表，用于报错提示 */
export function enumValues(field) {
  const def = ENUMS[field];
  return def ? Object.keys(def.values) : [];
}

/** 把英文枚举翻译成中文 */
export function enumLabel(field, value) {
  const def = ENUMS[field];
  if (!def || !value) return value;
  return def.values[value] || value;
}

/**
 * 把中文标签（或英文 key）反解成枚举 key
 * 用于 Excel 导入：模板里给用户看的是中文，入库要存 key
 * 返回 undefined 表示无法识别
 */
export function enumKey(field, value) {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  if (!v) return null;

  const def = ENUMS[field];
  if (!def) return v;
  // 已经是 key
  if (Object.prototype.hasOwnProperty.call(def.values, v)) return v;
  // 中文标签
  for (const [key, label] of Object.entries(def.values)) {
    if (label === v) return key;
  }
  return undefined;
}

/** 返回某字段的全部中文标签，用于模板下拉与报错提示 */
export function enumLabels(field) {
  const def = ENUMS[field];
  return def ? Object.values(def.values) : [];
}
