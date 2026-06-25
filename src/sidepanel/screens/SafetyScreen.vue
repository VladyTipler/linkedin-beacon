<script setup lang="ts">
import type { ActionQueueItem } from '@lib/types'

withDefaults(defineProps<{ quarantined?: ActionQueueItem[] }>(), { quarantined: () => [] })
defineEmits<{ pauseAll: []; cancel: [id: string] }>()

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

    <button class="ghost" data-testid="pause-all" @click="$emit('pauseAll')">Пауза всех модулей</button>
    <div class="foot">Beacon · V1 standalone<br>SSI Growth Engine</div>
  </section>
</template>
