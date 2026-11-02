<script setup>
/**
 * 账号与共享（超级管理员）
 * - 账号：新建 / 停用 / 改角色 / 重置密码 / 删除
 * - 登录信息：最后登录、活跃会话
 * - 共享：把自己的数据（全部或指定人）授权给别的账号只读查看
 */
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  showToast, showSuccessToast, showConfirmDialog, showLoadingToast, closeToast,
} from 'vant';
import api from '@/api';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();

const users = ref([]);
const sessions = ref([]);
const shares = ref([]);
const loading = ref(true);
const meStats = ref({ own_persons: 0, shared_persons: 0, shares_to_me: 0 });

const isAdmin = computed(() => auth.isAdmin);

/* ---------------- 加载 ---------------- */
async function loadAll() {
  loading.value = true;
  try {
    const me = await api.me();
    auth.user = me.user;
    meStats.value = me.stats;
    if (isAdmin.value) {
      const [u, s, sh] = await Promise.all([
        api.adminUsers(), api.adminSessions(), api.adminShares(),
      ]);
      users.value = u.items;
      sessions.value = s.items;
      shares.value = sh.items;
    }
  } catch (e) {
    showToast(e.message);
  } finally {
    loading.value = false;
  }
}

onMounted(loadAll);

const roleText = (r) => (r === 'super_admin' ? '超级管理员' : '普通账号');

/* ---------------- 新建账号 ---------------- */
const showUserForm = ref(false);
const userForm = ref({ username: '', password: '', display_name: '', role: 'user' });

function openUserForm() {
  userForm.value = { username: '', password: '', display_name: '', role: 'user' };
  showUserForm.value = true;
}

async function submitUser() {
  const f = userForm.value;
  if (!f.username.trim() || !f.password) return showToast('用户名和密码都要填');
  if (f.password.length < 6) return showToast('密码至少 6 位');
  try {
    await api.adminCreateUser({
      username: f.username.trim(),
      password: f.password,
      display_name: f.display_name.trim() || f.username.trim(),
      role: f.role,
    });
    showUserForm.value = false;
    showSuccessToast('账号已创建');
    loadAll();
  } catch (e) {
    showToast(e.message);
  }
}

/* ---------------- 账号操作 ---------------- */
async function toggleStatus(u) {
  const next = u.status === 'active' ? 'disabled' : 'active';
  try {
    await showConfirmDialog({
      title: next === 'disabled' ? '停用账号' : '恢复账号',
      message: next === 'disabled'
        ? `停用后 ${u.display_name} 会立即被踢下线，且无法登录。`
        : `恢复后 ${u.display_name} 可以重新登录。`,
    });
    await api.adminUpdateUser(u.id, { status: next });
    showSuccessToast(next === 'disabled' ? '已停用' : '已恢复');
    loadAll();
  } catch (e) {
    if (e !== 'cancel') showToast(e.message || '操作失败');
  }
}

async function toggleRole(u) {
  const next = u.role === 'super_admin' ? 'user' : 'super_admin';
  try {
    await showConfirmDialog({
      title: '调整角色',
      message: next === 'super_admin'
        ? `把 ${u.display_name} 设为超级管理员？他将能看到所有账号和全部数据。`
        : `把 ${u.display_name} 降为普通账号？他将只能看到自己的数据。`,
    });
    await api.adminUpdateUser(u.id, { role: next });
    showSuccessToast('角色已更新');
    loadAll();
  } catch (e) {
    if (e !== 'cancel') showToast(e.message || '操作失败');
  }
}

const showPwForm = ref(false);
const pwTarget = ref(null);
const newPw = ref('');

function openPw(u) {
  pwTarget.value = u;
  newPw.value = '';
  showPwForm.value = true;
}

async function submitPw() {
  if (newPw.value.length < 6) return showToast('新密码至少 6 位');
  try {
    await api.adminResetPassword(pwTarget.value.id, newPw.value);
    showPwForm.value = false;
    showSuccessToast('密码已重置，对方需重新登录');
    loadAll();
  } catch (e) {
    showToast(e.message);
  }
}

async function removeUser(u) {
  try {
    await showConfirmDialog({
      title: '删除账号',
      message: `删除 ${u.display_name} 后，其名下 ${u.stats.persons} 位联系人会转到你名下，不会丢数据。`,
    });
    await api.adminDeleteUser(u.id);
    showSuccessToast('账号已删除');
    loadAll();
  } catch (e) {
    if (e !== 'cancel') showToast(e.message || '操作失败');
  }
}

/* ---------------- 共享 ---------------- */
const showShareForm = ref(false);
const shareForm = ref({ owner_id: '', grantee_id: '', scope: 'all', person_id: '' });
const ownerPersons = ref([]);

const candidates = computed(() => users.value.filter((u) => u.status === 'active'));

function openShare() {
  const owner = candidates.value[0];
  shareForm.value = {
    owner_id: owner ? String(owner.id) : '',
    grantee_id: candidates.value[1] ? String(candidates.value[1].id) : '',
    scope: 'all',
    person_id: '',
  };
  ownerPersons.value = [];
  showShareForm.value = true;
  if (owner) loadOwnerPersons(owner.id);
}

async function loadOwnerPersons(ownerId) {
  shareForm.value.person_id = '';
  ownerPersons.value = [];
  if (!ownerId) return;
  try {
    const r = await api.adminUserPersons(ownerId);
    ownerPersons.value = r.items;
  } catch (e) {
    showToast(e.message);
  }
}

function onOwnerChange(e) {
  loadOwnerPersons(e.target.value);
}

async function submitShare() {
  const f = shareForm.value;
  if (!f.owner_id || !f.grantee_id) return showToast('请选择数据所有者和被共享人');
  if (f.owner_id === f.grantee_id) return showToast('不能共享给本人');
  if (f.scope === 'person' && !f.person_id) return showToast('请选择要共享的联系人');

  try {
    await api.adminCreateShare({
      owner_id: Number(f.owner_id),
      grantee_id: Number(f.grantee_id),
      person_id: f.scope === 'person' ? Number(f.person_id) : null,
    });
    showShareForm.value = false;
    showSuccessToast('共享已生效');
    loadAll();
  } catch (e) {
    showToast(e.message);
  }
}

async function removeShare(s) {
  try {
    await showConfirmDialog({ title: '取消共享', message: '取消后，对方将立即看不到这份数据。' });
    await api.adminDeleteShare(s.id);
    showSuccessToast('已取消');
    loadAll();
  } catch (e) {
    if (e !== 'cancel') showToast(e.message || '操作失败');
  }
}

function shareTargetText(s) {
  if (!s.person_id) return '全部数据';
  return `仅「${s.person_name || '指定联系人'}」`;
}

/* ---------------- 我的 ---------------- */
async function doLogout() {
  await auth.logout();
  router.replace('/login');
}

const showMyPw = ref(false);
const myPw = ref({ old_password: '', new_password: '' });

async function changeMyPw() {
  if (myPw.value.new_password.length < 6) return showToast('新密码至少 6 位');
  const t = showLoadingToast({ message: '保存中…', forbidClick: true });
  try {
    await api.changePassword(myPw.value);
    closeToast();
    showMyPw.value = false;
    myPw.value = { old_password: '', new_password: '' };
    showSuccessToast('密码已修改');
  } catch (e) {
    closeToast();
    showToast(e.message);
  }
}

const fmt = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '—');
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="container">
        <div class="row gap-8">
          <van-icon name="arrow-left" size="20" class="back" @click="router.push('/manage')" />
          <div class="grow">
            <h1>{{ isAdmin ? '账号与共享' : '我的账号' }}</h1>
            <div class="sub">
              {{ isAdmin ? '数据默认只有自己可见，共享由超级管理员授权' : '数据只有自己可见，需要看别人的由超管共享' }}
            </div>
          </div>
        </div>
      </div>
    </header>

    <div class="container">
      <!-- 我的账号 -->
      <div class="card me-card">
        <div class="avatar">{{ (auth.displayName || '我').slice(0, 1) }}</div>
        <div class="grow">
          <div class="me-name">
            {{ auth.displayName }}
            <span
              v-if="auth.displayName !== roleText(auth.user?.role)"
              class="tag"
              :class="isAdmin ? 'tag--warn' : 'tag--gray'"
            >{{ roleText(auth.user?.role) }}</span>
          </div>
          <div class="muted">@{{ auth.user?.username }}</div>
        </div>
      </div>

      <div class="mini-stats">
        <div class="ms"><b>{{ meStats.own_persons }}</b><span>我录入的人</span></div>
        <div class="ms"><b>{{ meStats.shared_persons }}</b><span>共享给我</span></div>
        <div class="ms"><b>{{ meStats.shares_to_me }}</b><span>授权记录</span></div>
      </div>

      <div class="row gap-8 mt-10">
        <button class="btn btn--ghost grow" @click="showMyPw = true">修改密码</button>
        <button class="btn btn--ghost grow" @click="doLogout">退出登录</button>
      </div>

      <template v-if="isAdmin">
        <!-- 概览 -->
        <div class="section-title">系统概览</div>
        <div class="mini-stats">
          <div class="ms"><b>{{ users.length }}</b><span>账号</span></div>
          <div class="ms"><b>{{ sessions.length }}</b><span>在线会话</span></div>
          <div class="ms"><b>{{ shares.length }}</b><span>共享关系</span></div>
        </div>

        <!-- 账号列表 -->
        <div class="section-title">
          账号管理
          <button class="link-btn" @click="openUserForm">+ 新建账号</button>
        </div>

        <div v-for="u in users" :key="u.id" class="card user-card">
          <div class="row gap-8">
            <div class="avatar avatar--sm" :class="{ 'avatar--off': u.status !== 'active' }">
              {{ (u.display_name || u.username).slice(0, 1) }}
            </div>
            <div class="grow">
              <div class="u-name">
                {{ u.display_name }}
                <span
                  v-if="u.display_name !== roleText(u.role)"
                  class="tag"
                  :class="u.role === 'super_admin' ? 'tag--warn' : 'tag--gray'"
                >{{ roleText(u.role) }}</span>
                <span v-if="u.status !== 'active'" class="tag tag--danger">已停用</span>
                <span v-else-if="u.active_sessions" class="tag tag--success">在线</span>
              </div>
              <div class="muted">@{{ u.username }} · 最后登录 {{ fmt(u.last_login_at) }}</div>
            </div>
          </div>

          <div class="u-stats">
            <span>联系人 <b>{{ u.stats.persons }}</b></span>
            <span>项目 <b>{{ u.stats.projects }}</b></span>
            <span>关系 <b>{{ u.stats.relations }}</b></span>
            <span>共享出 <b>{{ u.stats.shared_out }}</b></span>
          </div>

          <div class="u-ops">
            <button class="op" @click="openPw(u)">重置密码</button>
            <button class="op" @click="toggleRole(u)">
              {{ u.role === 'super_admin' ? '降为普通' : '设为超管' }}
            </button>
            <button class="op" @click="toggleStatus(u)">
              {{ u.status === 'active' ? '停用' : '恢复' }}
            </button>
            <button class="op op--danger" @click="removeUser(u)">删除</button>
          </div>
        </div>

        <!-- 共享 -->
        <div class="section-title">
          数据共享
          <button class="link-btn" @click="openShare">+ 新建共享</button>
        </div>
        <div class="tip">
          被共享人只能<b>查看</b>对方的数据，不能修改；对方的新增内容会自动出现在他的列表里。
        </div>

        <div v-if="!shares.length" class="card empty">还没有共享关系</div>
        <div v-for="s in shares" :key="s.id" class="card share-card">
          <div class="row gap-8">
            <span class="tag tag--gray">{{ s.owner_display || s.owner_name }}</span>
            <van-icon name="arrow" size="12" class="muted" />
            <span class="tag">{{ s.grantee_display || s.grantee_name }}</span>
            <span class="grow"></span>
            <button class="op op--danger" @click="removeShare(s)">取消</button>
          </div>
          <div class="muted mt-4">范围：{{ shareTargetText(s) }}</div>
        </div>

        <!-- 登录信息 -->
        <div class="section-title">登录信息</div>
        <div v-if="!sessions.length" class="card empty">当前没有活跃会话</div>
        <div v-for="(s, i) in sessions" :key="i" class="card sess">
          <div class="row-between">
            <span class="s-user">{{ s.display_name || s.username }}</span>
            <span class="muted">{{ s.expires_at?.slice(0, 10) }} 过期</span>
          </div>
          <div class="sess-meta">
            登录 {{ fmt(s.created_at) }} · {{ s.ip || '未知 IP' }} · {{ s.token }}
          </div>
        </div>
      </template>
    </div>

    <!-- 新建账号 -->
    <van-popup v-model:show="showUserForm" position="bottom" round :style="{ maxHeight: '80%' }">
      <div class="sheet">
        <div class="sheet-title">新建账号</div>
        <label class="field"><span>用户名</span>
          <input v-model="userForm.username" class="input" placeholder="字母、数字或下划线" />
        </label>
        <label class="field"><span>初始密码</span>
          <input v-model="userForm.password" type="password" class="input" placeholder="至少 6 位" />
        </label>
        <label class="field"><span>显示名</span>
          <input v-model="userForm.display_name" class="input" placeholder="不填则用用户名" />
        </label>
        <label class="field"><span>角色</span>
          <select v-model="userForm.role" class="input">
            <option value="user">普通账号（只看自己的数据）</option>
            <option value="super_admin">超级管理员（看全部 + 管账号）</option>
          </select>
        </label>
        <button class="btn btn--primary" @click="submitUser">创建</button>
      </div>
    </van-popup>

    <!-- 重置密码 -->
    <van-popup v-model:show="showPwForm" position="bottom" round>
      <div class="sheet">
        <div class="sheet-title">重置 {{ pwTarget?.display_name }} 的密码</div>
        <label class="field"><span>新密码</span>
          <input v-model="newPw" type="password" class="input" placeholder="至少 6 位" />
        </label>
        <div class="tip">重置后该账号所有设备都会退出登录。</div>
        <button class="btn btn--primary" @click="submitPw">确认重置</button>
      </div>
    </van-popup>

    <!-- 新建共享 -->
    <van-popup v-model:show="showShareForm" position="bottom" round :style="{ maxHeight: '86%' }">
      <div class="sheet">
        <div class="sheet-title">新建共享</div>
        <label class="field"><span>谁的数据</span>
          <select v-model="shareForm.owner_id" class="input" @change="onOwnerChange">
            <option v-for="u in candidates" :key="u.id" :value="String(u.id)">
              {{ u.display_name }}（@{{ u.username }}）
            </option>
          </select>
        </label>
        <label class="field"><span>共享给谁</span>
          <select v-model="shareForm.grantee_id" class="input">
            <option v-for="u in candidates" :key="u.id" :value="String(u.id)">
              {{ u.display_name }}（@{{ u.username }}）
            </option>
          </select>
        </label>

        <div class="field">
          <span>共享范围</span>
          <div class="seg">
            <button :class="{ on: shareForm.scope === 'all' }" @click="shareForm.scope = 'all'">全部数据</button>
            <button :class="{ on: shareForm.scope === 'person' }" @click="shareForm.scope = 'person'">指定联系人</button>
          </div>
        </div>

        <label v-if="shareForm.scope === 'person'" class="field">
          <span>选择联系人</span>
          <select v-model="shareForm.person_id" class="input">
            <option value="">请选择</option>
            <option v-for="p in ownerPersons" :key="p.id" :value="String(p.id)">
              {{ p.name }}{{ p.org_name ? ` · ${p.org_name}` : '' }}
            </option>
          </select>
        </label>

        <button class="btn btn--primary" @click="submitShare">确认共享</button>
      </div>
    </van-popup>

    <!-- 改自己的密码 -->
    <van-popup v-model:show="showMyPw" position="bottom" round>
      <div class="sheet">
        <div class="sheet-title">修改我的密码</div>
        <label class="field"><span>当前密码</span>
          <input v-model="myPw.old_password" type="password" class="input" />
        </label>
        <label class="field"><span>新密码</span>
          <input v-model="myPw.new_password" type="password" class="input" placeholder="至少 6 位" />
        </label>
        <button class="btn btn--primary" @click="changeMyPw">保存</button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.back { color: var(--c-text-2); flex: none; }
.gap-8 { gap: 8px; }
.mt-10 { margin-top: 10px; }
.mt-4 { margin-top: 4px; }

.me-card { display: flex; align-items: center; gap: 12px; padding: 14px; }
.avatar {
  width: 46px; height: 46px; border-radius: 14px;
  display: grid; place-items: center;
  background: linear-gradient(135deg, #2563eb, #4f46e5);
  color: #fff; font-weight: 600; font-size: 15px; flex: none;
}
.avatar--sm { width: 38px; height: 38px; border-radius: 12px; font-size: 13px; }
.avatar--off { background: #cbd5e1; }
.me-name { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.me-name .tag { font-weight: 500; }

.mini-stats {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px;
}
.ms {
  background: #fff; border: 1px solid var(--c-border); border-radius: 12px;
  padding: 10px 8px; text-align: center;
}
.ms b { display: block; font-size: 19px; letter-spacing: -.02em; }
.ms span { font-size: 11px; color: var(--c-text-3); }

.btn {
  border: 1px solid var(--c-border); background: #fff; color: var(--c-text);
  border-radius: 10px; padding: 10px 12px; font-size: 14px; font-weight: 500;
  font-family: inherit; cursor: pointer;
}
.btn:active { transform: scale(.99); }
.btn--ghost { background: #fff; }
.btn--primary {
  width: 100%; border: 0; color: #fff; font-weight: 600;
  background: linear-gradient(135deg, #2563eb, #4f46e5);
  box-shadow: 0 6px 16px rgba(37, 99, 235, .22);
  margin-top: 6px;
}

.link-btn {
  border: 0; background: var(--c-primary-light); color: var(--c-primary);
  font-size: 12px; font-weight: 600; padding: 4px 9px; border-radius: 8px;
  font-family: inherit; cursor: pointer;
}

.user-card { padding: 13px; margin-bottom: 9px; }
.u-name { font-weight: 600; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.u-stats {
  display: flex; gap: 14px; flex-wrap: wrap;
  margin: 10px 0 9px; padding: 8px 10px;
  background: #f8f9fb; border-radius: 9px;
  font-size: 12px; color: var(--c-text-2);
}
.u-stats b { color: var(--c-text); }
.u-ops { display: flex; gap: 6px; flex-wrap: wrap; }
.op {
  border: 1px solid var(--c-border); background: #fff; color: var(--c-text-2);
  border-radius: 8px; padding: 5px 9px; font-size: 12px; font-family: inherit; cursor: pointer;
}
.op--danger { color: var(--c-danger); border-color: #fecaca; background: #fff7f7; }

.tip {
  font-size: 11.5px; color: var(--c-text-3); line-height: 1.6;
  background: #f8f9fb; border-radius: 9px; padding: 9px 11px; margin-bottom: 9px;
}
.tip b { color: var(--c-text-2); }

.share-card { padding: 11px 13px; margin-bottom: 8px; }
.sess { padding: 11px 13px; margin-bottom: 8px; }
.s-user { font-weight: 600; font-size: 13.5px; }
.sess-meta { font-size: 11px; color: var(--c-text-3); margin-top: 3px; word-break: break-all; }

.empty { padding: 22px; text-align: center; color: var(--c-text-3); font-size: 13px; }

.field { display: block; margin-bottom: 12px; }
.field > span { display: block; font-size: 12.5px; color: var(--c-text-2); margin-bottom: 5px; }
.input {
  width: 100%; border: 1px solid var(--c-border); background: #fff;
  border-radius: 10px; padding: 10px 12px; font-size: 15px; font-family: inherit;
  color: var(--c-text); outline: none;
}
.input:focus { border-color: #93b4f7; }

.sheet { padding: 18px 16px calc(20px + var(--safe-bottom)); }
.sheet-title { font-size: 17px; font-weight: 700; margin-bottom: 14px; }

.seg {
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px;
  background: #f1f3f6; padding: 3px; border-radius: 10px;
}
.seg button {
  border: 0; background: transparent; padding: 8px 0; border-radius: 8px;
  font-size: 13px; color: var(--c-text-2); font-family: inherit; cursor: pointer;
}
.seg button.on { background: #fff; color: var(--c-text); font-weight: 600; box-shadow: var(--shadow-sm); }
</style>
