/**
 * API 封装：统一错误处理、超时、JSON 解析
 */

const BASE = import.meta.env.VITE_API_BASE || '/api';

async function request(path, { method = 'GET', body, timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(BASE + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!res.ok) {
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
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
      signal: controller.signal,
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!res.ok) {
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

  // ---------- 批量管理 ----------
  batchDeletePersons: (ids) => request('/persons/batch-delete', { method: 'POST', body: { ids } }),

  // ---------- Excel 导入 ----------
  importFields: () => request('/import/fields'),
  templateUrl: () => BASE + '/import/template',
  importPreview: (file) => upload('/import/preview', file),
  importExecute: (file, { mode = 'skip', skipInvalid = false } = {}) =>
    upload('/import/execute' + qs({ mode, skip_invalid: skipInvalid ? 1 : undefined }), file),
};

export default api;
