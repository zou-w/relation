<script setup>
import { ref, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import api from '@/api';

const router = useRouter();

const keyword = ref('');
const keyOnly = ref(false);
const items = ref([]);
const loading = ref(false);
const searched = ref(false);

let timer = null;

async function load() {
  loading.value = true;
  try {
    const r = await api.persons({
      keyword: keyword.value.trim() || undefined,
      key_only: keyOnly.value ? 1 : undefined,
      limit: 100,
    });
    items.value = r.items || [];
    searched.value = !!keyword.value.trim() || keyOnly.value;
  } catch (e) {
    showToast(e.message);
  } finally {
    loading.value = false;
  }
}

watch(keyword, () => {
  clearTimeout(timer);
  timer = setTimeout(load, 250);
});

watch(keyOnly, load);

const open = (id) => router.push(`/person/${id}`);

onMounted(load);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="container">
        <h1>查人</h1>
        <div class="sub">按姓名、单位、职务、备注搜索</div>

        <div class="search-box">
          <van-icon name="search" class="search-icon" />
          <input
            v-model="keyword"
            class="search-input"
            placeholder="搜姓名 / 单位 / 职务"
            autocomplete="off"
          />
          <van-icon
            v-if="keyword"
            name="clear"
            class="search-clear"
            @click="keyword = ''"
          />
        </div>

        <div class="filter-row">
          <button
            class="filter-chip"
            :class="{ 'filter-chip--on': keyOnly }"
            @click="keyOnly = !keyOnly"
          >
            <van-icon name="star-o" />
            只看重点人物
          </button>
        </div>
      </div>
    </header>

    <div class="container">
      <div v-if="loading" class="loading"><van-loading /></div>

      <template v-else>
        <div class="count" v-if="items.length">{{ items.length }} 人</div>

        <div
          v-for="p in items"
          :key="p.id"
          class="card card--tap person"
          @click="open(p.id)"
        >
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
            </div>
            <div class="p-sub ellipsis">
              <template v-if="p.org_name">
                {{ p.org_name }}<template v-if="p.position"> · {{ p.position }}</template>
              </template>
              <template v-else-if="p.title">{{ p.title }}</template>
              <template v-else>未填单位</template>
            </div>
          </div>
          <van-icon name="arrow" class="p-arrow" />
        </div>

        <div v-if="!items.length" class="empty">
          <div class="empty-icon">🔍</div>
          <div class="empty-text">
            {{ searched ? '没有匹配的人' : '还没有记录任何人' }}
          </div>
          <van-button
            v-if="!searched"
            type="primary"
            size="small"
            round
            style="margin-top: 16px"
            @click="router.push('/record')"
          >
            记第一个人
          </van-button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.search-box {
  position: relative;
  margin-top: 12px;
}

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
  padding: 11px 36px 11px 36px;
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

.filter-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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

.filter-chip--on {
  background: var(--c-warning-light);
  border-color: var(--c-warning);
  color: var(--c-warning);
  font-weight: 600;
}

.count {
  font-size: 12.5px;
  color: var(--c-text-3);
  margin: 14px 2px 8px;
}

.person {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
}

.p-name { font-weight: 600; font-size: 15.5px; }

.p-sub {
  font-size: 13px;
  color: var(--c-text-2);
  margin-top: 2px;
}

.p-arrow { color: var(--c-text-3); font-size: 14px; }
</style>
