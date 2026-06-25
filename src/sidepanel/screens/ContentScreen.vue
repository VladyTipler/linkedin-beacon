<script setup lang="ts">
import { onMounted } from 'vue'
import { useContent } from '../composables/useContent'

const {
  tab, ideas, drafts, generating, error, publishing, postsLeft,
  loadIdeas, generateIdeas, removeIdea, toDraft,
  loadDrafts, removeDraft, updateDraft, publishDraft, loadPostBudget
} = useContent()

onMounted(async () => {
  await loadIdeas()
  await loadDrafts()
  await loadPostBudget()
})

const ERR: Record<string, string> = {
  no_key: 'Задай LLM-ключ в настройках (⚙).',
  no_expertise: 'Заполни профиль экспертизы в настройках (⚙).',
  no_feed: 'Открой вкладку ленты LinkedIn.',
  ideas_not_json:
    'Модель вернула ответ не в том формате. Выбери модель посильнее (⚙) — например openai/gpt-4o-mini или google/gemini-2.5-flash — и попробуй снова.',
  budget: 'Лимит публикаций на эту неделю исчерпан.',
  composer_trigger_not_found: 'Не удалось открыть форму публикации. Открой ленту LinkedIn и попробуй снова.',
  composer_not_found: 'Не удалось открыть форму публикации. Открой ленту LinkedIn и попробуй снова.',
  post_button_disabled: 'Не получилось ввести текст в форму. Попробуй ещё раз.',
  modal_did_not_close: 'Публикация не подтвердилась. Проверь ленту и попробуй ещё раз.'
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
      <p v-if="drafts.length" class="lbl" style="opacity:.7" data-testid="posts-left">
        Осталось публикаций на неделе: {{ postsLeft }}
      </p>
      <div v-for="d in drafts" :key="d.id" class="note" :data-testid="`draft-${d.id}`">
        <div class="lbl">{{ d.ideaTopic }}</div>
        <textarea :value="d.text" rows="6" @change="updateDraft(d.id, ($event.target as HTMLTextAreaElement).value)" />
        <div class="row">
          <button class="btn primary" :disabled="publishing === d.id || postsLeft <= 0"
                  :data-testid="`publish-${d.id}`" @click="publishDraft(d.id)">
            {{ publishing === d.id ? 'Публикую…' : 'Опубликовать' }}
          </button>
          <button class="btn" data-testid="copy" @click="copy(d.text)">Копировать</button>
          <button class="btn" @click="toDraft({ topic: d.ideaTopic, angle: d.ideaAngle })">Перегенерировать</button>
          <button class="btn" @click="removeDraft(d.id)">Удалить</button>
        </div>
      </div>
    </template>
  </section>
</template>
