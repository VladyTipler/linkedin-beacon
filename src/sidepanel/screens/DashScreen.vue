<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SsiSnapshot } from '@lib/types'
import type { PillarView } from '../lib/ssiView'
import { weeklyGoal } from '@lib/ssi/weeklyGoal'
import { windowedDelta } from '@lib/ssi/ssiProgress'
import { deltaArrow, deltaLabel } from '../lib/ssiTrendView'
import SsiGauge from '../components/SsiGauge.vue'
import PillarBar from '../components/PillarBar.vue'
import SsiTrend from '../components/SsiTrend.vue'
import { useDayStats } from '../composables/useDayStats'

const props = defineProps<{
  snapshot: SsiSnapshot
  pillars: PillarView[]
  total: number
  history: SsiSnapshot[]
  isReal: boolean
  refreshing: boolean
  autopilotRunning?: boolean
  /** Live run step label ("Добавляю в сеть…") — broadcast by the SW. */
  autopilotStage?: string | null
  startHint?: string | null
}>()

// Today's action tally — refreshed live as the run progresses.
const { stats } = useDayStats()
const tally = computed(() => [
  { label: 'Просмотрено', value: stats.value.views },
  { label: 'Коннектов', value: stats.value.connects },
  { label: 'Лайков', value: stats.value.likes },
  { label: 'Комментариев', value: stats.value.comments },
  { label: 'Идей', value: stats.value.ideas },
  { label: 'Постов', value: stats.value.posts }
])
const emit = defineEmits<{
  refresh: []
  startAutopilot: []
  stopAutopilot: []
  pauseAll: []
  openAudit: []
}>()

// Profile Audit ships on DEMO data only — the real profile reader (voyager API / DOM,
// with an honest "couldn't check" state) is a focused follow-up. Hide the entry until
// it lands so no half-feature is exposed. Flip to true when the real reader ships.
const AUDIT_ENTRY_ENABLED = false

// One launch button that flips Запустить ↔ Остановить. `pending` gives the click an
// immediate state until the SW status (autopilotRunning) catches up.
const pending = ref(false)
watch(() => props.autopilotRunning, () => { pending.value = false })
function onLaunch() {
  if (pending.value) return
  pending.value = true
  if (props.autopilotRunning) emit('stopAutopilot')
  else emit('startAutopilot')
}

const chip = computed(() => {
  const parts: string[] = []
  if (props.snapshot.industryRank) parts.push(`${props.snapshot.industryRank} в индустрии`)
  if (props.snapshot.networkRank) parts.push(`${props.snapshot.networkRank} в твоей сети`)
  return parts.join(' · ')
})

// Week's focus: the weakest SSI pillar + the module that raises it (pure, no LLM).
const goal = computed(() => weeklyGoal(props.snapshot.pillars))

// Real 14-day delta next to the gauge — null (hidden) until ≥2 days of snapshots,
// so we never show an invented number.
const recentDelta = computed(() => windowedDelta(props.history, 14))
const recentSpan = computed(() => {
  const d = recentDelta.value?.days ?? 0
  return d === 1 ? 'за 1 день' : `за ${d} ${d < 5 ? 'дня' : 'дней'}`
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
          <div
            v-if="recentDelta"
            class="delta"
            :class="{ down: recentDelta.delta < 0, flat: recentDelta.delta === 0 }"
            data-testid="gauge-delta"
          >
            {{ deltaArrow(recentDelta.delta) }} {{ deltaLabel(recentDelta.delta) }}
            <span style="color:var(--mut);font-weight:500;font-size:12px">{{ recentSpan }}</span>
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

    <div class="sect-lbl">Динамика SSI</div>
    <SsiTrend :history="history" />

    <div class="sect-lbl">Автопилот · сегодня</div>
    <div class="ap-live" :class="{ idle: !autopilotRunning }" data-testid="ap-running">
      <div class="ap-stage">
        <span class="ap-dot" :class="{ off: !autopilotRunning }" aria-hidden="true"></span>
        <span class="ap-stage-lbl">{{ autopilotRunning ? (autopilotStage || 'Запускаюсь…') : 'Не запущен' }}</span>
      </div>
      <div class="ap-tally">
        <div v-for="m in tally" :key="m.label" class="ap-metric" :class="{ zero: m.value === 0 }">
          <span class="ap-num">{{ m.value }}</span>
          <span class="ap-mlbl">{{ m.label }}</span>
        </div>
      </div>
    </div>
    <div v-if="!autopilotRunning" class="banner" style="margin-bottom:10px">
      Один прогон проходит весь цикл по всем <b>включённым и настроенным модулям</b>: ищет людей и шлёт коннекты, листает ленту, ставит лайки и комментарии, публикует одобренные посты — в безопасном темпе, в этой вкладке. Держи вкладку LinkedIn активной (фоновые троттлятся), можно вынести на второй монитор.
    </div>

    <button
      :class="autopilotRunning ? 'btn stop launch' : 'btn primary launch'"
      data-testid="ap-launch"
      :disabled="pending"
      @click="onLaunch"
    >
      {{ pending
        ? (autopilotRunning ? 'Останавливаю…' : 'Запускаю…')
        : (autopilotRunning ? 'Остановить' : 'Запустить') }}
    </button>
    <button class="ghost" data-testid="pause-all" @click="emit('pauseAll')" style="margin-top:8px;width:100%">
      Пауза всех модулей
    </button>

    <div
      v-if="!autopilotRunning && startHint"
      class="banner"
      style="margin-top:10px;border-color:rgba(255,176,32,.35)"
      data-testid="ap-no-modules"
    >
      ⚠ {{ startHint }}
    </div>

    <button v-if="AUDIT_ENTRY_ENABLED" class="ghost" data-testid="open-audit" @click="$emit('openAudit')">📋 Аудит профиля</button>

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

<style scoped>
/* Live run widget: pulsing lime dot = "the bot is alive", mono tally = today's work. */
.ap-live {
  margin-bottom: 10px;
  padding: 11px 12px 9px;
  border: 1px solid rgba(196, 255, 77, 0.3);
  border-radius: 10px;
  background: rgba(196, 255, 77, 0.04);
}
/* Idle (not running): tally is always visible, but the widget reads "at rest" — muted border. */
.ap-live.idle {
  border-color: rgba(130, 148, 184, 0.25);
  background: transparent;
}
.ap-dot.off {
  background: var(--mut);
  box-shadow: none;
  animation: none;
}
.ap-stage {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 9px;
}
.ap-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--lime);
  box-shadow: 0 0 10px rgba(196, 255, 77, 0.8);
  flex-shrink: 0;
  animation: ap-pulse 1.4s ease-in-out infinite;
}
.ap-stage-lbl {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--txt);
}
.ap-tally {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px 6px;
}
.ap-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ap-num {
  font-family: 'Spline Sans Mono', monospace;
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
  color: var(--txt);
}
.ap-mlbl {
  font-size: 10.5px;
  color: var(--mut);
  line-height: 1.2;
}
/* A zero reads quietly — it's not an alarm, just "nothing yet". */
.ap-metric.zero .ap-num {
  color: var(--dim);
}
@keyframes ap-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.82); }
}
@media (prefers-reduced-motion: reduce) {
  .ap-dot { animation: none; }
}
/* Gauge delta colour by direction (default lime = up, from global .delta). */
.ssi-meta .delta.down { color: var(--warm); }
.ssi-meta .delta.flat { color: var(--mut); }
</style>
