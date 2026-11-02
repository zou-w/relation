<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { showToast, showSuccessToast, showConfirmDialog } from 'vant';
import api from '@/api';

const router = useRouter();

const stage = ref('idle');        // idle | checking | preview | done
const file = ref(null);
const preview = ref(null);
const result = ref(null);
const mode = ref('skip');          // skip | update
const fields = ref([]);
const showFields = ref(false);
const dragging = ref(false);
const fileInput = ref(null);

const MAX_SIZE = 12 * 1024 * 1024;

const summary = computed(() => preview.value?.summary || null);
const hasError = computed(() => (summary.value?.error || 0) > 0);

const statusText = {
  ok: '可导入',
  warning: '有提示',
  error: '有问题',
};

const actionText = {
  create: '新增',
  update: '更新',
  'duplicate-in-file': '文件内重复',
};

/* ---------------- 选择文件 ---------------- */
function pickFile() {
  fileInput.value?.click();
}

function onFileChange(e) {
  const f = e.target.files?.[0];
  if (f) handleFile(f);
  e.target.value = '';
}

function onDrop(e) {
  dragging.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f) handleFile(f);
}

async function handleFile(f) {
  if (!/\.xlsx$/i.test(f.name)) {
    showToast('只支持 .xlsx 文件，请用 Excel 另存为 xlsx 格式');
    return;
  }
  if (f.size > MAX_SIZE) {
    showToast('文件超过 12MB，请拆分后再导入');
    return;
  }

  file.value = f;
  stage.value = 'checking';
  preview.value = null;

  try {
    const r = await api.importPreview(f);
    preview.value = r;
    stage.value = 'preview';
  } catch (e) {
    stage.value = 'idle';
    file.value = null;
    showToast(e.message);
  }
}

/* ---------------- 执行导入 ---------------- */
async function doImport() {
  if (!file.value || !preview.value) return;

  let skipInvalid = false;
  if (hasError.value) {
    try {
      await showConfirmDialog({
        title: `有 ${summary.value.error} 行无法导入`,
        message: '这些行会被跳过，其余正常数据照常写入。要现在导入吗？',
        confirmButtonText: '跳过并导入',
        cancelButtonText: '先回去改',
      });
      skipInvalid = true;
    } catch {
      return;
    }
  }

  stage.value = 'checking';
  try {
    const r = await api.importExecute(file.value, { mode: mode.value, skipInvalid });
    result.value = r;
    stage.value = 'done';
    showSuccessToast(`导入完成：新增 ${r.summary.created} 人`);
  } catch (e) {
    stage.value = 'preview';
    showToast(e.message);
  }
}

function reset() {
  stage.value = 'idle';
  file.value = null;
  preview.value = null;
  result.value = null;
  mode.value = 'skip';
}

function goManage() {
  router.push('/manage');
}

async function downloadTemplate() {
  try {
    const blob = await api.downloadTemplate();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '人脉关系网-联系人导入模板.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    showToast(e.message || '下载失败');
  }
}

onMounted(async () => {
  try {
    const r = await api.importFields();
    fields.value = r.fields || [];
  } catch { /* ignore */ }
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="container">
        <div class="row gap-8">
          <van-icon name="arrow-left" size="19" class="back" @click="router.push('/manage')" />
          <h1>导入名单</h1>
        </div>
        <div class="sub">下载模板 → 填好上传 → 预检确认 → 入库</div>
      </div>
    </header>

    <div class="container">
      <!-- 第一步：模板 -->
      <section class="step">
        <div class="step-head">
          <span class="step-no">1</span>
          <div class="grow">
            <div class="step-title">下载模板</div>
            <div class="step-sub">按清单填写，必填列已标 *，下拉列有选项</div>
          </div>
        </div>

        <div class="card tpl-card">
          <van-icon name="description" class="tpl-icon" />
          <div class="grow">
            <div class="tpl-name">人脉关系网-联系人导入模板.xlsx</div>
            <div class="tpl-meta">15 列 · 含填写说明与下拉选项 · 单次最多 500 行</div>
          </div>
          <van-button type="primary" size="small" round @click="downloadTemplate">
            下载
          </van-button>
        </div>

        <button class="link-btn" @click="showFields = !showFields">
          <van-icon :name="showFields ? 'arrow-up' : 'arrow-down'" />
          {{ showFields ? '收起字段说明' : '查看字段填写要求' }}
        </button>

        <div v-if="showFields" class="card field-list">
          <div v-for="f in fields" :key="f.key" class="field-row">
            <div class="field-top">
              <span class="field-name">{{ f.header }}</span>
              <span class="tag" :class="f.required ? 'tag--danger' : 'tag--gray'">
                {{ f.required ? '必填' : '选填' }}
              </span>
            </div>
            <div class="field-hint">{{ f.hint }}</div>
            <div v-if="f.options" class="field-options">
              可选：{{ f.options.join(' / ') }}
            </div>
            <div class="field-eg">例：{{ f.example }}</div>
          </div>
        </div>
      </section>

      <!-- 第二步：上传 -->
      <section class="step">
        <div class="step-head">
          <span class="step-no">2</span>
          <div class="grow">
            <div class="step-title">上传填写好的表格</div>
            <div class="step-sub">只支持 .xlsx，上传后会先预检，不会直接写入</div>
          </div>
        </div>

        <input ref="fileInput" type="file" accept=".xlsx" hidden @change="onFileChange" />

        <div
          class="dropzone"
          :class="{ 'dropzone--over': dragging, 'dropzone--busy': stage === 'checking' }"
          @click="stage === 'checking' ? null : pickFile()"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="onDrop"
        >
          <template v-if="stage === 'checking'">
            <van-loading size="22" />
            <div class="dz-title">正在解析并校验…</div>
            <div class="dz-sub">{{ file?.name }}</div>
          </template>
          <template v-else-if="file && stage !== 'idle'">
            <van-icon name="passed" class="dz-icon dz-icon--ok" />
            <div class="dz-title ellipsis">{{ file.name }}</div>
            <div class="dz-sub">点击可重新选择文件</div>
          </template>
          <template v-else>
            <van-icon name="upload" class="dz-icon" />
            <div class="dz-title">点击选择文件，或把文件拖到这里</div>
            <div class="dz-sub">.xlsx · 最大 12MB</div>
          </template>
        </div>
      </section>

      <!-- 第三步：预检结果 -->
      <template v-if="stage === 'preview' && summary">
        <section class="step">
          <div class="step-head">
            <span class="step-no">3</span>
            <div class="grow">
              <div class="step-title">确认后导入</div>
              <div class="step-sub">预检不写库，确认之后才真正保存</div>
            </div>
          </div>

          <div class="stat-grid summary-grid">
            <div class="stat">
              <div class="stat-num">{{ summary.total }}</div>
              <div class="stat-label">总行数</div>
            </div>
            <div class="stat">
              <div class="stat-num" style="color: var(--c-success)">{{ summary.create }}</div>
              <div class="stat-label">将新增</div>
            </div>
            <div class="stat">
              <div class="stat-num" style="color: var(--c-primary)">{{ summary.update }}</div>
              <div class="stat-label">已存在</div>
            </div>
            <div class="stat">
              <div class="stat-num" :style="{ color: summary.error ? 'var(--c-danger)' : 'var(--c-text-3)' }">
                {{ summary.error }}
              </div>
              <div class="stat-label">有问题</div>
            </div>
          </div>

          <!-- 重复策略 -->
          <div v-if="summary.update > 0" class="card strategy">
            <div class="strategy-title">有 {{ summary.update }} 位已存在（姓名 + 单位相同）</div>
            <div class="strategy-opts">
              <button
                class="strategy-opt"
                :class="{ 'strategy-opt--on': mode === 'skip' }"
                @click="mode = 'skip'"
              >
                <b>跳过</b>
                <span>保留现有资料不动</span>
              </button>
              <button
                class="strategy-opt"
                :class="{ 'strategy-opt--on': mode === 'update' }"
                @click="mode = 'update'"
              >
                <b>更新</b>
                <span>用表格里填了的内容覆盖</span>
              </button>
            </div>
          </div>

          <!-- 行明细 -->
          <div class="rows">
            <div class="rows-head">
              <span>明细（{{ preview.rows.length }} 行）</span>
              <span class="muted">点数可看原因</span>
            </div>

            <div
              v-for="r in preview.rows"
              :key="r.rowNumber"
              class="row-item"
              :class="`row-item--${r.status}`"
            >
              <div class="row-line">
                <span class="row-no">第 {{ r.rowNumber }} 行</span>
                <span class="row-name">{{ r.preview.name || '（未填姓名）' }}</span>
                <span class="row-org ellipsis">{{ r.preview.org_name || '无单位' }}</span>
                <span class="tag" :class="{
                  'tag--danger': r.status === 'error',
                  'tag--warn': r.status === 'warning',
                  'tag--success': r.status === 'ok',
                }">
                  {{ statusText[r.status] }}
                </span>
              </div>

              <div v-if="r.action !== 'create' || r.errors.length || r.warnings.length" class="row-foot">
                <span v-if="r.action === 'update'" class="tag tag--gray">
                  {{ actionText[r.action] }}已有记录
                </span>
                <span v-else-if="r.action === 'duplicate-in-file'" class="tag tag--gray">
                  {{ actionText[r.action] }}
                </span>
                <span v-for="(e, i) in r.errors" :key="'e' + i" class="err">{{ e }}</span>
                <span v-for="(w, i) in r.warnings" :key="'w' + i" class="warn">{{ w }}</span>
              </div>
            </div>
          </div>

          <van-button
            type="primary"
            block
            round
            size="large"
            style="margin-top: 16px"
            @click="doImport"
          >
            {{ hasError ? `导入（跳过 ${summary.error} 行问题数据）` : `确认导入 ${summary.total} 行` }}
          </van-button>
          <button class="link-btn center" @click="reset">换个文件</button>
        </section>
      </template>

      <!-- 完成 -->
      <template v-if="stage === 'done' && result">
        <section class="step">
          <div class="card done-card">
            <van-icon name="passed" class="done-icon" />
            <div class="done-title">导入完成</div>
            <div class="done-grid">
              <div class="done-item">
                <div class="done-num" style="color: var(--c-success)">{{ result.summary.created }}</div>
                <div class="done-label">新增</div>
              </div>
              <div class="done-item">
                <div class="done-num" style="color: var(--c-primary)">{{ result.summary.updated }}</div>
                <div class="done-label">更新</div>
              </div>
              <div class="done-item">
                <div class="done-num" style="color: var(--c-text-3)">{{ result.summary.skipped }}</div>
                <div class="done-label">跳过</div>
              </div>
              <div class="done-item">
                <div class="done-num" :style="{ color: result.summary.failed ? 'var(--c-danger)' : 'var(--c-text-3)' }">
                  {{ result.summary.failed }}
                </div>
                <div class="done-label">失败</div>
              </div>
            </div>

            <van-button type="primary" block round style="margin-top: 20px" @click="goManage">
              去看人员列表
            </van-button>
            <button class="link-btn center" @click="reset">继续导入</button>
          </div>

          <div v-if="result.summary.failed" class="rows">
            <div class="rows-head"><span>失败明细</span></div>
            <div v-for="r in result.results.filter((x) => x.result === 'failed')" :key="r.rowNumber" class="row-item row-item--error">
              <div class="row-line">
                <span class="row-no">第 {{ r.rowNumber }} 行</span>
                <span class="row-name">{{ r.name || '（未填姓名）' }}</span>
                <span class="err">{{ r.message }}</span>
              </div>
            </div>
          </div>
        </section>
      </template>

      <p class="foot-hint">
        导入的联系人会自动建立单位关联；手机号等敏感字段加密存储。
      </p>
    </div>
  </div>
</template>

<style scoped>
.back { cursor: pointer; color: var(--c-text-2); }

.step { margin-top: 18px; }
.step:first-child { margin-top: 6px; }

.step-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 10px;
}

.step-no {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--c-primary);
  color: #fff;
  font-size: 12.5px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}

.step-title { font-size: 15px; font-weight: 600; }
.step-sub { font-size: 12.5px; color: var(--c-text-3); margin-top: 1px; }

/* 模板卡 */
.tpl-card { display: flex; align-items: center; gap: 12px; padding: 14px; }
.tpl-icon { font-size: 26px; color: var(--c-primary); }
.tpl-name { font-size: 14.5px; font-weight: 600; }
.tpl-meta { font-size: 12px; color: var(--c-text-3); margin-top: 2px; }

.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: none;
  color: var(--c-primary);
  font-size: 13px;
  font-family: inherit;
  padding: 8px 2px;
  cursor: pointer;
}
.link-btn.center { display: flex; margin: 10px auto 0; }

/* 字段说明 */
.field-list { padding: 4px 14px; }
.field-row {
  padding: 11px 0;
  border-bottom: 1px solid var(--c-border);
}
.field-row:last-child { border-bottom: 0; }
.field-top { display: flex; align-items: center; gap: 7px; }
.field-name { font-size: 14px; font-weight: 600; }
.field-hint { font-size: 12.5px; color: var(--c-text-2); margin-top: 3px; line-height: 1.5; }
.field-options { font-size: 12px; color: var(--c-primary); margin-top: 3px; }
.field-eg { font-size: 12px; color: var(--c-text-3); margin-top: 3px; }

/* 上传区 */
.dropzone {
  border: 1.5px dashed var(--c-border);
  border-radius: var(--radius);
  background: #fff;
  padding: 30px 20px;
  text-align: center;
  cursor: pointer;
  transition: all .18s;
}
.dropzone--over {
  border-color: var(--c-primary);
  background: var(--c-primary-light);
}
.dropzone--busy { cursor: default; background: #fafbfc; }
.dz-icon { font-size: 32px; margin-bottom: 8px; color: var(--c-text-3); }
.dz-icon--ok { color: var(--c-success); }
.dz-title { font-size: 14.5px; font-weight: 600; }
.dz-sub { font-size: 12.5px; color: var(--c-text-3); margin-top: 4px; }

/* 汇总 */
.summary-grid { margin-top: 4px; }
.summary-grid .stat-num { font-size: 20px; }

/* 策略 */
.strategy { padding: 14px; }
.strategy-title { font-size: 13.5px; font-weight: 600; margin-bottom: 10px; }
.strategy-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.strategy-opt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  border: 1.5px solid var(--c-border);
  background: #fafbfc;
  border-radius: 10px;
  padding: 10px 12px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: all .15s;
}
.strategy-opt b { font-size: 14px; color: var(--c-text); }
.strategy-opt span { font-size: 11.5px; color: var(--c-text-3); line-height: 1.4; }
.strategy-opt--on {
  border-color: var(--c-primary);
  background: var(--c-primary-light);
}
.strategy-opt--on b { color: var(--c-primary); }

/* 明细 */
.rows { margin-top: 16px; }
.rows-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
  color: var(--c-text-3);
  margin-bottom: 8px;
  padding: 0 2px;
}

.row-item {
  background: #fff;
  border: 1px solid var(--c-border);
  border-left: 3px solid var(--c-border);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 8px;
}
.row-item--error { border-left-color: var(--c-danger); background: #fffafa; }
.row-item--warning { border-left-color: var(--c-warning); background: #fffdfa; }
.row-item--ok { border-left-color: var(--c-success); }

.row-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.row-no { font-size: 11.5px; color: var(--c-text-3); font-variant-numeric: tabular-nums; }
.row-name { font-size: 14px; font-weight: 600; }
.row-org { font-size: 12.5px; color: var(--c-text-2); flex: 1; min-width: 0; }

.row-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--c-border);
}
.err { font-size: 12px; color: var(--c-danger); }
.warn { font-size: 12px; color: var(--c-warning); }

/* 完成 */
.done-card { padding: 24px 18px; text-align: center; }
.done-icon { font-size: 44px; color: var(--c-success); }
.done-title { font-size: 18px; font-weight: 700; margin-top: 6px; }
.done-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-top: 18px;
}
.done-num { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
.done-label { font-size: 11.5px; color: var(--c-text-3); margin-top: 1px; }

.foot-hint {
  text-align: center;
  font-size: 11.5px;
  color: var(--c-text-3);
  margin: 20px 0 8px;
  line-height: 1.6;
}
</style>
