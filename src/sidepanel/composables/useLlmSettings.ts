import { ref } from 'vue'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { loadLlmConfig, saveLlmConfig, type LlmConfig } from '@lib/llm/config'
import type { LlmModel } from '@lib/llm/models'
import { panelBus } from '../lib/panelBus'

/** Settings-screen state for the BYOK LLM config + the loaded model catalog. */
export function useLlmSettings() {
  const store = new ChromeStorageStore()
  const config = ref<LlmConfig>({ provider: 'openrouter', apiKey: '' })
  const models = ref<LlmModel[]>([])
  const keyValid = ref<boolean | null>(null)
  const loading = ref(false)

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
    if (list !== null) {
      models.value = list
      keyValid.value = list.length > 0
    } else {
      keyValid.value = false
    }
  }

  return { config, models, keyValid, loading, load, save, fetchModels }
}
