<script setup>
/**
 * 项目详情：谁在项目里、各自担什么角色
 */
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast, showSuccessToast, showConfirmDialog } from 'vant';
import api from '@/api';
import ProjectFormSheet from '@/components/ProjectFormSheet.vue';

const route = useRoute();
const router = useRouter();
const id = Number(route.params.id);

const project = ref(null);
const loading = ref(true);
const enums = ref({});

const statusMeta = {
  planning: { label: '筹备中', cls: 'st--plan' },
  bidding: { label: '投标中', cls: 'st--bid' },
  active: { label: '进行中', cls: 'st--on' },
  closed: { label: '已结项', cls: 'st--closed' },
  lost: { label: '已失单', cls: 'st--lost' },
};

const roleOptions = computed(() =>
  Object.entries(enums.value.project_role?.values || {}).map(([value, text]) => ({ value, text }))
);

/** 26.03 这种短格式，三列布局里放得下 */
function fmtRange(a, b) {
  const f = (d) => (d ? d.slice(2, 7).replace('-', '.') : '');
  if (!a && !b) return '未填';
  return `${f(a)} ~ ${f(b)}`;
}

function fmtAmount(v) {
  if (v === null || v === undefined || v === '') return '未填';
  const n = Number(v);
  if (!Number.isFinite(n)) return '未填';
  return n >= 10000 ? `${(n / 10000).toFixed(2).replace(/\.?0+$/, '')} 亿元` : `${n} 万元`;
}

/** 按角色分组，让「谁负责/谁把关」一眼看清 */
const grouped = computed(() => {
  if (!project.value?.members) return [];
  const order = ['leader', 'business', 'technical', 'approver', 'resource', 'advisor', 'other'];
  const map = new Map();
  for (const m of project.value.members) {
    const k = m.role_type || 'other';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(m);
  }
  return order
    .filter((k) => map.has(k))
    .map((k) => ({
      role: k,
      label: map.get(k)[0].role_label || k,
      members: map.get(k),
    }));
});

async function load() {
  loading.value = true;
  try {
    project.value = await api.project(id);
  } catch (e) {
    showToast(e.message);
  } finally {
    loading.value = false;
  }
}

/* ---------------- 编辑项目 ---------------- */
const editOpen = ref(false);

async function onProjectSaved() {
  await load();
}

/* ---------------- 加人 ---------------- */
const addOpen = ref(false);
const candidates = ref([]);
const candKeyword = ref('');
const picking = ref(null);   // 正在选角色的人
const adding = ref(false);

async function loadCandidates() {
  try {
    const r = await api.projectCandidates(id, candKeyword.value.trim() || undefined);
    candidates.value = r.items || [];
  } catch (e) {
    showToast(e.message);
  }
}

let candTimer = null;
function onCandKeyword() {
  clearTimeout(candTimer);
  candTimer = setTimeout(loadCandidates, 260);
}

function openAdd() {
  addOpen.value = true;
  picking.value = null;
  candKeyword.value = '';
  loadCandidates();
}

async function addAs(person, roleType) {
  adding.value = true;
  try {
    await api.addProjectMember(id, { person_id: person.id, role_type: roleType });
    showSuccessToast(`${person.name} 已加入`);
    picking.value = null;
    await Promise.all([load(), loadCandidates()]);
  } catch (e) {
    showToast(e.message);
  } finally {
    adding.value = false;
  }
}

/* ---------------- 编辑成员 ---------------- */
const memberOpen = ref(false);
const memberForm = ref(null);
const savingMember = ref(false);

function openMember(m) {
  memberForm.value = {
    id: m.id,
    name: m.name,
    org_name: m.org_name,
    position: m.position,
    role_type: m.role_type || 'other',
    role_title: m.role_title || '',
    duty: m.duty || '',
    is_key: !!m.is_key,
  };
  memberOpen.value = true;
}

async function saveMember() {
  const f = memberForm.value;
  if (!f) return;
  savingMember.value = true;
  try {
    await api.updateProjectMember(id, f.id, {
      role_type: f.role_type,
      role_title: f.role_title.trim() || undefined,
      duty: f.duty.trim() || undefined,
      is_key: f.is_key,
    });
    showSuccessToast('已保存');
    memberOpen.value = false;
    await load();
  } catch (e) {
    showToast(e.message);
  } finally {
    savingMember.value = false;
  }
}

async function removeMember() {
  const f = memberForm.value;
  if (!f) return;
  try {
    await showConfirmDialog({
      title: '移出项目',
      message: `把「${f.name}」从本项目移除？只会解除项目关联，联系人本身不会删除。`,
      confirmButtonText: '移除',
      confirmButtonColor: '#dc2626',
    });
  } catch { return; }

  try {
    await api.removeProjectMember(id, f.id);
    showSuccessToast('已移除');
    memberOpen.value = false;
    await load();
  } catch (e) {
    showToast(e.message);
  }
}

/* ---------------- 关系图 ---------------- */
function goGraph() {
  router.push({ path: '/graph', query: { project: id } });
}

function goPerson(m) {
  if (m.is_self) return;
  router.push(`/person/${m.id}`);
}

onMounted(async () => {
  try { enums.value = await api.enums(); } catch { /* ignore */ }
  await load();
});
</script>

<template>
  <div class="page detail">
    <header class="page-header">
      <div class="container">
        <div class="row gap-8 head-row">
          <van-icon name="arrow-left" size="20" class="back" @click="router.back()" />
          <span class="head-title">项目详情</span>
          <button v-if="project" class="edit-link" @click="editOpen = true">
            <van-icon name="edit" /> 编辑
          </button>
        </div>
      </div>
    </header>

    <div v-if="loading" class="loading"><van-loading /></div>

    <div v-else-if="project" class="container">
      <!-- 概览 -->
      <div class="card hero">
        <div class="hero-top">
          <span class="st" :class="statusMeta[project.status]?.cls">
            {{ statusMeta[project.status]?.label || project.status }}
          </span>
          <span v-if="project.is_key" class="st st--key"><van-icon name="star" /> 重点</span>
          <span v-if="project.code" class="hero-code">{{ project.code }}</span>
        </div>

        <h2 class="hero-name">{{ project.name }}</h2>

        <div class="hero-org">
          <van-icon name="shop-o" />
          {{ project.owner_org_name || '未填业主单位' }}
          <template v-if="project.our_role">
            <span class="sep">·</span>
            <span class="our-role">我方{{ project.our_role }}</span>
          </template>
        </div>

        <div class="hero-grid">
          <div class="hg">
            <div class="hg-label">项目金额</div>
            <div class="hg-value">{{ fmtAmount(project.amount) }}</div>
          </div>
          <div class="hg">
            <div class="hg-label">参与人</div>
            <div class="hg-value">{{ project.member_count }} 人</div>
          </div>
          <div class="hg">
            <div class="hg-label">周期</div>
            <div class="hg-value small">{{ fmtRange(project.start_date, project.end_date) }}</div>
          </div>
        </div>

        <div v-if="project.milestone" class="milestone">
          <span class="ms-tag">当前节点</span>
          {{ project.milestone }}
        </div>
      </div>

      <!-- 参与人 -->
      <div class="sec-head">
        <div>
          <div class="sec-title">参与人</div>
          <div class="sec-sub">谁负责、谁把关、谁引荐</div>
        </div>
        <button class="add-btn" @click="openAdd">
          <van-icon name="plus" /> 加人
        </button>
      </div>

      <div v-if="!project.members.length" class="empty-members">
        还没有标记参与人。点「加人」把相关人员拉进来，并标注他在这个项目里的角色。
      </div>

      <div v-for="g in grouped" :key="g.role" class="role-group">
        <div class="role-head">
          <span class="role-dot" :class="`rd--${g.role}`"></span>
          {{ g.label }}
          <span class="role-count">{{ g.members.length }}</span>
        </div>

        <div
          v-for="m in g.members"
          :key="m.id"
          class="card member"
          @click="openMember(m)"
        >
          <div class="m-avatar" :class="{ 'm-avatar--key': m.is_key }">
            {{ m.name.slice(-2) }}
          </div>

          <div class="grow m-main">
            <div class="m-line">
              <span class="m-name">{{ m.name }}</span>
              <span v-if="m.is_self && m.name !== '我'" class="tag tag--success">我</span>
              <span v-if="m.is_key" class="m-star"><van-icon name="star" /></span>
              <span v-if="m.role_title" class="m-role-title">{{ m.role_title }}</span>
            </div>
            <div class="m-sub ellipsis">
              <template v-if="m.org_name">
                {{ m.org_name }}<template v-if="m.position"> · {{ m.position }}</template>
              </template>
              <template v-else>{{ m.title || '未填单位' }}</template>
            </div>
            <div v-if="m.duty" class="m-duty">{{ m.duty }}</div>
          </div>

          <van-icon name="arrow" class="m-arrow" />
        </div>
      </div>

      <div v-if="project.remark" class="card remark-card">
        <div class="rc-label">备注</div>
        <div class="rc-text">{{ project.remark }}</div>
      </div>

      <button class="graph-btn" @click="goGraph">
        <van-icon name="cluster-o" />
        看这个项目的关系图
      </button>

      <div class="bottom-space"></div>
    </div>

    <!-- 编辑项目 -->
    <ProjectFormSheet v-model:show="editOpen" :project="project" @saved="onProjectSaved" />

    <!-- 加人 -->
    <van-popup v-model:show="addOpen" position="bottom" round :style="{ maxHeight: '82%' }">
      <div class="sheet">
        <div class="sheet-head">
          <span class="sheet-title">把谁加进项目</span>
          <van-icon name="cross" class="sheet-close" @click="addOpen = false" />
        </div>

        <div class="sheet-search">
          <van-icon name="search" class="ss-icon" />
          <input
            v-model="candKeyword"
            class="ss-input"
            placeholder="搜姓名 / 单位"
            autocomplete="off"
            @input="onCandKeyword"
          />
        </div>

        <div class="sheet-body">
          <div
            v-for="p in candidates"
            :key="p.id"
            class="cand"
            :class="{ 'cand--joined': p.joined }"
          >
            <div class="cand-row" @click="!p.joined && (picking = picking === p.id ? null : p.id)">
              <div class="m-avatar small">{{ p.name.slice(-2) }}</div>
              <div class="grow">
                <div class="cand-name">
                  {{ p.name }}
                  <span v-if="p.is_key_contact" class="tag tag--warn">重点</span>
                </div>
                <div class="cand-sub ellipsis">{{ p.org_name || '未填单位' }}</div>
              </div>
              <span v-if="p.joined" class="cand-joined">已加入</span>
              <van-icon v-else :name="picking === p.id ? 'arrow-up' : 'plus'" class="cand-plus" />
            </div>

            <div v-if="picking === p.id" class="cand-roles">
              <div class="cr-tip">他在这个项目里是什么角色？</div>
              <div class="chips">
                <button
                  v-for="r in roleOptions"
                  :key="r.value"
                  type="button"
                  class="chip"
                  :disabled="adding"
                  @click="addAs(p, r.value)"
                >{{ r.text }}</button>
              </div>
            </div>
          </div>

          <div v-if="!candidates.length" class="empty-cand">没有找到联系人，换个关键词试试</div>
        </div>
      </div>
    </van-popup>

    <!-- 编辑成员 -->
    <van-popup v-model:show="memberOpen" position="bottom" round :style="{ maxHeight: '82%' }">
      <div v-if="memberForm" class="sheet">
        <div class="sheet-head">
          <div>
            <span class="sheet-title">{{ memberForm.name }}</span>
            <div class="sheet-sub ellipsis">
              {{ memberForm.org_name || '未填单位' }}<template v-if="memberForm.position"> · {{ memberForm.position }}</template>
            </div>
          </div>
          <van-icon name="cross" class="sheet-close" @click="memberOpen = false" />
        </div>

        <div class="sheet-body">
          <div class="field">
            <span class="field-label">在项目里的角色</span>
            <div class="chips">
              <button
                v-for="r in roleOptions"
                :key="r.value"
                type="button"
                class="chip"
                :class="{ 'chip--on': memberForm.role_type === r.value }"
                @click="memberForm.role_type = r.value"
              >{{ r.text }}</button>
            </div>
          </div>

          <label class="field">
            <span class="field-label">具体头衔（可选）</span>
            <input
              v-model="memberForm.role_title"
              class="input"
              placeholder="如：评标委员会成员、分管副局长"
            />
          </label>

          <label class="field">
            <span class="field-label">在这个项目里做什么</span>
            <textarea
              v-model="memberForm.duty"
              class="input textarea"
              rows="3"
              placeholder="如：负责消防设计审查签批，卡点在排期"
            ></textarea>
          </label>

          <div class="switch-row">
            <div>
              <div class="field-label" style="margin: 0">项目关键人</div>
              <div class="muted" style="font-size: 12px">这个项目绕不开的人</div>
            </div>
            <van-switch v-model="memberForm.is_key" size="22px" />
          </div>
        </div>

        <div class="sheet-foot">
          <van-button plain type="danger" round style="flex: 0 0 92px" @click="removeMember">
            移出
          </van-button>
          <van-button type="primary" block round :loading="savingMember" @click="saveMember">
            保存
          </van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.detail { padding-bottom: 0; }
.head-row { align-items: center; }
.back { cursor: pointer; color: var(--c-text-2); }
.head-title { font-size: 15px; font-weight: 600; }
.edit-link {
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 3px;
  border: 0; background: none;
  color: var(--c-primary);
  font-size: 13px; font-family: inherit; cursor: pointer;
}

.loading { display: flex; justify-content: center; padding: 60px 0; }

/* 概览 */
.hero { padding: 16px; background: linear-gradient(160deg, #ffffff, #f6f9ff); }
.hero-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.st {
  display: inline-flex; align-items: center; gap: 2px;
  border-radius: 5px; padding: 2px 7px;
  font-size: 11px; font-weight: 600;
}
.st--on { background: var(--c-success-light, #ecfdf5); color: var(--c-success, #059669); }
.st--bid { background: #eff6ff; color: #2563eb; }
.st--plan { background: #f1f5f9; color: #475569; }
.st--closed { background: #f1f5f9; color: #64748b; }
.st--lost { background: #fef2f2; color: #dc2626; }
.st--key { background: var(--c-warning-light); color: var(--c-warning); }

.hero-code { margin-left: auto; font-size: 11px; color: var(--c-text-3); }

.hero-name {
  margin: 9px 0 0;
  font-size: 19px;
  font-weight: 700;
  line-height: 1.35;
  letter-spacing: -.01em;
}

.hero-org {
  display: flex; align-items: center; gap: 5px;
  margin-top: 6px;
  font-size: 13px; color: var(--c-text-2);
}
.sep { color: var(--c-text-3); }
.our-role { color: var(--c-primary); font-weight: 500; }

.hero-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 14px;
  padding-top: 13px;
  border-top: 1px dashed var(--c-border);
}
.hg-label { font-size: 11px; color: var(--c-text-3); }
.hg-value {
  margin-top: 3px;
  font-size: 15px;
  font-weight: 700;
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
}
.hg-value.small { font-size: 11.5px; font-weight: 500; color: var(--c-text-2); }

.milestone {
  margin-top: 12px;
  padding: 9px 11px;
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 9px;
  font-size: 12.5px;
  color: var(--c-text-2);
  line-height: 1.5;
}
.ms-tag {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--c-primary-light);
  color: var(--c-primary);
  font-size: 10.5px;
  font-weight: 600;
}

/* 参与人 */
.sec-head {
  display: flex; align-items: flex-end; justify-content: space-between;
  margin: 20px 0 10px;
}
.sec-title { font-size: 16px; font-weight: 700; }
.sec-sub { margin-top: 2px; font-size: 11.5px; color: var(--c-text-3); }

.add-btn {
  display: inline-flex; align-items: center; gap: 3px;
  border: 1px solid var(--c-primary);
  background: var(--c-primary);
  color: #fff;
  border-radius: 999px;
  padding: 6px 13px;
  font-size: 12.5px; font-family: inherit; font-weight: 600;
  cursor: pointer;
}

.empty-members {
  padding: 22px 16px;
  border: 1px dashed var(--c-border);
  border-radius: 12px;
  font-size: 12.5px;
  color: var(--c-text-3);
  line-height: 1.6;
  text-align: center;
}

.role-group { margin-bottom: 14px; }

.role-head {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 7px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--c-text-2);
}
.role-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--c-text-3); }
.rd--leader { background: #2563eb; }
.rd--business { background: #0891b2; }
.rd--technical { background: #7c3aed; }
.rd--approver { background: #f59e0b; }
.rd--resource { background: #059669; }
.rd--advisor { background: #db2777; }
.rd--other { background: #94a3b8; }

.role-count {
  font-size: 10.5px;
  color: var(--c-text-3);
  background: #f1f5f9;
  border-radius: 999px;
  padding: 1px 6px;
  font-weight: 500;
}

.member {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 13px;
  margin-bottom: 7px;
  cursor: pointer;
}

.m-avatar {
  width: 38px; height: 38px;
  border-radius: 11px;
  background: linear-gradient(135deg, #93c5fd, #2563eb);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600;
  flex-shrink: 0;
}
.m-avatar--key { background: linear-gradient(135deg, #fcd34d, #f59e0b); }
.m-avatar.small { width: 34px; height: 34px; border-radius: 10px; font-size: 12px; }

.m-main { min-width: 0; }
.m-line { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.m-name { font-size: 14.5px; font-weight: 600; }
.m-star { color: var(--c-warning); font-size: 12px; display: inline-flex; }
.m-role-title {
  font-size: 11px;
  color: var(--c-text-2);
  background: #f1f5f9;
  border-radius: 4px;
  padding: 1px 6px;
}
.m-sub { font-size: 12px; color: var(--c-text-2); margin-top: 2px; }
.m-duty {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--c-text-3);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.m-arrow { color: var(--c-text-3); font-size: 13px; flex-shrink: 0; }

.remark-card { padding: 13px; margin-top: 6px; }
.rc-label { font-size: 11px; color: var(--c-text-3); margin-bottom: 5px; }
.rc-text { font-size: 12.5px; color: var(--c-text-2); line-height: 1.6; }

.graph-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  margin-top: 14px;
  padding: 12px;
  border: 1px solid var(--c-primary);
  background: var(--c-primary-light);
  color: var(--c-primary);
  border-radius: 12px;
  font-size: 14px;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
}

.bottom-space { height: 24px; }

/* 抽屉通用 */
.sheet { display: flex; flex-direction: column; max-height: 82vh; }
.sheet-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 16px 16px 10px; border-bottom: 1px solid var(--c-border); flex-shrink: 0;
}
.sheet-title { font-size: 16px; font-weight: 700; }
.sheet-sub { font-size: 11.5px; color: var(--c-text-2); margin-top: 2px; }
.sheet-close { font-size: 18px; color: var(--c-text-3); cursor: pointer; padding: 4px; flex-shrink: 0; }
.sheet-body { padding: 14px 16px; overflow-y: auto; }
.sheet-foot {
  display: flex; gap: 10px;
  padding: 12px 16px calc(12px + var(--safe-bottom));
  border-top: 1px solid var(--c-border); flex-shrink: 0;
}

.sheet-search { position: relative; padding: 10px 16px 0; flex-shrink: 0; }
.ss-icon {
  position: absolute; left: 28px; top: 50%; transform: translateY(-32%);
  color: var(--c-text-3); font-size: 15px;
}
.ss-input {
  width: 100%;
  border: 1px solid var(--c-border);
  border-radius: 10px;
  background: #fafbfc;
  padding: 10px 12px 10px 34px;
  font-size: 14px;
  font-family: inherit;
  outline: none;
}
.ss-input:focus { border-color: var(--c-primary); background: #fff; }

.cand { border-bottom: 1px solid var(--c-border); }
.cand:last-child { border-bottom: 0; }
.cand--joined { opacity: .55; }

.cand-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 0;
  cursor: pointer;
}
.cand--joined .cand-row { cursor: default; }

.cand-name { display: flex; align-items: center; gap: 5px; font-size: 14px; font-weight: 600; }
.cand-sub { font-size: 11.5px; color: var(--c-text-2); margin-top: 1px; }
.cand-joined { font-size: 11px; color: var(--c-text-3); flex-shrink: 0; }
.cand-plus { color: var(--c-primary); font-size: 15px; flex-shrink: 0; }

.cand-roles {
  padding: 2px 0 12px;
  animation: fade .16s ease-out;
}
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }

.cr-tip { font-size: 11.5px; color: var(--c-text-3); margin-bottom: 7px; }

.chips { display: flex; flex-wrap: wrap; gap: 7px; }
.chip {
  border: 1px solid var(--c-border);
  background: #fff;
  color: var(--c-text-2);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  transition: all .15s;
}
.chip--on {
  background: var(--c-primary-light);
  border-color: var(--c-primary);
  color: var(--c-primary);
  font-weight: 600;
}

.empty-cand { padding: 30px 0; text-align: center; font-size: 12.5px; color: var(--c-text-3); }

/* 表单 */
.field { display: block; margin-bottom: 15px; }
.field-label {
  display: block; font-size: 12.5px; color: var(--c-text-3);
  font-weight: 500; margin-bottom: 6px;
}
.input {
  width: 100%;
  border: 1px solid var(--c-border);
  border-radius: 10px;
  padding: 11px 13px;
  font-size: 15px;
  font-family: inherit;
  color: var(--c-text);
  background: #fafbfc;
  outline: none;
}
.input:focus { border-color: var(--c-primary); background: #fff; }
.textarea { resize: vertical; line-height: 1.55; }

.switch-row {
  display: flex; align-items: center; justify-content: space-between;
  padding-top: 12px; border-top: 1px solid var(--c-border);
}
</style>
