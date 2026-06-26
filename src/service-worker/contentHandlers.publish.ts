// src/service-worker/contentHandlers.publish.ts
// Post-publishing SW handlers, split out of contentHandlers.ts (SRP + ≤300 rule):
// the manual approve-first publish (publishPost) and the auto-publish run step
// (publishApprovedDrafts). Re-exported from contentHandlers.ts so callers/tests
// keep importing from one place. All deps injected → unit-testable with fakes.
import { loadContentSettings } from '@lib/content/settings'
import { DraftStore } from '@lib/content/DraftStore'
import {
  isoWeekKey,
  rolloverPostWeek,
  recordPostWeek,
  remainingPosts,
  POST_WEEK_BUDGET_KEY,
  type PostWeek
} from '@lib/content/PostWeekBudget'
import { shouldPublishToday, pickOldestApproved } from '@lib/content/publishPolicy'
import { enabledModules } from '@lib/autopilot/startGate'
import type { Clock, KeyValueStore } from '@lib/ports'

export interface PublishApprovedDeps {
  store: KeyValueStore
  clock: Clock
  prepare: () => Promise<void>
  publish: (text: string) => Promise<{ ok: boolean; reason?: string } | undefined>
}

/** Auto-publish step: publish ONE oldest approved draft if today∈publishDays AND weekly cap left. */
export async function publishApprovedDrafts(
  deps: PublishApprovedDeps
): Promise<{ published: number; reason?: string }> {
  const modulesState = await deps.store.get('modules:state')
  if (!enabledModules(modulesState).some((m) => m.id === 'content')) return { published: 0, reason: 'disabled' }

  const { publishDays, postsPerWeek } = await loadContentSettings(deps.store)
  const now = deps.clock.now()
  const budget = rolloverPostWeek((await deps.store.get<PostWeek>(POST_WEEK_BUDGET_KEY)) ?? null, isoWeekKey(now))
  const drafts = new DraftStore(deps.store)
  const all = await drafts.all()
  const draft = pickOldestApproved(all)

  const ok = shouldPublishToday({
    weekday: now.getDay(),
    publishDays,
    remainingPosts: remainingPosts(budget, postsPerWeek),
    hasApproved: draft !== null
  })
  if (!ok || !draft) return { published: 0 }

  await deps.prepare()
  const res = await deps.publish(draft.text)
  // UNCERTAIN (undefined): the message channel closed (SW eviction / nav churn) AFTER the
  // post may already have gone live. Treating this like a clean failure would leave the draft
  // approved + the week un-recorded → the next publish-day run re-posts the SAME text =
  // duplicate PUBLIC post + an under-counted cap. So be conservative: un-approve the draft
  // (no blind re-publish; it survives for the human to reconcile against their real feed) and
  // consume the week. Distinct from an explicit {ok:false} where the post genuinely never sent.
  if (res === undefined) {
    await drafts.setApproved(draft.id, false)
    await deps.store.set(POST_WEEK_BUDGET_KEY, recordPostWeek(budget, 1))
    return { published: 1, reason: 'uncertain' }
  }
  if (!res.ok) return { published: 0, reason: res.reason ?? 'publish_failed' }

  await drafts.remove(draft.id)
  await deps.store.set(POST_WEEK_BUDGET_KEY, recordPostWeek(budget, 1))
  return { published: 1 }
}

export interface PublishDeps {
  store: KeyValueStore
  clock: Clock
  /** Sends the text to the content script's composer adapter; undefined if no tab. */
  publish: (text: string) => Promise<{ ok: boolean; reason?: string } | undefined>
}

/**
 * Approve-first publish of ONE draft (Vlad clicked «Опубликовать»). Gated by the
 * weekly post cap (a safety limit on a manual action, NOT an autopilot budget). On a
 * successful DOM publish: consume the draft + record the week. A failed publish keeps
 * the draft and surfaces the reason.
 */
export async function publishPost(
  deps: PublishDeps,
  draftId: string
): Promise<{ ok: boolean; reason?: string }> {
  const drafts = new DraftStore(deps.store)
  const draft = (await drafts.all()).find((d) => d.id === draftId)
  if (!draft) return { ok: false, reason: 'not_found' }

  const [{ postsPerWeek }, rawBudget] = await Promise.all([
    loadContentSettings(deps.store),
    deps.store.get<PostWeek>(POST_WEEK_BUDGET_KEY)
  ])
  const budget = rolloverPostWeek(rawBudget ?? null, isoWeekKey(deps.clock.now()))
  if (remainingPosts(budget, postsPerWeek) <= 0) return { ok: false, reason: 'budget' }

  const res = await deps.publish(draft.text)
  if (!res?.ok) return { ok: false, reason: res?.reason ?? 'publish_failed' }

  await drafts.remove(draftId)
  await deps.store.set(POST_WEEK_BUDGET_KEY, recordPostWeek(budget, 1))
  return { ok: true }
}
