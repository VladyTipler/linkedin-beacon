<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import type { ModuleId, ModuleState } from '@lib/types'
import ModuleCard from '../components/ModuleCard.vue'
import EngagementSettingsForm from '../components/EngagementSettingsForm.vue'
import { useEngagementStats } from '../composables/useEngagementStats'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { loadConnectSettings, saveConnectSettings, defaultConnectKeywords, DEFAULT_TARGET_REGIONS } from '@lib/connect/settings'
import { REGION_KEYS } from '@lib/connect/regions'
import { loadSettings } from '@lib/engagement/settings'
import { panelBus } from '../lib/panelBus'

defineProps<{ modules: ModuleState[] }>()
defineEmits<{ toggle: [id: ModuleId]; setLimit: [id: ModuleId, n: number] }>()

const byId = (modules: ModuleState[], id: ModuleId) => modules.find((m) => m.id === id)!

// Real, live engagement counters (not the demo hardcodes).
const { likes, comments, ceiling } = useEngagementStats()
const barWidth = computed(() =>
  ceiling.value > 0 ? `${Math.min(100, Math.round((likes.value / ceiling.value) * 100))}%` : '0%'
)

const connectKeywords = ref('')
const connectRegions = ref<string[]>([...DEFAULT_TARGET_REGIONS])
const REGION_LABEL: Record<string, string> = {
  US: '🇺🇸 США', Canada: '🇨🇦 Канада', UAE: '🇦🇪 ОАЭ', Europe: '🇪🇺 Европа', Asia: '🌏 Азия'
}
const regionLabel = (r: string) => REGION_LABEL[r] ?? r
const store = new ChromeStorageStore()
onMounted(async () => {
  if (!panelBus.available()) return
  const s = await loadConnectSettings(store)
  connectRegions.value = s.targetRegions
  if (s.searchKeywords.trim()) { connectKeywords.value = s.searchKeywords; return }
  const { expertise } = await loadSettings(store)
  connectKeywords.value = defaultConnectKeywords(expertise)
})
const connectSaved = ref(false)
function saveConnect() {
  // Persist a PLAIN array — chrome.storage serialises a Vue reactive array as an
  // array-like object {0:..,1:..}, which reads back non-array (regions then dropped).
  if (panelBus.available()) {
    void saveConnectSettings(store, { searchKeywords: connectKeywords.value, targetRegions: [...connectRegions.value] })
    connectSaved.value = true
    setTimeout(() => { connectSaved.value = false }, 1500)
  }
}
function toggleRegion(r: string) {
  const i = connectRegions.value.indexOf(r)
  if (i >= 0) connectRegions.value.splice(i, 1)
  else connectRegions.value.push(r)
  saveConnect()
}
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
      desc="Поиск рекрутёров и ЦА по ключевым словам в выбранных регионах · обычный коннект-запрос"
      limit-label="Коннектов/неделю"
      recommended="рек. ~100"
      @toggle="$emit('toggle', 'smart_connect')"
      @set-limit="(n) => $emit('setLimit', 'smart_connect', n)"
    >
      <template #icon>
        <svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.2" stroke="#c4ff4d" stroke-width="1.8" /><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="#c4ff4d" stroke-width="1.8" stroke-linecap="round" /><path d="M18 7v6M21 10h-6" stroke="#c4ff4d" stroke-width="1.8" stroke-linecap="round" /></svg>
      </template>
      <div class="note" style="border-style:dashed">
        <div class="lbl">Как работает</div>
        Задай «Кого искать» и регионы, запусти автопилот на Dash — бот находит людей и шлёт коннект-запросы в безопасном недельном/дневном лимите. Без персональной ноты (обычный инвайт).
      </div>
      <label class="fld">
        <span class="k">Кого искать <span v-if="connectSaved" class="v ok" data-testid="connect-saved">сохранено ✓</span></span>
        <input v-model="connectKeywords" @change="saveConnect" placeholder="frontend recruiter" />
      </label>
      <label class="fld">
        <span class="k">Регионы <span v-if="connectSaved" class="v ok">сохранено ✓</span></span>
        <div class="regions">
          <label v-for="r in REGION_KEYS" :key="r" class="region-chip" :class="{ on: connectRegions.includes(r) }">
            <input type="checkbox" :checked="connectRegions.includes(r)" @change="toggleRegion(r)" />
            <span>{{ regionLabel(r) }}</span>
          </label>
        </div>
      </label>
    </ModuleCard>

    <ModuleCard
      :module="byId(modules, 'profile_views')"
      title="Просмотр профилей — People"
      desc="Заходит на профили целевой ЦА из поиска (растит пиллар «Нужные люди»). Самое безопасное действие."
      limit-label="Профилей/день"
      recommended="рек. ~40"
      @toggle="$emit('toggle', 'profile_views')"
      @set-limit="(n) => $emit('setLimit', 'profile_views', n)"
    >
      <template #icon>👀</template>
      <div class="note" style="border-style:dashed">
        <div class="lbl">Как работает</div>
        Использует таргет Smart Connect («Кого искать» + регионы). Просмотр — read-only, без инвайта.
        Потолок SSI на free-аккаунте ~75 (Sales Navigator не нужен).
      </div>
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
  </section>
</template>

<style scoped>
.regions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.region-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  opacity: 0.75;
  transition: all 0.12s ease;
}
.region-chip.on {
  border-color: #4d9fff;
  background: rgba(77, 159, 255, 0.14);
  opacity: 1;
}
.region-chip input {
  display: none;
}
</style>
