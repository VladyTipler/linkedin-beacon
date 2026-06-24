<script setup lang="ts">
import { useEngagementSettings } from '../composables/useEngagementSettings'

const { stack, roles, threshold, saved, save } = useEngagementSettings()
</script>

<template>
  <div class="es-form">
    <div class="es-head">
      Таргет вовлечённости
      <span v-if="saved" class="es-saved" data-testid="settings-saved">сохранено ✓</span>
    </div>

    <label class="es-row">
      <span>Стек (через запятую)</span>
      <input
        v-model="stack"
        data-testid="settings-stack"
        placeholder="Vue, TypeScript, React, http"
        @blur="save"
      />
    </label>

    <label class="es-row">
      <span>Целевые роли</span>
      <input
        v-model="roles"
        data-testid="settings-roles"
        placeholder="recruiter, talent, hiring"
        @blur="save"
      />
    </label>

    <label class="es-row">
      <span>Порог релевантности · {{ threshold.toFixed(2) }}</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        v-model.number="threshold"
        data-testid="settings-threshold"
        @change="save"
      />
    </label>
  </div>
</template>

<style scoped>
.es-form {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid #243150;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.02);
}
.es-head {
  font-family: 'Spline Sans Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8fbb2e;
  margin-bottom: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.es-saved {
  color: #c4ff4d;
  text-transform: none;
  letter-spacing: 0;
}
.es-row {
  display: block;
  margin-bottom: 10px;
}
.es-row span {
  display: block;
  font-size: 11px;
  color: #8294b8;
  margin-bottom: 5px;
}
.es-row input[type='text'],
.es-row input:not([type]) {
  width: 100%;
  background: #0a0e17;
  border: 1px solid #243150;
  border-radius: 8px;
  color: #eaf0ff;
  font: inherit;
  font-size: 13px;
  padding: 8px 10px;
  outline: none;
}
.es-row input:focus {
  border-color: rgba(196, 255, 77, 0.4);
}
.es-row input[type='range'] {
  width: 100%;
  accent-color: #c4ff4d;
}
</style>
