/**
 * API 封装：统一错误处理、超时、JSON 解析
 */

const BASE = import.meta.env.VITE_API_BASE || '/api';
const TOKEN_KEY = 'relation_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** 统一带上登录凭证 */
function headers(extra = {}) {
  const t = getToken();
  return t ? { ...extra, Authorization: `Bearer ${t}` } : { ...extra };
}

/** 401 一律视为登录失效：清 token 并通知外层跳登录 */
function onUnauthorized() {
  setToken('');
  window.dispatchEvent(new CustomEvent('auth:expired'));
}

async function request(path, { method = 'GET', body, timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(BASE + path, {
      method,
      headers: headers(body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!res.ok) {
      if (res.status === 401) onUnauthorized();
      const err = new Error(data?.error || `请求失败（${res.status}）`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时，请检查网络');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const qs = (obj = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') p.append(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** 上传二进制文件（xlsx），超时给得宽一些 */
async function upload(path, file, { timeout = 60000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/octet-stream' }),
      body: file,
      signal: controller.signal,
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!res.ok) {
      if (res.status === 401) onUnauthorized();
      const err = new Error(data?.error || `上传失败（${res.status}）`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('文件处理超时，请检查文件大小或网络');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  // ---------- 基础 ----------
  health: () => request('/health'),
  enums: () => request('/enums'),
  stats: () => request('/graph/stats'),

  // ---------- 账号 ----------
  login: (data) => request('/auth/login', { method: 'POST', body: data }),
  register: (data) => request('/auth/register', { method: 'POST', body: data }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
  changePassword: (data) => request('/auth/password', { method: 'PATCH', body: data }),
  updateProfile: (data) => request('/auth/profile', { method: 'PATCH', body: data }),

  // ---------- 超管 ----------
  adminUsers: (params) => request('/admin/users' + qs(params)),
  adminCreateUser: (data) => request('/admin/users', { method: 'POST', body: data }),
  adminUpdateUser: (id, data) => request(`/admin/users/${id}`, { method: 'PATCH', body: data }),
  adminResetPassword: (id, password) =>
    request(`/admin/users/${id}/password`, { method: 'POST', body: { password } }),
  adminDeleteUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
  adminSessions: () => request('/admin/sessions'),
  adminShares: () => request('/admin/shares'),
  adminCreateShare: (data) => request('/admin/shares', { method: 'POST', body: data }),
  adminDeleteShare: (id) => request(`/admin/shares/${id}`, { method: 'DELETE' }),
  adminUserPersons: (id) => request(`/admin/users/${id}/persons`),

  // ---------- 联系人 ----------
  persons: (params) => request('/persons' + qs(params)),
  person: (id) => request(`/persons/${id}`),
  createPerson: (data) => request('/persons', { method: 'POST', body: data }),
  updatePerson: (id, data) => request(`/persons/${id}`, { method: 'PATCH', body: data }),
  deletePerson: (id) => request(`/persons/${id}`, { method: 'DELETE' }),
  neighbors: (id) => request(`/persons/${id}/neighbors`),
  addAttribute: (id, data) => request(`/persons/${id}/attributes`, { method: 'POST', body: data }),
  removeAttribute: (id, attrId) => request(`/persons/${id}/attributes/${attrId}`, { method: 'DELETE' }),

  // ---------- 资源 ----------
  searchResources: (params) => request('/resources/search' + qs(params)),
  spheres: () => request('/resources/spheres'),
  paths: (personId) => request(`/resources/paths/${personId}`),
  orgReach: (orgId) => request(`/resources/org/${orgId}/reach`),
  influencers: (personId) => request(`/resources/influencers/${personId}`),
  resourceOverview: () => request('/resources/overview'),

  // ---------- 接触事件 ----------
  events: (params) => request('/events' + qs(params)),
  createEvent: (data) => request('/events', { method: 'POST', body: data }),
  updateEvent: (id, data) => request(`/events/${id}`, { method: 'PATCH', body: data }),
  deleteEvent: (id) => request(`/events/${id}`, { method: 'DELETE' }),
  pending: (days) => request('/events/pending' + qs({ days })),
  coldContacts: (days) => request('/events/cold' + qs({ days })),

  // ---------- 关系 ----------
  relations: (params) => request('/relations' + qs(params)),
  createRelation: (data) => request('/relations', { method: 'POST', body: data }),
  updateRelation: (id, data) => request(`/relations/${id}`, { method: 'PATCH', body: data }),
  deleteRelation: (id) => request(`/relations/${id}`, { method: 'DELETE' }),

  // ---------- 组织 ----------
  orgs: (params) => request('/orgs' + qs(params)),
  org: (id) => request(`/orgs/${id}`),
  createOrg: (data) => request('/orgs', { method: 'POST', body: data }),

  // ---------- 图谱 ----------
  graph: (params) => request('/graph' + qs(params)),

  // ---------- 项目 ----------
  projects: (params) => request('/projects' + qs(params)),
  project: (id) => request(`/projects/${id}`),
  createProject: (data) => request('/projects', { method: 'POST', body: data }),
  updateProject: (id, data) => request(`/projects/${id}`, { method: 'PATCH', body: data }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),
  projectStats: () => request('/projects/stats'),
  projectGraph: (id) => request(`/projects/${id}/graph`),
  projectCandidates: (id, keyword) =>
    request(`/projects/${id}/candidates` + qs({ keyword })),
  addProjectMember: (id, data) =>
    request(`/projects/${id}/members`, { method: 'POST', body: data }),
  updateProjectMember: (id, mid, data) =>
    request(`/projects/${id}/members/${mid}`, { method: 'PATCH', body: data }),
  removeProjectMember: (id, mid) =>
    request(`/projects/${id}/members/${mid}`, { method: 'DELETE' }),

  // ---------- 批量管理 ----------
  batchDeletePersons: (ids) => request('/persons/batch-delete', { method: 'POST', body: { ids } }),

  // ---------- Excel 导入 ----------
  importFields: () => request('/import/fields'),
  /** 模板要带 token 才能下载，先取 blob 再交给浏览器 */
  async downloadTemplate() {
    const res = await fetch(BASE + '/import/template', { headers: headers() });
    if (!res.ok) {
      if (res.status === 401) onUnauthorized();
      throw new Error('模板下载失败');
    }
    return res.blob();
  },
  importPreview: (file) => upload('/import/preview', file),
  importExecute: (file, { mode = 'skip', skipInvalid = false } = {}) =>
    upload('/import/execute' + qs({ mode, skip_invalid: skipInvalid ? 1 : undefined }), file),
};

export default api;
