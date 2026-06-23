<script setup lang="ts">
import type { InboundLead } from '@lib/types'

defineProps<{ leads: InboundLead[] }>()

const GRADIENTS = [
  'linear-gradient(135deg,#c4ff4d,#8fbb2e)',
  'linear-gradient(135deg,#4d9fff,#3a7fd0)',
  'linear-gradient(135deg,#ff6b9d,#d04f7c)',
  'linear-gradient(135deg,#3ddc8a,#2bb06f)',
  'linear-gradient(135deg,#ffcc4d,#d0a02e)'
]

const initials = (name: string) =>
  name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()

const tagText = (lead: InboundLead) => {
  if (lead.signal === 'messaged') return 'Написал(а)'
  return lead.count && lead.count > 1 ? `${lead.count}× смотрел(а)` : 'Смотрел(а)'
}
</script>

<template>
  <section class="view" id="v-inbox">
    <div class="sect-lbl">Входящий интерес · цель продукта</div>
    <div class="banner">📈 Главная метрика Beacon — <b>не сколько ты написал, а сколько написали тебе</b>. Чем выше SSI, тем больше рекрутёров приходят сами.</div>
    <div v-for="(lead, i) in leads" :key="lead.id" class="lead">
      <div class="av" :style="{ background: GRADIENTS[i % GRADIENTS.length] }">{{ initials(lead.name) }}</div>
      <div class="info">
        <div class="nm">{{ lead.name }}</div>
        <div class="rl">{{ lead.role }}</div>
      </div>
      <span class="tag" :class="lead.signal === 'messaged' ? 'msg' : 'view'">{{ tagText(lead) }}</span>
    </div>
  </section>
</template>
