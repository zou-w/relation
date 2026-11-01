/**
 * 冒烟测试：覆盖全部接口
 * 用法：npm run smoke
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:3100';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${detail ? '  → ' + detail : ''}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ❌ ${name}${detail ? '  → ' + detail : ''}`);
  }
}

async function req(method, path, body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opt.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opt);
  let data = null;
  try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data };
}

const P = (s) => encodeURIComponent(s);

async function main() {
  console.log(`\n冒烟测试 → ${BASE}\n`);

  // ---------- 基础 ----------
  console.log('【基础】');
  {
    const { status, data } = await req('GET', '/api/health');
    ok('健康检查', status === 200 && data.ok, `驱动 ${data?.driver}`);
  }
  {
    const { status, data } = await req('GET', '/api/enums');
    ok('枚举字典', status === 200 && Object.keys(data || {}).length === 8,
      `${Object.keys(data || {}).length} 组`);
  }

  // ---------- 联系人 ----------
  console.log('\n【联系人】');
  {
    const { status, data } = await req('GET', '/api/persons');
    ok('查人列表', status === 200 && data.total >= 5, `${data?.total} 人`);
  }
  {
    const { status, data } = await req('GET', `/api/persons?keyword=${P('住建')}`);
    ok('按单位关键词搜人', status === 200 && data.total >= 2,
      data?.items?.map((x) => x.name).join('、'));
  }
  {
    const { status, data } = await req('GET', '/api/persons?key_only=1');
    ok('只看重点人物', status === 200 && data.total >= 3, `${data?.total} 人`);
  }

  let newId = null;
  {
    const { status, data } = await req('POST', '/api/persons', {
      name: '王海涛', org_name: '市交通运输局', position: '规划处处长',
      power_level: 'approval', met_way: 'conference', is_key_contact: true,
      phone: '13800005555',
    });
    newId = data?.id;
    ok('快速录入（自动建组织+任职）', status === 201 && newId && data.org_id,
      `id=${newId}, org_id=${data?.org_id}`);
  }
  {
    const { status, data } = await req('GET', `/api/persons/${newId}`);
    const emp = data?.employments?.[0];
    ok('联系人详情（含任职）', status === 200 && emp?.org_name === '市交通运输局',
      `${emp?.org_name} / ${emp?.position}`);
    ok('敏感字段加密后正确还原', data?.phone === '13800005555', data?.phone);
  }
  {
    const { status } = await req('POST', '/api/persons', {
      name: '测试脏数据', met_way: 'illegal_value',
    });
    ok('枚举校验拦截脏数据', status === 400);
  }
  {
    const { status, data } = await req('PATCH', `/api/persons/${newId}`, {
      remark: '更新备注', position: '规划处处长',
    });
    ok('编辑联系人', status === 200 && data.ok);
  }
  {
    const { status, data } = await req('POST', `/api/persons/${newId}/attributes`, {
      attr_type: 'resource', attr_value: '交通规划审批', weight: 5, note: '线路规划',
    });
    ok('资源画像打标', status === 201 && data.ok);
  }
  {
    const { status, data } = await req('GET', `/api/persons/${newId}/neighbors`);
    ok('一跳邻居', status === 200 && Array.isArray(data.neighbors));
  }

  // ---------- 资源检索 ----------
  console.log('\n【资源检索 · 第一价值】');
  {
    const { status, data } = await req('GET', `/api/resources/search?q=${P('审批')}`);
    ok('资源检索「审批」', status === 200 && data.total >= 2,
      data?.items?.slice(0, 2).map((x) => `${x.person_name}·${x.attr_value}`).join(' | '));
  }
  {
    const { status, data } = await req('GET', `/api/resources/search?type=${P('sphere')}`);
    ok('按类型筛圈子', status === 200 && data.total >= 3, `${data?.total} 条`);
  }
  {
    const { status, data } = await req('GET', '/api/resources/spheres');
    ok('圈子渗透度', status === 200 && data.items.length >= 2,
      data?.items?.map((s) => `${s.sphere}(${s.total}人)`).join('、'));
  }
  {
    const { status } = await req('GET', '/api/resources/search?type=bad_type');
    ok('资源检索枚举校验', status === 400);
  }
  {
    const { status, data } = await req('GET', '/api/resources/overview');
    ok('资源总览', status === 200 && data.byType.length > 0);
  }

  // ---------- 触达路径 ----------
  console.log('\n【触达路径 · 关系的关系】');
  let liId = null;
  {
    const { data } = await req('GET', `/api/persons?keyword=${P('李伟')}`);
    liId = data?.items?.[0]?.id;
    const { status, data: d } = await req('GET', `/api/resources/paths/${liId}`);
    const twoHop = d?.paths?.filter((p) => p.hops === 2) || [];
    ok('二跳路径：我→张建国→李伟', status === 200 && twoHop.length >= 1,
      twoHop[0]?.desc);
  }
  {
    const { data } = await req('GET', `/api/persons/${liId}`);
    const orgId = data?.employments?.[0]?.org_id;
    const { status, data: d } = await req('GET', `/api/resources/org/${orgId}/reach`);
    ok('组织抓手（该单位能通过谁）', status === 200 && d.insiders.length >= 2,
      `本单位 ${d?.insiders?.length} 人`);
  }
  {
    const { status, data } = await req('GET', `/api/resources/influencers/${liId}`);
    ok('影响力查询', status === 200 && data.items.length >= 1,
      data?.items?.[0]?.person_name);
  }

  // ---------- 接触事件 ----------
  console.log('\n【接触与提醒】');
  {
    const { status, data } = await req('POST', '/api/events', {
      person_id: liId, event_date: '2026-11-01', scene: 'visit',
      subject: '沟通施工许可进度', next_action: '补充材料', next_date: '2026-11-08',
    });
    ok('记录接触（自动关联单位）', status === 201 && data.auto_org,
      `org_id=${data?.org_id}`);
  }
  {
    const { status, data } = await req('GET', '/api/events/pending');
    ok('待办跟进（逾期/今日/未来）', status === 200 && data.total >= 1,
      `逾期 ${data?.overdue?.length} · 今日 ${data?.today?.length} · 未来 ${data?.upcoming?.length}`);
  }
  {
    const { status, data } = await req('GET', '/api/events/cold?days=30');
    ok('冷接触提醒', status === 200 && Array.isArray(data.items),
      `${data?.items?.length} 人待联系`);
  }
  {
    const { data } = await req('GET', `/api/events?person_id=${liId}`);
    const evId = data?.items?.[0]?.id;
    const { status } = await req('PATCH', `/api/events/${evId}`, { is_done: true });
    ok('勾选完成', status === 200);
  }
  {
    const { status } = await req('POST', '/api/events', {
      person_id: liId, event_date: '2026-11-01', scene: 'bad_scene',
    });
    ok('接触场景枚举校验', status === 400);
  }

  // ---------- 关系 ----------
  console.log('\n【关系】');
  // 动态取本人节点 id（seed 重灌后自增，不能写死 1）
  let selfId = null;
  {
    const { data } = await req('GET', '/api/persons');
    selfId = data?.items?.find((x) => x.is_self)?.id;
    ok('本人节点存在', !!selfId, `id=${selfId}`);
  }
  {
    const { status, data } = await req('POST', '/api/relations', {
      from_person: selfId, to_person: newId, relation_type: 'cooperation',
      strength: 3, influence: 4,
    });
    ok('建立人↔人关系', status === 201 && data.ok, `id=${data?.id}`);
  }
  {
    const { status } = await req('POST', '/api/relations', {
      from_person: selfId, to_person: newId, relation_type: 'bad_type',
    });
    ok('关系类型枚举校验', status === 400);
  }
  {
    const { status } = await req('POST', '/api/relations', {
      from_person: selfId, to_person: newId, relation_type: 'cooperation',
    });
    ok('重复关系拦截', status === 409);
  }
  {
    const { status, data } = await req('GET', '/api/relations');
    ok('关系列表', status === 200 && data.items.length >= 8, `${data?.items?.length} 条`);
  }

  // ---------- 组织 ----------
  console.log('\n【组织】');
  {
    const { status, data } = await req('GET', `/api/orgs?q=${P('住建')}`);
    ok('组织搜索（简称命中）', status === 200 && data.items.length >= 1,
      data?.items?.[0]?.name);
  }
  {
    const { data } = await req('GET', '/api/orgs');
    const hid = data.items.find((o) => o.name.includes('住房'))?.id;
    const { status, data: d } = await req('GET', `/api/orgs/${hid}`);
    ok('组织详情（含在任人员）', status === 200 && d.persons.length >= 2,
      `${d?.name} · ${d?.persons?.length} 人`);
  }

  // ---------- 图谱 ----------
  console.log('\n【关系图谱】');
  {
    const { status, data } = await req('GET', '/api/graph');
    const empEdges = data.edges.filter((e) => e.kind === 'employment').length;
    const relEdges = data.edges.filter((e) => e.kind === 'relation').length;
    ok('图谱数据（节点+边）', status === 200 && data.nodes.length > 0,
      `${data?.counts?.nodes} 节点 / ${data?.counts?.edges} 边（${relEdges} 人际 + ${empEdges} 任职）`);
    ok('边标签已中文化', data.edges.filter((e) => e.kind === 'relation')
      .every((e) => /[\u4e00-\u9fa5]/.test(e.label)));
  }
  {
    const { status, data } = await req('GET', '/api/graph?key_only=1');
    ok('重点人物聚焦', status === 200 && data.nodes.length > 0,
      `${data?.nodes?.length} 节点`);
  }
  {
    const { status, data } = await req('GET', '/api/graph/stats');
    ok('统计概览', status === 200 && data.persons >= 5,
      `联系人 ${data?.persons} · 组织 ${data?.orgs} · 待办 ${data?.pending}`);
  }

  // ---------- 清理 ----------
  console.log('\n【清理测试数据】');
  {
    const { status } = await req('DELETE', `/api/persons/${newId}`);
    ok('删除联系人（级联清理）', status === 200);
  }

  console.log('\n【Excel 导入】');

  /** 二进制请求，用于上传 xlsx */
  const raw = async (path, buf, type = 'application/octet-stream') => {
    const r = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': type },
      body: buf,
    });
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    return { status: r.status, data, size: Number(r.headers.get('content-length') || 0) };
  };

  let tplBuf = null;
  {
    const r = await fetch(BASE + '/api/import/template');
    const buf = Buffer.from(await r.arrayBuffer());
    tplBuf = buf;
    const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
    const cd = r.headers.get('content-disposition') || '';
    ok('下载导入模板', r.status === 200 && isZip && buf.length > 5000,
      `${(buf.length / 1024).toFixed(0)} KB`);
    ok('模板带中文文件名', cd.includes('filename*=UTF-8'), cd.slice(0, 48) + '…');
  }
  {
    const { status, data } = await req('GET', '/api/import/fields');
    const req1 = data?.fields?.filter((f) => f.required).map((f) => f.header);
    ok('模板字段清单', status === 200 && data.fields.length === 15,
      `${data?.fields?.length} 列，必填 ${req1?.join('、')}`);
    ok('字段带填写提示', data?.fields?.every((f) => f.hint?.length > 5));
  }
  {
    const { status, data } = await raw('/api/import/preview', tplBuf);
    ok('空白模板预检被拒', status === 400 && /没有数据/.test(data?.error || ''), data?.error);
  }
  {
    // 超过 100 字节才会走到魔数校验分支
    const fake = Buffer.from('x'.repeat(300));
    const { status, data } = await raw('/api/import/preview', fake);
    ok('非 xlsx 文件被拒', status === 400 && /xlsx/.test(data?.error || ''), data?.error);
  }
  {
    const { status, data } = await raw('/api/import/execute', tplBuf);
    ok('空表导入被拒', status === 400, data?.error);
  }

  console.log('\n【批量管理】');
  {
    const { status } = await req('POST', '/api/persons/batch-delete', { ids: [] });
    ok('批量删除需传 ids', status === 400);
  }
  {
    const selfId = (await req('GET', '/api/persons?key_only=0')).data.items.find((x) => x.is_self)?.id;
    const { status, data } = await req('POST', '/api/persons/batch-delete', { ids: [selfId] });
    ok('本人节点不可删除', status === 200 && data.deleted === 0 && data.skippedSelf.includes(selfId),
      `保护 id=${selfId}`);
  }

  // ---------- 汇总 ----------
  const total = pass + fail;
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`结果：${pass}/${total} 通过${fail ? `，${fail} 项失败` : ' ✅'}`);
  if (fail) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
