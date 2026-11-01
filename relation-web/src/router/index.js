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
    path: '/graph',
    name: 'graph',
    component: () => import('@/views/GraphView.vue'),
    meta: { title: '关系图', nav: true, fullscreen: true },
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
