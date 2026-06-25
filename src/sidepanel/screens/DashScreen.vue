<script setup lang="ts">
import { computed } from 'vue'
import type { SsiSnapshot } from '@lib/types'
import type { PillarView } from '../lib/ssiView'
import { weeklyGoal } from '@lib/ssi/weeklyGoal'
import SsiGauge from '../components/SsiGauge.vue'
import PillarBar from '../components/PillarBar.vue'

const props = defineProps<{
  snapshot: SsiSnapshot
  pillars: PillarView[]
  total: number
  isReal: boolean
  refreshing: boolean
  autopilotRunning?: boolean
  startHint?: string | null
}>()
defineEmits<{
  refresh: []
  startAutopilot: [host: 'tab' | 'window']
  stopAutopilot: []
}>()

const chip = computed(() => {
  const parts: string[] = []
  if (props.snapshot.industryRank) parts.push(`${props.snapshot.industryRank} в индустрии`)
  if (props.snapshot.networkRank) parts.push(`${props.snapshot.networkRank} в твоей сети`)
  return parts.join(' · ')
})

// Week's focus: the weakest SSI pillar + the module that raises it (pure, no LLM).
const goal = computed(() => weeklyGoal(props.snapshot.pillars))
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

    <div class="sect-lbl">Автопилот</div>
    <div v-if="autopilotRunning" class="banner" style="margin-bottom:10px;border-color:rgba(196,255,77,.3)" data-testid="ap-running">
      ● Автопилот работает… <span style="color:var(--mut)">статус — на ленте</span>
    </div>
    <div v-else class="banner" style="margin-bottom:10px">
      🪟 Лайкает ленту до дневного бюджета сам. Запусти в этой вкладке или в <b>окне-воркере</b> (на второй монитор — фоновые вкладки троттлятся).
    </div>
    <div v-if="!autopilotRunning" class="lvl" style="margin-bottom:10px">
      <button data-testid="ap-tab" @click="$emit('startAutopilot', 'tab')">В этой вкладке</button>
      <button data-testid="ap-window" @click="$emit('startAutopilot', 'window')">В окне-воркере</button>
    </div>
    <div
      v-if="!autopilotRunning && startHint"
      class="banner"
      style="margin-bottom:10px;border-color:rgba(255,176,32,.35)"
      data-testid="ap-no-modules"
    >
      ⚠ {{ startHint }}
    </div>
    <button v-else class="ghost" data-testid="ap-stop" @click="$emit('stopAutopilot')">Стоп автопилота</button>

    <div class="sect-lbl">Цель недели</div>
    <div v-if="goal" class="banner" data-testid="weekly-goal">
      🎯 {{ goal.message }} Цель — поднять до <b>{{ goal.target }}/25</b>.
    </div>

    <div class="sect-lbl">Эффект на этой неделе</div>
    <div class="banner" style="color:var(--mut)">
      Метрики входящих, просмотров и accept-rate появятся вместе с модулями «Входящие» и Smart Connect — без выдуманных цифр.
    </div>
  </section>
</template>
