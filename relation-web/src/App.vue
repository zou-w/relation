<script setup>
import { onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import TabBar from '@/components/TabBar.vue';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();

/** token 过期 / 被踢下线：清状态并回登录页 */
function onExpired() {
  auth.clear();
  if (router.currentRoute.value.path !== '/login') {
    router.replace({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } });
  }
}

onMounted(() => window.addEventListener('auth:expired', onExpired));
onBeforeUnmount(() => window.removeEventListener('auth:expired', onExpired));
</script>

<template>
  <div class="app-shell">
    <router-view v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
    <TabBar />
  </div>
</template>

<style>
.app-shell { min-height: 100%; }

.fade-enter-active,
.fade-leave-active {
  transition: opacity .16s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
