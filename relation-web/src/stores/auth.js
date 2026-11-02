/**
 * 登录态：token 存 localStorage，刷新后静默校验
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api, { getToken, setToken } from '@/api';

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null);
  const ready = ref(false);
  const busy = ref(false);

  const isAdmin = computed(() => user.value?.role === 'super_admin');
  const displayName = computed(() => user.value?.display_name || user.value?.username || '');

  function applySession(session) {
    setToken(session.token);
    user.value = session.user;
  }

  async function login({ username, password }) {
    busy.value = true;
    try {
      const s = await api.login({ username, password });
      applySession(s);
      return s.user;
    } finally {
      busy.value = false;
    }
  }

  async function register({ username, password, display_name }) {
    busy.value = true;
    try {
      const s = await api.register({ username, password, display_name });
      applySession(s);
      return s.user;
    } finally {
      busy.value = false;
    }
  }

  /** 启动时静默恢复登录态 */
  async function loadMe() {
    if (!getToken()) {
      ready.value = true;
      return null;
    }
    try {
      const r = await api.me();
      user.value = r.user;
    } catch {
      user.value = null;
      setToken('');
    } finally {
      ready.value = true;
    }
    return user.value;
  }

  async function refresh() {
    if (!getToken()) return null;
    const r = await api.me();
    user.value = r.user;
    return r.user;
  }

  async function logout() {
    try { await api.logout(); } catch { /* 本地清掉就够了 */ }
    setToken('');
    user.value = null;
  }

  /** 被踢下线 / token 过期：只清状态，跳转交给路由守卫 */
  function clear() {
    setToken('');
    user.value = null;
  }

  return { user, ready, busy, isAdmin, displayName, login, register, loadMe, refresh, logout, clear };
});
