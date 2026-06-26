// SW-side Profile Views orchestration. Deps injected → unit-testable with fakes.
import type { KeyValueStore, Clock, Rng } from '@lib/ports'
import type { ModuleState, PersonCandidate } from '@lib/types'
import { asArray } from '@lib/engagement/settings'
import { selectCandidates } from '@lib/connect/selectCandidates'
import {
  VIEW_DAY_BUDGET_KEY, VIEW_SEEN_KEY, rolloverViewDay, recordViewDay,
  remainingDailyViews, viewsPerDay, viewRunCap
} from '@lib/views/ViewDayBudget'
import { VIEW_HISTORY_KEY, appendViewHistory, type ViewRecord } from '@lib/views/ViewHistory'

export interface ViewDeps {
  store: KeyValueStore
  clock: Clock
  rng: Rng
  searchUrl: string
  navigate: (url: string) => Promise<void>
  harvest: () => Promise<PersonCandidate[]>
  dwell: () => Promise<{ ok: boolean } | undefined>
  pace: () => Promise<void>
}

export interface ViewStepResult {
  executed: number
  skipped: number
  reason?: string
}

function dayKey(clock: Clock): string {
  return clock.now().toISOString().slice(0, 10)
}

export async function runViewStep(deps: ViewDeps): Promise<ViewStepResult> {
  const modulesState = await deps.store.get('modules:state')
  const mod = asArray<ModuleState>(modulesState).find((m) => m?.id === 'profile_views')
  if (!mod?.enabled) return { executed: 0, skipped: 0, reason: 'disabled' }

  const dailyLimit = viewsPerDay(modulesState)
  const day = rolloverViewDay(await deps.store.get(VIEW_DAY_BUDGET_KEY), dayKey(deps.clock))
  const remaining = remainingDailyViews(day, dailyLimit)
  const cap = viewRunCap(remaining, dailyLimit, deps.rng)
  if (cap <= 0) return { executed: 0, skipped: 0, reason: 'budget' }

  await deps.navigate(deps.searchUrl)
  const harvested = await deps.harvest()
  const seen = new Set(asArray<string>(await deps.store.get(VIEW_SEEN_KEY)))
  const selected = selectCandidates(harvested, seen, cap)

  const records: ViewRecord[] = []
  for (const c of selected) {
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
    await deps.store.set(VIEW_HISTORY_KEY, appendViewHistory(await deps.store.get(VIEW_HISTORY_KEY), records))
    await deps.store.set(VIEW_SEEN_KEY, [...seen].slice(-5000))
    await deps.store.set(VIEW_DAY_BUDGET_KEY, recordViewDay(day, records.length))
  }
  return { executed: records.length, skipped: selected.length - records.length }
}
