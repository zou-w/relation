<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

const tabs = [
  { name: 'today', path: '/', label: '今日', icon: 'calendar-o' },
  { name: 'search', path: '/search', label: '查人', icon: 'search' },
  { name: 'resources', path: '/resources', label: '借资源', icon: 'gift-o' },
  { name: 'graph', path: '/graph', label: '关系图', icon: 'cluster-o' },
  { name: 'manage', path: '/manage', label: '管理', icon: 'friends-o' },
];

const show = computed(() => route.meta.nav === true);
const active = computed(() => route.name);

const go = (path) => {
  if (route.path !== path) router.push(path);
};
</script>

<template>
  <nav v-if="show" class="tabbar">
    <div class="tabbar-inner">
      <button
        v-for="t in tabs"
        :key="t.name"
        class="tab"
        :class="{ active: active === t.name }"
        type="button"
        @click="go(t.path)"
      >
        <van-icon :name="t.icon" class="tab-icon" />
        <span class="tab-label">{{ t.label }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  background: rgba(255, 255, 255, .92);
  backdrop-filter: saturate(180%) blur(16px);
  -webkit-backdrop-filter: saturate(180%) blur(16px);
  border-top: 1px solid var(--c-border);
  padding-bottom: var(--safe-bottom);
}

.tabbar-inner {
  display: flex;
  height: var(--nav-h);
  max-width: 780px;
  margin: 0 auto;
}

.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: 0;
  background: none;
  color: var(--c-text-3);
  font-family: inherit;
  cursor: pointer;
  transition: color .18s ease;
  padding: 0;
}

.tab-icon { font-size: 21px; transition: transform .18s ease; }
.tab-label { font-size: 10.5px; font-weight: 500; letter-spacing: .01em; }

.tab.active { color: var(--c-primary); }
.tab.active .tab-icon { transform: translateY(-1px) scale(1.06); }
.tab.active .tab-label { font-weight: 600; }

@media (min-width: 768px) {
  .tabbar-inner { height: 62px; }
  .tab-icon { font-size: 22px; }
  .tab-label { font-size: 11.5px; }
}
</style>
