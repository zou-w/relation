/**
 * 演示数据：政企场景
 * 5 个联系人（含本人）/ 5 个组织 / 12 条资源画像 / 7 条关系 / 接触事件
 * 用法：npm run seed
 */
import 'dotenv/config';
import { initDBAsync, createSchema, run, get, transaction, closeDB } from './driver.js';
import { encrypt, initCrypto } from '../lib/crypto.js';

initCrypto(); // 先确保密钥就绪，种子数据才会用持久密钥加密
const driver = await initDBAsync();
createSchema();

// 幂等：清空后重灌（保留结构）
transaction(() => {
  run('DELETE FROM project_members');
  run('DELETE FROM projects');
  run('DELETE FROM contact_events');
  run('DELETE FROM person_attributes');
  run('DELETE FROM relations');
  run('DELETE FROM org_relations');
  run('DELETE FROM employments');
  run('DELETE FROM persons');
  run('DELETE FROM organizations');
});

const personId = {};
const orgId = {};

transaction(() => {
  // ---------- 本人节点 ----------
  personId.me = run(
    `INSERT INTO persons (name, title, is_self, is_key_contact, remark)
     VALUES (?,?,1,0,?)`,
    ['我', '本人', '关系网的中心节点']
  ).lastInsertRowid;

  // ---------- 组织 ----------
  orgId.housing = run(
    `INSERT INTO organizations (name, alias, org_type, level, region, business, is_key_org)
     VALUES (?,?,?,?,?,?,1)`,
    ['市住房和城乡建设局', '住建局', 'gov', '局级', '杭州',
     '建筑市场监管、房地产开发、消防审批']
  ).lastInsertRowid;

  orgId.enterprise = run(
    `INSERT INTO organizations (name, alias, org_type, region, business, is_key_org)
     VALUES (?,?,?,?,?,1)`,
    ['浙建集团第三工程有限公司', '浙建三工', 'enterprise', '杭州',
     '建筑工程总承包、市政工程施工']
  ).lastInsertRowid;

  orgId.ndrc = run(
    `INSERT INTO organizations (name, alias, org_type, level, region, business, is_key_org)
     VALUES (?,?,?,?,?,?,1)`,
    ['市发展和改革委员会', '发改委', 'gov', '局级', '杭州',
     '项目立项审批、投资项目核准、产业政策']
  ).lastInsertRowid;

  orgId.association = run(
    `INSERT INTO organizations (name, alias, org_type, region, business)
     VALUES (?,?,?,?,?)`,
    ['市建筑业协会', '建协', 'association', '杭州', '行业自律、资质评审、行业交流']
  ).lastInsertRowid;

  orgId.zjcc = run(
    `INSERT INTO organizations (name, alias, org_type, region, business)
     VALUES (?,?,?,?,?)`,
    ['浙商商会', '浙商', 'association', '杭州', '商界资源对接、政企沟通']
  ).lastInsertRowid;

  // 组织层级：协会与商会为独立主体；住建局下辖（示例层级）
  run('UPDATE organizations SET parent_org_id = ? WHERE id = ?', [null, orgId.housing]);

  // ---------- 联系人 ----------
  personId.zhang = run(
    `INSERT INTO persons (name, title, gender, phone, met_way, is_key_contact, sensitivity, remark)
     VALUES (?,?,?,?,?,1,?,?)`,
    ['张建国', '副局长', 'male', encrypt('13800001111'), 'conference', 'sensitive',
     '2019 年建筑业高质量发展论坛认识，做事严谨，重视合规']
  ).lastInsertRowid;

  personId.li = run(
    `INSERT INTO persons (name, title, gender, phone, met_way, is_key_contact, remark)
     VALUES (?,?,?,?,?,1,?)`,
    ['李伟', '工程处处长', 'male', encrypt('13800002222'), 'refer',
     '张建国引荐，具体经办公司资质与施工许可事项']
  ).lastInsertRowid;

  personId.zhao = run(
    `INSERT INTO persons (name, title, gender, phone, met_way, is_key_contact, sensitivity, remark)
     VALUES (?,?,?,?,?,1,?,?)`,
    ['赵敏', '投资处处长', 'female', encrypt('13800003333'), 'work', 'sensitive',
     '项目立项口，为人直爽，关注项目落地实效']
  ).lastInsertRowid;

  personId.liu = run(
    `INSERT INTO persons (name, title, gender, phone, met_way, is_key_contact, remark)
     VALUES (?,?,?,?,?,0,?)`,
    ['刘敏', '秘书长', 'female', encrypt('13800004444'), 'dinner',
     '协会资源丰富，人脉广，善于牵线']
  ).lastInsertRowid;

  // ---------- 任职 ----------
  const emp = (pid, oid, position, department, power) =>
    run(
      `INSERT INTO employments (person_id, org_id, position, department, power_level, is_current)
       VALUES (?,?,?,?,?,1)`,
      [pid, oid, position, department, power]
    );

  emp(personId.zhang, orgId.housing, '副局长', '局领导班子', 'decision');
  emp(personId.li, orgId.housing, '工程处处长', '工程管理处', 'operator');
  emp(personId.zhao, orgId.ndrc, '投资处处长', '固定资产投资处', 'approval');
  emp(personId.liu, orgId.association, '秘书长', '秘书处', 'support');

  // ---------- 资源画像（12 条，"借资源"核心） ----------
  const attr = (pid, type, value, weight, note) =>
    run('INSERT INTO person_attributes (person_id, attr_type, attr_value, weight, note) VALUES (?,?,?,?,?)',
      [pid, type, value, weight, note || null]);

  attr(personId.zhang, 'resource', '消防审批口人脉', 5, '能协调消防设计审查排期');
  attr(personId.zhang, 'influence', '建筑市场监管', 4, '分管市场监管与房地产开发');
  attr(personId.zhang, 'sphere', '市建筑业协会', 3, '协会常务理事');
  attr(personId.zhang, 'channel', '局内横向协调', 4, '可对接局内其他处室');

  attr(personId.li, 'resource', '资质审批经办', 5, '施工许可、资质增项直接经办');
  attr(personId.li, 'tag', '经办人', 4, '事项推进的关键执行者');
  attr(personId.li, 'sphere', '市建筑业协会', 2, null);

  attr(personId.zhao, 'resource', '项目立项审批', 5, '政府投资项目核准');
  attr(personId.zhao, 'influence', '产业政策制定', 3, '参与市级产业扶持政策起草');
  attr(personId.zhao, 'channel', '市级部门联动', 3, '与经信、财政有业务往来');

  attr(personId.liu, 'resource', '行业资源对接', 4, '可介绍协会会员企业');
  attr(personId.liu, 'sphere', '市建筑业协会', 5, '秘书处负责人');
  attr(personId.liu, 'sphere', '浙商商会', 3, '理事单位代表');

  // ---------- 人↔人关系（7 条） ----------
  const rel = (from, to, type, strength, influence, note) =>
    run(
      `INSERT INTO relations (from_person, to_person, relation_type, direction, strength, influence, note)
       VALUES (?,?,?,'two-way',?,?,?)`,
      [from, to, type, strength, influence, note || null]
    );

  rel(personId.me, personId.zhang, 'cooperation', 4, 5, '多年工作往来，信任度高');
  rel(personId.zhang, personId.li, 'superior', 4, 5, '张建国是李伟的直接上级');
  rel(personId.me, personId.zhao, 'cooperation', 3, 4, '项目对接结识');
  rel(personId.me, personId.liu, 'friend', 4, 3, '协会活动熟识');
  rel(personId.liu, personId.zhang, 'colleague', 3, 3, '协会事务往来');
  rel(personId.liu, personId.zhao, 'colleague', 2, 2, '跨部门活动认识');
  rel(personId.me, personId.li, 'cooperation', 2, 3, '经张建国引荐，尚浅');

  // ---------- 接触事件 ----------
  const ev = (pid, oid, date, scene, subject, nextAction, nextDate, done = 0) =>
    run(
      `INSERT INTO contact_events (person_id, org_id, event_date, scene, subject, next_action, next_date, is_done)
       VALUES (?,?,?,?,?,?,?,?)`,
      [pid, oid, date, scene, subject, nextAction, nextDate, done]
    );

  ev(personId.zhang, orgId.housing, '2026-09-01', 'meeting',
     '沟通新项目消防审查流程', '整理公司资质材料送审', '2026-09-03', 0);

  ev(personId.zhao, orgId.ndrc, '2026-08-20', 'visit',
     '了解产业扶持资金申报条件', '准备申报材料初稿', '2026-11-10', 0);

  ev(personId.liu, orgId.association, '2026-08-15', 'dinner',
     '协会年会筹备，答应帮引荐两家总包企业', '确认引荐名单', '2026-11-05', 0);

  ev(personId.li, orgId.housing, '2026-07-28', 'call',
     '咨询资质增项材料清单', null, null, 1);

  // ---------- 项目（把关系落到具体事由上） ----------
  const prj = (name, code, type, status, ownerOrg, ourRole, region, amount, start, end, milestone, isKey, remark) =>
    run(
      `INSERT INTO projects
         (name, code, project_type, status, owner_org_id, our_role, region, amount,
          start_date, end_date, milestone, is_key, remark)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [name, code, type, status, ownerOrg, ourRole, region, amount, start, end, milestone, isKey, remark]
    ).lastInsertRowid;

  const prjEpcc = prj(
    '城东片区老旧小区改造 EPC 项目', 'HZ-EPC-2026-018', 'gov_tender', 'active',
    orgId.housing, '总包', '杭州', 8600, '2026-03-01', '2027-06-30',
    '施工许可已批复，进入消防设计审查', 1,
    '体量最大的在建项目，卡点在消防审查排期'
  );

  const prjFund = prj(
    '2027 年产业扶持资金申报', 'HZ-FUND-2027-006', 'gov_tender', 'bidding',
    orgId.ndrc, '申报方', '杭州', 1200, '2026-09-01', '2027-03-31',
    '材料初稿已完成，等待处室初审', 1,
    '赵敏牵头初审，需要她认可项目落地成效'
  );

  // ---------- 项目成员（谁在项目里担什么角色） ----------
  const member = (projectId, pid, role, roleTitle, duty, isKey) =>
    run(
      `INSERT INTO project_members (project_id, person_id, role_type, role_title, duty, is_key)
       VALUES (?,?,?,?,?,?)`,
      [projectId, pid, role, roleTitle || null, duty || null, isKey ? 1 : 0]
    );

  member(prjEpcc, personId.me, 'leader', '项目总协调',
    '对内统筹投标与履约，对外维护主管单位关系', 1);
  member(prjEpcc, personId.zhang, 'approver', '分管副局长',
    '消防设计审查与施工许可的最终签批', 1);
  member(prjEpcc, personId.li, 'technical', '工程处对接人',
    '资质与施工许可材料审核、现场检查安排', 0);
  member(prjEpcc, personId.liu, 'resource', '协会引荐',
    '通过协会推荐两家分包单位，协调行业专家', 0);

  member(prjFund, personId.me, 'leader', null,
    '申报主体负责人，负责材料统筹与答辩', 1);
  member(prjFund, personId.zhao, 'approver', '投资处初审',
    '项目核准与资金额度初审', 1);
  member(prjFund, personId.zhang, 'advisor', '政策顾问',
    '从建筑市场监管角度提供政策口径建议', 0);
});

const count = (t) => get(`SELECT COUNT(*) AS c FROM ${t}`).c;
console.log('✅ 演示数据已写入');
console.log(`   联系人 ${count('persons')} · 组织 ${count('organizations')} · 任职 ${count('employments')}`);
console.log(`   资源画像 ${count('person_attributes')} · 关系 ${count('relations')} · 接触事件 ${count('contact_events')}`);
console.log(`   项目 ${count('projects')} · 项目成员 ${count('project_members')}`);
console.log(`   驱动: ${driver}`);
closeDB();
