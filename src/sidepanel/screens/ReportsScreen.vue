<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { RunReport, ModuleId } from '@lib/types'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { CONNECT_HISTORY_KEY, type ConnectRecord } from '@lib/connect/ConnectHistory'
import { asArray } from '@lib/engagement/settings'
import { panelBus } from '../lib/panelBus'

defineProps<{ reports: RunReport[] }>()

const REASON: Record<RunReport['stopReason'], string> = {
  budget: 'дневной бюджет',
  risk: 'риск-стоп',
  manual: 'остановлено вручную',
  feed_exhausted: 'лента кончилась'
}
const fmt = (iso: string) => new Date(iso).toLocaleString()
const moduleExecuted = (r: RunReport, id: ModuleId) => r.modules.find((m) => m.id === id)?.executed ?? 0

// Detailed connect history (who was added + when) — read straight from storage.
const connects = ref<ConnectRecord[]>([])
onMounted(async () => {
  if (!panelBus.available()) return
  connects.value = asArray<ConnectRecord>(await new ChromeStorageStore().get(CONNECT_HISTORY_KEY))
})
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
      Лайки: <b>{{ moduleExecuted(r, 'engagement') }}</b> ·
      Коннекты: <b>{{ moduleExecuted(r, 'smart_connect') }}</b>
    </div>

    <div class="sect-lbl">Добавленные контакты · {{ connects.length }}</div>
    <p v-if="!connects.length" class="banner">Пока никого не добавили.</p>
    <div v-for="c in connects" :key="c.memberId + c.sentAt" class="note" data-testid="connect-record">
      <div class="lbl">{{ fmt(c.sentAt) }}</div>
      <a :href="c.profileUrl" target="_blank" rel="noopener"><b>{{ c.name }}</b></a>
      <template v-if="c.headline"> — {{ c.headline }}</template>
    </div>
  </section>
</template>
