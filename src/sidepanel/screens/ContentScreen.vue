<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useContent } from '../composables/useContent'

const {
  tab, ideas, drafts, generating, drafting, approving, savedDraft, error, postsLeft, lastRun,
  loadIdeas, generateIdeas, removeIdea, toDraft, loadLastRun,
  loadDrafts, removeDraft, updateDraft, approveDraft, loadPostBudget
} = useContent()

onMounted(() => Promise.all([loadIdeas(), loadDrafts(), loadPostBudget(), loadLastRun()]))

/** Human-readable status of the last AUTO idea-collect during a run (empty until one runs). */
const lastRunText = computed(() => {
  const r = lastRun.value
  if (!r) return ''
  const t = new Date(r.at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
  if (r.reason === 'ok') return `Последний автосбор: +${r.stored} идей (${t})`
  if (r.reason === 'budget_exhausted') return `Бюджет идей на сегодня исчерпан (${r.budget?.used}/${r.budget?.limit}) — обновится завтра`
  if (r.reason === 'error') return `Ошибка автосбора в прогоне: ${r.error} (${t})`
  if (r.reason === 'no_feed') return `Автосбор: лента пуста на момент прогона (${t})`
  if (r.reason === 'thin_feed') return `Маловато постов для идей в этом прогоне (${r.posts}) — соберётся в следующем (${t})`
  if (r.reason === 'disabled') return `Контент-модуль был выключен в этом прогоне (${t})`
  if (r.reason === 'no_key') return `Автосбор пропущен: не задан LLM-ключ (⚙) (${t})`
  if (r.reason === 'no_expertise') return `Автосбор пропущен: не заполнен профиль экспертизы (⚙) (${t})`
  return `Автосбор: ${r.reason} (${t})`
})

const ERR: Record<string, string> = {
  no_key: 'Задай LLM-ключ в настройках (⚙).',
  no_expertise: 'Заполни профиль экспертизы в настройках (⚙).',
  no_feed: 'Открой вкладку ленты LinkedIn.',
  ideas_not_json:
    'Модель вернула ответ не в том формате. Выбери модель посильнее (⚙) — например openai/gpt-4o-mini или google/gemini-2.5-flash — и попробуй снова.'
}

// Transient per-draft copy feedback so the click lands "Скопировано ✓" on its own button.
const copyState = ref<{ id: string; ok: boolean } | null>(null)
async function copy(id: string, text: string) {
  let ok = true
  try { await navigator.clipboard.writeText(text) } catch { ok = false }
  copyState.value = { id, ok }
  setTimeout(() => { if (copyState.value?.id === id) copyState.value = null }, 1600)
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
      <p v-if="lastRunText" class="lbl" style="opacity:.7" data-testid="ideas-last-run">{{ lastRunText }}</p>
      <p v-if="!ideas.length" class="banner">Пока нет идей. Открой ленту и нажми «Сгенерировать».</p>
      <div v-for="(idea, i) in ideas" :key="i" class="note" :data-testid="`idea-${i}`">
        <div class="lbl">{{ idea.topic }}</div>
        {{ idea.angle }}
        <div v-if="idea.spark" class="lbl" style="margin-top:8px;opacity:.75" :data-testid="`spark-${i}`">
          ↳ повод: {{ idea.spark.claim }}<span v-if="idea.spark.source"> · {{ idea.spark.source.author }}</span>
        </div>
        <div class="row">
          <button class="btn" :data-testid="`to-draft-${i}`" :disabled="drafting === `idea-${i}`"
                  @click="toDraft(idea, `idea-${i}`)">
            {{ drafting === `idea-${i}` ? 'Генерирую…' : 'В черновик' }}
          </button>
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
        <span v-if="savedDraft === d.id" class="v ok" :data-testid="`draft-saved-${d.id}`">сохранено ✓</span>
        <div class="row">
          <span v-if="d.approved" class="lbl" :data-testid="`approved-badge-${d.id}`" style="color: var(--lime)">Одобрено ✓</span>
          <button v-if="!d.approved" class="btn primary" :data-testid="`approve-${d.id}`"
                  :disabled="approving === d.id" @click="approveDraft(d.id, true)">
            {{ approving === d.id ? 'Одобряю…' : 'Одобрить' }}
          </button>
          <button v-else class="btn" :data-testid="`unapprove-${d.id}`"
                  :disabled="approving === d.id" @click="approveDraft(d.id, false)">
            {{ approving === d.id ? 'Отзываю…' : 'Отозвать' }}
          </button>
          <button class="btn" :data-testid="`copy-${d.id}`" @click="copy(d.id, d.text)">
            {{ copyState?.id === d.id ? (copyState.ok ? 'Скопировано ✓' : 'Не вышло') : 'Копировать' }}
          </button>
          <button class="btn" :disabled="drafting === `draft-${d.id}`"
                  @click="toDraft({ topic: d.ideaTopic, angle: d.ideaAngle }, `draft-${d.id}`)">
            {{ drafting === `draft-${d.id}` ? 'Генерирую…' : 'Перегенерировать' }}
          </button>
          <button class="btn" @click="removeDraft(d.id)">Удалить</button>
        </div>
      </div>
    </template>
  </section>
</template>
