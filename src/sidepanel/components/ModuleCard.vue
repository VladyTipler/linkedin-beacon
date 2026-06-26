<script setup lang="ts">
import { ref } from 'vue'
import type { ModuleState } from '@lib/types'

defineProps<{
  module: ModuleState
  title: string
  desc: string
  /** When set, render a daily-limit input (omit for modules without a budget). */
  limitLabel?: string
  recommended?: string
}>()
const emit = defineEmits<{ toggle: []; setLimit: [n: number] }>()

// Persist is reliable + synchronous, so confirm optimistically right on change.
const savedLimit = ref(false)
function onLimit(e: Event) {
  emit('setLimit', Number((e.target as HTMLInputElement).value))
  savedLimit.value = true
  setTimeout(() => { savedLimit.value = false }, 1500)
}
</script>

<template>
  <div class="mod" :class="{ active: module.available && module.enabled }">
    <div class="mod-head">
      <div class="mic"><slot name="icon" /></div>
      <div class="mod-ttl">
        <h3>{{ title }}</h3>
        <p>{{ desc }}</p>
      </div>
      <span v-if="!module.available" class="soon">Скоро</span>
      <div
        v-else
        class="sw"
        :class="{ on: module.enabled }"
        :data-testid="`toggle-${module.id}`"
        @click="$emit('toggle')"
      />
    </div>

    <slot />

    <label v-if="limitLabel" class="fld" style="margin-top:10px">
      <span class="k">
        {{ limitLabel }} <span style="color:var(--mut)">{{ recommended }}</span>
        <span v-if="savedLimit" class="v ok" :data-testid="`limit-saved-${module.id}`">сохранено ✓</span>
      </span>
      <input
        type="number"
        min="1"
        :value="module.dailyLimit"
        :disabled="!module.available"
        :data-testid="`limit-${module.id}`"
        @change="onLimit"
      />
    </label>
  </div>
</template>
