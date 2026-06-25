<script setup lang="ts">
import type { ModuleState } from '@lib/types'

defineProps<{
  module: ModuleState
  title: string
  desc: string
  /** When set, render a daily-limit input (omit for modules without a budget, e.g. auto_apply). */
  limitLabel?: string
  recommended?: string
}>()
defineEmits<{ toggle: []; setLimit: [n: number] }>()
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
      <span class="k">{{ limitLabel }} <span style="color:var(--mut)">{{ recommended }}</span></span>
      <input
        type="number"
        min="0"
        :value="module.dailyLimit"
        :disabled="!module.available"
        :data-testid="`limit-${module.id}`"
        @change="$emit('setLimit', Number(($event.target as HTMLInputElement).value))"
      />
    </label>
  </div>
</template>
