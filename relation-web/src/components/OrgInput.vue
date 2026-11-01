<script setup>
/**
 * 单位输入框（带已填单位联想）
 * 交互要点：
 * 1. 一聚焦就列出「常用单位」——按已有联系人数排序，不用先打字
 * 2. 输入时模糊匹配全称 / 简称
 * 3. 支持 ↑↓ 选择、回车确认、Esc 关闭
 * 4. 选中已存在单位会明确提示「复用」，避免同单位写成多个名字
 */
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue';
import api from '@/api';

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '公司 / 政府单位' },
  limit: { type: Number, default: 8 },
});
const emit = defineEmits(['update:modelValue', 'pick']);

const inputEl = ref(null);
const open = ref(false);
const active = ref(0);
const options = ref([]);
const loading = ref(false);
const rect = ref({ left: 0, top: 0, width: 0, maxHeight: 264 });

let timer = null;
let seq = 0;

const keyword = computed(() => (props.modelValue || '').trim());

/** 输入值是否正好等于某个已有单位 */
const exact = computed(() => {
  const v = keyword.value;
  if (!v) return null;
  return options.value.find((o) => o.name === v || o.alias === v) || null;
});

/** 把下拉框贴到输入框下方；空间不够时翻到上方 */
function updateRect() {
  const el = inputEl.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const POP_H = 264;
  const below = vh - r.bottom - 10;
  const above = r.top - 10;
  const up = below < 180 && above > below;

  rect.value = {
    left: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)),
    width: r.width,
    top: up ? r.top - Math.min(POP_H, above) - 6 : r.bottom + 6,
    maxHeight: Math.max(96, Math.min(POP_H, up ? above : below)),
  };
}

async function fetchOrgs(q) {
  const mySeq = ++seq;
  loading.value = true;
  try {
    const r = await api.orgs({ q: q || undefined, limit: props.limit });
    if (mySeq !== seq) return; // 丢弃过期响应，避免快速输入时结果闪回
    options.value = r.items || [];
    active.value = 0;
  } catch {
    if (mySeq === seq) options.value = [];
  } finally {
    if (mySeq === seq) loading.value = false;
  }
}

function onFocus() {
  open.value = true;
  nextTick(updateRect);
  fetchOrgs(keyword.value);
}

function onInput(e) {
  emit('update:modelValue', e.target.value);
  open.value = true;
  updateRect();
  clearTimeout(timer);
  timer = setTimeout(() => fetchOrgs(e.target.value.trim()), 200);
}

/** 失焦延迟关闭，给点击选项留出时间 */
function onBlur() {
  setTimeout(() => { open.value = false; }, 150);
}

function move(step) {
  if (!open.value) { open.value = true; updateRect(); return; }
  if (!options.value.length) return;
  active.value = (active.value + step + options.value.length) % options.value.length;
}

function pick(o) {
  emit('update:modelValue', o.name);
  emit('pick', o);
  open.value = false;
  options.value = [];
}

function chooseActive() {
  if (open.value && options.value[active.value]) pick(options.value[active.value]);
}

function close() {
  open.value = false;
}

/* 抽屉内部滚动 / 窗口尺寸变化时保持跟随 */
function bindFollow(on) {
  const fn = on ? 'addEventListener' : 'removeEventListener';
  window[fn]('scroll', updateRect, true);
  window[fn]('resize', updateRect);
}
watch(open, (v) => bindFollow(v));

// 外部清空时同步收起
watch(() => props.modelValue, (v) => {
  if (!v) active.value = 0;
});

onBeforeUnmount(() => {
  clearTimeout(timer);
  bindFollow(false);
});
</script>

<template>
  <div class="org-input">
    <input
      ref="inputEl"
      :value="modelValue"
      class="org-native"
      :placeholder="placeholder"
      autocomplete="off"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter.prevent="chooseActive"
      @keydown.esc="close"
    />
    <van-icon
      v-if="modelValue"
      name="clear"
      class="org-clear"
      @mousedown.prevent
      @click="emit('update:modelValue', '')"
    />

    <teleport to="body">
      <div
        v-if="open && (options.length || loading || keyword)"
        class="org-pop"
        :style="{
          left: rect.left + 'px',
          top: rect.top + 'px',
          width: rect.width + 'px',
          maxHeight: rect.maxHeight + 'px',
        }"
        @mousedown.prevent
      >
        <div class="org-pop-head">
          <span>{{ keyword ? '匹配到的单位' : '常用单位' }}</span>
          <span class="org-pop-tip">{{ keyword ? '↑↓ 选择 · 回车确认' : '输入可筛选' }}</span>
        </div>

        <div v-if="exact" class="org-exact">
          <van-icon name="passed" />
          <span>已有「{{ exact.name }}」，保存时直接归到这个单位</span>
        </div>

        <div v-if="loading && !options.length" class="org-loading">搜索中…</div>

        <div
          v-for="(o, i) in options"
          :key="o.id"
          class="org-item"
          :class="{ 'org-item--active': i === active }"
          @click="pick(o)"
          @mouseenter="active = i"
        >
          <div class="oi-main">
            <span class="oi-name">{{ o.name }}</span>
            <span v-if="o.alias" class="oi-alias">{{ o.alias }}</span>
          </div>
          <span class="oi-count">{{ o.person_count }} 人</span>
        </div>

        <div v-if="keyword && !options.length && !loading" class="org-empty">
          没有匹配的单位，保存时会新建「{{ keyword }}」
        </div>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.org-input { position: relative; }

.org-native {
  width: 100%;
  border: 1px solid var(--c-border);
  border-radius: 10px;
  padding: 11px 34px 11px 13px;
  font-size: 15px;
  font-family: inherit;
  color: var(--c-text);
  background: #fafbfc;
  outline: none;
  transition: border-color .15s, background .15s;
}

.org-native:focus { border-color: var(--c-primary); background: #fff; }
.org-native::placeholder { color: var(--c-text-3); }

.org-clear {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 15px;
  color: var(--c-text-3);
  cursor: pointer;
  padding: 4px;
}

.org-pop {
  position: fixed;
  z-index: 3000;
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, .14);
  overflow-y: auto;
  padding: 6px;
  animation: pop .12s ease-out;
}

@keyframes pop {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.org-pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 6px;
  font-size: 11px;
  color: var(--c-text-3);
  font-weight: 600;
  letter-spacing: .02em;
}

.org-pop-tip { font-weight: 400; opacity: .8; }

.org-exact {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0 4px 4px;
  padding: 6px 8px;
  border-radius: 7px;
  background: var(--c-success-light, #ecfdf5);
  color: var(--c-success, #059669);
  font-size: 11.5px;
}

.org-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px;
  border-radius: 8px;
  cursor: pointer;
}

.org-item--active { background: var(--c-primary-light); }

.oi-main { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px; }

.oi-name {
  font-size: 13.5px;
  color: var(--c-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.oi-alias { font-size: 11px; color: var(--c-text-3); flex-shrink: 0; }

.oi-count {
  font-size: 11px;
  color: var(--c-text-3);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.org-loading,
.org-empty {
  padding: 12px 9px;
  font-size: 12.5px;
  color: var(--c-text-3);
  text-align: center;
}
</style>
