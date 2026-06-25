<script setup lang="ts">
import { computed } from 'vue'
import type { ModuleId, ModuleState } from '@lib/types'
import ModuleCard from '../components/ModuleCard.vue'
import EngagementSettingsForm from '../components/EngagementSettingsForm.vue'
import { useEngagementStats } from '../composables/useEngagementStats'

defineProps<{ modules: ModuleState[] }>()
defineEmits<{ toggle: [id: ModuleId]; setLimit: [id: ModuleId, n: number] }>()

const byId = (modules: ModuleState[], id: ModuleId) => modules.find((m) => m.id === id)!

// Real, live engagement counters (not the demo hardcodes).
const { likes, comments, ceiling } = useEngagementStats()
const barWidth = computed(() =>
  ceiling.value > 0 ? `${Math.min(100, Math.round((likes.value / ceiling.value) * 100))}%` : '0%'
)
</script>

<template>
  <section class="view" id="v-auto">
    <div class="sect-lbl">Модули автоматизации</div>

    <ModuleCard
      :module="byId(modules, 'engagement')"
      title="Вовлечённость в ленте"
      desc="Умные лайки + AI-комментарии к постам твоей ЦА и рекрутёров"
      limit-label="Лайков/день"
      recommended="рек. 30–40"
      @toggle="$emit('toggle', 'engagement')"
      @set-limit="(n) => $emit('setLimit', 'engagement', n)"
    >
      <template #icon>
        <svg viewBox="0 0 24 24" fill="none"><path d="M7 10v10M2 12.5C2 11 3 10 4.5 10H7l1.5-6c.3-1.2 1.5-1.8 2.6-1.3.8.4 1.2 1.3 1 2.2L11 9h6.5c1.6 0 2.8 1.5 2.4 3l-1.6 7c-.3 1.2-1.3 2-2.5 2H7" stroke="#c4ff4d" stroke-width="1.8" stroke-linejoin="round" /></svg>
      </template>
      <div class="mod-stats">
        <div class="stat"><div class="n lime" data-testid="stat-likes">{{ likes }}</div><div class="l">лайков сегодня</div></div>
        <div class="stat"><div class="n lime" data-testid="stat-comments">{{ comments }}</div><div class="l">комментов</div></div>
        <div class="stat"><div class="n">{{ Math.max(0, ceiling - likes) }}</div><div class="l">осталось</div></div>
      </div>
      <div class="limitbar"><div class="lh"><span>Дневной лимит вовлечённости</span><span class="mono">{{ likes }}/{{ ceiling || '—' }}</span></div><div class="track"><div class="fill" :style="{ width: barWidth, background: 'linear-gradient(90deg,#c4ff4d,#8fbb2e)' }"></div></div></div>
      <EngagementSettingsForm />
    </ModuleCard>

    <ModuleCard
      :module="byId(modules, 'smart_connect')"
      title="Smart Connect — рекрутёры"
      desc="Таргет по роли/гео/стеку + персональный Note к каждому"
      limit-label="Коннектов/неделю"
      recommended="рек. 60–80"
      @toggle="$emit('toggle', 'smart_connect')"
      @set-limit="(n) => $emit('setLimit', 'smart_connect', n)"
    >
      <template #icon>
        <svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.2" stroke="#c4ff4d" stroke-width="1.8" /><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="#c4ff4d" stroke-width="1.8" stroke-linecap="round" /><path d="M18 7v6M21 10h-6" stroke="#c4ff4d" stroke-width="1.8" stroke-linecap="round" /></svg>
      </template>
      <div class="mod-stats">
        <div class="stat"><div class="n blue">12</div><div class="l">запросов сегодня</div></div>
        <div class="stat"><div class="n lime">41%</div><div class="l">принято</div></div>
        <div class="stat"><div class="n">186</div><div class="l">в воронке</div></div>
      </div>
      <div class="note">
        <div class="lbl">AI-сгенерированный Note · рекрутёр</div>
        Привет, <b>Anna</b>! Вижу, ты нанимаешь Senior Frontend в <b>finance-tech</b>. 11 лет на Vue/TS, последний год строю AI-native инструменты. Буду рад быть на связи 🙌
      </div>
      <div class="limitbar"><div class="lh"><span>Connect-запросы · неделя</span><span class="mono">38/80</span></div><div class="track"><div class="fill" style="width:47%;background:linear-gradient(90deg,#4d9fff,#3a7fd0)"></div></div></div>
    </ModuleCard>

    <ModuleCard
      :module="byId(modules, 'content')"
      title="Контент — идеи из ленты"
      desc="Пока автопилот листает ленту, собирает идеи для постов с привязкой к реальному поводу · черновик по клику"
      limit-label="Идей/день"
      recommended="рек. 3–6"
      @toggle="$emit('toggle', 'content')"
      @set-limit="(n) => $emit('setLimit', 'content', n)"
    >
      <template #icon>
        <svg viewBox="0 0 24 24" fill="none"><path d="M5 3h10l4 4v14H5z" stroke="#c4ff4d" stroke-width="1.8" stroke-linejoin="round" /><path d="M14 3v5h5M8.5 13h7M8.5 16.5h5" stroke="#c4ff4d" stroke-width="1.8" stroke-linecap="round" /></svg>
      </template>
      <div class="note" style="border-style:dashed">
        <div class="lbl">Как работает</div>
        Включи модуль и запусти автопилот на Dash — идеи появятся во вкладке «Контент». Публикация постов — отдельно, позже.
      </div>
    </ModuleCard>

    <ModuleCard
      :module="byId(modules, 'auto_apply')"
      title="Авто-отклики"
      desc="Easy Apply + cover letter (свой движок или через Job Radar)"
      @toggle="$emit('toggle', 'auto_apply')"
    >
      <template #icon>
        <svg viewBox="0 0 24 24" fill="none"><path d="M4 7l8-4 8 4-8 4z" stroke="#ff8a5c" stroke-width="1.8" stroke-linejoin="round" /><path d="M4 7v6l8 4 8-4V7M9 14v4" stroke="#ff8a5c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </template>
      <div class="note" style="border-style:dashed">
        <div class="lbl">Статус</div>
        Появится после ядра V1. Решение об интеграции с <b>Job Radar</b> отложено — от ядра не зависит.
      </div>
    </ModuleCard>
  </section>
</template>
