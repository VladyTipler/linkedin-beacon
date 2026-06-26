// SW-side Smart Connect orchestration. Deps injected → unit-testable with fakes.
import type { Clock, KeyValueStore, Rng } from '@lib/ports'
import type { PersonCandidate } from '@lib/types'
import { asArray } from '@lib/engagement/settings'
import { enabledModules } from '@lib/autopilot/startGate'
import { peopleSearchUrl } from '@lib/connect/peopleSearchUrl'
import { loadConnectSettings } from '@lib/connect/settings'
import { selectCandidates } from '@lib/connect/selectCandidates'
import {
  isoWeekKey, rolloverConnectWeek, recordConnectWeek, remainingConnects,
  connectsPerWeek, connectRunCap, CONNECT_WEEK_BUDGET_KEY, type ConnectWeek
} from '@lib/connect/ConnectWeekBudget'

export const CONNECT_SENT_KEY = 'connects:sent'

export interface ConnectDeps {
  store: KeyValueStore
  clock: Clock
  rng: Rng
  navigate: (url: string) => Promise<void>
  harvest: () => Promise<PersonCandidate[]>
  connect: (c: PersonCandidate) => Promise<{ ok: boolean; reason?: string } | undefined>
  pace: () => Promise<void>
}

export interface ConnectStepResult {
  executed: number
  skipped: number
  reason?: string
}

/**
 * One Smart Connect pass inside the run: gate on module + weekly budget + keywords,
 * navigate to the people-search, harvest, select (dedup vs sent-set + per-run cap),
 * send bare invites with human pacing, persist the week usage + sent-set.
 */
export async function runConnectStep(deps: ConnectDeps): Promise<ConnectStepResult> {
  const modulesState = await deps.store.get('modules:state')
  if (!enabledModules(modulesState).some((m) => m.id === 'smart_connect')) {
    return { executed: 0, skipped: 0, reason: 'disabled' }
  }
  const perWeek = connectsPerWeek(modulesState)
  const budget = rolloverConnectWeek(
    (await deps.store.get<ConnectWeek>(CONNECT_WEEK_BUDGET_KEY)) ?? null,
    isoWeekKey(deps.clock.now())
  )
  const weeklyRemaining = remainingConnects(budget, perWeek)
  if (weeklyRemaining <= 0) return { executed: 0, skipped: 0, reason: 'budget' }
  const cap = connectRunCap(weeklyRemaining, perWeek, deps.rng)
  if (cap <= 0) return { executed: 0, skipped: 0 }

  const { searchKeywords } = await loadConnectSettings(deps.store)
  if (!searchKeywords.trim()) return { executed: 0, skipped: 0, reason: 'no_keywords' }

  await deps.navigate(peopleSearchUrl(searchKeywords))
  const harvested = await deps.harvest()
  const sent = new Set(asArray<string>(await deps.store.get<string[]>(CONNECT_SENT_KEY)))
  const chosen = selectCandidates(harvested, sent, cap)

  const newlySent: string[] = []
  for (const c of chosen) {
    const res = await deps.connect(c)
    if (res?.ok) newlySent.push(c.memberId)
    await deps.pace()
  }
  if (newlySent.length) {
    await deps.store.set(CONNECT_SENT_KEY, [...sent, ...newlySent])
    await deps.store.set(CONNECT_WEEK_BUDGET_KEY, recordConnectWeek(budget, newlySent.length))
  }
  return { executed: newlySent.length, skipped: harvested.length - newlySent.length }
}
