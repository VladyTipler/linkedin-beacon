import { ref } from 'vue'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { loadContentSettings, saveContentSettings } from '@lib/content/settings'
import type { CommentTone } from '@lib/types'

/** Settings-screen state for the post-generator prompt + auto-comment config. */
export function useContentSettings() {
  const store = new ChromeStorageStore()
  const prompt = ref('')
  const commentsEnabled = ref(false)
  const commentsPerDay = ref(5)
  const commentTone = ref<CommentTone>('expert')

  async function load() {
    const s = await loadContentSettings(store)
    prompt.value = s.postPrompt
    commentsEnabled.value = s.commentsEnabled
    commentsPerDay.value = s.commentsPerDay
    commentTone.value = s.commentTone
  }

  async function save() {
    await saveContentSettings(store, {
      postPrompt: prompt.value,
      commentsEnabled: commentsEnabled.value,
      commentsPerDay: commentsPerDay.value,
      commentTone: commentTone.value
    })
  }

  return { prompt, commentsEnabled, commentsPerDay, commentTone, load, save }
}
