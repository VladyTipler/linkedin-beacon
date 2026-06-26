<script setup lang="ts">
import { useProfileAudit } from '../composables/useProfileAudit'

const emit = defineEmits<{ (e: 'back'): void }>()
const { audit, refresh } = useProfileAudit()
</script>

<template>
  <section v-if="audit" class="view" id="v-profile">
    <button class="ghost" @click="emit('back')">← Назад</button>

    <div class="sect-lbl">Аудит профиля · {{ audit.completeness }}%</div>

    <div class="banner">
      Официальный All-Star: <b>{{ audit.officialDone }}/{{ audit.officialTotal }}</b>.
      Растит пиллар «Бренд». Потолок SSI на free-аккаунте ~75
      (Sales Navigator не нужен).
    </div>

    <div class="sect-lbl">Официальные (All-Star) — обязательны</div>
    <div data-testid="audit-official">
      <div
        v-for="i in audit.items.filter((x) => x.tier === 'official')"
        :key="i.key"
        class="note"
      >
        <span>{{ i.done ? '✅' : '⬜' }} {{ i.label }}</span>
        <a v-if="!i.done" :href="i.editUrl" target="_blank" rel="noopener" style="display:block;margin-top:5px;font-size:11px;color:var(--lime-dim)">{{ i.hint }}</a>
      </div>
    </div>

    <div class="sect-lbl">Усиление (best-practice — не официальный SSI-фактор)</div>
    <div data-testid="audit-boost">
      <div
        v-for="i in audit.items.filter((x) => x.tier === 'best-practice')"
        :key="i.key"
        class="note"
      >
        <span>{{ i.done ? '✅' : '⬜' }} {{ i.label }}</span>
        <a v-if="!i.done" :href="i.editUrl" target="_blank" rel="noopener" style="display:block;margin-top:5px;font-size:11px;color:var(--lime-dim)">{{ i.hint }}</a>
      </div>
    </div>

    <button class="ghost" style="margin-top:16px" @click="refresh">Обновить</button>
  </section>
  <section v-else class="view">
    <div class="banner" style="color:var(--mut)">Загрузка аудита…</div>
  </section>
</template>
