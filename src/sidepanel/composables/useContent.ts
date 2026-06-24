import { ref } from 'vue'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { IdeaBank } from '@lib/ideas/IdeaBank'
import { DraftStore } from '@lib/content/DraftStore'
import type { Idea, Draft } from '@lib/types'
import { panelBus } from '../lib/panelBus'

/** Side-panel state for the Content screen: idea bank + draft queue. */
export function useContent() {
  const store = new ChromeStorageStore()
  const bank = new IdeaBank(store)
  const drafts = new DraftStore(store)

  const tab = ref<'ideas' | 'drafts'>('ideas')
  const ideas = ref<Idea[]>([])
  const draftList = ref<Draft[]>([])
  const generating = ref(false)
  const error = ref<string | null>(null)

  async function loadIdeas() {
    ideas.value = await bank.all()
  }

  async function generateIdeas() {
    generating.value = true
    error.value = null
    const res = await panelBus.request<{ ideas: Idea[]; error?: string }>({ type: 'GENERATE_IDEAS' })
    generating.value = false
    if (res?.error) error.value = res.error
    ideas.value = res?.ideas ?? (await bank.all())
  }

  async function removeIdea(idea: Idea) {
    await bank.remove(idea)
    await loadIdeas()
  }

  async function loadDrafts() {
    draftList.value = await drafts.all()
  }

  async function toDraft(idea: Idea) {
    generating.value = true
    error.value = null
    const res = await panelBus.request<{ draft: Draft | null; error?: string }>({ type: 'GENERATE_DRAFT', idea })
    generating.value = false
    if (res?.error) error.value = res.error
    await loadDrafts()
    if (res?.draft) tab.value = 'drafts'
  }

  async function removeDraft(id: string) {
    await drafts.remove(id)
    await loadDrafts()
  }

  async function updateDraft(id: string, text: string) {
    await drafts.update(id, text)
    await loadDrafts()
  }

  return {
    tab, ideas, drafts: draftList, generating, error,
    loadIdeas, generateIdeas, removeIdea,
    loadDrafts, toDraft, removeDraft, updateDraft
  }
}
