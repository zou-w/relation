import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  {
    path: '/',
    name: 'today',
    component: () => import('@/views/TodayView.vue'),
    meta: { title: '今日', nav: true },
  },
  {
    path: '/search',
    name: 'search',
    component: () => import('@/views/SearchView.vue'),
    meta: { title: '查人', nav: true },
  },
  {
    path: '/resources',
    name: 'resources',
    component: () => import('@/views/ResourcesView.vue'),
    meta: { title: '借资源', nav: true },
  },
  {
    path: '/projects',
    name: 'projects',
    component: () => import('@/views/ProjectsView.vue'),
    meta: { title: '项目', nav: true },
  },
  {
    path: '/project/:id',
    name: 'project',
    component: () => import('@/views/ProjectView.vue'),
    meta: { title: '项目详情' },
  },
  {
    path: '/graph',
    name: 'graph',
    component: () => import('@/views/GraphView.vue'),
    meta: { title: '关系图', nav: true, fullscreen: true },
  },
  {
    path: '/manage',
    name: 'manage',
    component: () => import('@/views/ManageView.vue'),
    meta: { title: '管理', nav: true },
  },
  {
    path: '/import',
    name: 'import',
    component: () => import('@/views/ImportView.vue'),
    meta: { title: '导入名单' },
  },
  {
    path: '/record',
    name: 'record',
    component: () => import('@/views/RecordView.vue'),
    meta: { title: '快速记录' },
  },
  {
    path: '/person/:id',
    name: 'person',
    component: () => import('@/views/PersonView.vue'),
    meta: { title: '联系人' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, saved) {
    return saved || { top: 0 };
  },
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · 人脉关系网` : '人脉关系网';
});

export default router;
