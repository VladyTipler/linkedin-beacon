import { ref } from 'vue'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { loadContentSettings, saveContentSettings } from '@lib/content/settings'

/** Settings-screen state for the post-generator prompt. */
export function useContentSettings() {
  const store = new ChromeStorageStore()
  const prompt = ref('')

  async function load() {
    prompt.value = (await loadContentSettings(store)).postPrompt
  }

  async function save() {
    await saveContentSettings(store, { postPrompt: prompt.value })
  }

  return { prompt, load, save }
}
