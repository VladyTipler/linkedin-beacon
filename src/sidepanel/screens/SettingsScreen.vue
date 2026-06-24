<script setup lang="ts">
import { onMounted } from 'vue'
import { useLlmSettings } from '../composables/useLlmSettings'
import { useExpertiseSettings } from '../composables/useExpertiseSettings'

const { config, modelQuery, filteredModels, keyValid, loading, load, save, fetchModels } = useLlmSettings()
onMounted(load)

const exp = useExpertiseSettings()
onMounted(exp.load)

async function onSave() {
  await save()
  await exp.save()
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

    <label class="fld" v-if="filteredModels.length">
      <span class="k">Модель</span>
      <input v-model="modelQuery" placeholder="поиск модели…" data-testid="model-search" />
      <select v-model="config.model" data-testid="model-select" size="6">
        <option v-for="m in filteredModels" :key="m.id" :value="m.id">{{ m.label ?? m.id }}</option>
      </select>
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

    <button class="btn primary" data-testid="llm-save" @click="onSave">Сохранить</button>
  </section>
</template>
