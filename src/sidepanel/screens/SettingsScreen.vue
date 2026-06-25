<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useLlmSettings } from '../composables/useLlmSettings'
import { useExpertiseSettings } from '../composables/useExpertiseSettings'
import { useContentSettings } from '../composables/useContentSettings'
import ModelCombobox from '../components/ModelCombobox.vue'

const { config, models, keyValid, loading, load, save, fetchModels } = useLlmSettings()
onMounted(load)

// Picking a model persists immediately so there's no "did it save?" doubt.
const modelSaved = ref(false)
async function onModelPicked() {
  await save()
  modelSaved.value = true
}

const exp = useExpertiseSettings()
onMounted(exp.load)

const content = useContentSettings()
onMounted(content.load)

const saveError = ref(false)

async function onSave() {
  saveError.value = false
  const results = await Promise.allSettled([save(), exp.save(), content.save()])
  saveError.value = results.some((r) => r.status === 'rejected')
}
</script>

<template>
  <section class="view" id="v-settings">
    <div class="sect-lbl">LLM · ключ и модель</div>

    <label class="fld">
      <span class="k">Провайдер</span>
      <select v-model="config.provider" data-testid="llm-provider" @change="config.model = undefined">
        <option value="openrouter">OpenRouter</option>
        <option value="gemini">Google Gemini</option>
      </select>
    </label>

    <label class="fld">
      <span class="k">API-ключ</span>
      <input v-model="config.apiKey" type="password" data-testid="llm-key" placeholder="sk-… / AIza…" />
    </label>

    <button class="btn" :disabled="loading" data-testid="llm-fetch" @click="fetchModels">
      {{ loading ? 'Загрузка…' : 'Загрузить модели' }}
    </button>
    <span v-if="keyValid === true" class="v ok" data-testid="llm-valid">Модели загружены</span>
    <span v-else-if="keyValid === false" class="v" data-testid="llm-invalid">Не удалось загрузить модели — проверь ключ или сеть</span>

    <label class="fld" v-if="models.length">
      <span class="k">Модель</span>
      <ModelCombobox :models="models" v-model="config.model" @update:model-value="onModelPicked" />
      <span v-if="modelSaved && config.model" class="v ok" data-testid="model-saved">
        ✓ Сохранена: {{ config.model }}
      </span>
    </label>

    <div class="sect-lbl">Экспертиза</div>
    <label class="fld">
      <span class="k">Заголовок</span>
      <input v-model="exp.form.value.headline" data-testid="exp-headline" placeholder="Frontend TechLead, 11y Vue/TS" />
    </label>
    <label class="fld">
      <span class="k">Стек (через запятую)</span>
      <input v-model="exp.form.value.stack" data-testid="exp-stack" placeholder="Vue, TypeScript, Nuxt" />
    </label>
    <label class="fld">
      <span class="k">О себе</span>
      <textarea v-model="exp.form.value.bio" rows="3" data-testid="exp-bio" />
    </label>

    <div class="sect-lbl">Промпт генератора постов</div>
    <label class="fld">
      <span class="k">Голос / структура (используется при «В черновик»)</span>
      <textarea v-model="content.prompt.value" rows="6" data-testid="post-prompt" />
    </label>

    <div class="sect-lbl">Авто-комментарии в ленте</div>
    <label class="fld">
      <span class="k">
        <input type="checkbox" v-model="content.commentsEnabled.value" data-testid="comments-enabled" />
        Комментировать релевантные посты сам (full-auto, каждый коммент проходит quality-судью)
      </span>
    </label>
    <label class="fld">
      <span class="k">Комментариев в день (рек. 3–8)</span>
      <input type="number" min="1" v-model.number="content.commentsPerDay.value" data-testid="comments-per-day" />
    </label>
    <label class="fld">
      <span class="k">Тон комментария</span>
      <select v-model="content.commentTone.value" data-testid="comment-tone">
        <option value="expert">Экспертный</option>
        <option value="friendly">Дружелюбный</option>
        <option value="question">Вопрос</option>
      </select>
    </label>

    <button class="btn primary" data-testid="llm-save" @click="onSave">Сохранить</button>
    <span v-if="saveError" class="v" data-testid="save-error">Не удалось сохранить — попробуй ещё раз</span>
  </section>
</template>
