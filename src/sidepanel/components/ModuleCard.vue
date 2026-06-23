<script setup lang="ts">
import type { AutomationLevel, ModuleState } from '@lib/types'

defineProps<{
  module: ModuleState
  title: string
  desc: string
}>()
defineEmits<{ toggle: []; setLevel: [level: AutomationLevel] }>()

const LEVELS: { id: AutomationLevel; label: string }[] = [
  { id: 'manual', label: 'Ручной' },
  { id: 'auto_guardrails', label: 'Авто+карантин' },
  { id: 'full_auto', label: 'Полный авто' }
]
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

    <div v-if="module.available && module.enabled" class="lvl">
      <button
        v-for="l in LEVELS"
        :key="l.id"
        :class="{ on: module.automationLevel === l.id }"
        :data-testid="`level-${module.id}-${l.id}`"
        @click="$emit('setLevel', l.id)"
      >
        {{ l.label }}
      </button>
    </div>
  </div>
</template>
