<script setup lang="ts">
import { onMounted } from 'vue'
import { useContent } from '../composables/useContent'

const {
  tab, ideas, drafts, generating, error,
  loadIdeas, generateIdeas, removeIdea, toDraft,
  loadDrafts, removeDraft, updateDraft
} = useContent()

onMounted(async () => {
  await loadIdeas()
  await loadDrafts()
})

const ERR: Record<string, string> = {
  no_key: 'Задай LLM-ключ в настройках (⚙).',
  no_expertise: 'Заполни профиль экспертизы в настройках (⚙).',
  no_feed: 'Открой вкладку ленты LinkedIn.'
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text) } catch { /* clipboard blocked */ }
}
</script>

<template>
  <section class="view" id="v-content">
    <div class="subtabs">
      <button :class="{ on: tab === 'ideas' }" data-testid="subtab-ideas" @click="tab = 'ideas'">Идеи</button>
      <button :class="{ on: tab === 'drafts' }" data-testid="subtab-drafts" @click="tab = 'drafts'">Черновики</button>
    </div>

    <p v-if="error" class="banner">{{ ERR[error] ?? `Ошибка: ${error}` }}</p>

    <!-- IDEAS -->
    <template v-if="tab === 'ideas'">
      <button class="btn primary" :disabled="generating" data-testid="gen-ideas" @click="generateIdeas">
        {{ generating ? 'Генерация…' : 'Сгенерировать идеи' }}
      </button>
      <p v-if="!ideas.length" class="banner">Пока нет идей. Открой ленту и нажми «Сгенерировать».</p>
      <div v-for="(idea, i) in ideas" :key="i" class="note" :data-testid="`idea-${i}`">
        <div class="lbl">{{ idea.topic }}</div>
        {{ idea.angle }}
        <div v-if="idea.spark" class="lbl" style="margin-top:8px;opacity:.75" :data-testid="`spark-${i}`">
          ↳ повод: {{ idea.spark.claim }}<span v-if="idea.spark.source"> · {{ idea.spark.source.author }}</span>
        </div>
        <div class="row">
          <button class="btn" :data-testid="`to-draft-${i}`" @click="toDraft(idea)">В черновик</button>
          <button class="btn" @click="removeIdea(idea)">Удалить</button>
        </div>
      </div>
    </template>

    <!-- DRAFTS -->
    <template v-else>
      <p v-if="!drafts.length" class="banner">Нет черновиков. Сгенерируй пост из идеи.</p>
      <div v-for="d in drafts" :key="d.id" class="note" :data-testid="`draft-${d.id}`">
        <div class="lbl">{{ d.ideaTopic }}</div>
        <textarea :value="d.text" rows="6" @change="updateDraft(d.id, ($event.target as HTMLTextAreaElement).value)" />
        <div class="row">
          <button class="btn" data-testid="copy" @click="copy(d.text)">Копировать</button>
          <button class="btn" @click="toDraft({ topic: d.ideaTopic, angle: d.ideaAngle })">Перегенерировать</button>
          <button class="btn" @click="removeDraft(d.id)">Удалить</button>
        </div>
      </div>
    </template>
  </section>
</template>
