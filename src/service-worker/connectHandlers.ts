// SW-side Smart Connect orchestration. Deps injected → unit-testable with fakes.
import type { Clock, KeyValueStore, Rng } from '@lib/ports'
import type { HarvestResult, PersonCandidate } from '@lib/types'
import { asArray } from '@lib/engagement/settings'
import { enabledModules } from '@lib/autopilot/startGate'
import { peopleSearchUrl } from '@lib/connect/peopleSearchUrl'
// regions.ts (REGION_GEO + geoUrnsForRegions) is intentionally unused here for now:
import { geoUrnsForRegions } from '@lib/connect/regions'
import { loadConnectSettings } from '@lib/connect/settings'
import { selectCandidates } from '@lib/connect/selectCandidates'
import {
  isoWeekKey, rolloverConnectWeek, recordConnectWeek, remainingConnects,
  connectsPerWeek, connectRunCap, CONNECT_WEEK_BUDGET_KEY, type ConnectWeek,
  rolloverConnectDay, recordConnectDay, dailyConnectCap, remainingDailyConnects,
  CONNECT_DAY_BUDGET_KEY, type ConnectDay
} from '@lib/connect/ConnectWeekBudget'
import { CONNECT_HISTORY_KEY, appendConnectHistory, type ConnectRecord } from '@lib/connect/ConnectHistory'

export const CONNECT_SENT_KEY = 'connects:sent'
export const PYMK_URL = 'https://www.linkedin.com/mynetwork/grow/'

export interface ConnectDeps {
  store: KeyValueStore
  clock: Clock
  rng: Rng
  /** Navigate to the people-search; resolves true only if the page actually loaded. */
  navigate: (url: string) => Promise<boolean>
  /** Harvest the CURRENTLY-loaded search page only (NOT paginated) — a candidate's Connect
   * anchor is only in the DOM while its page is loaded, so we must connect per-page. */
  harvest: () => Promise<HarvestResult>
  /** Advance the people-search to the next page; false if there is no next page. */
  nextPage: () => Promise<boolean>
  connect: (c: PersonCandidate) => Promise<{ ok: boolean; reason?: string } | undefined>
  pace: () => Promise<void>
  /** True if the run was stopped (STOP_AUTOPILOT) — the per-candidate loop MUST abort. */
  cancelled: () => Promise<boolean>
}

export interface ConnectStepResult {
  executed: number
  skipped: number
  /**
   * Machine code for WHY the step did what it did — surfaced in the run report so a
   * zero-connect run is never silent. One of: disabled | budget | no_keywords |
   * nav_failed | empty_search | not_ready | pool_pending | none_fresh | cancelled |
   * unreachable | <executeConnect failure> | done.
   */
  reason: string
}

/** Max search pages to walk in one connect pass (safety bound; cap usually stops us first). */
const CONNECT_MAX_PAGES = 5

/**
 * One Smart Connect pass: gate on module + weekly/daily budget + keywords, navigate to the
 * people-search, then PER PAGE harvest → connect its fresh candidates → advance. Connecting
 * per-page is load-bearing: a candidate's Connect `<a>` exists in the DOM only while ITS page
 * is loaded, so harvesting across pagination then connecting later misses every anchor that
 * isn't on the current page (the connect_anchor_not_found bug). Persist week + day + sent-set.
 */
export async function runConnectStep(
  deps: ConnectDeps,
  opts: { source?: 'search' | 'pymk' } = {}
): Promise<ConnectStepResult> {
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
  const dayBudget = rolloverConnectDay(
    (await deps.store.get<ConnectDay>(CONNECT_DAY_BUDGET_KEY)) ?? null,
    deps.clock.now().toISOString().slice(0, 10)
  )
  const dailyRemaining = remainingDailyConnects(dayBudget, dailyConnectCap(perWeek))
  const cap = connectRunCap(weeklyRemaining, dailyRemaining, perWeek, deps.rng)
  if (cap <= 0) return { executed: 0, skipped: 0, reason: 'budget' }

  const source = opts.source ?? 'search'
  let url: string
  if (source === 'pymk') {
    url = PYMK_URL // PYMK is keyword-free — LinkedIn curates the list
  } else {
    const { searchKeywords, targetRegions } = await loadConnectSettings(deps.store)
    if (!searchKeywords.trim()) return { executed: 0, skipped: 0, reason: 'no_keywords' }
    url = peopleSearchUrl(searchKeywords, geoUrnsForRegions(targetRegions))
  }
  const navOk = await deps.navigate(url)
  if (!navOk) return { executed: 0, skipped: 0, reason: 'nav_failed' }
  const sent = new Set(asArray<string>(await deps.store.get<string[]>(CONNECT_SENT_KEY)))

  const sentRecords: ConnectRecord[] = []
  let lastFailReason: string | null = null
  let sawUndefined = false
  let cancelled = false
  let sawAnyCandidate = false
  let sawNoneConnectable = false
  for (let page = 0; page < CONNECT_MAX_PAGES; page++) {
    if (await deps.cancelled()) { cancelled = true; break }
    const { candidates, outcome } = await deps.harvest()
    // A dead page ends the walk. On page 0 it's the whole run's reason (empty / never
    // rendered); deeper, just stop paging and keep whatever earlier pages already connected.
    if (outcome === 'empty' || outcome === 'not_ready') {
      if (page === 0) return { executed: 0, skipped: 0, reason: outcome === 'empty' ? 'empty_search' : 'not_ready' }
      break
    }
    // Page rendered but everyone is already Pending/connected — page DEEPER for the sparse
    // still-connectable recruiters instead of bailing (the saturated-pool bug: page 1 is all
    // Pending, so returning here left "connects 0" every run). Views already page like this.
    if (outcome === 'none_connectable') sawNoneConnectable = true
    sawAnyCandidate = sawAnyCandidate || candidates.length > 0
    const fresh = selectCandidates(candidates, sent, cap - sentRecords.length)
    for (const c of fresh) {
      if (await deps.cancelled()) { cancelled = true; break }
      const res = await deps.connect(c)
      if (res?.ok) {
        sentRecords.push({
          memberId: c.memberId, name: c.name, headline: c.headline,
          profileUrl: c.profileUrl, sentAt: deps.clock.now().toISOString()
        })
        sent.add(c.memberId)
      } else if (res === undefined) {
        sawUndefined = true
      } else if (res?.reason) {
        lastFailReason = res.reason
      }
      await deps.pace()
    }
    if (cancelled) break
    if (sentRecords.length >= cap) break
    if (!(await deps.nextPage())) break // no more pages
  }
  if (sentRecords.length) {
    await deps.store.set(CONNECT_SENT_KEY, [...sent])
    await deps.store.set(CONNECT_WEEK_BUDGET_KEY, recordConnectWeek(budget, sentRecords.length))
    await deps.store.set(CONNECT_DAY_BUDGET_KEY, recordConnectDay(dayBudget, sentRecords.length))
    await deps.store.set(CONNECT_HISTORY_KEY, appendConnectHistory(await deps.store.get(CONNECT_HISTORY_KEY), sentRecords))
  }
  // Reason precedence: cancelled → done (≥1 sent) → pool_pending (walked pages, everyone on
  // them already invited/Pending) → empty (never saw a candidate) → a named executeConnect
  // failure → unreachable (no response from content) → none_fresh (all already in the sent-set).
  const reason = cancelled
    ? 'cancelled'
    : sentRecords.length > 0
      ? 'done'
      : sawNoneConnectable
        ? 'pool_pending'
        : !sawAnyCandidate
          ? 'empty_search'
          : lastFailReason ?? (sawUndefined ? 'unreachable' : 'none_fresh')
  return { executed: sentRecords.length, skipped: 0, reason }
}

export interface FallbackDeps extends ConnectDeps {
  /** Scroll-harvest PYMK connectable people (the fallback source). */
  pymkHarvest: () => Promise<HarvestResult>
}

/**
 * Smart Connect with PYMK fallback: run the people-search pass; if it connected NOBODY
 * (any reason except module-off / no-budget), top up the remaining connect budget from
 * PYMK (/mynetwork/). Budget/sent-set/history are shared — the PYMK pass re-reads the
 * (unchanged) budget, so the daily/weekly cap bounds search+PYMK together.
 */
// Search-pass reasons that must NOT fall back to PYMK:
// - disabled/budget: nothing to top up (module off / cap spent).
// - cancelled: STOP means stop — never navigate to /mynetwork/ and act after the user stopped.
// `no_keywords` DOES fall through to PYMK (deliberate — Vlad, 2026-07-14): an enabled Smart
// Connect with no keywords still tops up from LinkedIn's own suggestions (PYMK is keyword-free).
const NO_PYMK_FALLBACK = new Set(['disabled', 'budget', 'cancelled'])

export async function runConnectWithFallback(deps: FallbackDeps): Promise<ConnectStepResult> {
  const search = await runConnectStep(deps)
  if (search.executed > 0 || NO_PYMK_FALLBACK.has(search.reason)) return search

  const pymk = await runConnectStep(
    { ...deps, harvest: deps.pymkHarvest, nextPage: async () => false },
    { source: 'pymk' }
  )
  if (pymk.executed > 0) return { ...pymk, reason: 'done' }
  // PYMK sent nobody. A genuine PYMK FAILURE (nav_failed / unreachable / a named executeConnect
  // failure) must surface honestly — NOT be masked as pymk_dry ("try later"), which would hide a
  // real break (e.g. a PYMK Connect that direct-sends with no modal → send_button_not_found).
  // Only a genuinely-empty PYMK (empty_search / none_fresh) is pymk_dry.
  const pymkGenuinelyDry = pymk.reason === 'empty_search' || pymk.reason === 'none_fresh'
  return { executed: 0, skipped: 0, reason: pymkGenuinelyDry ? 'pymk_dry' : pymk.reason }
}
