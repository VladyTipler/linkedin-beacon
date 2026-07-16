<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { RunReport } from '@lib/types'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { CONNECT_HISTORY_KEY, type ConnectRecord } from '@lib/connect/ConnectHistory'
import { VIEW_HISTORY_KEY, type ViewRecord } from '@lib/views/ViewHistory'
import { asArray } from '@lib/engagement/settings'
import { moduleLabel, reasonHint } from '@lib/autopilot/reasonLabels'
import { panelBus } from '../lib/panelBus'

defineProps<{ reports: RunReport[] }>()

const REASON: Record<RunReport['stopReason'], string> = {
  budget: 'дневной бюджет',
  risk: 'риск-стоп',
  manual: 'остановлено вручную',
  feed_exhausted: 'лента кончилась'
}
const fmt = (iso: string) => new Date(iso).toLocaleString()

// Detailed connect history (who was added + when) — read straight from storage.
const connects = ref<ConnectRecord[]>([])
const views = ref<ViewRecord[]>([])
onMounted(async () => {
  if (!panelBus.available()) return
  const store = new ChromeStorageStore()
  connects.value = asArray<ConnectRecord>(await store.get(CONNECT_HISTORY_KEY))
  views.value = asArray<ViewRecord>(await store.get(VIEW_HISTORY_KEY))
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
      <div v-for="m in r.modules" :key="m.id" class="mrow">
        {{ moduleLabel(m.id) }}: <b>{{ m.executed }}</b>
        <span v-if="reasonHint(m.reason)" class="why">— {{ reasonHint(m.reason) }}</span>
        <span v-if="m.withdrawn" class="why">· отозвано {{ m.withdrawn }}</span>
      </div>
    </div>

    <div class="sect-lbl">Добавленные контакты · {{ connects.length }}</div>
    <p v-if="!connects.length" class="banner">Пока никого не добавили.</p>
    <div v-for="c in connects" :key="c.memberId + c.sentAt" class="note" data-testid="connect-record">
      <div class="lbl">{{ fmt(c.sentAt) }}</div>
      <a :href="c.profileUrl" target="_blank" rel="noopener"><b>{{ c.name }}</b></a>
      <template v-if="c.headline"> — {{ c.headline }}</template>
    </div>

    <div class="sect-lbl">Просмотренные профили · {{ views.length }}</div>
    <p v-if="!views.length" class="banner">Пока никого не смотрели.</p>
    <div v-for="v in views" :key="v.memberId + v.viewedAt" class="note" data-testid="view-record">
      <div class="lbl">{{ fmt(v.viewedAt) }}</div>
      <a :href="v.profileUrl" target="_blank" rel="noopener"><b>{{ v.name }}</b></a>
      <template v-if="v.headline"> — {{ v.headline }}</template>
    </div>
  </section>
</template>

<style scoped>
.mrow {
  line-height: 1.55;
}
/* Muted "why this module did nothing" hint — informative, not alarming. */
.why {
  opacity: 0.6;
  font-size: 0.85em;
}
</style>
