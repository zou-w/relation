<script setup>
/**
 * 关系图谱
 * 流畅性设计要点：
 * 1. 布局只在初始化时计算一次，之后锁定 —— 政企人脉关系稳定，无需每帧跑力导
 * 2. pan/zoom 只改变视口矩阵，不触发节点坐标重排（Cytoscape 原生支持）
 * 3. 分级渲染：缩放较小时隐藏文字标签与任职边，减少绘制量
 * 4. 点击节点按需加载一跳邻居，避免一次渲染全图
 * 5. 移动端加大触摸命中区
 */
import { ref, onMounted, onBeforeUnmount, shallowRef, computed, nextTick, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import api from '@/api';

cytoscape.use(fcose);

const route = useRoute();
const router = useRouter();

/** ?project=id 时只看单个项目的关系网 */
const projectId = Number(route.query.project) || null;
const projectName = ref('');
/** ?cross_org=1 时只显示跨单位认识 */
const crossParam = () => route.query.cross_org === '1';

const container = ref(null);
const cy = shallowRef(null);
const loading = ref(true);
const keyOnly = ref(false);
/** 只看跨单位关系：把不同单位之间的"私人关系"拎出来单独看 */
const crossOnly = ref(crossParam());
/** 是否把跨单位关系标成高亮的强调线 */
const emphasizeCross = ref(true);
const stats = ref({ nodes: 0, edges: 0 });
const crossCount = ref(0);
const crossPairs = ref([]);
const selected = ref(null);
const showDetail = ref(false);
const detail = ref(null);
const showCrossList = ref(false);

const theme = {
  person: { bg: '#ffffff', border: '#c7d2e5', text: '#1a1d23' },
  key: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
  self: { bg: '#059669', border: '#047857', text: '#ffffff' },
  org: { bg: '#eef4ff', border: '#bfdbfe', text: '#1e40af' },
  project: { bg: '#fff7ed', border: '#fb923c', text: '#9a3412' },
  edgeRel: '#94a3b8',
  edgeEmp: '#cbd5e1',
  // 跨单位关系：紫红强调色，和普通关系线一眼区分
  edgeCross: '#9333ea',
};

/** 构建 Cytoscape 元素 */
function buildElements(data) {
  const nodes = data.nodes.map((n) => {
    const isSelf = n.isSelf;
    const isKey = n.isKey;
    const isOrg = n.kind === 'org';
    const isProject = n.kind === 'project';
    const isPerson = !isOrg && !isProject;
    const label = isProject && n.label.length > 15
      ? `${n.label.slice(0, 14)}…`
      : n.label;
    return {
      data: {
        id: n.id,
        label,
        kind: n.kind,
        isSelf: isSelf ? 1 : 0,
        isKey: isKey ? 1 : 0,
        orgName: n.orgName || '',
        raw: n,
      },
      classes: [
        isProject ? 'project' : isOrg ? 'org' : 'person',
        isSelf ? 'self' : '',
        isKey && !isProject && !isOrg ? 'key' : '',
        isPerson ? 'pnode' : '',
      ].filter(Boolean).join(' '),
    };
  });

  const edges = data.edges.map((e) => ({
    data: {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label || '',
      kind: e.kind,
      strength: e.strength,
      crossOrg: e.crossOrg ? 1 : 0,
      spansOrg: e.spansOrg ? 1 : 0,
    },
    classes: [
      e.kind === 'employment' ? 'edge-emp' : e.kind === 'project' ? 'edge-proj' : 'edge-rel',
      e.crossOrg ? 'edge-cross' : '',
    ].filter(Boolean).join(' '),
  }));

  return [...nodes, ...edges];
}

/**
 * 视口自适应：把全图收拢到可视区中部
 * 用节点模型坐标自己算包围盒，避免 renderedBoundingBox 与标签高度不一致的偏差
 */
function fitView(instance, { padTop = 96, padBottom = 92, maxScale = 2.0 } = {}) {
  const nodes = instance.nodes();
  if (!nodes.length) return;

  const w = instance.width();
  const h = instance.height();
  if (!w || !h) return;

  // 用模型坐标（不受视口缩放影响）算包围盒，并给节点半径与标签留余量
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  nodes.forEach((n) => {
    const p = n.position();
    const hw = (n.width() || 40) / 2 + 6;
    // 项目节点标签在内部，只留一点点余量
    const hh = (n.height() || 40) / 2 + (n.hasClass('project') ? 10 : 26);
    x0 = Math.min(x0, p.x - hw);
    x1 = Math.max(x1, p.x + hw);
    y0 = Math.min(y0, p.y - (n.height() || 40) / 2 - 6);
    y1 = Math.max(y1, p.y + hh);
  });

  const bbW = Math.max(x1 - x0, 1);
  const bbH = Math.max(y1 - y0, 1);

  const isMobile = w < 768;
  // 移动端底部有 tabbar + 横排图例，需要额外留白，否则节点会被压住
  const padB = isMobile ? Math.max(padBottom, 128) : Math.max(padBottom, 96);
  // 移动端两侧也要留够，避免单位节点贴边被裁掉
  const padX = isMobile ? 28 : 60;
  const availW = Math.max(w - padX * 2, 120);
  const availH = Math.max(h - padTop - padB, 120);

  const level = Math.max(Math.min(availW / bbW, availH / bbH, maxScale), 0.25);
  instance.zoom({ level });

  // 模型坐标中心 → 屏幕可视区中心（zoom 默认以 (0,0) 为基准，pan 后即为目标位置）
  // 水平方向：居中即可；竖直方向：落在顶部工具条与底部图例之间
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  instance.pan({
    x: w / 2 - cx * level,
    y: padTop + availH / 2 - cy * level,
  });
}

/** 用固定种子替换 Math.random，喂给力导向布局，保证布局结果可复现 */
function seedRandom(seedStr) {
  let seed = 2166136261;
  for (let i = 0; i < seedStr.length; i += 1) {
    seed ^= seedStr.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  seed >>>= 0;
  Math.random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** 稳定布局种子：首次进图和点「重排」都得到同一张图 */
const LAYOUT_SEED = 20261101;

/** 布局并锁定 */
function applyLayout(instance) {
  // 固定随机序列：同一批数据每次重排都得到同一张图，用户不会以为数据变了
  seedRandom(`rel-${LAYOUT_SEED}`);
  // fcose：带了非重叠约束的力导向，人物气泡不会互相压字
  // 仍只算一次（animate: false），算完 autolock，拖拽只改视口
  const fewNodes = instance.nodes().length <= 30;
  const opts = {
    name: 'fcose',
    quality: fewNodes ? 'proof' : 'default',
    animate: false,
    fit: false,
    randomize: true,
    padding: 30,
    nodeSeparation: 110,
    idealEdgeLength: (edge) => {
      const k = edge.data('kind');
      const cross = edge.data('crossOrg') === 1;
      if (k === 'employment') return 45;
      if (k === 'project') return projectId ? 160 : 140;
      // 跨单位的线拉长一点，自然形成"两个圈子被一条线连起来"的形态
      return cross ? 175 : 110;
    },
    edgeElasticity: (edge) => (edge.data('crossOrg') === 1 ? 0.16 : 0.45),
    nodeRepulsion: () => (projectId ? 14000 : 11000),
    gravity: 0.28,
    gravityRange: 3.2,
    numIter: 2200,
    samplingType: true,
    packComponents: true,
  };

  try {
    instance.layout(opts).run();
  } catch {
    // 兜底：极少数环境 fcose 算不出来时退回环形布局，保证有图可看
    instance.layout({ name: 'concentric', animate: false, fit: false, padding: 30 }).run();
  }

  fitView(instance);

  // 锁死坐标：此后拖拽仅改视口，不再触发重算
  instance.autolock(true);
}

function initCy(data) {
  if (cy.value) {
    cy.value.destroy();
    cy.value = null;
  }

  const instance = cytoscape({
    container: container.value,
    elements: buildElements(data),
    minZoom: 0.25,
    maxZoom: 2.6,
    textureOnViewport: false,
    motionBlur: false,
    motionBlurOpacity: 0,
    pixelRatio: 'auto',
    hideEdgesOnViewport: true,   // 拖拽时暂时隐藏边，大幅提速
    hideLabelsOnViewport: true,  // 拖拽时隐藏标签
    style: [
      {
        selector: 'node',
        style: {
          'background-color': theme.person.bg,
          'border-width': 2,
          'border-color': theme.person.border,
          width: 44,
          height: 44,
          label: 'data(label)',
          'font-size': 13,
          'font-weight': 500,
          color: theme.person.text,
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 5,
          'text-outline-width': 3,
          'text-outline-color': '#f5f6f8',
          'min-zoomed-font-size': 9,
        },
      },
      {
        selector: 'node.key',
        style: {
          'background-color': theme.key.bg,
          'border-color': theme.key.border,
          'border-width': 2.5,
          width: 54,
          height: 54,
          color: theme.key.text,
          'font-weight': 600,
        },
      },
      {
        selector: 'node.self',
        style: {
          'background-color': theme.self.bg,
          'border-color': theme.self.border,
          'border-width': 3,
          width: 62,
          height: 62,
          color: '#065f46',
          'font-weight': 700,
          'font-size': 15,
        },
      },
      {
        selector: 'node.org',
        style: {
          'background-color': '#dbeafe',
          'background-opacity': 1,
          'border-color': '#93c5fd',
          'border-style': 'dashed',
          'border-width': 1.5,
          width: 38,
          height: 38,
          shape: 'round-rectangle',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 5,
          'text-wrap': 'wrap',
          'text-max-width': 120,
          'text-outline-width': 3,
          'text-outline-color': '#f5f6f8',
          color: '#1e40af',
          'font-size': 11,
          'font-weight': 600,
        },
      },
      {
        selector: 'node.project',
        style: {
          'background-color': theme.project.bg,
          'background-opacity': 1,
          'border-color': theme.project.border,
          'border-width': 2,
          width: 104,
          height: 42,
          shape: 'round-rectangle',
          'text-valign': 'center',
          'text-halign': 'center',
          'text-margin-y': 0,
          'text-wrap': 'wrap',
          'text-max-width': 86,
          'text-outline-width': 0,
          color: theme.project.text,
          'font-size': 9,
          'font-weight': 700,
          'min-zoomed-font-size': 7,
        },
      },
      {
        selector: 'edge',
        style: {
          width: 1.4,
          'line-color': theme.edgeRel,
          'target-arrow-color': theme.edgeRel,
          'curve-style': 'straight',
          opacity: 0.75,
        },
      },
      {
        selector: 'edge.edge-emp',
        style: {
          width: 1,
          'line-color': theme.edgeEmp,
          'line-style': 'dashed',
          opacity: 0.6,
          'curve-style': 'bezier',
        },
      },
      {
        selector: 'edge.edge-proj',
        style: {
          width: 1.2,
          'line-color': '#fdba74',
          'line-style': 'dashed',
          opacity: 0.85,
          'curve-style': 'bezier',
          label: 'data(label)',
          'font-size': 8,
          color: '#c2410c',
          'text-background-color': '#fff7ed',
          'text-background-opacity': 0.95,
          'text-background-padding': 1.5,
          'min-zoomed-font-size': 8,
        },
      },
      {
        selector: 'edge.edge-rel',
        style: {
          label: 'data(label)',
          'font-size': 8.5,
          color: '#7c8798',
          'text-background-color': '#f5f6f8',
          'text-background-opacity': 0.92,
          'text-background-padding': 1.5,
          'min-zoomed-font-size': 8,
          'text-rotation': 'autorotate',
        },
      },
      // 跨单位认识：两个不同单位的人之间的私交，用紫红粗线 + 两端紫色圈强调
      {
        selector: 'edge.edge-cross',
        style: {
          width: 3,
          'line-color': theme.edgeCross,
          'target-arrow-color': theme.edgeCross,
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.9,
          'curve-style': 'bezier',
          'line-style': 'solid',
          opacity: 1,
          label: 'data(label)',
          'font-size': 10,
          'font-weight': 700,
          color: '#7e22ce',
          'text-background-color': '#faf5ff',
          'text-background-opacity': 1,
          'text-background-padding': 2,
          'text-background-shape': 'roundrectangle',
          'min-zoomed-font-size': 7,
          'text-rotation': 'autorotate',
          'z-index': 20,
        },
      },
      // 跨单位关系两端的节点加紫色外圈，远看就知道"这里连着两家单位"
      {
        selector: 'node.pnode.cross-end',
        style: {
          'border-color': theme.edgeCross,
          'border-width': 2.5,
          'border-style': 'solid',
        },
      },
      // 关掉"强调"时，跨单位线回到普通外观，只保留连接本身
      {
        selector: 'edge.edge-cross.muted',
        style: {
          width: 1.4,
          'line-color': theme.edgeRel,
          'target-arrow-color': theme.edgeRel,
          'target-arrow-shape': 'none',
          opacity: 0.75,
          color: '#7c8798',
          'font-weight': 400,
          'text-background-color': '#f5f6f8',
        },
      },
      {
        selector: 'node.pnode.cross-end.muted',
        style: { 'border-color': '#c7d2e5', 'border-width': 2 },
      },
      {
        selector: 'node:selected',
        style: {
          'border-color': '#2563eb',
          'border-width': 3.5,
          'overlay-color': '#2563eb',
          'overlay-opacity': 0.12,
          'overlay-padding': 8,
        },
      },
      // 邻居高亮
      {
        selector: '.dimmed',
        style: { opacity: 0.18 },
      },
      {
        selector: '.highlighted',
        style: { opacity: 1 },
      },
    ],
    // 移动端性能与交互
    boxSelectionEnabled: false,
    autoungrabify: false,
    userPanningEnabled: true,
    userZoomingEnabled: true,
  });

  // 布局算一次后锁定
  applyLayout(instance);

  // 跨单位关系的两端节点打标，配合强调开关
  markCrossEnds(instance);
  applyCrossEmphasis(instance);

  // 点击节点
  instance.on('tap', 'node', (evt) => {
    const node = evt.target;
    selected.value = node.data('raw');
    highlightNeighbors(instance, node);
    openDetail(node);
  });

  // 点击边：关系边显示这条关系说明（重点看跨单位的）
  instance.on('tap', 'edge', (evt) => {
    const edge = evt.target;
    if (edge.data('kind') !== 'relation') return;
    const a = edge.source().data('label') || '';
    const b = edge.target().data('label') || '';
    const t = edge.data('crossOrg') === 1 ? '跨单位认识' : '关系';
    showToast(`${a} — ${b}：${t} · ${edge.data('label')}${edge.data('spansOrg') ? '（跨单位）' : ''}`);
  });

  // 点击空白取消
  instance.on('tap', (evt) => {
    if (evt.target === instance) {
      instance.elements().removeClass('dimmed highlighted');
      selected.value = null;
      showDetail.value = false;
    }
  });

  // 缩放分级：太小时隐藏任职边和文字
  let zoomTimer = null;
  instance.on('zoom', () => {
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      const z = instance.zoom();
      const small = z < 0.55;
      instance.edges('.edge-emp').style('display', small ? 'none' : 'element');
      instance.nodes('.org').style('label', small ? '' : 'data(label)');
    }, 90);
  });

  cy.value = instance;
  stats.value = { nodes: data.nodes.length, edges: data.edges.length };
  crossCount.value = data.cross?.count || 0;
  crossPairs.value = data.cross?.pairs || [];
  if (data.crossOnly) crossOnly.value = true;
}

/** 把跨单位关系的两端节点标出来 */
function markCrossEnds(instance) {
  instance.nodes('.pnode').removeClass('cross-end');
  instance.edges('.edge-cross').forEach((e) => {
    e.source().addClass('cross-end');
    e.target().addClass('cross-end');
  });
}

/** 强调 / 取消强调跨单位关系（只切 class，不重算布局） */
function applyCrossEmphasis(instance) {
  if (emphasizeCross.value) {
    instance.edges('.edge-cross').removeClass('muted');
    instance.nodes('.cross-end').removeClass('muted');
  } else {
    instance.edges('.edge-cross').addClass('muted');
    instance.nodes('.cross-end').addClass('muted');
  }
}

/** 高亮邻居 */
function highlightNeighbors(instance, node) {
  instance.elements().removeClass('dimmed highlighted');
  const neighborhood = node.closedNeighborhood();
  instance.elements().not(neighborhood).addClass('dimmed');
  neighborhood.addClass('highlighted');
  // 跨单位线不受淡化影响：顺着这条线就能看到"还能连到哪家单位"
  instance.edges('.edge-cross').removeClass('dimmed').addClass('highlighted');
}

async function openDetail(node) {
  const raw = node.data('raw');
  if (raw.kind === 'org') {
    showDetail.value = false;
    return;
  }
  // 项目节点：直接进项目详情，不在图谱里开抽屉
  if (raw.kind === 'project') {
    showDetail.value = false;
    router.push(`/project/${String(raw.id).replace('j', '')}`);
    return;
  }
  showDetail.value = true;
  detail.value = { base: raw, neighbors: [], loaded: false };

  try {
    const pid = Number(String(raw.id).replace('p', ''));
    const r = await api.neighbors(pid);
    detail.value = {
      base: raw,
      personId: pid,
      neighbors: r.neighbors || [],
      orgs: r.orgs || [],
      // 这个人的跨单位认识：在抽屉里直接点，跳到对方
      cross: crossPairs.value.filter(
        (p) => p.from === `p${pid}` || p.to === `p${pid}`
      ),
      loaded: true,
    };
  } catch {
    detail.value = { ...detail.value, loaded: true };
  }
}

async function load() {
  loading.value = true;
  try {
    let data;
    if (projectId) {
      const g = await api.projectGraph(projectId);
      projectName.value = g.project?.name || '';
      data = { nodes: g.nodes, edges: g.edges, cross: g.cross };
    } else {
      data = await api.graph({
        key_only: keyOnly.value ? 1 : undefined,
        cross_org: crossOnly.value ? 1 : undefined,
        limit: 300,
      });
    }
    await nextTick();
    // 容器需要已渲染
    requestAnimationFrame(() => initCy(data));
  } catch (e) {
    showToast(e.message);
  } finally {
    loading.value = false;
  }
}

/** 切到跨单位视角：布局会重算（节点集变了），所以走重新加载 */
function toggleCrossOnly() {
  crossOnly.value = !crossOnly.value;
  if (crossOnly.value) keyOnly.value = false;
  // 同步到地址栏，方便回退 / 分享当前视角（用 history 直接写，避免路由重挂载导致重复初始化）
  const url = crossOnly.value ? '/graph?cross_org=1' : '/graph';
  window.history.replaceState(window.history.state, '', url);
  load();
}

/** 强调开关：纯样式切换，不重排，瞬间完成 */
function toggleEmphasis() {
  emphasizeCross.value = !emphasizeCross.value;
  if (cy.value) applyCrossEmphasis(cy.value);
}

/** 点开跨单位关系清单里的某条，把两端节点选中并居中 */
function focusPair(p) {
  const instance = cy.value;
  if (!instance) return;
  const a = instance.getElementById(p.from);
  const b = instance.getElementById(p.to);
  if (a.empty() || b.empty()) {
    showToast('这两个人不在当前视图里');
    return;
  }
  showCrossList.value = false;
  instance.elements().unselect();
  a.select();
  highlightNeighbors(instance, a);
  const box = a.union(b).renderedBoundingBox({ includeLabels: true });
  const z = Math.min(Math.max(instance.zoom(), 0.9), 1.4);
  instance.zoom({ level: z });
  instance.pan({
    x: instance.width() / 2 - ((box.x1 + box.x2) / 2),
    y: instance.height() / 2 - ((box.y1 + box.y2) / 2),
  });
}

/** 重新布局 */
function relayout() {
  if (!cy.value) return;
  const instance = cy.value;
  instance.autolock(false);
  applyLayout(instance);
  instance.fit(undefined, 40);
}

function zoom(dir) {
  if (!cy.value) return;
  const instance = cy.value;
  const level = instance.zoom();
  const next = dir > 0 ? level * 1.3 : level / 1.3;
  instance.zoom({
    level: Math.min(Math.max(next, instance.minZoom()), instance.maxZoom()),
    renderedPosition: {
      x: container.value.clientWidth / 2,
      y: container.value.clientHeight / 2,
    },
  });
}

function fit() {
  if (cy.value) fitView(cy.value);
}

function toggleKey() {
  keyOnly.value = !keyOnly.value;
  if (keyOnly.value && crossOnly.value) {
    crossOnly.value = false;
    window.history.replaceState(window.history.state, '', '/graph');
  }
  load();
}

function goPerson() {
  if (detail.value?.personId) {
    showDetail.value = false;
    router.push(`/person/${detail.value.personId}`);
  }
}

/** 抽屉里点跨单位认识的人：选中并居中该节点，不用跳页也能顺着关系走 */
function jumpPerson(nodeId) {
  const instance = cy.value;
  if (!instance) return;
  const node = instance.getElementById(nodeId);
  if (node.empty()) return;
  selected.value = node.data('raw');
  highlightNeighbors(instance, node);
  openDetail(node);
  // 选中节点居中：选中的对象正好在视口中心，抽屉不会挡住
  instance.animate({ center: { eles: node }, zoom: Math.max(instance.zoom(), 0.85) }, { duration: 260 });
}

/** 去补录一条跨单位认识 */
function goRecordRelation() {
  showCrossList.value = false;
  router.push('/record-relation');
}

/** 窗口尺寸变化时重新 fit */
function onResize() {
  cy.value?.resize();
}

onMounted(() => {
  load();
  window.addEventListener('resize', onResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  if (cy.value) {
    cy.value.destroy();
    cy.value = null;
  }
});
</script>

<template>
  <div class="graph-page">
    <!-- 画布 -->
    <div ref="container" class="cy-container"></div>

    <!-- 顶部工具条 -->
    <div class="topbar">
      <div class="topbar-inner">
        <div class="tb-left">
          <van-icon v-if="projectId" name="arrow-left" class="tb-back" @click="router.back()" />
          <div class="tb-titles">
            <h1>{{ projectId ? '项目关系图' : '关系图' }}</h1>
            <div v-if="projectId && projectName" class="tb-proj ellipsis">{{ projectName }}</div>
          </div>
        </div>
        <div class="row gap-6">
          <button v-if="!projectId" class="pill" :class="{ 'pill--on': keyOnly }" @click="toggleKey">
            <van-icon name="star-o" />
            只看重点
          </button>
          <button v-if="!projectId" class="pill" :class="{ 'pill--cross': crossOnly }" @click="toggleCrossOnly">
            <van-icon name="exchange" />
            跨单位
          </button>
          <button class="pill" @click="relayout">
            <van-icon name="replay" />
            重排
          </button>
        </div>
      </div>
      <div class="meta" v-if="!loading">
        {{ stats.nodes }} 节点 · {{ stats.edges }} 条连接
        <button
          v-if="crossCount"
          class="meta-cross"
          :class="{ 'meta-cross--off': !emphasizeCross }"
          @click="showCrossList = true"
        >
          <i class="mc-dot"></i>
          跨单位认识 {{ crossCount }} 条
        </button>
        <button v-if="crossCount" class="meta-toggle" @click="toggleEmphasis">
          {{ emphasizeCross ? '取消强调' : '强调显示' }}
        </button>
      </div>
    </div>

    <!-- 加载 -->
    <div v-if="loading" class="cy-loading">
      <van-loading size="24px" color="#2563eb">加载关系网…</van-loading>
    </div>

    <!-- 空态 -->
    <div v-else-if="!stats.nodes" class="cy-empty">
      <van-icon name="cluster-o" class="ce-icon" />
      <div class="ce-title">
        {{ projectId ? '这个项目还没有标记参与人' : crossOnly ? '还没有跨单位认识的关系' : '还没有关系网' }}
      </div>
      <div class="ce-hint">
        {{
          projectId
            ? '回项目详情点「加人」，把参与人标进来'
            : crossOnly
              ? '在联系人详情里给不同单位的两个人加上「同学 / 亲属 / 朋友 / 熟人」关系'
              : '先录入几位联系人，关系图会自动生成'
        }}
      </div>
    </div>

    <!-- 右下角控制 -->
    <div class="ctrls">
      <button class="ctrl" @click="zoom(1)"><van-icon name="plus" /></button>
      <button class="ctrl" @click="zoom(-1)"><van-icon name="minus" /></button>
      <button class="ctrl" @click="fit"><van-icon name="aim" /></button>
    </div>

    <!-- 图例 -->
    <div class="legend">
      <span class="lg"><i class="dot dot--self"></i>我</span>
      <span class="lg"><i class="dot dot--key"></i>重点</span>
      <span class="lg"><i class="dot dot--person"></i>联系人</span>
      <span class="lg"><i class="dot dot--org"></i>单位</span>
      <span class="lg"><i class="dot dot--proj"></i>项目</span>
      <span class="lg"><i class="line line--cross"></i>跨单位认识</span>
    </div>

    <!-- 跨单位认识清单 -->
    <transition name="sheet">
      <div v-if="showCrossList" class="cross-sheet">
        <div class="cs-head">
          <div>
            <div class="cs-title">跨单位认识</div>
            <div class="cs-sub">不同单位的两个人之间的私交，往往是打通两家单位的钥匙</div>
          </div>
          <van-icon name="cross" size="18" class="ns-close" @click="showCrossList = false" />
        </div>
        <div class="cs-list">
          <div
            v-for="p in crossPairs"
            :key="p.id"
            class="cs-item"
            @click="focusPair(p)"
          >
            <div class="cs-line">
              <span class="cs-name">{{ p.fromName || '?' }}</span>
              <span class="cs-rel">{{ p.label }}</span>
              <span class="cs-name">{{ p.toName || '?' }}</span>
            </div>
            <div class="cs-orgs">
              <span class="ellipsis">{{ p.fromOrg || '未填单位' }}</span>
              <van-icon name="arrow" class="cs-arrow" />
              <span class="ellipsis">{{ p.toOrg || '未填单位' }}</span>
            </div>
          </div>
          <div v-if="!crossPairs.length" class="cs-empty">
            还没有跨单位认识。不同单位的两个人，往往私下就认识 —— 补记一条，图谱就通了。
          </div>
        </div>
        <button class="cs-add" @click="goRecordRelation">
          <van-icon name="add-o" />
          记一条跨单位认识
        </button>
      </div>
    </transition>

    <!-- 节点详情抽屉 -->
    <transition name="sheet">
      <div v-if="showDetail && detail" class="node-sheet">
        <div class="ns-head">
          <div
            class="ns-avatar"
            :class="{ 'ns-avatar--key': detail.base.isKey, 'ns-avatar--self': detail.base.isSelf }"
          >
            {{ detail.base.label?.slice(-2) }}
          </div>
          <div class="grow">
            <div class="ns-name">{{ detail.base.label }}</div>
            <div class="ns-org">{{ detail.base.orgName || '未填单位' }}</div>
          </div>
          <van-icon name="cross" size="18" class="ns-close" @click="showDetail = false" />
        </div>

        <div v-if="detail.loaded" class="ns-body">
          <div v-if="detail.cross?.length" class="ns-sec">
            <div class="ns-label">跨单位认识 · {{ detail.cross.length }}</div>
            <div class="ns-neighbors">
              <span
                v-for="p in detail.cross"
                :key="p.id"
                class="ns-cross"
                @click="jumpPerson(p.from === `p${detail.personId}` ? p.to : p.from)"
              >
                {{ p.from === `p${detail.personId}` ? p.toName : p.fromName }}
                <i class="ns-cross-rel">{{ p.label }}</i>
              </span>
            </div>
            <div class="ns-tip">不在同一单位，但两人认识 —— 往往能替你把线搭过去</div>
          </div>
          <div v-if="detail.orgs?.length" class="ns-sec">
            <div class="ns-label">任职单位</div>
            <div class="ns-chips">
              <span v-for="o in detail.orgs" :key="o.id" class="tag">{{ o.name }}</span>
            </div>
          </div>
          <div v-if="detail.neighbors?.length" class="ns-sec">
            <div class="ns-label">直接关系 · {{ detail.neighbors.length }}</div>
            <div class="ns-neighbors">
              <span
                v-for="n in detail.neighbors.slice(0, 8)"
                :key="n.id"
                class="ns-chips tag tag--gray"
              >{{ n.name }}</span>
            </div>
          </div>
          <van-button type="primary" block round size="small" style="margin-top: 12px" @click="goPerson">
            查看详情
          </van-button>
        </div>
        <div v-else class="ns-loading"><van-loading size="18px" /></div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.graph-page {
  position: fixed;
  inset: 0;
  background: var(--c-bg);
  overflow: hidden;
}

.cy-container {
  position: absolute;
  inset: 0;
  /* 关键：告知浏览器该层可被 GPU 合成，拖拽更顺 */
  will-change: transform;
  touch-action: none;
}

/* 顶部 */
.topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  padding: 14px 14px 10px;
  padding-top: calc(14px + env(safe-area-inset-top, 0px));
  background: linear-gradient(to bottom, rgba(245, 246, 248, .96), rgba(245, 246, 248, 0));
  pointer-events: none;
}

.topbar-inner {
  max-width: 780px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: auto;
}

.tb-left { display: flex; align-items: center; gap: 7px; min-width: 0; }
.tb-back { font-size: 19px; color: var(--c-text-2); cursor: pointer; flex-shrink: 0; }
.tb-titles { min-width: 0; }
.tb-proj {
  font-size: 11px;
  color: var(--c-text-3);
  max-width: 52vw;
  margin-top: 1px;
}

.topbar h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -.02em;
}

.meta {
  max-width: 780px;
  margin: 4px auto 0;
  font-size: 12px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid var(--c-border);
  background: rgba(255, 255, 255, .95);
  color: var(--c-text-2);
  border-radius: 999px;
  padding: 5px 11px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
}

.pill--on {
  background: var(--c-warning-light);
  border-color: var(--c-warning);
  color: var(--c-warning);
  font-weight: 600;
}

.pill--cross {
  background: #faf5ff;
  border-color: #a855f7;
  color: #7e22ce;
  font-weight: 600;
}

/* 统计行 + 跨单位提示 */
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  pointer-events: auto;
  position: relative;
}

.meta-cross {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  border-radius: 999px;
  padding: 2px 9px;
  background: #faf5ff;
  color: #7e22ce;
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}

.meta-cross--off {
  background: #f1f2f4;
  color: var(--c-text-2);
}

.meta-cross--off .mc-dot { background: #b6bcc7; }

.mc-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #9333ea;
}

.meta-toggle {
  border: 0;
  background: none;
  color: var(--c-text-3);
  font-family: inherit;
  font-size: 11.5px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
  padding: 0;
}

.cy-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  z-index: 5;
  padding: 0 40px;
  text-align: center;
  pointer-events: none;
}

.ce-icon { font-size: 46px; color: var(--c-border); margin-bottom: 4px; }
.ce-title { font-size: 14.5px; font-weight: 600; color: var(--c-text-2); }
.ce-hint { font-size: 12px; color: var(--c-text-3); line-height: 1.6; }

.cy-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
}

/* 控制按钮 */
.ctrls {
  position: absolute;
  right: 14px;
  bottom: calc(72px + var(--safe-bottom));
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ctrl {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid var(--c-border);
  background: rgba(255, 255, 255, .96);
  color: var(--c-text-2);
  font-size: 17px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: var(--shadow);
  transition: transform .12s;
}

.ctrl:active { transform: scale(.93); }

/* 图例 */
.legend {
  position: absolute;
  left: 14px;
  bottom: calc(72px + var(--safe-bottom));
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(255, 255, 255, .92);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  padding: 8px 10px;
  box-shadow: var(--shadow-sm);
}

.lg { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--c-text-2); }

.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.dot--self { background: #059669; }
.dot--key { background: #fef3c7; border: 1.5px solid #f59e0b; }
.dot--person { background: #fff; border: 1.5px solid #c7d2e5; }
.dot--org { background: #eef4ff; border: 1.5px dashed #bfdbfe; border-radius: 3px; }
.dot--proj { background: #fff7ed; border: 1.5px solid #fb923c; border-radius: 3px; }
.dot--cross { background: #9333ea; }

/* 跨单位认识清单 */
.cross-sheet {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: calc(70px + var(--safe-bottom));
  max-width: 560px;
  margin: 0 auto;
  z-index: 22;
  background: rgba(255, 255, 255, .985);
  backdrop-filter: blur(16px);
  border-radius: 16px;
  border: 1px solid var(--c-border);
  box-shadow: var(--shadow-lg);
  padding: 14px 14px 8px;
  max-height: 62vh;
  display: flex;
  flex-direction: column;
}

.cs-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.cs-title { font-size: 15px; font-weight: 700; color: #7e22ce; }
.cs-sub { font-size: 11.5px; color: var(--c-text-3); margin-top: 2px; line-height: 1.5; }

.cs-list { overflow-y: auto; margin-top: 8px; -webkit-overflow-scrolling: touch; }

.cs-item {
  padding: 10px 0;
  border-bottom: 1px solid var(--c-border);
  cursor: pointer;
}

.cs-item:last-child { border-bottom: 0; }
.cs-item:active { opacity: .6; }

.cs-line { display: flex; align-items: center; gap: 7px; font-size: 14px; }
.cs-name { font-weight: 600; }

.cs-rel {
  font-size: 11px;
  font-weight: 700;
  color: #7e22ce;
  background: #faf5ff;
  border-radius: 5px;
  padding: 1px 7px;
}

.cs-orgs {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--c-text-3);
  min-width: 0;
}

.cs-orgs .ellipsis { max-width: 45%; }
.cs-arrow { font-size: 10px; flex-shrink: 0; color: #a855f7; }
.cs-empty { text-align: center; color: var(--c-text-3); font-size: 13px; padding: 18px 8px; line-height: 1.6; }

.cs-add {
  margin-top: 8px;
  flex-shrink: 0;
  border: 1px dashed #d8b4fe;
  background: #faf5ff;
  color: #7e22ce;
  border-radius: 10px;
  padding: 9px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.line {
  display: inline-block;
  width: 14px;
  height: 0;
  border-top: 2.5px solid #9333ea;
  border-radius: 2px;
}

/* 移动端图例横排，避免压住左下角节点 */
@media (max-width: 767px) {
  .legend {
    left: 12px;
    right: 12px;
    bottom: calc(66px + var(--safe-bottom));
    flex-direction: row;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 4px 11px;
    padding: 6px 8px;
  }
  .lg { font-size: 10px; }
  .dot { width: 8px; height: 8px; }
  /* 控制按钮抬到图例上方，避免被压住 */
  .ctrls { bottom: calc(112px + var(--safe-bottom)); }
}

/* 节点抽屉 */
.node-sheet {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: calc(70px + var(--safe-bottom));
  max-width: 560px;
  margin: 0 auto;
  z-index: 20;
  background: rgba(255, 255, 255, .98);
  backdrop-filter: blur(16px);
  border-radius: 16px;
  border: 1px solid var(--c-border);
  box-shadow: var(--shadow-lg);
  padding: 14px;
}

.ns-head { display: flex; align-items: center; gap: 11px; }

.ns-avatar {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: linear-gradient(135deg, #60a5fa, #2563eb);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 15px;
  flex-shrink: 0;
}

.ns-avatar--key { background: linear-gradient(135deg, #fbbf24, #f59e0b); }
.ns-avatar--self { background: linear-gradient(135deg, #34d399, #059669); }

.ns-name { font-weight: 700; font-size: 16px; }
.ns-org { font-size: 12.5px; color: var(--c-text-2); margin-top: 1px; }
.ns-close { color: var(--c-text-3); cursor: pointer; padding: 4px; }

.ns-body { margin-top: 12px; }
.ns-sec { margin-bottom: 10px; }
.ns-label { font-size: 11.5px; color: var(--c-text-3); margin-bottom: 5px; }
.ns-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.ns-neighbors { display: flex; flex-wrap: wrap; gap: 5px; }

.ns-cross {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #faf5ff;
  color: #7e22ce;
  border: 1px solid #e9d5ff;
  border-radius: 8px;
  padding: 4px 9px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.ns-cross:active { opacity: .6; }

.ns-cross-rel {
  font-style: normal;
  font-size: 10.5px;
  font-weight: 500;
  color: #a855f7;
}

.ns-tip {
  font-size: 11px;
  color: var(--c-text-3);
  margin-top: 6px;
  line-height: 1.5;
}
.ns-loading { display: flex; justify-content: center; padding: 12px 0 4px; }

.sheet-enter-active, .sheet-leave-active { transition: all .22s cubic-bezier(.4, 0, .2, 1); }
.sheet-enter-from, .sheet-leave-to { transform: translateY(16px); opacity: 0; }
</style>
