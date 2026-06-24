import { ref, computed } from 'vue'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { loadLlmConfig, saveLlmConfig, type LlmConfig } from '@lib/llm/config'
import type { LlmModel } from '@lib/llm/models'
import { panelBus } from '../lib/panelBus'

/** Settings-screen state for the BYOK LLM config + the searchable model catalog. */
export function useLlmSettings() {
  const store = new ChromeStorageStore()
  const config = ref<LlmConfig>({ provider: 'openrouter', apiKey: '' })
  const models = ref<LlmModel[]>([])
  const modelQuery = ref('')
  const keyValid = ref<boolean | null>(null)
  const loading = ref(false)

  const filteredModels = computed(() => {
    const q = modelQuery.value.trim().toLowerCase()
    if (!q) return models.value
    return models.value.filter(
      (m) => m.id.toLowerCase().includes(q) || (m.label ?? '').toLowerCase().includes(q)
    )
  })

  async function load() {
    config.value = await loadLlmConfig(store)
  }

  async function save() {
    await saveLlmConfig(store, { ...config.value })
  }

  async function fetchModels() {
    loading.value = true
    const list = await panelBus.request<LlmModel[]>({
      type: 'LIST_MODELS',
      provider: config.value.provider,
      apiKey: config.value.apiKey
    })
    loading.value = false
    if (list && list.length) {
      models.value = list
      keyValid.value = true
    } else {
      keyValid.value = false
    }
  }

  return { config, models, modelQuery, filteredModels, keyValid, loading, load, save, fetchModels }
}
