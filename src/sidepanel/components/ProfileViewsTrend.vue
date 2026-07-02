<script setup lang="ts">
import { computed } from 'vue'
import type { ProfileViewsSnapshot } from '@lib/types'
import { computeViewsProgress } from '@lib/profileViews/profileViewsProgress'
// Generic trend-view helpers (shared with SsiTrend).
import { sparklinePoints, deltaArrow, deltaLabel } from '../lib/ssiTrendView'

const props = defineProps<{ history: ProfileViewsSnapshot[] }>()

const W = 240
const H = 30

const progress = computed(() => computeViewsProgress(props.history))

// Auto-scale the sparkline to the data (views have no fixed ceiling like SSI's 25).
const points = computed(() =>
  sparklinePoints(progress.value.values, W, H, Math.max(...progress.value.values, 1))
)

const arrow = computed(() => deltaArrow(progress.value.countDelta))
const deltaTxt = computed(() => deltaLabel(progress.value.countDelta))
// Honesty: this is a ROLLING window — a dip is often just old views ageing out,
// not a real decline. So growth reads positive, but a drop stays NEUTRAL (never
// an alarming red), unlike SSI where down genuinely means the score fell.
const deltaCls = computed(() => (progress.value.countDelta > 0 ? 'up' : 'flat'))

const days = (d: number) => `${d} ${d < 5 ? 'дня' : 'дней'}`
const spanLabel = computed(() => {
  const d = progress.value.spanDays
  if (d <= 0) return 'сегодня'
  if (d === 1) return 'за 1 день'
  return `за ${days(d)}`
})
const windowLabel = computed(() => `за ${days(progress.value.windowDays)}`)
</script>

<template>
  <div class="pv" data-testid="pv-trend">
    <div class="pv-head">
      <div class="pv-count">
        <span class="pv-num" data-testid="pv-count">{{ progress.countTo }}</span>
        <span class="pv-unit">просмотров профиля · {{ windowLabel }}</span>
      </div>
      <div
        v-if="progress.hasBaseline"
        class="delta"
        :class="deltaCls"
        data-testid="pv-delta"
      >
        {{ arrow }} {{ deltaTxt }}
        <span class="span">{{ spanLabel }}</span>
      </div>
    </div>

    <!-- Trend needs ≥2 daily snapshots; the count above is useful from day one. -->
    <svg
      v-if="progress.hasBaseline"
      class="spark"
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="none"
      aria-hidden="true"
      data-testid="pv-spark"
    >
      <polyline
        :points="points"
        stroke="#4d9fff"
        fill="none"
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
    <div v-else class="pv-hint" data-testid="pv-hint">
      Динамика появится, когда накопится <b>2 дня</b> данных.
    </div>

    <div class="pv-cap">кто смотрел ваш профиль · скользящее окно</div>
  </div>
</template>

<style scoped>
.pv {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px 15px;
  margin-bottom: 18px;
  background: linear-gradient(160deg, #16203a, #0f1728);
}
.pv-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.pv-count {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.pv-num {
  font-family: 'Spline Sans Mono', monospace;
  font-size: 26px;
  font-weight: 700;
  color: var(--txt);
}
.pv-unit {
  font-size: 11px;
  color: var(--mut);
}
.delta {
  font-family: 'Spline Sans Mono', monospace;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.2;
}
.delta .span {
  font-size: 10px;
  font-weight: 500;
  color: var(--dim);
}
/* Growth = positive accent; a rolling-window dip stays neutral, never alarming. */
.up { color: var(--blue, #4d9fff); }
.flat { color: var(--mut); }
.spark {
  width: 100%;
  height: 30px;
  display: block;
}
.pv-hint {
  font-size: 11px;
  color: var(--mut);
  line-height: 1.5;
}
.pv-cap {
  margin-top: 8px;
  font-size: 10px;
  color: var(--dim);
}
</style>
