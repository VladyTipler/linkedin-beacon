<script setup lang="ts">
defineEmits<{ runCampaign: []; pauseAll: [] }>()
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

    <div class="sect-lbl">Автономный режим</div>
    <div class="banner" style="margin-bottom:0">🪟 Полностью автоматический режим работает в <b>выделенном окне-воркере</b> (можно вынести на второй монитор). Фоновые вкладки троттлятся браузером — отдельное окно держит сессию «видимой» и автоматизацию живой.</div>

    <button class="cta" data-testid="run-campaign" @click="$emit('runCampaign')">Запустить сегодняшнюю кампанию</button>
    <button class="ghost" data-testid="pause-all" @click="$emit('pauseAll')">Пауза всех модулей</button>
    <div class="foot">Beacon · V1 standalone<br>SSI Growth Engine</div>
  </section>
</template>
