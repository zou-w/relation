<script setup>
/**
 * 项目新建 / 编辑表单（列表页与详情页共用）
 */
import { ref, computed, watch, onMounted } from 'vue';
import { showToast, showSuccessToast } from 'vant';
import api from '@/api';
import OrgInput from '@/components/OrgInput.vue';

const props = defineProps({
  show: { type: Boolean, default: false },
  project: { type: Object, default: null },
});
const emit = defineEmits(['update:show', 'saved']);

const enums = ref({});
const saving = ref(false);
const form = ref(blank());

function blank() {
  return {
    name: '', code: '', project_type: 'gov_tender', status: 'active',
    owner_org_name: '', our_role: '', region: '', amount: '',
    start_date: '', end_date: '', milestone: '', is_key: false, remark: '',
  };
}

function fill(p) {
  if (!p) { form.value = blank(); return; }
  form.value = {
    name: p.name || '',
    code: p.code || '',
    project_type: p.project_type || 'other',
    status: p.status || 'active',
    owner_org_name: p.owner_org_name || '',
    our_role: p.our_role || '',
    region: p.region || '',
    amount: p.amount ?? '',
    start_date: p.start_date || '',
    end_date: p.end_date || '',
    milestone: p.milestone || '',
    is_key: !!p.is_key,
    remark: p.remark || '',
  };
}

watch(() => props.show, (v) => { if (v) fill(props.project); });
watch(() => props.project, (p) => { if (props.show) fill(p); });

const typeOptions = computed(() =>
  Object.entries(enums.value.project_type?.values || {}).map(([value, text]) => ({ value, text }))
);
const statusOptions = computed(() =>
  Object.entries(enums.value.project_status?.values || {}).map(([value, text]) => ({ value, text }))
);

/** 业主单位按名字复用已有组织，没有就新建 */
async function resolveOrgId(name) {
  const v = (name || '').trim();
  if (!v) return null;
  const r = await api.orgs({ q: v, limit: 20 });
  const hit = (r.items || []).find((o) => o.name === v || o.alias === v);
  if (hit) return hit.id;
  const created = await api.createOrg({ name: v });
  return created.id;
}

const canSave = computed(() => form.value.name.trim().length > 0);

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  try {
    const f = form.value;
    const ownerOrgId = await resolveOrgId(f.owner_org_name);
    const payload = {
      name: f.name.trim(),
      code: f.code.trim() || undefined,
      project_type: f.project_type || 'other',
      status: f.status || 'active',
      owner_org_id: ownerOrgId || null,
      our_role: f.our_role.trim() || undefined,
      region: f.region.trim() || undefined,
      amount: f.amount === '' ? null : Number(f.amount),
      start_date: f.start_date || null,
      end_date: f.end_date || null,
      milestone: f.milestone.trim() || undefined,
      is_key: f.is_key,
      remark: f.remark.trim() || undefined,
    };

    if (props.project?.id) {
      await api.updateProject(props.project.id, payload);
      showSuccessToast('已保存');
      emit('saved', { id: props.project.id, created: false });
    } else {
      const r = await api.createProject(payload);
      showSuccessToast('项目已建');
      emit('saved', { id: r.id, created: true });
    }
    emit('update:show', false);
  } catch (e) {
    showToast(e.message);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try { enums.value = await api.enums(); } catch { /* ignore */ }
});
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    round
    :style="{ maxHeight: '90%' }"
    @update:show="emit('update:show', $event)"
  >
    <div class="sheet">
      <div class="sheet-head">
        <span class="sheet-title">{{ project ? '编辑项目' : '新建项目' }}</span>
        <van-icon name="cross" class="sheet-close" @click="emit('update:show', false)" />
      </div>

      <div class="sheet-body">
        <label class="field">
          <span class="field-label">项目名称 <em>*</em></span>
          <input v-model="form.name" class="input input--lg" placeholder="如：城东片区老旧小区改造 EPC 项目" />
        </label>

        <div class="two-col">
          <label class="field">
            <span class="field-label">项目编号</span>
            <input v-model="form.code" class="input" placeholder="招标 / 立项编号" />
          </label>
          <label class="field">
            <span class="field-label">金额（万元）</span>
            <input v-model="form.amount" class="input" placeholder="8600" inputmode="decimal" />
          </label>
        </div>

        <div class="field">
          <span class="field-label">业主 / 甲方单位</span>
          <OrgInput v-model="form.owner_org_name" placeholder="点一下可选已填过的单位" />
        </div>

        <div class="field">
          <span class="field-label">项目类型</span>
          <div class="chips">
            <button
              v-for="o in typeOptions" :key="o.value" type="button" class="chip"
              :class="{ 'chip--on': form.project_type === o.value }"
              @click="form.project_type = o.value"
            >{{ o.text }}</button>
          </div>
        </div>

        <div class="field">
          <span class="field-label">当前状态</span>
          <div class="chips">
            <button
              v-for="o in statusOptions" :key="o.value" type="button" class="chip"
              :class="{ 'chip--on': form.status === o.value }"
              @click="form.status = o.value"
            >{{ o.text }}</button>
          </div>
        </div>

        <div class="two-col">
          <label class="field">
            <span class="field-label">我方角色</span>
            <input v-model="form.our_role" class="input" placeholder="总包 / 分包 / 投标" />
          </label>
          <label class="field">
            <span class="field-label">区域</span>
            <input v-model="form.region" class="input" placeholder="杭州" />
          </label>
        </div>

        <div class="two-col">
          <label class="field">
            <span class="field-label">开始日期</span>
            <input v-model="form.start_date" class="input" type="date" />
          </label>
          <label class="field">
            <span class="field-label">结束日期</span>
            <input v-model="form.end_date" class="input" type="date" />
          </label>
        </div>

        <label class="field">
          <span class="field-label">当前节点</span>
          <input v-model="form.milestone" class="input" placeholder="如：施工许可已批复，进入消防审查" />
        </label>

        <div class="switch-row">
          <div>
            <div class="field-label" style="margin: 0">重点项目</div>
            <div class="muted" style="font-size: 12px">会在列表和关系图里突出显示</div>
          </div>
          <van-switch v-model="form.is_key" size="22px" />
        </div>

        <label class="field" style="margin-top: 14px">
          <span class="field-label">备注</span>
          <textarea v-model="form.remark" class="input textarea" rows="3" placeholder="卡点、风险、关键人态度"></textarea>
        </label>
      </div>

      <div class="sheet-foot">
        <van-button type="primary" block round :loading="saving" :disabled="!canSave" @click="save">
          保存
        </van-button>
      </div>
    </div>
  </van-popup>
</template>

<style scoped>
.sheet { display: flex; flex-direction: column; max-height: 90vh; }
.sheet-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 16px 10px; border-bottom: 1px solid var(--c-border); flex-shrink: 0;
}
.sheet-title { font-size: 16px; font-weight: 700; }
.sheet-close { font-size: 18px; color: var(--c-text-3); cursor: pointer; padding: 4px; }
.sheet-body { padding: 16px; overflow-y: auto; }
.sheet-foot {
  display: flex; gap: 10px;
  padding: 12px 16px calc(12px + var(--safe-bottom));
  border-top: 1px solid var(--c-border); flex-shrink: 0;
}

.field { display: block; margin-bottom: 14px; }
.field-label {
  display: block; font-size: 12.5px; color: var(--c-text-3);
  font-weight: 500; margin-bottom: 6px;
}
.field-label em { color: var(--c-danger); font-style: normal; }

.input {
  width: 100%;
  border: 1px solid var(--c-border);
  border-radius: 10px;
  padding: 11px 13px;
  font-size: 15px;
  font-family: inherit;
  color: var(--c-text);
  background: #fafbfc;
  outline: none;
  transition: border-color .15s, background .15s;
}
.input:focus { border-color: var(--c-primary); background: #fff; }
.input--lg { font-size: 16.5px; font-weight: 500; }
.textarea { resize: vertical; line-height: 1.55; }

.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.chips { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.chip {
  border: 1px solid var(--c-border);
  background: #fff;
  color: var(--c-text-2);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: all .15s;
}
.chip--on {
  background: var(--c-primary-light);
  border-color: var(--c-primary);
  color: var(--c-primary);
  font-weight: 600;
}

.switch-row {
  display: flex; align-items: center; justify-content: space-between;
  padding-top: 12px; border-top: 1px solid var(--c-border);
}
</style>
