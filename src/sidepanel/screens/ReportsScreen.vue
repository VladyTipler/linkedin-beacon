<script setup lang="ts">
import type { RunReport } from '@lib/types'

defineProps<{ reports: RunReport[] }>()

const REASON: Record<RunReport['stopReason'], string> = {
  budget: 'дневной бюджет',
  risk: 'риск-стоп',
  manual: 'остановлено вручную',
  feed_exhausted: 'лента кончилась'
}
const fmt = (iso: string) => new Date(iso).toLocaleString()
const total = (r: RunReport, k: 'executed' | 'skipped' | 'failed') =>
  r.modules.reduce((n, m) => n + m[k], 0)
</script>

<template>
  <section class="view" id="v-reports">
    <div class="sect-lbl">Отчёты о прогонах</div>
    <p v-if="!reports.length" class="banner">
      Пока нет прогонов. Запусти автопилот на экране «Защита».
    </p>
    <div v-for="r in reports" :key="r.id" class="note" :data-testid="`report-${r.id}`">
      <div class="lbl">
        {{ fmt(r.startedAt) }} · {{ r.host === 'window' ? 'окно-воркер' : 'вкладка' }} ·
        {{ REASON[r.stopReason] }}
      </div>
      Лайков: <b>{{ total(r, 'executed') }}</b> · скип: {{ total(r, 'skipped') }} · ошибок:
      {{ total(r, 'failed') }}
    </div>
  </section>
</template>
