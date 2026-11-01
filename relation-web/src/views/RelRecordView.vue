<script setup>
/**
 * 记录"跨单位认识"
 *
 * 常遇到的场景：A 单位的熟人，私下认识 B 单位的领导。
 * 这种关系不在工作流程里出现，最容易被漏记 —— 而它恰恰是最能"借"的一条线。
 * 这一页专门用来快速补录：选两个人、选关系类型，保存。
 */
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast, showSuccessToast } from 'vant';
import api from '@/api';

const route = useRoute();
const router = useRouter();

const enums = ref({});
const keyword = ref('');
const candidates = ref([]);
const searching = ref(false);
const from = ref(null);
const to = ref(null);
const form = ref({ relation_type: 'classmate', strength: 3, influence: 3, note: '' });
const saving = ref(false);
/** 已知两人的单位时，提前告诉用户这条关系会被标成"跨单位" */
const sameOrg = ref(null);

const TYPE_KEYS = ['classmate', 'relative', 'friend', 'acquaintance', 'cooperation', 'introducer', 'colleague', 'superior'];
const TYPE_HINT = {
  classmate: '同窗，跨单位最常见',
  relative: '亲戚关系',
  friend: '私交好',
  acquaintance: '一面之交 / 老相识',
  cooperation: '业务往来',
  introducer: '经由他介绍认识',
  colleague: '曾共事 / 同单位',
  superior: '上下级',
};

const typeList = computed(() => {
  const vals = enums.value.relation_type?.values || {};
  return TYPE_KEYS.filter((k) => vals[k]).map((k) => ({ value: k, label: vals[k], hint: TYPE_HINT[k] }));
});

let timer = null;
async function search() {
  searching.value = true;
  try {
    const r = await api.persons({ keyword: keyword.value.trim() || undefined, limit: 30 });
    candidates.value = r.items || [];
  } catch (e) {
    showToast(e.message);
  } finally {
    searching.value = false;
  }
}

watch(keyword, () => {
  clearTimeout(timer);
  timer = setTimeout(search, 250);
});

function pick(p) {
  if (!from.value) {
    from.value = p;
  } else if (!to.value) {
    if (p.id === from.value.id) {
      showToast('不能选同一个人');
      return;
    }
    to.value = p;
  } else {
    // 两个都选了，再点就替换第二个
    to.value = p.id === from.value.id ? to.value : p;
  }
  checkSameOrg();
}

function reset(slot) {
  if (slot === 'from') from.value = null;
  if (slot === 'to') to.value = null;
  sameOrg.value = null;
}

function checkSameOrg() {
  if (!from.value || !to.value) { sameOrg.value = null; return; }
  const a = from.value.org_name || '';
  const b = to.value.org_name || '';
  sameOrg.value = a && b ? a === b : null;
}

async function save() {
  if (!from.value || !to.value) {
    showToast('请选择两个人');
    return;
  }
  saving.value = true;
  try {
    await api.createRelation({
      from_person: from.value.id,
      to_person: to.value.id,
      relation_type: form.value.relation_type,
      strength: form.value.strength,
      influence: form.value.influence,
      note: form.value.note.trim() || undefined,
    });
    showSuccessToast('已记下');
    router.replace('/graph');
  } catch (e) {
    showToast(e.message);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try { enums.value = await api.enums(); } catch { /* ignore */ }
  // ?with=id 时预填第一个人（从联系人详情页跳过来）
  const withId = Number(route.query.with);
  if (withId) {
    try {
      const p = await api.person(withId);
      from.value = {
        id: p.id,
        name: p.name,
        org_name: p.employments?.find((e) => e.is_current)?.org_name || '',
      };
    } catch { /* ignore */ }
  }
  search();
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="container">
        <div class="row gap-8">
          <van-icon name="arrow-left" size="20" style="cursor: pointer" @click="router.back()" />
          <div>
            <h1 style="font-size: 17px">记录跨单位认识</h1>
            <div class="sub">两个不在同一单位的人，私下可能就认识</div>
          </div>
        </div>
      </div>
    </header>

    <div class="container cross-picker">
      <!-- 选人 -->
      <div class="card pick">
        <div class="pick-row">
          <div class="pick-slot" :class="{ 'pick-slot--filled': from }">
            <div class="pk-label">甲方</div>
            <template v-if="from">
              <div class="pk-name">{{ from.name }}</div>
              <div class="pk-org ellipsis">{{ from.org_name || '未填单位' }}</div>
              <van-icon name="cross" class="pk-x" @click="reset('from')" />
            </template>
            <div v-else class="pk-empty">从下面选一个人</div>
          </div>
          <div class="pick-link">
            <van-icon name="exchange" />
            <span class="pick-link-lbl">{{ typeList.find((t) => t.value === form.relation_type)?.label || '关系' }}</span>
          </div>
          <div class="pick-slot" :class="{ 'pick-slot--filled': to }">
            <div class="pk-label">乙方</div>
            <template v-if="to">
              <div class="pk-name">{{ to.name }}</div>
              <div class="pk-org ellipsis">{{ to.org_name || '未填单位' }}</div>
              <van-icon name="cross" class="pk-x" @click="reset('to')" />
            </template>
            <div v-else class="pk-empty">从下面选一个人</div>
          </div>
        </div>

        <div v-if="sameOrg === true" class="hint hint--gray">
          两人同属一家单位，这条关系会按「同单位」处理
        </div>
        <div v-else-if="sameOrg === false" class="hint hint--cross">
          <i class="hint-dot"></i>
          两人单位不同 —— 保存后会在关系图里标成<b>跨单位认识</b>
        </div>
      </div>

      <!-- 关系类型 -->
      <div class="section-title">怎么认识的</div>
      <div class="card type-card">
        <div class="type-grid">
          <button
            v-for="t in typeList"
            :key="t.value"
            class="type"
            :class="{
              'type--on': form.relation_type === t.value,
              'type--cross': ['classmate', 'relative', 'friend', 'acquaintance'].includes(t.value),
            }"
            @click="form.relation_type = t.value"
          >
            <span class="type-name">{{ t.label }}</span>
            <span class="type-hint">{{ t.hint }}</span>
          </button>
        </div>
      </div>

      <!-- 强度 -->
      <div class="section-title">关系强度</div>
      <div class="card">
        <div class="field">
          <span class="field-label">亲密度 {{ form.strength }}/5</span>
          <van-slider v-model="form.strength" :min="1" :max="5" :step="1" />
        </div>
        <div class="field" style="margin-bottom: 0">
          <span class="field-label">他的话语权 {{ form.influence }}/5</span>
          <van-slider v-model="form.influence" :min="1" :max="5" :step="1" />
        </div>
      </div>

      <div class="field">
        <span class="field-label">备注（可选）</span>
        <input v-model="form.note" class="input" placeholder="如：党校同班 / 老同事 / 打球认识" />
      </div>

      <van-button
        type="primary"
        block
        round
        :loading="saving"
        :disabled="!from || !to"
        @click="save"
      >保存关系</van-button>

      <!-- 候选 -->
      <div class="section-title">选人</div>
      <div class="search-box">
        <van-icon name="search" class="search-icon" />
        <input v-model="keyword" class="search-input" placeholder="搜姓名 / 单位 / 职务" />
        <van-icon v-if="keyword" name="clear" class="search-clear" @click="keyword = ''" />
      </div>

      <div class="cand-list">
        <div
          v-for="p in candidates"
          :key="p.id"
          class="cand"
          :class="{ 'cand--on': from?.id === p.id, 'cand--on2': to?.id === p.id }"
          @click="pick(p)"
        >
          <div class="avatar avatar--sm" :class="{ 'avatar--key': p.is_key_contact && !p.is_self }">
            {{ p.name.slice(-2) }}
          </div>
          <div class="grow">
            <div class="cand-name">
              {{ p.name }}
              <span v-if="p.is_self" class="tag tag--success">我</span>
            </div>
            <div class="muted ellipsis">{{ p.org_name || '未填单位' }}</div>
          </div>
          <span v-if="from?.id === p.id" class="tag">甲方</span>
          <span v-else-if="to?.id === p.id" class="tag tag--cross">乙方</span>
        </div>
        <div v-if="!candidates.length && !searching" class="empty-inline">没有匹配的人</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sub { font-size: 12px; color: var(--c-text-3); margin-top: 2px; }

.pick { padding: 12px; }

.pick-row { display: flex; align-items: stretch; gap: 6px; }

.pick-slot {
  flex: 1;
  min-width: 0;
  border: 1.5px dashed var(--c-border);
  border-radius: 12px;
  padding: 10px;
  position: relative;
  background: #fafbfc;
  min-height: 74px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.pick-slot--filled {
  border-style: solid;
  border-color: #e9d5ff;
  background: #faf5ff;
}

.pk-label { font-size: 10.5px; color: var(--c-text-3); margin-bottom: 3px; }
.pk-name { font-size: 15px; font-weight: 700; }
.pk-org { font-size: 11.5px; color: var(--c-text-2); margin-top: 1px; }
.pk-empty { font-size: 12px; color: var(--c-text-3); }
.pk-x {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 12px;
  color: var(--c-text-3);
  cursor: pointer;
  padding: 3px;
}

.pick-link {
  flex-shrink: 0;
  width: 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: #a855f7;
  font-size: 15px;
}

.pick-link-lbl { font-size: 9.5px; color: var(--c-text-3); white-space: nowrap; }

.hint {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.5;
  border-radius: 8px;
  padding: 7px 10px;
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.hint--gray { background: #f1f2f4; color: var(--c-text-2); }
.hint--cross { background: #faf5ff; color: #7e22ce; }
.hint-dot { width: 7px; height: 7px; border-radius: 50%; background: #9333ea; }

.type-card { padding: 10px; }

.type-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 7px; }

.type {
  text-align: left;
  border: 1px solid var(--c-border);
  border-radius: 10px;
  padding: 8px 10px;
  background: #fafbfc;
  font-family: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.type-name { font-size: 13.5px; font-weight: 600; color: var(--c-text); }
.type-hint { font-size: 10.5px; color: var(--c-text-3); }
.type--cross .type-name { color: #7e22ce; }
.type--on { border-color: #a855f7; background: #faf5ff; }
.type--on .type-name { color: #6b21a8; }
.type:not(.type--cross).type--on { border-color: var(--c-primary); background: var(--c-primary-light); }
.type:not(.type--cross).type--on .type-name { color: var(--c-primary); }

.field { margin-bottom: 14px; }
.field-label { display: block; font-size: 12.5px; color: var(--c-text-3); margin-bottom: 8px; }

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

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 12px;
  padding: 0 10px;
  height: 42px;
  margin-bottom: 10px;
}

.search-icon { color: var(--c-text-3); font-size: 16px; }
.search-input {
  flex: 1;
  border: 0;
  outline: none;
  font-size: 14.5px;
  font-family: inherit;
  background: none;
  padding: 0 8px;
  min-width: 0;
}
.search-clear { color: var(--c-text-3); font-size: 15px; cursor: pointer; }

.cand-list { padding-bottom: 20px; }

.cand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 12px;
  margin-bottom: 7px;
  cursor: pointer;
}

.cand:active { background: #f7f8fa; }
.cand--on { border-color: #a855f7; background: #faf5ff; }
.cand--on2 { border-color: #c084fc; background: #fdf4ff; }
.cand-name { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 5px; }

.empty-inline { text-align: center; color: var(--c-text-3); font-size: 13px; padding: 24px 0; }
</style>
