<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'

const props = defineProps<{ score: number }>()

const C = 326.7
const offset = ref(C)
const display = ref(0)
let raf = 0

function animateTo(target: number) {
  const clamped = Math.min(100, Math.max(0, target))
  offset.value = C - (C * clamped) / 100
  cancelAnimationFrame(raf)
  const start = display.value
  const t0 = performance.now()
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / 900)
    display.value = Math.round(start + (clamped - start) * k)
    if (k < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}

onMounted(() => setTimeout(() => animateTo(props.score), 250))
watch(() => props.score, (v) => animateTo(v))
</script>

<template>
  <div class="gauge">
    <svg width="120" height="120" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="52" fill="none" stroke="#0c1322" stroke-width="10" />
      <circle
        cx="60" cy="60" r="52" fill="none" stroke="url(#gg)" stroke-width="10"
        stroke-linecap="round" stroke-dasharray="326.7"
        :stroke-dashoffset="offset"
        style="transition: stroke-dashoffset 1.6s cubic-bezier(.2,.8,.2,1)"
      />
      <defs>
        <linearGradient id="gg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#c4ff4d" />
          <stop offset="1" stop-color="#4d9fff" />
        </linearGradient>
      </defs>
    </svg>
    <div class="val">
      <div class="num" data-testid="gauge-num">{{ display }}</div>
      <div class="of mono">/ 100</div>
    </div>
  </div>
</template>
