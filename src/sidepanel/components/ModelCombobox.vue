<script setup lang="ts">
import { ref, computed } from 'vue'
import type { LlmModel } from '@lib/llm/models'
import { filterModels } from '../lib/filterModels'

const props = defineProps<{ models: LlmModel[]; modelValue?: string }>()
const emit = defineEmits<{ 'update:modelValue': [id: string] }>()

const query = ref('')
const open = ref(false)

const selectedLabel = computed(() => {
  const m = props.models.find((x) => x.id === props.modelValue)
  return m ? (m.label ?? m.id) : ''
})

const shown = computed(() => filterModels(props.models, query.value, 10))

function onInput(e: Event) {
  query.value = (e.target as HTMLInputElement).value
  open.value = true
}
function onFocus() {
  open.value = true
  query.value = ''
}
function pick(m: LlmModel) {
  emit('update:modelValue', m.id)
  open.value = false
  query.value = ''
}
function close() {
  // delay so a list mousedown registers before blur closes it
  setTimeout(() => {
    open.value = false
    query.value = ''
  }, 150)
}
</script>

<template>
  <div class="combo">
    <input
      :value="open ? query : selectedLabel"
      :placeholder="modelValue ? selectedLabel : 'выбери модель…'"
      data-testid="model-search"
      @input="onInput"
      @focus="onFocus"
      @blur="close"
    />
    <ul v-if="open && shown.length" class="combo-list">
      <li
        v-for="m in shown"
        :key="m.id"
        :class="{ on: m.id === modelValue }"
        :data-testid="`model-opt`"
        @mousedown.prevent="pick(m)"
      >
        {{ m.label ?? m.id }}
      </li>
    </ul>
    <div v-else-if="open" class="combo-empty">Ничего не найдено</div>
  </div>
</template>

<style scoped>
.combo {
  position: relative;
}
.combo-list {
  position: absolute;
  z-index: 20;
  left: 0;
  right: 0;
  max-height: 230px;
  overflow-y: auto;
  margin: 4px 0 0;
  padding: 4px;
  list-style: none;
  background: #12161f;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.combo-list li {
  padding: 7px 9px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.combo-list li:hover,
.combo-list li.on {
  background: rgba(196, 255, 77, 0.16);
}
.combo-empty {
  position: absolute;
  z-index: 20;
  left: 0;
  right: 0;
  margin-top: 4px;
  padding: 7px 9px;
  background: #12161f;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: var(--mut);
  font-size: 12px;
}
</style>
