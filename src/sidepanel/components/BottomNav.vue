<script setup lang="ts">
import type { ViewId } from '../composables/useNavigation'

defineProps<{ active: ViewId }>()
defineEmits<{ go: [id: ViewId] }>()
</script>

<template>
  <nav class="nav">
    <button :class="{ on: active === 'v-dash' }" data-testid="nav-v-dash" @click="$emit('go', 'v-dash')">
      <svg viewBox="0 0 24 24" fill="none"><path d="M3 13l9-9 9 9M5 11v8h5v-5h4v5h5v-8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <span>SSI</span>
    </button>
    <button :class="{ on: active === 'v-auto' }" data-testid="nav-v-auto" @click="$emit('go', 'v-auto')">
      <svg viewBox="0 0 24 24" fill="none"><path d="M12 4v2m0 12v2m8-8h-2M6 12H4m12.5-5.5l-1.4 1.4M8.9 15.1l-1.4 1.4m9.6 0l-1.4-1.4M8.9 8.9L7.5 7.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.9" /></svg>
      <span>Модули</span>
    </button>
    <button :class="{ on: active === 'v-reports' }" data-testid="nav-v-reports" @click="$emit('go', 'v-reports')">
      <svg viewBox="0 0 24 24" fill="none"><path d="M5 3h14v18l-7-4-7 4z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" /></svg>
      <span>Отчёты</span>
    </button>
    <button :class="{ on: active === 'v-content' }" data-testid="nav-v-content" @click="$emit('go', 'v-content')">
      <svg viewBox="0 0 24 24" fill="none"><path d="M5 3h10l4 4v14H5z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" /><path d="M14 3v5h5M8.5 13h7M8.5 16.5h5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
      <span>Контент</span>
    </button>
  </nav>
</template>
