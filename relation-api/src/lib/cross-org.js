/**
 * 跨单位认识关系的识别
 *
 * 场景：政企人脉里，两个人不在同一单位，但可能是同学、亲属、老同事、饭局上认识的……
 * 这种"弱连接"恰好是打通两个单位的关键，图谱上必须能看出来。
 *
 * 判定：
 *   1. 两人都有现任单位，且主单位（第一任职）不同
 *   2. 关系类型属于"非工作场合"：同学 / 亲属 / 朋友 / 熟人
 *      （同事、上下级、合作默认是同单位的工作关系，单人挂靠两家单位的情况很常见，不计入）
 */

/** 默认视为跨单位场景的关系类型 */
export const CROSS_ORG_TYPES = ['classmate', 'relative', 'friend', 'acquaintance'];

/** 单个联系人任职的单位数量上限（一个人挂靠太多单位，说明录入质量一般，不参与判定） */
const MAX_ORGS_PER_PERSON = 2;

/**
 * 计算每条人↔人关系的跨单位属性
 * @param {Array} rels  relations 行（需含 from_person / to_person / relation_type）
 * @param {Array} emps  employments 行（需含 id / person_id / org_id / is_current）
 * @param {Array} orgs  organizations 行（需含 id / name）
 * @param {object} opts { types: 自定义跨单位类型, names: person_id→姓名 的 Map }
 * @returns {Map<number, {cross, sameType, reason, fromOrg, toOrg, fromName, toName}>}
 */
export function computeCrossOrg(rels, emps, orgs, { types = CROSS_ORG_TYPES, names = null } = {}) {
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const typeSet = new Set(types);
  const nameOf = names instanceof Map ? names : new Map(Object.entries(names || {}));

  // person_id -> [{ id, name }]（现任，按 id 排序保证"主单位"稳定）
  const byPerson = new Map();
  for (const e of emps) {
    if (!e.is_current) continue;
    if (!byPerson.has(e.person_id)) byPerson.set(e.person_id, []);
    byPerson.get(e.person_id).push({ id: e.org_id, name: orgName.get(e.org_id) || '' });
  }
  for (const list of byPerson.values()) list.sort((a, b) => a.id - b.id);

  const result = new Map();
  for (const r of rels) {
    const a = byPerson.get(r.from_person) || [];
    const b = byPerson.get(r.to_person) || [];
    const inType = typeSet.has(r.relation_type);

    let same =
      a.length > 0 && b.length > 0 &&
      a.length <= MAX_ORGS_PER_PERSON && b.length <= MAX_ORGS_PER_PERSON &&
      a.some((x) => b.some((y) => y.id === x.id));

    const cross = inType && a.length > 0 && b.length > 0 && !same;

    // 有一方没填单位时标 unknown：数据不全，不硬判
    const reason = cross ? 'cross' : same ? 'same_org' : 'unknown';
    result.set(r.id, {
      cross,
      sameType: inType,
      reason,
      fromOrg: a[0]?.name || null,
      toOrg: b[0]?.name || null,
      fromName: nameOf.get(r.from_person) || '',
      toName: nameOf.get(r.to_person) || '',
    });
  }
  return result;
}
