<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { showToast, showSuccessToast, showConfirmDialog, showLoadingToast, closeToast } from 'vant';
import api from '@/api';
import OrgInput from '@/components/OrgInput.vue';

const router = useRouter();

const items = ref([]);
const total = ref(0);
const loading = ref(false);
const keyword = ref('');
const filter = ref('all');       // all | key | attr | nophone
const selectMode = ref(false);
const selected = ref(new Set());
const stats = ref({ persons: 0, keyContacts: 0, orgs: 0 });

const enums = ref({});
const PAGE = 100;

const filters = [
  { key: 'all', label: '全部' },
  { key: 'key', label: '重点' },
  { key: 'attr', label: '有资源' },
  { key: 'nophone', label: '缺手机' },
];

const powerOptions = computed(() =>
  Object.entries(enums.value.power_level?.values || {}).map(([value, text]) => ({ value, text }))
);

/* ---------------- 列表 ---------------- */
function params() {
  const p = { limit: PAGE, offset: 0 };
  if (keyword.value.trim()) p.keyword = keyword.value.trim();
  if (filter.value === 'key') p.key_only = 1;
  if (filter.value === 'attr') p.has_attr = 1;
  if (filter.value === 'nophone') p.missing_phone = 1;
  return p;
}

async function load({ append = false } = {}) {
  loading.value = true;
  try {
    const p = params();
    if (append) p.offset = items.value.length;
    const r = await api.persons(p);
    items.value = append ? [...items.value, ...r.items] : r.items;
    total.value = r.total;
    // 已选中的里剔除不存在的
    const ids = new Set(items.value.map((x) => x.id));
    selected.value = new Set([...selected.value].filter((id) => ids.has(id)));
  } catch (e) {
    showToast(e.message);
  } finally {
    loading.value = false;
  }
}

async function loadStats() {
  try {
    const s = await api.stats();
    stats.value = s;
  } catch { /* ignore */ }
}

let timer = null;
function onKeyword() {
  clearTimeout(timer);
  timer = setTimeout(() => load(), 260);
}

function setFilter(f) {
  if (filter.value === f) return;
  filter.value = f;
  load();
}

const hasMore = computed(() => items.value.length < total.value);

/* ---------------- 选择 ---------------- */
function toggleSelectMode() {
  selectMode.value = !selectMode.value;
  if (!selectMode.value) selected.value = new Set();
}

function toggle(id) {
  const s = new Set(selected.value);
  s.has(id) ? s.delete(id) : s.add(id);
  selected.value = s;
}

const allChecked = computed(() =>
  items.value.length > 0 && items.value.every((x) => selected.value.has(x.id))
);

function toggleAll() {
  selected.value = allChecked.value ? new Set() : new Set(items.value.map((x) => x.id));
}

/* ---------------- 删除 ---------------- */
async function removeBatch() {
  const ids = [...selected.value];
  if (!ids.length) return;
  try {
    await showConfirmDialog({
      title: '确认删除',
      message: `将删除 ${ids.length} 位联系人，其任职、资源标签、接触记录一并删除，且无法恢复。`,
      confirmButtonText: '删除',
      confirmButtonColor: '#dc2626',
    });
  } catch { return; }

  try {
    const r = await api.batchDeletePersons(ids);
    showSuccessToast(`已删除 ${r.deleted} 人`);
    selected.value = new Set();
    await Promise.all([load(), loadStats()]);
  } catch (e) {
    showToast(e.message);
  }
}

async function removeOne(p) {
  try {
    await showConfirmDialog({
      title: '确认删除',
      message: `删除「${p.name}」？其任职、资源标签、接触记录会一并删除。`,
      confirmButtonText: '删除',
      confirmButtonColor: '#dc2626',
    });
  } catch { return; }

  try {
    await api.deletePerson(p.id);
    showSuccessToast('已删除');
    sheetOpen.value = false;
    await Promise.all([load(), loadStats()]);
  } catch (e) {
    showToast(e.message);
  }
}

/* ---------------- 编辑抽屉 ---------------- */
const sheetOpen = ref(false);
const saving = ref(false);
const editing = ref(null);
const form = ref(blankForm());
const originalOrg = ref('');

function blankForm() {
  return {
    name: '',
    org_name: '',
    position: '',
    power_level: '',
    phone: '',
    email: '',
    is_key_contact: false,
    remark: '',
  };
}

function openCreate() {
  editing.value = null;
  originalOrg.value = '';
  form.value = blankForm();
  sheetOpen.value = true;
}

function openEdit(p) {
  editing.value = p;
  originalOrg.value = p.org_name || '';
  form.value = {
    name: p.name || '',
    org_name: p.org_name || '',
    position: p.position || p.title || '',
    power_level: '',
    phone: p.phone || '',
    email: p.email || '',
    is_key_contact: !!p.is_key_contact,
    remark: p.remark || '',
  };
  // 补权力角色：列表接口不带，单独取详情
  api.person(p.id)
    .then((d) => {
      const cur = d.employments?.find((e) => e.is_current) || d.employments?.[0];
      if (cur) form.value.power_level = cur.power_level || '';
    })
    .catch(() => {});
  sheetOpen.value = true;
}

const canSave = computed(() => form.value.name.trim().length > 0);

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  try {
    const f = form.value;
    const payload = {
      name: f.name.trim(),
      position: f.position.trim() || undefined,
      phone: f.phone.trim() || undefined,
      email: f.email.trim() || undefined,
      is_key_contact: f.is_key_contact,
      remark: f.remark.trim() || undefined,
      met_way: undefined,
    };
    // 只有单位真的改了才动任职，避免每次保存都新建一条任职记录
    if (f.org_name.trim() && f.org_name.trim() !== originalOrg.value) {
      payload.org_name = f.org_name.trim();
      payload.power_level = f.power_level || 'unknown';
    } else if (!editing.value && f.org_name.trim()) {
      payload.org_name = f.org_name.trim();
      payload.power_level = f.power_level || 'unknown';
    }

    // 清空手机号要显式传空串，undefined 会被后端当成"不修改"
    if (editing.value && !f.phone.trim() && editing.value.phone) payload.phone = '';
    if (editing.value && !f.email.trim() && editing.value.email) payload.email = '';

    if (editing.value) {
      await api.updatePerson(editing.value.id, payload);
      showSuccessToast('已保存');
    } else {
      await api.createPerson(payload);
      showSuccessToast('已新增');
    }
    sheetOpen.value = false;
    await Promise.all([load(), loadStats()]);
  } catch (e) {
    showToast(e.message);
  } finally {
    saving.value = false;
  }
}

/* ---------------- 导入入口 ---------------- */
function goImport() {
  router.push('/import');
}

function goDetail(p) {
  if (selectMode.value) { toggle(p.id); return; }
  router.push(`/person/${p.id}`);
}

onMounted(() => {
  load();
  loadStats();
  api.enums().then((e) => { enums.value = e; }).catch(() => {});
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="container">
        <h1>管理</h1>
        <div class="sub">
          共 {{ stats.persons || total }} 人 · {{ stats.keyContacts || 0 }} 位重点 · {{ stats.orgs || 0 }} 个单位
        </div>

        <div class="acts">
          <button class="act act--primary" @click="goImport">
            <van-icon name="down" />
            <span>导入 Excel</span>
          </button>
          <button class="act" @click="openCreate">
            <van-icon name="plus" />
            <span>新增人员</span>
          </button>
          <button class="act act--ghost" :class="{ 'act--on': selectMode }" @click="toggleSelectMode">
            {{ selectMode ? '完成' : '批量' }}
          </button>
        </div>

        <div class="search-box">
          <van-icon name="search" class="search-icon" />
          <input
            v-model="keyword"
            class="search-input"
            placeholder="搜姓名 / 单位 / 职务"
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
            :class="{ 'chip--on': filter === f.key }"
            @click="setFilter(f.key)"
          >
            {{ f.label }}
          </button>
        </div>
      </div>
    </header>

    <div class="container">
      <div v-if="loading && !items.length" class="loading"><van-loading /></div>

      <template v-else>
        <div v-if="selectMode" class="select-bar">
          <button class="mini-btn" @click="toggleAll">
            <van-icon :name="allChecked ? 'checked' : 'circle'" />
            {{ allChecked ? '取消全选' : '全选本页' }}
          </button>
          <span class="muted">已选 {{ selected.size }} 人</span>
        </div>

        <div v-if="!items.length" class="empty">
          <van-icon name="friends-o" class="empty-icon" />
          <div class="empty-text">
            {{ keyword || filter !== 'all' ? '没有符合条件的联系人' : '还没有联系人' }}
          </div>
          <van-button
            v-if="!keyword && filter === 'all'"
            type="primary"
            size="small"
            round
            style="margin-top: 16px"
            @click="goImport"
          >
            导入 Excel 名单
          </van-button>
        </div>

        <div
          v-for="p in items"
          :key="p.id"
          class="card card--tap person"
          :class="{ 'person--on': selected.has(p.id) }"
          @click="goDetail(p)"
        >
          <div v-if="selectMode" class="check" @click.stop="toggle(p.id)">
            <van-icon :name="selected.has(p.id) ? 'checked' : 'circle'" />
          </div>

          <div
            class="avatar"
            :class="{ 'avatar--key': p.is_key_contact && !p.is_self, 'avatar--self': p.is_self }"
          >
            {{ p.name.slice(-2) }}
          </div>

          <div class="grow">
            <div class="row gap-6">
              <span class="p-name">{{ p.name }}</span>
              <span v-if="p.is_self" class="tag tag--success">我</span>
              <span v-if="p.is_key_contact" class="tag tag--warn">重点</span>
              <span v-if="p.attr_count" class="tag">{{ p.attr_count }} 资源</span>
            </div>
            <div class="p-sub ellipsis">
              <template v-if="p.org_name">
                {{ p.org_name }}<template v-if="p.position"> · {{ p.position }}</template>
              </template>
              <template v-else-if="p.title">{{ p.title }}</template>
              <template v-else>未填单位</template>
            </div>
          </div>

          <button v-if="!selectMode && !p.is_self" class="edit-btn" @click.stop="openEdit(p)">
            <van-icon name="edit" />
          </button>
          <van-icon v-else-if="!selectMode" name="arrow" class="p-arrow" />
        </div>

        <button v-if="hasMore" class="more-btn" :disabled="loading" @click="load({ append: true })">
          {{ loading ? '加载中…' : `加载更多（还有 ${total - items.length} 人）` }}
        </button>
      </template>
    </div>

    <!-- 批量操作条 -->
    <div v-if="selectMode && selected.size" class="batch-bar">
      <span class="batch-count">已选 <b>{{ selected.size }}</b> 人</span>
      <button class="batch-btn" @click="removeBatch">删除</button>
    </div>

    <!-- 编辑 / 新增 -->
    <van-popup v-model:show="sheetOpen" position="bottom" round :style="{ maxHeight: '88%' }">
      <div class="sheet">
        <div class="sheet-head">
          <span class="sheet-title">{{ editing ? '编辑联系人' : '新增联系人' }}</span>
          <van-icon name="cross" class="sheet-close" @click="sheetOpen = false" />
        </div>

        <div class="sheet-body">
          <label class="field">
            <span class="field-label">姓名 <em>*</em></span>
            <input v-model="form.name" class="input input--lg" placeholder="真实姓名" autocomplete="off" />
          </label>

          <div class="field">
            <span class="field-label">单位</span>
            <OrgInput v-model="form.org_name" placeholder="点一下可选已填过的单位" />
          </div>

          <div class="two-col">
            <label class="field">
              <span class="field-label">职务</span>
              <input v-model="form.position" class="input" placeholder="处长 / 总经理" />
            </label>
            <label class="field">
              <span class="field-label">手机号</span>
              <input v-model="form.phone" class="input" placeholder="自动加密" inputmode="tel" />
            </label>
          </div>

          <div class="field">
            <span class="field-label">权力角色</span>
            <div class="chips">
              <button
                v-for="opt in powerOptions"
                :key="opt.value"
                type="button"
                class="chip"
                :class="{ 'chip--on': form.power_level === opt.value }"
                @click="form.power_level = form.power_level === opt.value ? '' : opt.value"
              >
                {{ opt.text }}
              </button>
            </div>
          </div>

          <label class="field">
            <span class="field-label">邮箱</span>
            <input v-model="form.email" class="input" placeholder="name@domain.com" autocomplete="off" />
          </label>

          <div class="switch-row">
            <div>
              <div class="field-label" style="margin: 0">重点人物</div>
              <div class="muted" style="font-size: 12px">决策人、审批人这类要重点经营的人</div>
            </div>
            <van-switch v-model="form.is_key_contact" size="22px" />
          </div>

          <label class="field" style="margin-top: 14px">
            <span class="field-label">备注</span>
            <textarea v-model="form.remark" class="input textarea" rows="3" placeholder="印象、背景、能帮你办什么事"></textarea>
          </label>
        </div>

        <div class="sheet-foot">
          <van-button
            v-if="editing"
            plain
            type="danger"
            round
            style="flex: 0 0 92px"
            @click="removeOne(editing)"
          >
            删除
          </van-button>
          <van-button type="primary" block round :loading="saving" :disabled="!canSave" @click="save">
            保存
          </van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.acts {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  flex: 1;
  border: 1px solid var(--c-border);
  background: #fff;
  color: var(--c-text-2);
  border-radius: 10px;
  padding: 9px 10px;
  font-size: 13.5px;
  font-family: inherit;
  font-weight: 500;
  cursor: pointer;
  transition: all .15s;
}

.act--primary {
  background: var(--c-primary);
  border-color: var(--c-primary);
  color: #fff;
  font-weight: 600;
}

.act--ghost { flex: 0 0 72px; }
.act--on { background: var(--c-primary-light); border-color: var(--c-primary); color: var(--c-primary); }

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
  transition: border-color .15s;
}
.search-input:focus { border-color: var(--c-primary); }
.search-clear {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  color: var(--c-text-3); cursor: pointer; font-size: 16px;
}

.chips { display: flex; align-items: center; gap: 7px; margin-top: 10px; flex-wrap: wrap; }
.chip {
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

.select-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 2px 6px;
  font-size: 12.5px;
}

.mini-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: none;
  color: var(--c-primary);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  padding: 0;
}

.person {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  transition: background .15s;
}
.person--on { background: var(--c-primary-light); border-color: var(--c-primary); }

.check {
  font-size: 20px;
  color: var(--c-primary);
  display: flex;
  align-items: center;
  margin-left: -4px;
}

.p-name { font-weight: 600; font-size: 15.5px; }
.p-sub { font-size: 13px; color: var(--c-text-2); margin-top: 2px; }
.p-arrow { color: var(--c-text-3); font-size: 14px; }

.edit-btn {
  border: 1px solid var(--c-border);
  background: #fff;
  color: var(--c-text-3);
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 15px;
  flex-shrink: 0;
}
.edit-btn:active { background: var(--c-primary-light); color: var(--c-primary); }

.more-btn {
  display: block;
  width: 100%;
  border: 1px dashed var(--c-border);
  background: none;
  color: var(--c-text-2);
  border-radius: 10px;
  padding: 12px;
  font-size: 13px;
  font-family: inherit;
  margin: 6px 0 16px;
  cursor: pointer;
}

.batch-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(var(--nav-h) + var(--safe-bottom));
  z-index: 99;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  max-width: 780px;
  margin: 0 auto;
  padding: 10px 16px;
  background: rgba(255, 255, 255, .96);
  backdrop-filter: blur(12px);
  border-top: 1px solid var(--c-border);
}

.batch-count { font-size: 13.5px; color: var(--c-text-2); }
.batch-count b { color: var(--c-primary); font-size: 16px; }

.batch-btn {
  border: 0;
  background: var(--c-danger);
  color: #fff;
  border-radius: 999px;
  padding: 8px 22px;
  font-size: 14px;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
}

/* 抽屉 */
.sheet { display: flex; flex-direction: column; max-height: 88vh; }
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 10px;
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}
.sheet-title { font-size: 16px; font-weight: 700; }
.sheet-close { font-size: 18px; color: var(--c-text-3); cursor: pointer; padding: 4px; }

.sheet-body { padding: 16px; overflow-y: auto; }
.sheet-foot {
  display: flex;
  gap: 10px;
  padding: 12px 16px calc(12px + var(--safe-bottom));
  border-top: 1px solid var(--c-border);
  flex-shrink: 0;
}

.field { display: block; margin-bottom: 14px; }
.field-label {
  display: block;
  font-size: 12.5px;
  color: var(--c-text-3);
  font-weight: 500;
  margin-bottom: 6px;
}
.field-label em { color: var(--c-danger); font-style: normal; }

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
  transition: border-color .15s, background .15s;
}
.input:focus { border-color: var(--c-primary); background: #fff; }
.input--lg { font-size: 16.5px; font-weight: 500; }
.textarea { resize: vertical; line-height: 1.55; }

.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 12px;
  border-top: 1px solid var(--c-border);
}

@media (min-width: 768px) {
  .batch-bar { padding: 12px 24px; }
}
</style>
