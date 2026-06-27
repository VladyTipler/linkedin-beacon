// SW-side Profile Views orchestration. Deps injected → unit-testable with fakes.
import type { KeyValueStore, Clock, Rng } from '@lib/ports'
import type { HarvestResult, ModuleState } from '@lib/types'
import { asArray } from '@lib/engagement/settings'
import { selectCandidates } from '@lib/connect/selectCandidates'
import {
  VIEW_DAY_BUDGET_KEY, VIEW_SEEN_KEY, rolloverViewDay, recordViewDay,
  remainingDailyViews, viewRunCap, DEFAULT_VIEWS_PER_DAY
} from '@lib/views/ViewDayBudget'
import { VIEW_HISTORY_KEY, appendViewHistory, type ViewRecord } from '@lib/views/ViewHistory'

export interface ViewDeps {
  store: KeyValueStore
  clock: Clock
  rng: Rng
  searchUrl: string
  /** Navigate to a URL; resolves true only if the page actually loaded. */
  navigate: (url: string) => Promise<boolean>
  harvest: () => Promise<HarvestResult>
  dwell: () => Promise<{ ok: boolean } | undefined>
  pace: () => Promise<void>
  /** True if the run was stopped (STOP_AUTOPILOT) — the per-profile loop MUST abort. */
  cancelled: () => Promise<boolean>
}

export interface ViewStepResult {
  executed: number
  skipped: number
  /**
   * Why the step did what it did — surfaced in the run report. One of: disabled |
   * budget | nav_failed | empty_search | not_ready | none_fresh | done.
   */
  reason: string
}

function dayKey(clock: Clock): string {
  return clock.now().toISOString().slice(0, 10)
}

export async function runViewStep(deps: ViewDeps): Promise<ViewStepResult> {
  const modulesState = await deps.store.get('modules:state')
  const mod = asArray<ModuleState>(modulesState).find((m) => m?.id === 'profile_views')
  if (!mod?.enabled) return { executed: 0, skipped: 0, reason: 'disabled' }

  const dailyLimit = typeof mod.dailyLimit === 'number' && mod.dailyLimit > 0 ? mod.dailyLimit : DEFAULT_VIEWS_PER_DAY
  const day = rolloverViewDay(await deps.store.get(VIEW_DAY_BUDGET_KEY), dayKey(deps.clock))
  const remaining = remainingDailyViews(day, dailyLimit)
  const cap = viewRunCap(remaining, dailyLimit, deps.rng)
  if (cap <= 0) return { executed: 0, skipped: 0, reason: 'budget' }

  const navOk = await deps.navigate(deps.searchUrl)
  if (!navOk) return { executed: 0, skipped: 0, reason: 'nav_failed' }
  const { candidates: harvested, outcome } = await deps.harvest()
  if (outcome === 'empty') return { executed: 0, skipped: 0, reason: 'empty_search' }
  if (outcome === 'not_ready') return { executed: 0, skipped: 0, reason: 'not_ready' }
  const seen = new Set(asArray<string>(await deps.store.get(VIEW_SEEN_KEY)))
  const selected = selectCandidates(harvested, seen, cap)
  if (selected.length === 0) return { executed: 0, skipped: harvested.length, reason: 'none_fresh' }

  const records: ViewRecord[] = []
  let cancelled = false
  for (const c of selected) {
    // STOP must interrupt a long views pass — without this a stop mid-pass keeps opening +
    // dwelling on every remaining profile, ignoring the user.
    if (await deps.cancelled()) { cancelled = true; break }
    await deps.navigate(c.profileUrl)
    const r = await deps.dwell()
    if (r?.ok) {
      records.push({
        memberId: c.memberId, name: c.name, headline: c.headline,
        profileUrl: c.profileUrl, viewedAt: deps.clock.now().toISOString()
      })
      seen.add(c.memberId)
    }
    await deps.pace()
  }

  if (records.length) {
    const existingHistory = await deps.store.get(VIEW_HISTORY_KEY)
    await Promise.all([
      deps.store.set(VIEW_HISTORY_KEY, appendViewHistory(existingHistory, records)),
      deps.store.set(VIEW_SEEN_KEY, [...seen].slice(-5000)),
      deps.store.set(VIEW_DAY_BUDGET_KEY, recordViewDay(day, records.length))
    ])
  }
  return { executed: records.length, skipped: selected.length - records.length, reason: cancelled ? 'cancelled' : 'done' }
}
