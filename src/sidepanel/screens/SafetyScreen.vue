<script setup lang="ts">
import type { ActionQueueItem, EngagementRunSummary } from '@lib/types'

withDefaults(
  defineProps<{
    quarantined?: ActionQueueItem[]
    summary?: EngagementRunSummary | null
    autopilotRunning?: boolean
  }>(),
  { quarantined: () => [], summary: null, autopilotRunning: false }
)
defineEmits<{
  runCampaign: []
  pauseAll: []
  cancel: [id: string]
  startAutopilot: [host: 'tab' | 'window']
  stopAutopilot: []
}>()

const authorOf = (item: ActionQueueItem) => String(item.target.meta?.author ?? 'пост')
</script>

<template>
  <section class="view" id="v-set">
    <div class="sect-lbl">Anti-ban · режим невидимки</div>
    <div class="safety">
      <div class="sh">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" stroke="#ff6b9d" stroke-width="1.8" stroke-linejoin="round" /><path d="M9 12l2 2 4-4" stroke="#ff6b9d" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <h3>Защита аккаунта</h3>
      </div>
      <div class="srow"><span class="k">Человеческие задержки</span><span class="v ok">8–45 сек</span></div>
      <div class="srow"><span class="k">Рабочие часы (твой ТЗ)</span><span class="v ok">09:00–19:00</span></div>
      <div class="srow"><span class="k">Warmup новых аккаунтов</span><span class="v ok">Вкл</span></div>
      <div class="srow"><span class="k">Лимит коннектов / неделя</span><span class="v">80 / 100</span></div>
      <div class="srow"><span class="k">Паузы и «выходные»</span><span class="v ok">Авто</span></div>
      <div class="srow"><span class="k">Риск-скоринг сессии</span><span class="v ok">Низкий</span></div>
    </div>
    <div class="banner" style="margin-top:14px">⚠️ LinkedIn агрессивно банит автоматизацию. Beacon работает в твоём реальном браузере, имитирует поведение и держит объёмы ниже порогов — но <b>скорость всегда жертвуется ради безопасности аккаунта</b>.</div>

    <template v-if="quarantined.length">
      <div class="sect-lbl">Карантин · можно отменить</div>
      <div
        v-for="item in quarantined"
        :key="item.id"
        class="note"
        :data-testid="`quarantine-${item.id}`"
      >
        <div class="lbl">{{ item.type === 'comment' ? 'Коммент' : item.type }} · {{ authorOf(item) }} · уйдёт {{ new Date(item.scheduledFor ?? '').toLocaleTimeString() }}</div>
        {{ item.payload?.comment ?? '' }}
        <button class="ghost" style="margin-top:8px" :data-testid="`cancel-${item.id}`" @click="$emit('cancel', item.id)">Отменить</button>
      </div>
    </template>

    <div class="sect-lbl">Автономный режим</div>
    <div class="banner" style="margin-bottom:10px">🪟 Автопилот лайкает ленту до дневного бюджета сам. Запусти в этой вкладке или в <b>выделенном окне-воркере</b> (вынеси на второй монитор — фоновые вкладки троттлятся, отдельное окно держит сессию живой).</div>
    <div v-if="autopilotRunning" class="banner" style="margin-bottom:10px;border-color:rgba(196,255,77,.3)" data-testid="ap-running">
      ● Автопилот работает…
    </div>
    <div class="lvl" style="margin-bottom:10px">
      <button data-testid="ap-tab" @click="$emit('startAutopilot', 'tab')">В этой вкладке</button>
      <button data-testid="ap-window" @click="$emit('startAutopilot', 'window')">В окне-воркере</button>
    </div>
    <button v-if="autopilotRunning" class="ghost" data-testid="ap-stop" @click="$emit('stopAutopilot')">Стоп автопилота</button>

    <div v-if="summary" class="banner" style="margin-top:12px" data-testid="run-summary">
      Прогон: просмотрено <b>{{ summary.scanned }}</b> · релевантных <b>{{ summary.relevant }}</b> · выполнено <b>{{ summary.executed }}</b> · в очереди <b>{{ summary.queued }}</b> · карантин <b>{{ summary.quarantined }}</b>
    </div>

    <button class="cta" data-testid="run-campaign" @click="$emit('runCampaign')">Запустить сегодняшнюю кампанию</button>
    <button class="ghost" data-testid="pause-all" @click="$emit('pauseAll')">Пауза всех модулей</button>
    <div class="foot">Beacon · V1 standalone<br>SSI Growth Engine</div>
  </section>
</template>
