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
