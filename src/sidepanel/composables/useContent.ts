import { ref } from 'vue'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { IdeaBank } from '@lib/ideas/IdeaBank'
import { DraftStore } from '@lib/content/DraftStore'
import { loadContentSettings } from '@lib/content/settings'
import {
  remainingPosts,
  rolloverPostWeek,
  isoWeekKey,
  POST_WEEK_BUDGET_KEY,
  type PostWeek
} from '@lib/content/PostWeekBudget'
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
  const publishing = ref<string | null>(null)
  const postsLeft = ref(0)

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

  /** Remaining publishes this ISO-week, against the configured weekly cap. */
  async function loadPostBudget() {
    const [{ postsPerWeek }, rawBudget] = await Promise.all([
      loadContentSettings(store),
      store.get<PostWeek>(POST_WEEK_BUDGET_KEY)
    ])
    const budget = rolloverPostWeek(rawBudget ?? null, isoWeekKey(new Date()))
    postsLeft.value = remainingPosts(budget, postsPerWeek)
  }

  /** Approve-first publish: SW gates the week cap + drives the composer adapter. */
  async function publishDraft(id: string) {
    publishing.value = id
    error.value = null
    const res = await panelBus.request<{ ok: boolean; reason?: string }>({ type: 'PUBLISH_POST', draftId: id })
    publishing.value = null
    if (!res?.ok) {
      error.value = res?.reason ?? 'publish_failed'
      return
    }
    await Promise.all([loadDrafts(), loadPostBudget()])
  }

  return {
    tab, ideas, drafts: draftList, generating, error, publishing, postsLeft,
    loadIdeas, generateIdeas, removeIdea,
    loadDrafts, toDraft, removeDraft, updateDraft, publishDraft, loadPostBudget
  }
}
