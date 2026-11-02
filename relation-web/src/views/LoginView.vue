<script setup>
/**
 * 登录 / 注册
 */
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const mode = ref('login');       // login | register
const username = ref('');
const password = ref('');
const confirm = ref('');
const displayName = ref('');
const error = ref('');

const title = computed(() => (mode.value === 'login' ? '欢迎回来' : '创建账号'));
const subtitle = computed(() =>
  mode.value === 'login' ? '登录后管理你的关系网' : '注册后，你录入的数据只有你能看到'
);

function switchMode(m) {
  mode.value = m;
  error.value = '';
  password.value = '';
  confirm.value = '';
}

async function submit() {
  error.value = '';
  const u = username.value.trim();
  if (!u || !password.value) {
    error.value = '请填写用户名和密码';
    return;
  }
  if (mode.value === 'register') {
    if (password.value !== confirm.value) {
      error.value = '两次输入的密码不一致';
      return;
    }
    if (password.value.length < 6) {
      error.value = '密码至少 6 位';
      return;
    }
  }

  try {
    if (mode.value === 'login') {
      await auth.login({ username: u, password: password.value });
    } else {
      await auth.register({
        username: u,
        password: password.value,
        display_name: displayName.value.trim() || u,
      });
    }
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    router.replace(redirect.startsWith('/') ? redirect : '/');
  } catch (e) {
    error.value = e.message || '登录失败';
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-bg"></div>

    <div class="auth-wrap">
      <div class="brand">
        <div class="brand-mark">
          <van-icon name="cluster-o" size="30" />
        </div>
        <h1>人脉关系网</h1>
        <p>把认识的人，连成能用的关系</p>
      </div>

      <div class="auth-card">
        <div class="seg">
          <button :class="{ on: mode === 'login' }" @click="switchMode('login')">登录</button>
          <button :class="{ on: mode === 'register' }" @click="switchMode('register')">注册</button>
        </div>

        <h2>{{ title }}</h2>
        <p class="sub">{{ subtitle }}</p>

        <label class="field">
          <span>用户名</span>
          <input
            v-model="username"
            class="input"
            autocomplete="username"
            placeholder="3-32 位字母、数字或下划线"
            @keyup.enter="submit"
          />
        </label>

        <label v-if="mode === 'register'" class="field">
          <span>显示名 <i>可选</i></span>
          <input v-model="displayName" class="input" placeholder="同事看到的称呼，如「王工」" />
        </label>

        <label class="field">
          <span>密码</span>
          <input
            v-model="password"
            type="password"
            class="input"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            placeholder="至少 6 位"
            @keyup.enter="submit"
          />
        </label>

        <label v-if="mode === 'register'" class="field">
          <span>确认密码</span>
          <input
            v-model="confirm"
            type="password"
            class="input"
            autocomplete="new-password"
            placeholder="再输一次"
            @keyup.enter="submit"
          />
        </label>

        <div v-if="error" class="err">{{ error }}</div>

        <button class="submit" :disabled="auth.busy" @click="submit">
          {{ auth.busy ? '处理中…' : mode === 'login' ? '登录' : '注册并进入' }}
        </button>

        <div class="hint">
          <template v-if="mode === 'login'">
            第一次使用？默认管理员 <b>admin / admin123</b>，登录后请立即改密码
          </template>
          <template v-else>
            注册后只能看到自己录入的数据；需要看别人的，由超级管理员共享
          </template>
        </div>
      </div>

      <div class="foot">数据仅自己可见 · 共享由管理员授权 · 手机号加密存储</div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  position: relative;
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 16px 40px;
  overflow: hidden;
}

.auth-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(70% 50% at 20% 0%, #dbeafe 0%, transparent 60%),
    radial-gradient(60% 45% at 100% 15%, #ede9fe 0%, transparent 55%),
    linear-gradient(180deg, #f7f9fc 0%, #f5f6f8 100%);
}

.auth-wrap {
  position: relative;
  width: 100%;
  max-width: 400px;
}

.brand { text-align: center; margin-bottom: 20px; }

.brand-mark {
  width: 62px;
  height: 62px;
  margin: 0 auto 12px;
  border-radius: 18px;
  display: grid;
  place-items: center;
  color: #fff;
  background: linear-gradient(135deg, #2563eb, #4f46e5);
  box-shadow: 0 10px 24px rgba(37, 99, 235, .28);
}

.brand h1 {
  margin: 0;
  font-size: 24px;
  letter-spacing: -.02em;
}

.brand p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--c-text-3);
}

.auth-card {
  background: rgba(255, 255, 255, .92);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, .8);
  border-radius: 18px;
  padding: 16px;
  box-shadow: 0 12px 40px rgba(16, 24, 40, .09);
}

.seg {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  background: #f1f3f6;
  padding: 3px;
  border-radius: 10px;
  margin-bottom: 16px;
}

.seg button {
  border: 0;
  background: transparent;
  padding: 7px 0;
  border-radius: 8px;
  font-size: 13.5px;
  color: var(--c-text-2);
  font-weight: 500;
  cursor: pointer;
}

.seg button.on {
  background: #fff;
  color: var(--c-text);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.auth-card h2 {
  margin: 0 0 2px;
  font-size: 18px;
}

.auth-card .sub {
  margin: 0 0 16px;
  font-size: 12.5px;
  color: var(--c-text-3);
}

.field { display: block; margin-bottom: 12px; }

.field > span {
  display: block;
  font-size: 12.5px;
  color: var(--c-text-2);
  margin-bottom: 5px;
}

.field i {
  font-style: normal;
  color: var(--c-text-3);
  font-size: 11px;
}

.input {
  width: 100%;
  border: 1px solid var(--c-border);
  background: #fff;
  border-radius: 10px;
  padding: 11px 12px;
  font-size: 15px;
  color: var(--c-text);
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}

.input:focus {
  border-color: #93b4f7;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, .1);
}

.err {
  background: var(--c-danger-light);
  color: var(--c-danger);
  font-size: 12.5px;
  padding: 8px 10px;
  border-radius: 8px;
  margin-bottom: 10px;
}

.submit {
  width: 100%;
  border: 0;
  border-radius: 11px;
  padding: 13px;
  font-size: 15.5px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #2563eb, #4f46e5);
  box-shadow: 0 6px 16px rgba(37, 99, 235, .25);
  cursor: pointer;
  margin-top: 2px;
}

.submit:active { transform: scale(.99); }
.submit:disabled { opacity: .6; }

.hint {
  margin-top: 14px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--c-text-3);
  text-align: center;
}

.hint b { color: var(--c-text-2); font-weight: 600; }

.foot {
  text-align: center;
  font-size: 11px;
  color: var(--c-text-3);
  margin-top: 18px;
  opacity: .8;
}
</style>
