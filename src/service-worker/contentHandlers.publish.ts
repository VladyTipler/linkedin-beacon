// Post-publishing SW handlers. All deps injected → unit-testable with fakes.
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
import { pickOldestApproved } from '@lib/content/publishPolicy'
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

  const now = deps.clock.now()
  const drafts = new DraftStore(deps.store)
  const [{ publishDays, postsPerWeek }, rawBudget, all] = await Promise.all([
    loadContentSettings(deps.store),
    deps.store.get<PostWeek>(POST_WEEK_BUDGET_KEY),
    drafts.all()
  ])
  const budget = rolloverPostWeek(rawBudget ?? null, isoWeekKey(now))
  const draft = pickOldestApproved(all)

  // Granular gate so a no-publish run names its reason in the report (never silent):
  // not_publish_day | weekly_cap | no_approved_draft. Precedence is "most global first".
  if (!publishDays.includes(now.getDay())) return { published: 0, reason: 'not_publish_day' }
  if (remainingPosts(budget, postsPerWeek) <= 0) return { published: 0, reason: 'weekly_cap' }
  if (!draft) return { published: 0, reason: 'no_approved_draft' }

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
  return { published: 1, reason: 'done' }
}
