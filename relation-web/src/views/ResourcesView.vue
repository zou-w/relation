<script setup>
import { ref, onMounted, watch, computed } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import api from '@/api';

const router = useRouter();

const keyword = ref('');
const activeType = ref('');
const items = ref([]);
const spheres = ref([]);
const overview = ref({ byType: [], topValues: [] });
const loading = ref(false);
const loaded = ref(false);

let timer = null;

const typeMeta = {
  resource: { label: '资源', icon: 'gift-o' },
  sphere: { label: '圈子', icon: 'friends-o' },
  tag: { label: '标签', icon: 'label-o' },
  influence: { label: '影响力', icon: 'fire-o' },
  channel: { label: '渠道', icon: 'exchange' },
};

const typeChips = computed(() =>
  (overview.value.byType || []).map((t) => ({
    value: t.attr_type,
    label: typeMeta[t.attr_type]?.label || t.attr_type,
    count: t.cnt,
  }))
);

const quickKeywords = computed(() =>
  (overview.value.topValues || []).slice(0, 8).map((v) => v.attr_value)
);

async function load() {
  loading.value = true;
  try {
    const [r, s, o] = await Promise.all([
      api.searchResources({
        q: keyword.value.trim() || undefined,
        type: activeType.value || undefined,
        limit: 100,
      }),
      spheres.value.length ? Promise.resolve({ items: spheres.value }) : api.spheres(),
      overview.value.byType.length ? Promise.resolve(overview.value) : api.resourceOverview(),
    ]);
    items.value = r.items || [];
    spheres.value = s.items || [];
    overview.value = o || { byType: [], topValues: [] };
    loaded.value = true;
  } catch (e) {
    showToast(e.message);
  } finally {
    loading.value = false;
  }
}

watch(keyword, () => {
  clearTimeout(timer);
  timer = setTimeout(load, 260);
});

watch(activeType, load);

function pick(kw) {
  keyword.value = kw;
}

const open = (id) => router.push(`/person/${id}`);

onMounted(load);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="container">
        <h1>借资源</h1>
        <div class="sub">谁手里有你要的东西</div>

        <div class="search-box">
          <van-icon name="search" class="search-icon" />
          <input
            v-model="keyword"
            class="search-input"
            placeholder="输入资源关键词，如：审批、渠道、协会"
            autocomplete="off"
          />
          <van-icon v-if="keyword" name="clear" class="search-clear" @click="keyword = ''" />
        </div>

        <!-- 类型筛选 -->
        <div class="type-row">
          <button
            class="type-chip"
            :class="{ 'type-chip--on': activeType === '' }"
            @click="activeType = ''"
          >
            全部
          </button>
          <button
            v-for="t in typeChips"
            :key="t.value"
            class="type-chip"
            :class="{ 'type-chip--on': activeType === t.value }"
            @click="activeType = activeType === t.value ? '' : t.value"
          >
            {{ t.label }}
            <span class="type-count">{{ t.count }}</span>
          </button>
        </div>
      </div>
    </header>

    <div class="container">
      <div v-if="loading && !loaded" class="loading"><van-loading /></div>

      <template v-else>
        <!-- 热门标签 -->
        <div v-if="quickKeywords.length && !keyword" class="quick-tags">
          <span class="quick-label">常用：</span>
          <button
            v-for="kw in quickKeywords"
            :key="kw"
            class="quick-tag"
            @click="pick(kw)"
          >
            {{ kw }}
          </button>
        </div>

        <!-- 圈子渗透度 -->
        <template v-if="!keyword && activeType === ''">
          <div class="section-title">圈子渗透度</div>
          <div class="card sphere-card">
            <div v-for="s in spheres" :key="s.sphere" class="sphere-item">
              <div class="grow">
                <div class="row gap-6">
                  <span class="sphere-name">{{ s.sphere }}</span>
                  <span v-if="s.key_count" class="tag tag--warn">{{ s.key_count }} 位重点</span>
                </div>
                <div class="muted ellipsis">{{ s.members }}</div>
              </div>
              <div class="sphere-count">{{ s.total }}<small>人</small></div>
            </div>
          </div>
        </template>

        <!-- 资源列表 -->
        <div class="section-title">
          {{ keyword ? `「${keyword}」相关资源` : '资源画像' }}
          <span class="muted" style="font-weight: 400"> · {{ items.length }} 条</span>
        </div>

        <div
          v-for="r in items"
          :key="r.id"
          class="card card--tap res"
          @click="open(r.person_id)"
        >
          <div class="res-head">
            <span class="res-value">{{ r.attr_value }}</span>
            <span class="tag tag--gray">{{ typeMeta[r.attr_type]?.label || r.attr_type }}</span>
            <span class="grow"></span>
            <div class="weight">
              <span class="weight-dot" v-for="i in 5" :key="i" :class="{ on: i <= r.weight }" />
            </div>
          </div>

          <div v-if="r.note" class="res-note">{{ r.note }}</div>

          <div class="res-foot">
            <div class="avatar avatar--sm" :class="{ 'avatar--key': r.is_key_contact }">
              {{ r.person_name.slice(-2) }}
            </div>
            <div class="grow ellipsis">
              <span class="res-person">{{ r.person_name }}</span>
              <span class="muted" v-if="r.org_name"> · {{ r.org_name }}</span>
              <span class="muted" v-if="r.title"> {{ r.title }}</span>
            </div>
            <span v-if="r.power_level && r.power_level !== 'unknown'" class="tag">
              {{ { decision: '决策人', approval: '审批人', operator: '经办人', support: '协助方' }[r.power_level] || r.power_level }}
            </span>
          </div>
        </div>

        <div v-if="!items.length" class="empty">
          <div class="empty-icon">🎁</div>
          <div class="empty-text">没有匹配的资源</div>
          <div class="muted" style="margin-top: 6px">
            到联系人详情页给 ta 打个资源标签
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.search-box { position: relative; margin-top: 12px; }

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--c-text-3);
  font-size: 16px;
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
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--c-text-3);
  cursor: pointer;
  font-size: 16px;
}

.type-row {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 2px;
}

.type-row::-webkit-scrollbar { display: none; }

.type-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--c-border);
  background: #fff;
  color: var(--c-text-2);
  border-radius: 999px;
  padding: 5px 11px;
  font-size: 12.5px;
  font-family: inherit;
  white-space: nowrap;
  cursor: pointer;
  transition: all .15s;
}

.type-chip--on {
  background: var(--c-primary);
  border-color: var(--c-primary);
  color: #fff;
  font-weight: 600;
}

.type-count {
  font-size: 10.5px;
  opacity: .7;
  font-variant-numeric: tabular-nums;
}

.quick-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 14px 0 4px;
}

.quick-label { font-size: 12.5px; color: var(--c-text-3); }

.quick-tag {
  border: 1px solid var(--c-border);
  background: #fff;
  color: var(--c-text-2);
  border-radius: 7px;
  padding: 3px 9px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.quick-tag:active { background: var(--c-primary-light); }

.sphere-card { padding: 4px 14px; }

.sphere-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 0;
  border-bottom: 1px solid var(--c-border);
}

.sphere-item:last-child { border-bottom: 0; }
.sphere-name { font-weight: 600; font-size: 14.5px; }

.sphere-count {
  font-size: 19px;
  font-weight: 700;
  color: var(--c-primary);
  font-variant-numeric: tabular-nums;
}

.sphere-count small { font-size: 11px; font-weight: 400; color: var(--c-text-3); margin-left: 2px; }

.res-head {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

.res-value { font-weight: 700; font-size: 15.5px; letter-spacing: -.01em; }

.weight { display: flex; gap: 2.5px; align-items: center; }

.weight-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--c-border);
}

.weight-dot.on { background: var(--c-warning); }

.res-note {
  font-size: 13px;
  color: var(--c-text-2);
  margin-top: 6px;
  line-height: 1.55;
}

.res-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--c-border);
}

.res-person { font-weight: 600; font-size: 13.5px; }
</style>
