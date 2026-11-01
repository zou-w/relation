<script setup>
/**
 * 项目列表
 * 项目是把人脉落到"具体事由"上的容器：一个项目里谁负责、谁把关、谁引荐
 */
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import api from '@/api';
import ProjectFormSheet from '@/components/ProjectFormSheet.vue';

const router = useRouter();

const items = ref([]);
const stats = ref({ total: 0, active: 0, keyProjects: 0, members: 0, hiddenKeys: 0 });
const loading = ref(true);
const status = ref('');
const keyOnly = ref(false);
const keyword = ref('');

const filters = [
  { key: '', label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'bidding', label: '投标中' },
  { key: 'planning', label: '筹备中' },
  { key: 'closed', label: '已结项' },
];

const statusMeta = {
  planning: { label: '筹备中', cls: 'st--plan' },
  bidding: { label: '投标中', cls: 'st--bid' },
  active: { label: '进行中', cls: 'st--on' },
  closed: { label: '已结项', cls: 'st--closed' },
  lost: { label: '已失单', cls: 'st--lost' },
};

function fmtAmount(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n >= 10000 ? `${(n / 10000).toFixed(2).replace(/\.?0+$/, '')} 亿` : `${n} 万`;
}

async function load() {
  loading.value = true;
  try {
    const r = await api.projects({
      status: status.value || undefined,
      key_only: keyOnly.value ? 1 : undefined,
      keyword: keyword.value.trim() || undefined,
      limit: 100,
    });
    items.value = r.items || [];
  } catch (e) {
    showToast(e.message);
  } finally {
    loading.value = false;
  }
}

async function loadStats() {
  try { stats.value = await api.projectStats(); } catch { /* ignore */ }
}

let timer = null;
function onKeyword() {
  clearTimeout(timer);
  timer = setTimeout(load, 260);
}

function setStatus(s) {
  if (status.value === s) return;
  status.value = s;
  load();
}

function toggleKey() {
  keyOnly.value = !keyOnly.value;
  load();
}

/* ---------------- 新建 / 编辑 ---------------- */
const sheetOpen = ref(false);
const editing = ref(null);

function openCreate() {
  editing.value = null;
  sheetOpen.value = true;
}

function openEdit(p) {
  editing.value = p;
  sheetOpen.value = true;
}

async function onSaved({ id, created }) {
  if (created) { router.push(`/project/${id}`); return; }
  await Promise.all([load(), loadStats()]);
}

function goDetail(p) {
  router.push(`/project/${p.id}`);
}

onMounted(() => {
  load();
  loadStats();
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="container">
        <div class="row-between">
          <h1>项目</h1>
          <button class="new-btn" @click="openCreate">
            <van-icon name="plus" />
            新建
          </button>
        </div>
        <div class="sub">
          {{ stats.total }} 个项目 · {{ stats.active }} 个在推进 · {{ stats.members }} 人参与
        </div>

        <div class="search-box">
          <van-icon name="search" class="search-icon" />
          <input
            v-model="keyword"
            class="search-input"
            placeholder="搜项目名 / 编号 / 参与人"
            autocomplete="off"
            @input="onKeyword"
          />
          <van-icon v-if="keyword" name="clear" class="search-clear" @click="keyword = ''; load()" />
        </div>

        <div class="chips">
          <button
            v-for="f in filters"
            :key="f.key"
            class="chip"
            :class="{ 'chip--on': status === f.key }"
            @click="setStatus(f.key)"
          >
            {{ f.label }}
          </button>
          <button class="chip chip--star" :class="{ 'chip--on-warn': keyOnly }" @click="toggleKey">
            <van-icon name="star-o" />
            重点
          </button>
        </div>
      </div>
    </header>

    <div class="container">
      <div v-if="loading && !items.length" class="loading"><van-loading /></div>

      <div v-else-if="!items.length" class="empty">
        <van-icon name="bag-o" class="empty-icon" />
        <div class="empty-text">
          {{ keyword || status || keyOnly ? '没有符合条件的项目' : '还没有项目' }}
        </div>
        <div class="empty-hint">把办过的事记成项目，人脉才有落点</div>
        <van-button type="primary" size="small" round style="margin-top: 14px" @click="openCreate">
          建第一个项目
        </van-button>
      </div>

      <div v-else class="grid">
        <div v-for="p in items" :key="p.id" class="card proj" @click="goDetail(p)">
          <div class="proj-top">
            <span class="st" :class="statusMeta[p.status]?.cls">{{ statusMeta[p.status]?.label || p.status }}</span>
            <span v-if="p.is_key" class="st st--key"><van-icon name="star" /> 重点</span>
            <span v-if="p.code" class="proj-code">{{ p.code }}</span>
          </div>

          <div class="proj-name">{{ p.name }}</div>

          <div class="proj-org">
            <van-icon name="shop-o" />
            <span class="ellipsis">{{ p.owner_org_name || '未填业主单位' }}</span>
            <template v-if="p.our_role">
              <span class="dot-sep">·</span>
              <span class="proj-role">{{ p.our_role }}</span>
            </template>
          </div>

          <div v-if="p.milestone" class="proj-mile ellipsis">{{ p.milestone }}</div>

          <div class="proj-foot">
            <div class="proj-people">
              <span class="avatars">
                <i
                  v-for="n in (p.leaders || '').split('、').filter(Boolean).slice(0, 3)"
                  :key="n"
                  class="mini-avatar"
                >{{ n.slice(-1) }}</i>
              </span>
              <span class="pcount">{{ p.member_count }} 人参与</span>
            </div>
            <span v-if="p.amount" class="amount">{{ fmtAmount(p.amount) }}</span>
          </div>
        </div>
      </div>
    </div>

    <ProjectFormSheet v-model:show="sheetOpen" :project="editing" @saved="onSaved" />
  </div>
</template>

<style scoped>
.row-between { display: flex; align-items: center; justify-content: space-between; }

.new-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid var(--c-primary);
  background: var(--c-primary);
  color: #fff;
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
}

.search-box { position: relative; margin-top: 10px; }
.search-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: var(--c-text-3); font-size: 16px;
}
.search-input {
  width: 100%;
  border: 1px solid var(--c-border);
  border-radius: 11px;
  background: #fff;
  padding: 11px 36px;
  font-size: 15px;
  font-family: inherit;
  outline: none;
}
.search-input:focus { border-color: var(--c-primary); }
.search-clear {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  color: var(--c-text-3); cursor: pointer; font-size: 16px;
}

.chips { display: flex; align-items: center; gap: 7px; margin-top: 10px; flex-wrap: wrap; }
.chip {
  display: inline-flex; align-items: center; gap: 3px;
  border: 1px solid var(--c-border);
  background: #fff;
  color: var(--c-text-2);
  border-radius: 999px;
  padding: 5px 12px;
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
.chip--on-warn {
  background: var(--c-warning-light);
  border-color: var(--c-warning);
  color: var(--c-warning);
  font-weight: 600;
}

.grid { display: grid; gap: 10px; margin-top: 12px; }

.proj { padding: 14px; cursor: pointer; transition: transform .12s, box-shadow .15s; }
.proj:active { transform: scale(.995); }

.proj-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.st {
  display: inline-flex; align-items: center; gap: 2px;
  border-radius: 5px;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 600;
}
.st--on { background: var(--c-success-light, #ecfdf5); color: var(--c-success, #059669); }
.st--bid { background: #eff6ff; color: #2563eb; }
.st--plan { background: #f1f5f9; color: #475569; }
.st--closed { background: #f1f5f9; color: #64748b; }
.st--lost { background: #fef2f2; color: #dc2626; }
.st--key { background: var(--c-warning-light); color: var(--c-warning); }

.proj-code {
  margin-left: auto;
  font-size: 11px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

.proj-name {
  margin-top: 8px;
  font-size: 15.5px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--c-text);
}

.proj-org {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 5px;
  font-size: 12.5px;
  color: var(--c-text-2);
  min-width: 0;
}
.proj-org .ellipsis { max-width: 60%; }
.dot-sep { color: var(--c-text-3); }
.proj-role { color: var(--c-primary); font-weight: 500; }

.proj-mile {
  margin-top: 8px;
  padding: 7px 9px;
  background: #f8fafc;
  border-radius: 7px;
  font-size: 12px;
  color: var(--c-text-2);
}

.proj-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--c-border);
}

.proj-people { display: flex; align-items: center; gap: 7px; }

.avatars { display: inline-flex; }
.mini-avatar {
  width: 20px; height: 20px;
  border-radius: 50%;
  background: linear-gradient(135deg, #93c5fd, #2563eb);
  color: #fff;
  font-size: 10px;
  font-style: normal;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: -5px;
  border: 1.5px solid #fff;
}
.mini-avatar:first-child { margin-left: 0; }

.pcount { font-size: 12px; color: var(--c-text-3); }
.amount { font-size: 13px; font-weight: 600; color: var(--c-text-2); font-variant-numeric: tabular-nums; }

.empty { text-align: center; padding: 56px 0 24px; }
.empty-icon { font-size: 44px; color: var(--c-border); }
.empty-text { margin-top: 10px; font-size: 14px; color: var(--c-text-2); }
.empty-hint { margin-top: 5px; font-size: 12px; color: var(--c-text-3); }

.loading { display: flex; justify-content: center; padding: 46px 0; }

@media (min-width: 768px) {
  .grid { grid-template-columns: 1fr 1fr; gap: 12px; }
}
</style>
