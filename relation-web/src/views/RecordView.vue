<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { showToast, showSuccessToast } from 'vant';
import api from '@/api';
import OrgInput from '@/components/OrgInput.vue';

const router = useRouter();

const form = ref({
  name: '',
  org_name: '',
  position: '',
  power_level: '',
  met_way: '',
  phone: '',
  is_key_contact: false,
  remark: '',
});

const enums = ref({});
const saving = ref(false);
const showMore = ref(false);

const canSave = computed(() => form.value.name.trim().length > 0);

const powerOptions = computed(() =>
  Object.entries(enums.value.power_level?.values || {}).map(([value, text]) => ({ text, value }))
);
const metOptions = computed(() =>
  Object.entries(enums.value.met_way?.values || {}).map(([value, text]) => ({ text, value }))
);

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  try {
    const payload = {
      name: form.value.name.trim(),
      org_name: form.value.org_name.trim() || undefined,
      position: form.value.position.trim() || undefined,
      power_level: form.value.power_level || undefined,
      met_way: form.value.met_way || undefined,
      phone: form.value.phone.trim() || undefined,
      is_key_contact: form.value.is_key_contact,
      remark: form.value.remark.trim() || undefined,
      met_date: new Date().toISOString().slice(0, 10),
    };
    const r = await api.createPerson(payload);
    showSuccessToast('已记录');
    router.replace(`/person/${r.id}`);
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
  <div class="page page--no-nav record-page">
    <header class="page-header">
      <div class="container">
        <div class="row-between">
          <div class="row gap-8">
            <van-icon name="arrow-left" size="20" @click="router.back()" style="cursor: pointer" />
            <h1>记一个人</h1>
          </div>
          <span class="muted">3 秒落库</span>
        </div>
      </div>
    </header>

    <div class="container">
      <!-- 必填：姓名 -->
      <div class="card form-card">
        <label class="field">
          <span class="field-label">姓名 <em>*</em></span>
          <input
            v-model="form.name"
            class="input input--lg"
            placeholder="见到的人叫什么"
            autocomplete="off"
          />
        </label>

        <!-- 单位（带已填单位联想） -->
        <div class="field">
          <span class="field-label">单位</span>
          <OrgInput
            v-model="form.org_name"
            placeholder="公司 / 政府单位，点一下可选已填过的"
          />
        </div>

        <label class="field">
          <span class="field-label">职务</span>
          <input v-model="form.position" class="input" placeholder="处长 / 总经理" autocomplete="off" />
        </label>

        <!-- 权力角色 -->
        <div class="field">
          <span class="field-label">在单位里的角色</span>
          <div class="chips">
            <button
              v-for="opt in powerOptions"
              :key="opt.value"
              type="button"
              class="chip"
              :class="{ 'chip--on': form.power_level === opt.value }"
              @click="form.power_level = form.power_level === opt.value ? '' : opt.value"
            >
              {{ opt.text }}
            </button>
          </div>
        </div>

        <!-- 重点人物 -->
        <div class="switch-row">
          <div>
            <div class="field-label" style="margin: 0">重点人物</div>
            <div class="muted" style="font-size: 12px">决策人、审批人这类要重点经营的人</div>
          </div>
          <van-switch v-model="form.is_key_contact" size="22px" />
        </div>
      </div>

      <!-- 更多信息 -->
      <div class="more-toggle" @click="showMore = !showMore">
        <van-icon :name="showMore ? 'arrow-up' : 'arrow-down'" />
        <span>{{ showMore ? '收起' : '补充更多信息（可后补）' }}</span>
      </div>

      <div v-if="showMore" class="card form-card">
        <label class="field">
          <span class="field-label">手机号</span>
          <input v-model="form.phone" class="input" placeholder="入库后自动加密存储" inputmode="tel" />
        </label>

        <div class="field">
          <span class="field-label">怎么认识的</span>
          <div class="chips">
            <button
              v-for="opt in metOptions"
              :key="opt.value"
              type="button"
              class="chip"
              :class="{ 'chip--on': form.met_way === opt.value }"
              @click="form.met_way = form.met_way === opt.value ? '' : opt.value"
            >
              {{ opt.text }}
            </button>
          </div>
        </div>

        <label class="field">
          <span class="field-label">备注</span>
          <textarea v-model="form.remark" class="input textarea" rows="3" placeholder="印象、背景、他能帮上什么"></textarea>
        </label>
      </div>

      <van-button
        type="primary"
        block
        round
        size="large"
        :loading="saving"
        :disabled="!canSave"
        style="margin-top: 18px"
        @click="save"
      >
        保存
      </van-button>

      <p class="hint">只有姓名是必填，其他都能后补。系统会提醒你补全。</p>
    </div>
  </div>
</template>

<style scoped>
.form-card { padding: 16px; }

.field {
  display: block;
  margin-bottom: 16px;
  position: relative;
}

.field:last-child { margin-bottom: 0; }

.field-label {
  display: block;
  font-size: 12.5px;
  color: var(--c-text-3);
  font-weight: 500;
  margin-bottom: 6px;
}

.field-label em {
  color: var(--c-danger);
  font-style: normal;
}

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

.input:focus {
  border-color: var(--c-primary);
  background: #fff;
}

.input--lg {
  font-size: 17px;
  font-weight: 500;
  padding: 13px;
}

.textarea { resize: vertical; line-height: 1.55; }

.chips { display: flex; flex-wrap: wrap; gap: 7px; }

.chip {
  border: 1px solid var(--c-border);
  background: #fafbfc;
  color: var(--c-text-2);
  border-radius: 8px;
  padding: 7px 13px;
  font-size: 13.5px;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 14px;
  border-top: 1px solid var(--c-border);
}

.more-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 12px;
  font-size: 13px;
  color: var(--c-primary);
  cursor: pointer;
  margin-bottom: 10px;
}

.hint {
  text-align: center;
  font-size: 12px;
  color: var(--c-text-3);
  margin: 12px 0 0;
}
</style>
