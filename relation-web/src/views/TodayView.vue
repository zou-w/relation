<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import api from '@/api';

const router = useRouter();

const loading = ref(true);
const stats = ref({});
const pending = ref({ overdue: [], today: [], upcoming: [], total: 0 });
const cold = ref([]);

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
});

const todayStr = computed(() => {
  const d = new Date();
  const w = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${w}`;
});

async function load() {
  loading.value = true;
  try {
    const [s, p, c] = await Promise.all([
      api.stats(),
      api.pending(7),
      api.coldContacts(30),
    ]);
    stats.value = s || {};
    pending.value = p || { overdue: [], today: [], upcoming: [], total: 0 };
    cold.value = (c?.items || []).slice(0, 6);
  } catch (e) {
    showToast(e.message);
  } finally {
    loading.value = false;
  }
}

async function done(ev) {
  try {
    await api.updateEvent(ev.id, { is_done: true });
    showToast('已标记完成');
    load();
  } catch (e) {
    showToast(e.message);
  }
}

const openPerson = (id) => router.push(`/person/${id}`);

onMounted(load);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="container">
        <h1>{{ greeting }}</h1>
        <div class="sub">{{ todayStr }}</div>
      </div>
    </header>

    <div class="container">
      <div v-if="loading" class="loading"><van-loading /></div>

      <template v-else>
        <!-- 概览 -->
        <div class="stat-grid" style="margin-top: 4px;">
          <div class="stat">
            <div class="stat-num">{{ stats.persons ?? 0 }}</div>
            <div class="stat-label">联系人</div>
          </div>
          <div class="stat">
            <div class="stat-num" style="color: var(--c-warning)">{{ stats.keyContacts ?? 0 }}</div>
            <div class="stat-label">重点人物</div>
          </div>
          <div class="stat">
            <div class="stat-num">{{ stats.orgs ?? 0 }}</div>
            <div class="stat-label">单位</div>
          </div>
          <div class="stat">
            <div class="stat-num" style="color: var(--c-primary)">{{ stats.resources ?? 0 }}</div>
            <div class="stat-label">资源画像</div>
          </div>
        </div>

        <!-- 逾期 -->
        <template v-if="pending.overdue.length">
          <div class="section-title">已逾期 · {{ pending.overdue.length }}</div>
          <div v-for="ev in pending.overdue" :key="ev.id" class="card todo todo--overdue">
            <div class="row-between">
              <div class="grow">
                <div class="row gap-6">
                  <span class="todo-name" @click="openPerson(ev.person_id)">{{ ev.person_name }}</span>
                  <span class="tag tag--danger">逾期 {{ Math.abs(ev.days_left) }} 天</span>
                </div>
                <div class="todo-action">{{ ev.next_action || ev.subject || '待跟进' }}</div>
                <div class="muted" style="margin-top: 2px;">截止 {{ ev.next_date }}</div>
              </div>
              <van-button size="small" type="primary" plain round @click="done(ev)">完成</van-button>
            </div>
          </div>
        </template>

        <!-- 今日 -->
        <template v-if="pending.today.length">
          <div class="section-title">今天 · {{ pending.today.length }}</div>
          <div v-for="ev in pending.today" :key="ev.id" class="card todo">
            <div class="row-between">
              <div class="grow">
                <div class="row gap-6">
                  <span class="todo-name" @click="openPerson(ev.person_id)">{{ ev.person_name }}</span>
                  <span class="tag">今日到期</span>
                </div>
                <div class="todo-action">{{ ev.next_action || ev.subject || '待跟进' }}</div>
              </div>
              <van-button size="small" type="primary" round @click="done(ev)">完成</van-button>
            </div>
          </div>
        </template>

        <!-- 未来 -->
        <template v-if="pending.upcoming.length">
          <div class="section-title">最近 7 天 · {{ pending.upcoming.length }}</div>
          <div v-for="ev in pending.upcoming" :key="ev.id" class="card todo">
            <div class="row-between">
              <div class="grow">
                <div class="row gap-6">
                  <span class="todo-name" @click="openPerson(ev.person_id)">{{ ev.person_name }}</span>
                  <span class="tag tag--gray">{{ ev.days_left }} 天后</span>
                </div>
                <div class="todo-action">{{ ev.next_action || ev.subject || '待跟进' }}</div>
              </div>
              <van-button size="small" plain round @click="done(ev)">完成</van-button>
            </div>
          </div>
        </template>

        <!-- 冷接触 -->
        <template v-if="cold.length">
          <div class="section-title">该联系了 · {{ cold.length }}</div>
          <div class="card cold-card">
            <div
              v-for="p in cold"
              :key="p.id"
              class="cold-item"
              @click="openPerson(p.id)"
            >
              <div class="avatar avatar--sm" :class="{ 'avatar--key': p.is_key_contact }">
                {{ p.name.slice(-2) }}
              </div>
              <div class="grow">
                <div class="row gap-6">
                  <span class="cold-name">{{ p.name }}</span>
                  <span v-if="p.is_key_contact" class="tag tag--warn">重点</span>
                </div>
                <div class="muted ellipsis">{{ p.org_name || '未填单位' }}</div>
              </div>
              <div class="cold-days">
                {{ p.days_since === null ? '从未联系' : p.days_since + ' 天' }}
              </div>
            </div>
          </div>
        </template>

        <!-- 全空 -->
        <div v-if="!pending.total && !cold.length" class="empty">
          <div class="empty-icon">☕</div>
          <div class="empty-text">今天没有待办，也没有冷落的人</div>
        </div>

        <!-- 快捷入口 -->
        <div class="section-title">快捷操作</div>
        <div class="quick-grid">
          <div class="quick" @click="router.push('/record')">
            <van-icon name="add-o" class="quick-icon" />
            <span>记一个人</span>
          </div>
          <div class="quick" @click="router.push('/search')">
            <van-icon name="search" class="quick-icon" />
            <span>查人</span>
          </div>
          <div class="quick" @click="router.push('/resources')">
            <van-icon name="gift-o" class="quick-icon" />
            <span>找资源</span>
          </div>
          <div class="quick" @click="router.push('/graph')">
            <van-icon name="cluster-o" class="quick-icon" />
            <span>看关系</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.todo--overdue {
  border-left: 3px solid var(--c-danger);
}

.todo-name {
  font-weight: 600;
  font-size: 15.5px;
}

.todo-action {
  color: var(--c-text-2);
  font-size: 13.5px;
  margin-top: 3px;
  line-height: 1.5;
}

.cold-card { padding: 4px 14px; }

.cold-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 0;
  border-bottom: 1px solid var(--c-border);
  cursor: pointer;
}

.cold-item:last-child { border-bottom: 0; }
.cold-item:active { opacity: .6; }

.cold-name { font-weight: 600; font-size: 14.5px; }

.cold-days {
  font-size: 12.5px;
  color: var(--c-warning);
  font-weight: 600;
  white-space: nowrap;
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 10px;
}

.quick {
  background: var(--c-card);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  padding: 14px 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--c-text-2);
  cursor: pointer;
  transition: transform .12s;
}

.quick:active { transform: scale(.97); }
.quick-icon { font-size: 22px; color: var(--c-primary); }
</style>
