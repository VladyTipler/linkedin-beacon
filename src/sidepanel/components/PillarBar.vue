<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { PillarView } from '../lib/ssiView'

defineProps<{ pillar: PillarView }>()

// Animate width from 0 → pct after mount (matches demo bar fill).
const ready = ref(false)
onMounted(() => setTimeout(() => (ready.value = true), 300))
</script>

<template>
  <div class="pillar">
    <div class="ph">
      <span>{{ pillar.label }}</span>
      <span>{{ pillar.score }}</span>
    </div>
    <div class="track">
      <div
        class="fill"
        :style="{ width: ready ? pillar.pct + '%' : '0%', background: pillar.gradient }"
      />
    </div>
  </div>
</template>
