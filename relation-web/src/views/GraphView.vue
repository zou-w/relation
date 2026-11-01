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
import { ref, onMounted, onBeforeUnmount, shallowRef, computed, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import cytoscape from 'cytoscape';
import api from '@/api';

const router = useRouter();

const container = ref(null);
const cy = shallowRef(null);
const loading = ref(true);
const keyOnly = ref(false);
const stats = ref({ nodes: 0, edges: 0 });
const selected = ref(null);
const showDetail = ref(false);
const detail = ref(null);

const theme = {
  person: { bg: '#ffffff', border: '#c7d2e5', text: '#1a1d23' },
  key: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
  self: { bg: '#059669', border: '#047857', text: '#ffffff' },
  org: { bg: '#eef4ff', border: '#bfdbfe', text: '#1e40af' },
  edgeRel: '#94a3b8',
  edgeEmp: '#cbd5e1',
};

/** 构建 Cytoscape 元素 */
function buildElements(data) {
  const nodes = data.nodes.map((n) => {
    const isSelf = n.isSelf;
    const isKey = n.isKey;
    const isOrg = n.kind === 'org';
    return {
      data: {
        id: n.id,
        label: n.label,
        kind: n.kind,
        isSelf: isSelf ? 1 : 0,
        isKey: isKey ? 1 : 0,
        orgName: n.orgName || '',
        raw: n,
      },
      classes: [
        isOrg ? 'org' : 'person',
        isSelf ? 'self' : '',
        isKey ? 'key' : '',
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
    },
    classes: e.kind === 'employment' ? 'edge-emp' : 'edge-rel',
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
    const hh = (n.height() || 40) / 2 + 26; // 下方标签占位
    x0 = Math.min(x0, p.x - hw);
    x1 = Math.max(x1, p.x + hw);
    y0 = Math.min(y0, p.y - (n.height() || 40) / 2 - 6);
    y1 = Math.max(y1, p.y + hh);
  });

  const bbW = Math.max(x1 - x0, 1);
  const bbH = Math.max(y1 - y0, 1);

  const isMobile = w < 768;
  const availW = Math.max(w - (isMobile ? 40 : 120), 120);
  const availH = Math.max(h - padTop - padBottom, 120);

  const level = Math.max(Math.min(availW / bbW, availH / bbH, maxScale), 0.25);
  instance.zoom({ level });

  // 模型坐标中心 → 渲染坐标中心（zoom 默认以 (0,0) 为基准，pan 后即为目标位置）
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  instance.pan({
    x: w / 2 - cx * level,
    y: padTop + availH / 2 - cy * level,
  });
}

/** 布局并锁定 */
function applyLayout(instance) {
  const layout = instance.layout({
    name: 'cose',
    animate: false,           // 不做动画，一次性算完，避免掉帧
    fit: false,               // 自己算视口，更可控
    padding: 40,
    nodeRepulsion: () => 90000,
    idealEdgeLength: (edge) => (edge.data('kind') === 'employment' ? 60 : 120),
    edgeElasticity: () => 90,
    nestingFactor: 1.2,
    gravity: 0.6,             // 加大向心力，避免节点被推到远处
    numIter: 1200,
    initialTemp: 200,
    coolingFactor: 0.95,
    minTemp: 1.0,
    randomize: true,
  });
  layout.run();

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
          color: theme.self.text,
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

  // 点击节点
  instance.on('tap', 'node', (evt) => {
    const node = evt.target;
    selected.value = node.data('raw');
    highlightNeighbors(instance, node);
    openDetail(node);
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
}

/** 高亮邻居 */
function highlightNeighbors(instance, node) {
  instance.elements().removeClass('dimmed highlighted');
  const neighborhood = node.closedNeighborhood();
  instance.elements().not(neighborhood).addClass('dimmed');
  neighborhood.addClass('highlighted');
}

async function openDetail(node) {
  const raw = node.data('raw');
  if (raw.kind === 'org') {
    showDetail.value = false;
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
      loaded: true,
    };
  } catch {
    detail.value = { ...detail.value, loaded: true };
  }
}

async function load() {
  loading.value = true;
  try {
    const data = await api.graph({ key_only: keyOnly.value ? 1 : undefined, limit: 300 });
    await nextTick();
    // 容器需要已渲染
    requestAnimationFrame(() => initCy(data));
  } catch (e) {
    showToast(e.message);
  } finally {
    loading.value = false;
  }
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
  load();
}

function goPerson() {
  if (detail.value?.personId) {
    showDetail.value = false;
    router.push(`/person/${detail.value.personId}`);
  }
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
        <h1>关系图</h1>
        <div class="row gap-6">
          <button class="pill" :class="{ 'pill--on': keyOnly }" @click="toggleKey">
            <van-icon name="star-o" />
            只看重点
          </button>
          <button class="pill" @click="relayout">
            <van-icon name="replay" />
            重排
          </button>
        </div>
      </div>
      <div class="meta" v-if="!loading">
        {{ stats.nodes }} 节点 · {{ stats.edges }} 条连接
      </div>
    </div>

    <!-- 加载 -->
    <div v-if="loading" class="cy-loading">
      <van-loading size="24px" color="#2563eb">加载关系网…</van-loading>
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
    </div>

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
.ns-loading { display: flex; justify-content: center; padding: 12px 0 4px; }

.sheet-enter-active, .sheet-leave-active { transition: all .22s cubic-bezier(.4, 0, .2, 1); }
.sheet-enter-from, .sheet-leave-to { transform: translateY(16px); opacity: 0; }
</style>
