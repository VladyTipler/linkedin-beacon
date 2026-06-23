<script setup lang="ts">
import { computed } from 'vue'
import type { SsiSnapshot } from '@lib/types'
import type { PillarView } from '../lib/ssiView'
import SsiGauge from '../components/SsiGauge.vue'
import PillarBar from '../components/PillarBar.vue'

const props = defineProps<{
  snapshot: SsiSnapshot
  pillars: PillarView[]
  total: number
  isReal: boolean
  refreshing: boolean
}>()
defineEmits<{ refresh: [] }>()

const chip = computed(() => {
  const parts: string[] = []
  if (props.snapshot.industryRank) parts.push(`${props.snapshot.industryRank} в индустрии`)
  if (props.snapshot.networkRank) parts.push(`${props.snapshot.networkRank} в твоей сети`)
  return parts.join(' · ')
})
</script>

<template>
  <section class="view" id="v-dash">
    <div class="sect-lbl">Social Selling Index</div>
    <div class="ssi">
      <div class="ssi-top">
        <SsiGauge :score="total" />
        <div class="ssi-meta">
          <div class="t">{{ isReal ? 'Твой индекс' : 'Демо-данные · открой /sales/ssi' }}</div>
          <div v-if="!isReal" class="delta">
            ▲ +14 <span style="color:var(--mut);font-weight:500;font-size:12px">за 14 дней</span>
          </div>
          <div v-if="chip" class="chip">{{ chip }}</div>
        </div>
      </div>
      <div class="pillars">
        <PillarBar v-for="p in pillars" :key="p.key" :pillar="p" />
      </div>
    </div>

    <button class="ghost" data-testid="refresh-ssi" :disabled="refreshing" @click="$emit('refresh')">
      {{ refreshing ? 'Считываю /sales/ssi…' : 'Обновить SSI со страницы' }}
    </button>

    <div class="sect-lbl">Эффект на этой неделе</div>
    <div class="mod" style="margin-bottom:0">
      <div class="mod-stats" style="margin-top:0;padding-top:0;border:0">
        <div class="stat"><div class="n lime">7</div><div class="l">входящих от рекрутёров</div></div>
        <div class="stat"><div class="n blue">×3.2</div><div class="l">просмотров профиля</div></div>
        <div class="stat"><div class="n warm">41%</div><div class="l">accept rate коннектов</div></div>
      </div>
    </div>

    <div class="sect-lbl">Цель недели</div>
    <div class="banner">🎯 Поднять <b>«Построение связей»</b> до 18/25 — это самый слабый столб. Beacon добавит +30 целевых коннектов с рекрутёрами в безопасном темпе и усилит вовлечённость в их постах.</div>
  </section>
</template>
