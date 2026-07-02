<script setup lang="ts">
import { computed } from 'vue'
import type { SsiSnapshot, SsiPillarKey } from '@lib/types'
import { computeProgress, pillarSeries } from '@lib/ssi/ssiProgress'
import { sparklinePoints, deltaArrow, deltaLabel } from '../lib/ssiTrendView'

const props = defineProps<{ history: SsiSnapshot[] }>()

// Solid stroke per pillar (base colour of each pillar's dashboard gradient).
const STROKE: Record<SsiPillarKey, string> = {
  brand: '#c4ff4d',
  people: '#4d9fff',
  insights: '#3ddc8a',
  relationships: '#ff8a5c'
}

const W = 120
const H = 26

const progress = computed(() => computeProgress(props.history))
const series = computed(() => pillarSeries(props.history))

// Merge each pillar's baseline→now delta with its sparkline path.
const rows = computed(() =>
  series.value.map((s) => {
    const d = progress.value.pillars.find((p) => p.key === s.key)
    const delta = d?.delta ?? 0
    return {
      key: s.key,
      label: s.label,
      points: sparklinePoints(s.values, W, H, 25),
      stroke: STROKE[s.key],
      delta,
      arrow: deltaArrow(delta),
      label_: deltaLabel(delta),
      cls: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
    }
  })
)

const totalArrow = computed(() => deltaArrow(progress.value.totalDelta))
const totalLabel = computed(() => deltaLabel(progress.value.totalDelta))
const totalCls = computed(() =>
  progress.value.totalDelta > 0 ? 'up' : progress.value.totalDelta < 0 ? 'down' : 'flat'
)
const spanLabel = computed(() => {
  const d = progress.value.spanDays
  if (d <= 0) return 'сегодня'
  if (d === 1) return 'за 1 день'
  return `за ${d} ${d < 5 ? 'дня' : 'дней'}`
})
</script>

<template>
  <!-- Not enough data yet: honest, no invented numbers. -->
  <div v-if="!progress.hasBaseline" class="banner" data-testid="trend-empty" style="color:var(--mut)">
    📈 Динамика появится, когда накопится минимум <b>2 дня</b> данных. Балл снимается раз в сутки — так виден реальный прогресс «как было → как стало».
  </div>

  <div v-else class="trend" data-testid="ssi-trend">
    <!-- Overall: было → стало -->
    <div class="trend-head">
      <div class="wasnow">
        <span class="was" data-testid="trend-from">{{ progress.totalFrom }}</span>
        <span class="arrow">→</span>
        <span class="now" data-testid="trend-to">{{ progress.totalTo }}</span>
      </div>
      <div class="delta" :class="totalCls" data-testid="trend-total-delta">
        {{ totalArrow }} {{ totalLabel }}
        <span class="span">{{ spanLabel }}</span>
      </div>
    </div>

    <!-- Per-pillar sparklines -->
    <div class="rows">
      <div v-for="r in rows" :key="r.key" class="row" :data-testid="`trend-row-${r.key}`">
        <span class="rlbl">{{ r.label }}</span>
        <svg class="spark" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" aria-hidden="true">
          <polyline :points="r.points" :stroke="r.stroke" fill="none" stroke-width="2"
            stroke-linejoin="round" stroke-linecap="round" />
        </svg>
        <span class="rdelta" :class="r.cls">{{ r.arrow }} {{ r.label_ }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trend {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px 15px;
  margin-bottom: 18px;
  background: linear-gradient(160deg, #16203a, #0f1728);
}
.trend-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.wasnow {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-family: 'Spline Sans Mono', monospace;
}
.was {
  font-size: 20px;
  font-weight: 700;
  color: var(--mut);
}
.arrow {
  color: var(--dim);
  font-size: 14px;
}
.now {
  font-size: 26px;
  font-weight: 700;
  color: var(--txt);
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
.up { color: var(--lime); }
.down { color: var(--warm); }
.flat { color: var(--mut); }
.rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: grid;
  grid-template-columns: 92px 1fr 56px;
  align-items: center;
  gap: 10px;
}
.rlbl {
  font-size: 11px;
  color: var(--mut);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spark {
  width: 100%;
  height: 26px;
  display: block;
}
.rdelta {
  font-family: 'Spline Sans Mono', monospace;
  font-size: 11.5px;
  font-weight: 600;
  text-align: right;
}
</style>
