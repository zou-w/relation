<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast, showConfirmDialog, showSuccessToast } from 'vant';
import api from '@/api';

const route = useRoute();
const router = useRouter();

const loading = ref(true);
const person = ref(null);
const paths = ref([]);
const influencers = ref([]);
const enums = ref({});

// 打标弹层
const showAttr = ref(false);
const attrForm = ref({ attr_type: 'resource', attr_value: '', weight: 3, note: '' });
const savingAttr = ref(false);

// 记录接触弹层
const showEvent = ref(false);
const evForm = ref({ event_date: new Date().toISOString().slice(0, 10), scene: '', subject: '', next_action: '', next_date: '' });
const savingEvent = ref(false);

const id = computed(() => Number(route.params.id));

const attrMeta = {
  resource: '资源', sphere: '圈子', tag: '标签', influence: '影响力', channel: '渠道',
};

const powerLabel = {
  decision: '决策人', approval: '审批人', operator: '经办人', support: '协助方', unknown: '未明确',
};

const sceneLabel = {
  meeting: '会议', dinner: '饭局', visit: '拜访', call: '电话', wechat: '微信', other: '其他',
};

const relationLabel = {
  superior: '上下级', colleague: '同事', introducer: '引荐人', classmate: '同学',
  relative: '亲属', cooperation: '合作', friend: '朋友', acquaintance: '熟人',
};

const groupedAttrs = computed(() => {
  const g = {};
  for (const a of person.value?.attributes || []) {
    (g[a.attr_type] ||= []).push(a);
  }
  return g;
});

const currentEmp = computed(() => (person.value?.employments || []).find((e) => e.is_current));
const crossRelations = computed(() => (person.value?.relations || []).filter((r) => r.is_cross_org));

async function load() {
  loading.value = true;
  try {
    const [p, e] = await Promise.all([
      api.person(id.value),
      enums.value.attr_type ? Promise.resolve(enums.value) : api.enums(),
    ]);
    person.value = p;
    enums.value = e;

    // 并行拉路径与影响力，失败不影响主体
    Promise.all([
      api.paths(id.value).catch(() => null),
      api.influencers(id.value).catch(() => null),
    ]).then(([pt, inf]) => {
      paths.value = pt?.paths || [];
      influencers.value = inf?.items || [];
    });
  } catch (err) {
    showToast(err.message);
    if (err.status === 404) router.replace('/search');
  } finally {
    loading.value = false;
  }
}

async function addAttr() {
  if (!attrForm.value.attr_value.trim()) {
    showToast('请填写内容');
    return;
  }
  savingAttr.value = true;
  try {
    await api.addAttribute(id.value, {
      attr_type: attrForm.value.attr_type,
      attr_value: attrForm.value.attr_value.trim(),
      weight: attrForm.value.weight,
      note: attrForm.value.note.trim() || undefined,
    });
    showSuccessToast('已添加');
    showAttr.value = false;
    attrForm.value = { attr_type: 'resource', attr_value: '', weight: 3, note: '' };
    await load();
  } catch (e) {
    showToast(e.message);
  } finally {
    savingAttr.value = false;
  }
}

async function removeAttr(a) {
  try {
    await showConfirmDialog({ title: '删除标签', message: `确定删除「${a.attr_value}」？` });
    await api.removeAttribute(id.value, a.id);
    showToast('已删除');
    await load();
  } catch { /* 取消 */ }
}

async function addEvent() {
  if (!evForm.value.event_date) { showToast('请选择日期'); return; }
  savingEvent.value = true;
  try {
    await api.createEvent({
      person_id: id.value,
      event_date: evForm.value.event_date,
      scene: evForm.value.scene || undefined,
      subject: evForm.value.subject.trim() || undefined,
      next_action: evForm.value.next_action.trim() || undefined,
      next_date: evForm.value.next_date || undefined,
    });
    showSuccessToast('已记录');
    showEvent.value = false;
    evForm.value = { event_date: new Date().toISOString().slice(0, 10), scene: '', subject: '', next_action: '', next_date: '' };
    await load();
  } catch (e) {
    showToast(e.message);
  } finally {
    savingEvent.value = false;
  }
}

async function toggleKey() {
  try {
    await api.updatePerson(id.value, { is_key_contact: !person.value.is_key_contact });
    person.value.is_key_contact = person.value.is_key_contact ? 0 : 1;
    showToast(person.value.is_key_contact ? '已标为重点' : '已取消重点');
  } catch (e) {
    showToast(e.message);
  }
}

onMounted(load);
</script>

<template>
  <div class="page page--no-nav">
    <header class="page-header">
      <div class="container">
        <div class="row gap-8">
          <van-icon name="arrow-left" size="20" style="cursor: pointer" @click="router.back()" />
          <h1 style="font-size: 17px">联系人详情</h1>
        </div>
      </div>
    </header>

    <div class="container">
      <div v-if="loading" class="loading"><van-loading /></div>

      <template v-else-if="person">
        <!-- 名片 -->
        <div class="card profile">
          <div class="profile-top">
            <div
              class="avatar avatar--lg"
              :class="{ 'avatar--key': person.is_key_contact && !person.is_self, 'avatar--self': person.is_self }"
            >
              {{ person.name.slice(-2) }}
            </div>
            <div class="grow">
              <div class="row gap-6" style="flex-wrap: wrap">
                <span class="profile-name">{{ person.name }}</span>
                <span v-if="person.is_self" class="tag tag--success">我</span>
                <span v-if="person.is_key_contact" class="tag tag--warn">重点人物</span>
                <span v-if="person.sensitivity === 'sensitive'" class="tag tag--danger">涉敏</span>
              </div>
              <div class="profile-org" v-if="currentEmp">
                {{ currentEmp.org_name }}
                <template v-if="currentEmp.position"> · {{ currentEmp.position }}</template>
              </div>
              <div class="profile-org" v-else-if="person.title">{{ person.title }}</div>
            </div>
          </div>

          <div class="profile-actions">
            <button v-if="!person.is_self" class="pa" :class="{ 'pa--on': person.is_key_contact }" @click="toggleKey">
              <van-icon :name="person.is_key_contact ? 'star' : 'star-o'" />
              {{ person.is_key_contact ? '重点' : '标重点' }}
            </button>
            <button class="pa" @click="showEvent = true">
              <van-icon name="edit" />
              记接触
            </button>
            <button class="pa" @click="showAttr = true">
              <van-icon name="add-o" />
              加标签
            </button>
            <button
              v-if="!person.is_self"
              class="pa pa--cross"
              @click="router.push(`/record-relation?with=${id}`)"
            >
              <van-icon name="exchange" />
              记跨单位关系
            </button>
            <a v-if="person.phone" class="pa" :href="`tel:${person.phone}`">
              <van-icon name="phone-o" />
              打电话
            </a>
          </div>

          <div v-if="person.remark" class="profile-remark">{{ person.remark }}</div>

          <div class="kv-list" v-if="person.phone || person.wechat || person.birthday">
            <div v-if="person.phone" class="kv"><span class="k">手机</span><span class="v">{{ person.phone }}</span></div>
            <div v-if="person.wechat" class="kv"><span class="k">微信</span><span class="v">{{ person.wechat }}</span></div>
            <div v-if="person.birthday" class="kv"><span class="k">生日</span><span class="v">{{ person.birthday }}</span></div>
          </div>
        </div>

        <!-- 任职 -->
        <template v-if="person.employments?.length">
          <div class="section-title">任职</div>
          <div class="card list-card">
            <div v-for="e in person.employments" :key="e.id" class="list-item">
              <div class="grow">
                <div class="item-title">
                  {{ e.org_name }}
                  <span v-if="!e.is_current" class="tag tag--gray">已离任</span>
                </div>
                <div class="muted">
                  {{ [e.department, e.position].filter(Boolean).join(' · ') || '未填职务' }}
                </div>
              </div>
              <span v-if="e.power_level && e.power_level !== 'unknown'" class="tag">
                {{ powerLabel[e.power_level] }}
              </span>
            </div>
          </div>
        </template>

        <!-- 参与项目 -->
        <template v-if="person.projects?.length">
          <div class="section-title">参与项目</div>
          <div class="card list-card">
            <div
              v-for="pj in person.projects"
              :key="pj.id"
              class="list-item list-item--tap"
              @click="router.push(`/project/${pj.id}`)"
            >
              <div class="pj-ico"><van-icon name="bag-o" /></div>
              <div class="grow">
                <div class="item-title">
                  {{ pj.name }}
                  <span v-if="pj.is_key" class="tag tag--warn">重点</span>
                </div>
                <div class="muted ellipsis">
                  {{ pj.owner_org_name || '未填业主单位' }} · {{ pj.status_label }}
                </div>
              </div>
              <span class="tag">{{ pj.role_label }}</span>
            </div>
          </div>
        </template>

        <!-- 资源画像 -->
        <div class="section-title">
          资源画像
          <button class="mini-btn" @click="showAttr = true">
            <van-icon name="plus" /> 添加
          </button>
        </div>

        <div v-if="Object.keys(groupedAttrs).length" class="card">
          <div v-for="(list, type) in groupedAttrs" :key="type" class="attr-group">
            <div class="attr-type">{{ attrMeta[type] || type }}</div>
            <div class="attrs">
              <span
                v-for="a in list"
                :key="a.id"
                class="attr-chip"
                :class="{ 'attr-chip--strong': a.weight >= 4 }"
                @click="removeAttr(a)"
              >
                {{ a.attr_value }}
                <small v-if="a.weight >= 4">★</small>
              </span>
            </div>
          </div>
        </div>
        <div v-else class="card empty-inline">
          还没有资源标签。给 ta 打上「能提供什么」，<br />以后「借资源」才搜得到。
        </div>

        <!-- 触达路径 -->
        <template v-if="!person.is_self">
          <div class="section-title">怎么搭上线</div>
          <div v-if="paths.length" class="card list-card">
            <div v-for="(p, i) in paths" :key="i" class="path-item">
              <span class="path-hop" :class="{ 'path-hop--direct': p.hops === 1 }">
                {{ p.hops === 1 ? '直达' : `${p.hops} 跳` }}
              </span>
              <div class="grow">
                <div class="path-desc">
                  {{ p.desc }}
                  <span v-if="p.crossOrg" class="tag tag--cross" style="margin-left: 4px">跨单位</span>
                </div>
                <div class="muted" v-if="p.hops === 2">
                  我 ↔ {{ p.via.name }} {{ relationLabel[p.myRelation] || p.myRelation }} ·
                  {{ p.via.name }} → 目标 {{ relationLabel[p.theirRelation] || p.theirRelation }}
                </div>
              </div>
            </div>
          </div>
          <div v-else class="card empty-inline">
            暂时找不到经过熟人搭线的路径，<br />可以先从熟人关系入手。
          </div>
        </template>

        <!-- 影响力 -->
        <template v-if="influencers.length && !person.is_self">
          <div class="section-title">谁对 ta 有话语权</div>
          <div class="card list-card">
            <div v-for="n in influencers" :key="n.id" class="list-item list-item--tap"
                 @click="router.push(`/person/${n.from_person}`)">
              <div class="avatar avatar--sm" :class="{ 'avatar--key': n.is_key_contact }">
                {{ n.person_name.slice(-2) }}
              </div>
              <div class="grow">
                <div class="item-title">{{ n.person_name }}</div>
                <div class="muted ellipsis">{{ n.org_name || '未填单位' }}</div>
              </div>
              <span class="tag tag--warn">影响力 {{ n.influence }}</span>
            </div>
          </div>
        </template>

        <!-- 人际关系 -->
        <template v-if="person.relations?.length">
          <div class="section-title">
            人际关系
            <span v-if="crossRelations.length" class="cross-hint">其中 {{ crossRelations.length }} 条跨单位</span>
          </div>
          <div class="card list-card">
            <div
              v-for="r in person.relations"
              :key="r.id"
              class="list-item list-item--tap"
              @click="router.push(`/person/${r.from_person === id ? r.to_person : r.from_person}`)"
            >
              <div class="avatar avatar--sm">{{ r.other_name.slice(-2) }}</div>
              <div class="grow">
                <div class="item-title">{{ r.other_name }}</div>
                <div class="muted ellipsis">{{ r.other_org || '未填单位' }}</div>
              </div>
              <span
                v-if="r.is_cross_org"
                class="tag tag--cross"
                title="不在同一单位，但两人认识"
              >跨单位</span>
              <span class="tag tag--gray">{{ relationLabel[r.relation_type] || r.relation_type }}</span>
            </div>
          </div>
        </template>

        <!-- 接触记录 -->
        <div class="section-title">
          接触记录
          <button class="mini-btn" @click="showEvent = true">
            <van-icon name="plus" /> 记录
          </button>
        </div>

        <div v-if="person.events?.length" class="card list-card">
          <div v-for="ev in person.events" :key="ev.id" class="event-item">
            <div class="event-line"></div>
            <div class="event-dot"></div>
            <div class="grow">
              <div class="row-between">
                <span class="event-date">{{ ev.event_date }}</span>
                <span v-if="ev.scene" class="tag tag--gray">{{ sceneLabel[ev.scene] || ev.scene }}</span>
              </div>
              <div class="event-subject" v-if="ev.subject">{{ ev.subject }}</div>
              <div v-if="ev.next_action" class="event-next">
                <van-icon name="arrow" size="11" />
                {{ ev.next_action }}
                <span v-if="ev.next_date" class="muted">（{{ ev.next_date }}）</span>
                <span v-if="ev.is_done" class="tag tag--success" style="margin-left: 4px">已完成</span>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="card empty-inline">还没有接触记录</div>
      </template>
    </div>

    <!-- 打标弹层 -->
    <van-popup v-model:show="showAttr" position="bottom" round :style="{ maxHeight: '80%' }">
      <div class="sheet">
        <div class="sheet-title">添加资源标签</div>
        <div class="sheet-body">
          <div class="field">
            <span class="field-label">类型</span>
            <div class="chips">
              <button
                v-for="(label, val) in (enums.attr_type?.values || {})"
                :key="val"
                class="chip"
                :class="{ 'chip--on': attrForm.attr_type === val }"
                @click="attrForm.attr_type = val"
              >{{ label }}</button>
            </div>
          </div>
          <div class="field">
            <span class="field-label">内容</span>
            <input v-model="attrForm.attr_value" class="input" placeholder="如：消防审批口人脉 / 建筑业协会" />
          </div>
          <div class="field">
            <span class="field-label">可用度 {{ attrForm.weight }}</span>
            <van-slider v-model="attrForm.weight" :min="1" :max="5" :step="1" style="margin: 8px 6px" />
          </div>
          <div class="field">
            <span class="field-label">备注（可选）</span>
            <input v-model="attrForm.note" class="input" placeholder="补充说明" />
          </div>
          <van-button type="primary" block round :loading="savingAttr" @click="addAttr">保存</van-button>
        </div>
      </div>
    </van-popup>

    <!-- 记接触弹层 -->
    <van-popup v-model:show="showEvent" position="bottom" round :style="{ maxHeight: '85%' }">
      <div class="sheet">
        <div class="sheet-title">记录一次接触</div>
        <div class="sheet-body">
          <div class="field">
            <span class="field-label">日期</span>
            <input v-model="evForm.event_date" type="date" class="input" />
          </div>
          <div class="field">
            <span class="field-label">场景</span>
            <div class="chips">
              <button
                v-for="(label, val) in (enums.scene?.values || {})"
                :key="val"
                class="chip"
                :class="{ 'chip--on': evForm.scene === val }"
                @click="evForm.scene = evForm.scene === val ? '' : val"
              >{{ label }}</button>
            </div>
          </div>
          <div class="field">
            <span class="field-label">聊了什么</span>
            <input v-model="evForm.subject" class="input" placeholder="这次见面/通话的主要内容" />
          </div>
          <div class="field">
            <span class="field-label">下一步</span>
            <input v-model="evForm.next_action" class="input" placeholder="要跟进什么" />
          </div>
          <div class="field">
            <span class="field-label">跟进截止日（可选）</span>
            <input v-model="evForm.next_date" type="date" class="input" />
          </div>
          <van-button type="primary" block round :loading="savingEvent" @click="addEvent">保存</van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.avatar--lg {
  width: 58px;
  height: 58px;
  border-radius: 16px;
  font-size: 20px;
}

.profile-top { display: flex; gap: 14px; align-items: flex-start; }

.profile-name { font-size: 21px; font-weight: 700; letter-spacing: -.02em; }

.profile-org {
  font-size: 13.5px;
  color: var(--c-text-2);
  margin-top: 4px;
}

.profile-actions {
  display: flex;
  gap: 6px;
  margin-top: 14px;
  flex-wrap: wrap;
}

.pa {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--c-border);
  background: #fff;
  color: var(--c-text-2);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  text-decoration: none;
  transition: all .15s;
}

.pa:active { transform: scale(.96); }
.pa--on { background: var(--c-warning-light); border-color: var(--c-warning); color: var(--c-warning); font-weight: 600; }
.pa--cross { background: #faf5ff; border-color: #e9d5ff; color: #7e22ce; }

.cross-hint { font-size: 11.5px; color: #7e22ce; text-transform: none; letter-spacing: 0; font-weight: 500; }

.profile-remark {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--c-border);
  font-size: 13.5px;
  color: var(--c-text-2);
  line-height: 1.6;
}

.kv-list {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--c-border);
}

.kv { display: flex; gap: 12px; font-size: 13.5px; padding: 3px 0; }
.k { color: var(--c-text-3); width: 40px; flex-shrink: 0; }
.v { color: var(--c-text); font-variant-numeric: tabular-nums; }

.list-card { padding: 2px 14px; }

.list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--c-border);
}

.list-item:last-child { border-bottom: 0; }
.list-item--tap { cursor: pointer; }
.list-item--tap:active { opacity: .6; }

.pj-ico {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--c-primary-light);
  color: var(--c-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  flex-shrink: 0;
}

.item-title { font-weight: 600; font-size: 14.5px; display: flex; align-items: center; gap: 6px; }

.mini-btn {
  float: right;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 0;
  background: none;
  color: var(--c-primary);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  text-transform: none;
  letter-spacing: 0;
}

.attr-group { padding: 10px 0; border-bottom: 1px solid var(--c-border); }
.attr-group:last-child { border-bottom: 0; }

.attr-type { font-size: 12px; color: var(--c-text-3); margin-bottom: 7px; }

.attrs { display: flex; flex-wrap: wrap; gap: 6px; }

.attr-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: var(--c-primary-light);
  color: var(--c-primary);
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 13px;
  cursor: pointer;
  transition: opacity .15s;
}

.attr-chip--strong { background: #fef3c7; color: #b45309; font-weight: 600; }
.attr-chip:active { opacity: .5; }
.attr-chip small { font-size: 10px; }

.empty-inline {
  text-align: center;
  color: var(--c-text-3);
  font-size: 13px;
  line-height: 1.7;
  padding: 20px 14px;
}

.path-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 0;
  border-bottom: 1px solid var(--c-border);
}

.path-item:last-child { border-bottom: 0; }

.path-hop {
  flex-shrink: 0;
  background: var(--c-primary-light);
  color: var(--c-primary);
  border-radius: 6px;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 600;
}

.path-hop--direct { background: var(--c-success-light); color: var(--c-success); }

.path-desc { font-size: 13.5px; font-weight: 500; line-height: 1.5; }

.event-item {
  display: flex;
  gap: 10px;
  padding: 12px 0;
  position: relative;
  border-bottom: 1px solid var(--c-border);
  padding-left: 16px;
}

.event-item:last-child { border-bottom: 0; }

.event-line {
  position: absolute;
  left: 3px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--c-border);
}

.event-dot {
  position: absolute;
  left: 0;
  top: 18px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c-primary);
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px var(--c-primary);
}

.event-date { font-size: 12.5px; color: var(--c-text-3); font-variant-numeric: tabular-nums; }
.event-subject { font-size: 13.5px; margin-top: 3px; line-height: 1.5; }
.event-next {
  font-size: 12.5px;
  color: var(--c-primary);
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 3px;
  flex-wrap: wrap;
}

/* 弹层 */
.sheet { padding: 18px 16px calc(18px + var(--safe-bottom)); }
.sheet-title { font-size: 17px; font-weight: 700; margin-bottom: 14px; text-align: center; }
.sheet-body { max-width: 520px; margin: 0 auto; }

.field { margin-bottom: 14px; }
.field-label { display: block; font-size: 12.5px; color: var(--c-text-3); margin-bottom: 6px; }

.input {
  width: 100%;
  border: 1px solid var(--c-border);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 15px;
  font-family: inherit;
  background: #fafbfc;
  outline: none;
}

.input:focus { border-color: var(--c-primary); background: #fff; }

.chips { display: flex; flex-wrap: wrap; gap: 7px; }

.chip {
  border: 1px solid var(--c-border);
  background: #fafbfc;
  color: var(--c-text-2);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}

.chip--on { background: var(--c-primary-light); border-color: var(--c-primary); color: var(--c-primary); font-weight: 600; }
</style>
