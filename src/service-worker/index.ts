// MV3 service worker: message router + SSI persistence/refresh + autopilot
// gatekeeping (budget/burst/risk) + LLM/content handlers. SRP: wiring only —
// decisions live in the autopilot gatekeeper and the content/LLM handlers; the
// SW never touches the DOM.

import { SsiRepository } from '@lib/storage/SsiRepository'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { SystemClock } from '@/adapters/SystemClock'
import { FetchHttpClient } from '@/adapters/FetchHttpClient'
import * as content from './contentHandlers'
import { ChromeCookieCsrfProvider } from '@/adapters/ChromeCookieCsrfProvider'
import { ChromeAlarmScheduler } from '@/adapters/ChromeAlarmScheduler'
import { randomId } from '@/adapters/randomId'
import { LinkedInSsiApiClient } from '@lib/ssi-api/LinkedInSsiApiClient'
import { RefreshPolicy } from '@lib/refresh/RefreshPolicy'
import { BackgroundRefreshService, type RefreshResult } from '@lib/refresh/BackgroundRefreshService'
import { MathRandomRng } from '@/adapters/MathRandomRng'
import { QuarantineQueue } from '@lib/gate/QuarantineQueue'
import { ChromeWindows } from '@/adapters/ChromeWindows'
import { DailyCeiling } from '@lib/autopilot/DailyCeiling'
import { engagementLimit } from '@lib/autopilot/engagementLimit'
import { decideAutopilotStart, enabledModules, runLoopModules } from '@lib/autopilot/startGate'
import { HumanDelay } from '@lib/engagement/HumanDelay'
import { runConnectStep } from './connectHandlers'
import { runViewStep } from './viewHandlers'
import { loadConnectSettings } from '@lib/connect/settings'
import { peopleSearchUrl } from '@lib/connect/peopleSearchUrl'
import { geoUrnsForRegions } from '@lib/connect/regions'
import { loadContentSettings } from '@lib/content/settings'
import { BurstGuard } from '@lib/autopilot/BurstGuard'
import { RiskAssessor, type RiskMarker } from '@lib/autopilot/RiskAssessor'
import { AutopilotGatekeeper } from '@lib/autopilot/AutopilotGatekeeper'
import { RunReportStore } from '@lib/autopilot/RunReportStore'
import { buildReportModules } from '@lib/autopilot/runOutcomes'
import { resolveDailyBudget } from '@lib/autopilot/resolveDailyBudget'
import { GENERATING_IDEAS, PUBLISHING, SEARCHING_PEOPLE, CONNECTING, VIEWING_PROFILES, SCANNING, COLLECTING_IDEAS } from '@lib/autopilot/statusLabels'
import type {
  AutopilotHost,
  AutopilotState,
  BeaconMessage,
  FeedPost,
  HarvestResult,
  ModuleId,
  ModuleOutcome,
  RunReport,
  StartAutopilotResult,
  StopReason
} from '@lib/types'

const HOUR_MS = 60 * 60 * 1000
const REFRESH_INTERVAL_MS = 24 * HOUR_MS
const REFRESH_ALARM = 'beacon:ssi-refresh'

const store = new ChromeStorageStore()
const clock = new SystemClock()
const repo = new SsiRepository(store)

const refresher = new BackgroundRefreshService({
  policy: new RefreshPolicy(REFRESH_INTERVAL_MS),
  apiClient: new LinkedInSsiApiClient(new FetchHttpClient(), new ChromeCookieCsrfProvider()),
  store,
  clock
})

const quarantine = new QuarantineQueue({
  store,
  clock,
  scheduler: new ChromeAlarmScheduler(),
  newId: randomId
})

// ── Autopilot: the SW is the authoritative gatekeeper. The loop runs in the
// content script; here we own budget/burst/risk state and write run reports. ──
const AUTOPILOT_KEY = 'autopilot:state'
const autopilotRng = new MathRandomRng()
const reportsStore = new RunReportStore(store)
const llmHttp = new FetchHttpClient()
const gatekeeper = new AutopilotGatekeeper({ burst: new BurstGuard(), risk: new RiskAssessor() })
const windows = new ChromeWindows()
let sessionRisk: RiskMarker[] = []

function autopilotState(): Promise<AutopilotState | null> {
  return store.get<AutopilotState>(AUTOPILOT_KEY)
}
function saveAutopilot(s: AutopilotState): Promise<void> {
  return store.set(AUTOPILOT_KEY, s)
}

function dayKey(): string {
  return clock.now().toISOString().slice(0, 10)
}

async function startAutopilot(host: AutopilotHost): Promise<StartAutopilotResult> {
  const existing = await autopilotState()
  const modulesState = await store.get('modules:state')
  // One-button promise: the run only starts if there's an ENABLED+available module.
  // Disabling engagement in «Модули» must stop the launch, not silently keep liking.
  const decision = decideAutopilotStart(modulesState, existing)
  if (!decision.started || existing?.running) return decision
  sessionRisk = []
  let tabId: number | undefined
  let windowId: number | undefined
  if (host === 'window') {
    const w = await windows.createFeedWindow()
    windowId = w.windowId
    tabId = w.tabId
  } else {
    tabId = (await activeLinkedInTab())?.id
  }
  // Carry over today's ceiling AND used so re-running in the same day does NOT
  // re-grant the budget — the cap is genuinely daily (design-spec §5).
  const prev = existing ? { day: existing.day, ceiling: existing.ceiling, used: existing.used } : null
  const base = engagementLimit(modulesState)
  // Computed once; reused across re-inject retries. Comments ride the like pass
  // (engagement on) and are opt-in via content settings — off by default.
  const baseModules = runLoopModules(modulesState)
  const loopModules = {
    ...baseModules,
    comments: baseModules.engagement && (await loadContentSettings(store)).commentsEnabled
  }
  const budget = resolveDailyBudget(prev, dayKey(), new DailyCeiling({ base }).forDay(autopilotRng))
  const state: AutopilotState = {
    running: true,
    host,
    windowId,
    tabId,
    day: budget.day,
    ceiling: budget.ceiling,
    used: budget.used,
    actionTimestamps: [],
    actionsSinceBreak: 0,
    manualStop: false,
    startedAt: clock.now().toISOString()
  }
  await saveAutopilot(state)
  broadcastStatus(state)
  // Kick the loop in the content script. If the script is orphaned (extension
  // reloaded after the tab loaded), re-inject and retry — otherwise START would
  // set running=true with no loop ever running (a silent phantom-running state).
  // The crxjs loader imports the real content module asynchronously, so after a
  // re-inject the onMessage listener isn't up immediately — poll until it answers.
  const startLoop = async (): Promise<boolean> => {
    if (!tabId) return false
    if (await sendRunLoop(tabId, loopModules)) return true
    if (!(await reinjectContentScript(tabId))) return false
    for (let i = 0; i < 10; i++) {
      await sleep(500)
      if (await sendRunLoop(tabId, loopModules)) return true
    }
    return false
  }
  const enabledIds = new Set(enabledModules(modulesState).map((m) => m.id))
  const connectEnabled = enabledIds.has('smart_connect')
  const viewsEnabled = enabledIds.has('profile_views')
  // Persist each module's outcome (count + reason) as it finishes, so the final report can
  // name WHY every module did what it did — a do-nothing run is never silent again.
  const recordOutcome = async (id: ModuleId, outcome: ModuleOutcome) => {
    const s = await autopilotState()
    if (s) { s.moduleOutcomes = { ...s.moduleOutcomes, [id]: outcome }; await saveAutopilot(s) }
  }
  // True while the run is live. STOP_AUTOPILOT flips state.running=false; launch + the
  // per-candidate loops poll this so a stop actually interrupts (not just the content loop).
  const isRunning = async (): Promise<boolean> => (await autopilotState())?.running === true
  // Inverse of isRunning — true when the run was STOPPED. Passed to the per-candidate
  // loops as `cancelled` so they abort on STOP. (Inverting isRunning here, NOT in the
  // loop, keeps the ConnectDeps contract honest: `cancelled` = "the run was stopped".)
  const isCancelled = async (): Promise<boolean> => !(await isRunning())
  const clearActivity = () => {
    if (tabId) chrome.tabs.sendMessage(tabId, { type: 'SET_ACTIVITY', active: false }).catch(() => {})
  }
  const launch = async () => {
    try {
      // Kill any ORPHAN content-script loop left over from a previous run. If the user
      // reloaded the extension but did NOT F5 the LinkedIn tab, the old content script
      // (and its still-running loop) is alive — its AUTOPILOT_ENDED would flip running=false
      // mid-step and cancel this run. Stop it before any step runs.
      if (tabId) {
        await chrome.tabs.sendMessage(tabId, { type: 'STOP_AUTOPILOT' }).catch(() => {})
        await sleep(300)
      }
      // Engagement runs in the content-script loop; seed its reason now, reconcile the count at stop.
      await recordOutcome('engagement', { executed: 0, reason: enabledIds.has('engagement') ? 'done' : 'disabled' })
      // Each step checks isRunning() before starting — a STOP during the previous step must
      // NOT let the next step run (that was the "переход в ленту после стопа" bug).
      if (tabId && viewsEnabled && await isRunning()) {
        try { await recordOutcome('profile_views', await runViewsThen(tabId, isCancelled)) }
        catch { await recordOutcome('profile_views', { executed: 0, reason: 'error' }) }
      } else {
        await recordOutcome('profile_views', { executed: 0, reason: 'disabled' })
      }
      if (tabId && connectEnabled && await isRunning()) {
        try { await recordOutcome('smart_connect', await runConnectsThen(tabId, 'https://www.linkedin.com/feed/', isCancelled)) }
        catch { await recordOutcome('smart_connect', { executed: 0, reason: 'error' }) }
      } else {
        await recordOutcome('smart_connect', { executed: 0, reason: 'disabled' })
      }
      if (tabId && await isRunning()) {
        // publishApprovedDrafts self-reports 'disabled' when content is off, so always call it.
        try { await recordOutcome('content', await publishApprovedThen(tabId)) }
        catch { await recordOutcome('content', { executed: 0, reason: 'error' }) }
      }
      // Don't kick the engagement loop if the user stopped — would relaunch liking after a stop.
      // Also don't start a do-nothing loop: if neither likes nor ideas are enabled, there is
      // nothing for the loop to do (it would just scroll the feed in circles until feed_exhausted).
      const loopHasWork = loopModules.engagement || loopModules.content
      if (loopHasWork && await isRunning()) {
        setStage(tabId, loopModules.engagement ? SCANNING : COLLECTING_IDEAS)
        if (await startLoop()) return
      }
      // Stopped mid-launch OR couldn't reach the page — roll back so the UI shows no phantom "running".
      const s = await autopilotState()
      if (s?.running) {
        s.running = false
        await saveAutopilot(s)
        broadcastStatus(s)
      }
    } finally {
      // ALWAYS drop the on-page "agent is working" overlay — a stop or a launch failure must
      // never leave the border/pill stuck on (the user reloads the extension to escape it today).
      clearActivity()
    }
  }
  // A freshly-created window needs a moment to load the content script.
  if (host === 'window') setTimeout(() => void launch(), 4000)
  else void launch()
  return decision
}

/** Send AUTOPILOT_RUN_LOOP to a tab; true if the content script answered. */
async function sendRunLoop(
  tabId: number,
  modules: { engagement: boolean; content: boolean; comments: boolean }
): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'AUTOPILOT_RUN_LOOP', modules })
    return true
  } catch {
    return false
  }
}

async function stopAutopilot(reason: StopReason): Promise<void> {
  const s = await autopilotState()
  if (!s || !s.running) return // single-report guard: first stop wins
  s.running = false
  await saveAutopilot(s)
  if (s.tabId) chrome.tabs.sendMessage(s.tabId, { type: 'STOP_AUTOPILOT' }).catch(() => {})
  // Reconcile engagement's executed from the live like counter; every touched module
  // (incl. 0-executed ones) keeps its reason so the report explains a do-nothing run.
  const outcomes: Partial<Record<ModuleId, ModuleOutcome>> = { ...s.moduleOutcomes }
  outcomes.engagement = { executed: s.used, reason: outcomes.engagement?.reason ?? (s.used > 0 ? 'done' : 'disabled') }
  const report: RunReport = {
    id: randomId(),
    startedAt: s.startedAt,
    endedAt: clock.now().toISOString(),
    host: s.host,
    stopReason: reason,
    modules: buildReportModules(outcomes)
  }
  await reportsStore.add(report)
  broadcast({ type: 'AUTOPILOT_REPORT', report })
  broadcastStatus(s, reason)
}

function broadcastStatus(s: AutopilotState, stopReason?: StopReason): void {
  broadcast({
    type: 'AUTOPILOT_STATUS',
    status: { running: s.running, used: s.used, ceiling: s.ceiling, stopReason }
  })
}

async function handleRefresh(result: RefreshResult): Promise<void> {
  if (result.status !== 'refreshed') return
  await repo.save(result.snapshot)
  broadcast({ type: 'SSI_SNAPSHOT', payload: result.snapshot })
}

// ── Lifecycle. ──
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 6 * 60 })
  void refresher.refreshIfDue().then(handleRefresh)
})

chrome.runtime.onStartup.addListener(() => {
  void refresher.refreshIfDue().then(handleRefresh)
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) {
    void refresher.refreshIfDue().then(handleRefresh)
  }
  // QUARANTINE_ALARM_PREFIX branch removed with the campaign orchestrator.
  // Phase-1 quarantine is list/cancel only; execution will be re-wired in Phase 2.
})

// The user closed the autopilot worker window → finalize the run.
chrome.windows.onRemoved.addListener((closedId) => {
  void autopilotState().then((s) => {
    if (s?.running && s.host === 'window' && s.windowId === closedId) void stopAutopilot('manual')
  })
})

// ── Message routing. ──
chrome.runtime.onMessage.addListener((message: BeaconMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'SSI_SNAPSHOT':
      void repo.save(message.payload).then(() => {
        broadcast(message)
        sendResponse({ ok: true })
      })
      return true

    case 'REQUEST_SSI':
      void forwardToLinkedInTab(message)
      return false

    case 'REQUEST_REFRESH':
      void refresher.refreshIfDue().then(handleRefresh)
      return false

    case 'FORCE_REFRESH':
      void refresher.refreshNow().then(handleRefresh)
      return false

    case 'LIST_MODELS':
      void content.listModels(llmHttp, message.provider, message.apiKey).then(sendResponse)
      return true

    case 'GENERATE_DRAFT':
      void content.generateDraft({ store, http: llmHttp, clock, newId: randomId }, message.idea).then(sendResponse)
      return true

    case 'GENERATE_IDEAS':
      void withPageActivity(
        () => content.generateIdeas({ store, http: llmHttp, harvest: harvestPosts }),
        GENERATING_IDEAS
      ).then(sendResponse)
      return true

    case 'EXTRACT_RUN_IDEAS':
      void withPageActivity(
        () => content.extractRunIdeas({ store, http: llmHttp, clock }, message.posts),
        GENERATING_IDEAS
      ).then(sendResponse)
      return true

    case 'COMMENT_ON_POST':
      void content.commentOnPost({ store, http: llmHttp, clock }, message.post).then(sendResponse)
      return true

    case 'LIST_QUARANTINE':
      void quarantine.list().then(sendResponse)
      return true

    case 'CANCEL_QUARANTINE':
      void quarantine.cancel(message.id).then((ok) => sendResponse({ ok }))
      return true

    case 'START_AUTOPILOT':
      void startAutopilot(message.host).then(sendResponse)
      return true

    case 'STOP_AUTOPILOT':
      // Respond when stopped so the side panel can await + retry on a cold/evicted SW
      // (a fire-and-forget STOP is silently lost when the SW was evicted on idle).
      void stopAutopilot('manual').then(() => sendResponse({ ok: true }))
      return true // async sendResponse

    case 'AUTOPILOT_RISK':
      sessionRisk.push(message.marker)
      return false

    case 'AUTOPILOT_ENDED':
      void stopAutopilot(message.reason)
      return false

    case 'AUTOPILOT_MAY_ACT': {
      void (async () => {
        const s = await autopilotState()
        if (!s || !s.running) {
          sendResponse({ action: 'stop', reason: 'manual' })
          return
        }
        const decision = gatekeeper.decide({
          used: s.used,
          ceiling: s.ceiling,
          manualStop: s.manualStop,
          risk: sessionRisk,
          actionTimestamps: s.actionTimestamps,
          now: clock.now().getTime()
        })
        if (decision.action === 'stop') void stopAutopilot(decision.reason)
        sendResponse(decision)
      })()
      return true // async sendResponse
    }

    case 'AUTOPILOT_ACTED':
      void (async () => {
        if (!message.ok) return
        const s = await autopilotState()
        if (!s || !s.running) return
        s.used += 1
        s.actionTimestamps = [...s.actionTimestamps, clock.now().getTime()].slice(-20)
        await saveAutopilot(s)
        broadcastStatus(s)
      })()
      return false

    case 'LIST_REPORTS':
      void reportsStore.list().then(sendResponse)
      return true

    case 'PING':
      sendResponse({ type: 'PONG' })
      return false

    default:
      return false
  }
})

/**
 * Run a page-touching operation while the LinkedIn tab shows the "agent is
 * working" border (lit at the start, cleared in a finally so an error never
 * leaves it stuck on). The autopilot loop manages its own border locally.
 */
async function withPageActivity<T>(op: () => Promise<T>, label: string): Promise<T> {
  void forwardToLinkedInTab({ type: 'SET_ACTIVITY', active: true, label })
  try {
    return await op()
  } finally {
    void forwardToLinkedInTab({ type: 'SET_ACTIVITY', active: false })
  }
}

async function harvestPosts(limit: number): Promise<FeedPost[]> {
  return (await sendToLinkedInTab<FeedPost[]>({ type: 'REQUEST_FEED_POSTS', limit })) ?? []
}

function broadcast(message: BeaconMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {})
}

/**
 * Set the current run step BOTH on the page (overlay/border) AND in the side panel
 * (Dash "Автопилот работает… <stage>"). The panel can't see the content-script overlay,
 * so without this broadcast the Dash shows a stale "на ленте" while the bot is connecting.
 */
function setStage(tabId: number | undefined, label: string): void {
  if (tabId) chrome.tabs.sendMessage(tabId, { type: 'SET_ACTIVITY', active: true, label }).catch(() => {})
  broadcast({ type: 'AUTOPILOT_STAGE', label })
}

async function forwardToLinkedInTab(message: BeaconMessage): Promise<void> {
  const tab = await activeLinkedInTab()
  if (tab?.id) chrome.tabs.sendMessage(tab.id, message).catch(() => {})
}

async function sendToLinkedInTab<T>(message: BeaconMessage): Promise<T | undefined> {
  const tab = await activeLinkedInTab()
  if (!tab?.id) return undefined
  try {
    return (await chrome.tabs.sendMessage(tab.id, message)) as T
  } catch {
    // The content script may be missing (extension reloaded after the tab loaded).
    // Re-inject it (path read from the live manifest so it survives hashing), retry once.
    if (!(await reinjectContentScript(tab.id))) return undefined
    try {
      return (await chrome.tabs.sendMessage(tab.id, message)) as T
    } catch {
      return undefined
    }
  }
}

/**
 * Navigate the LinkedIn tab and wait until the NEW page is actually loaded + its content
 * script answers. Waiting for PING alone races: during the transition the OLD page's
 * content script answers immediately, so a harvest sent then hits a context that's about
 * to be destroyed → "message channel closed" → empty harvest. So gate on the tab being
 * `status:'complete'` on the target URL FIRST, then confirm the (new) content script pings.
 */
async function navigateLinkedInTab(tabId: number, url: string): Promise<boolean> {
  await chrome.tabs.update(tabId, { url })
  const target = url.split('?')[0]
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    if (!tab || tab.status !== 'complete' || !(tab.url ?? '').startsWith(target)) continue
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'PING' }).catch(() => null)
    if (pong) return true
  }
  return false // never confirmed loaded — caller reports nav_failed, not a silent empty harvest
}

/** Run the Profile Views step against `tabId`, return the tab to the feed, report outcome. */
async function runViewsThen(tabId: number, cancelled: () => Promise<boolean>): Promise<ModuleOutcome> {
  const rng = new MathRandomRng()
  const pacer = new HumanDelay(rng)
  const settings = await loadConnectSettings(store)
  if (!settings.searchKeywords.trim()) return { executed: 0, reason: 'no_keywords' }
  const searchUrl = peopleSearchUrl(settings.searchKeywords, geoUrnsForRegions(settings.targetRegions))
  const setActivity = (label: string) => setStage(tabId, label)
  const res = await runViewStep({
    store, clock, rng, searchUrl,
    navigate: async (url) => {
      const ok = await navigateLinkedInTab(tabId, url)
      await setActivity(VIEWING_PROFILES) // re-assert overlay (nav destroys the content script)
      return ok
    },
    // Per-page harvest of ALL people (incl. already-invited Pending) — Views must visit anyone,
    // not just connectable, or it goes blind once the search pool is mostly invited. runViewStep
    // walks pages until it has `cap` FRESH profiles, driving pagination with the seen-set in hand.
    harvestPage: () => harvestProfilesPageFrom(tabId),
    nextPage: () => nextPeoplePageFrom(tabId),
    dwell: async () =>
      chrome.tabs.sendMessage(tabId, { type: 'DWELL_PROFILE' }).catch(() => undefined),
    pace: () => contentSleep(tabId, pacer.nextMs(8000, 30000)),
    cancelled
  })
  await navigateLinkedInTab(tabId, 'https://www.linkedin.com/feed/')
  return { executed: res.executed, reason: res.reason }
}

/** Harvest ONE search page of CONNECTABLE people (Smart Connect) — invite anchors only. */
async function harvestPeoplePageFrom(tabId: number): Promise<HarvestResult> {
  const r = await chrome.tabs.sendMessage(tabId, { type: 'HARVEST_PEOPLE_PAGE' }).catch(() => null)
  return (r as HarvestResult | null) ?? { candidates: [], outcome: 'not_ready' }
}

/** Harvest ONE search page of ALL people incl. already-Pending (Profile Views — visits anyone). */
async function harvestProfilesPageFrom(tabId: number): Promise<HarvestResult> {
  const r = await chrome.tabs.sendMessage(tabId, { type: 'HARVEST_PROFILES_PAGE' }).catch(() => null)
  return (r as HarvestResult | null) ?? { candidates: [], outcome: 'not_ready' }
}

/** Advance the people-search one page; false if there is no next page (or content unreachable). */
async function nextPeoplePageFrom(tabId: number): Promise<boolean> {
  const r = await chrome.tabs.sendMessage(tabId, { type: 'PEOPLE_NEXT_PAGE' }).catch(() => false)
  return r === true
}

/** Run the Smart Connect step against `tabId`, return the tab to the feed, report outcome. */
async function runConnectsThen(tabId: number, afterUrl: string, cancelled: () => Promise<boolean>): Promise<ModuleOutcome> {
  const rng = new MathRandomRng()
  const pacer = new HumanDelay(rng)
  const setActivity = (label: string) => setStage(tabId, label)
  const res = await runConnectStep({
    store, clock, rng,
    navigate: async (url) => {
      const ok = await navigateLinkedInTab(tabId, url)
      // Each navigation destroys the content script + its overlay/pill — re-assert it
      // on the freshly-loaded page so the "agent is working" UI stays consistent.
      await setActivity(SEARCHING_PEOPLE)
      return ok
    },
    harvest: () => harvestPeoplePageFrom(tabId),
    nextPage: () => nextPeoplePageFrom(tabId),
    connect: async (c) => {
      await setActivity(CONNECTING)
      return chrome.tabs
        .sendMessage(tabId, {
          type: 'EXECUTE_ACTION',
          action: { type: 'connect', target: { url: c.profileUrl, meta: { memberId: c.memberId, name: c.name } } }
        })
        .catch(() => undefined)
    },
    pace: () => contentSleep(tabId, pacer.nextMs(8000, 30000)),
    cancelled
  })
  await navigateLinkedInTab(tabId, afterUrl)
  return { executed: res.executed, reason: res.reason }
}

/**
 * Sleep INSIDE the content script (not the SW). The SW `await`s the sendResponse, which
 * keeps the MV3 service worker alive — a long setTimeout in the SW itself gets evicted
 * mid-pause, killing the connect/views loop (the "завис на добавлении" + lost-STOP bug).
 */
async function contentSleep(tabId: number, ms: number): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: 'SLEEP', ms }).catch(() => {})
}

/**
 * Auto-publish step: publish ONE oldest approved draft if today∈publishDays and the
 * weekly cap has room. `prepare` (navigate to feed + ready-gate + activity) runs ONLY
 * when about to publish — same nav race as Smart Connect, so reuse navigateLinkedInTab's
 * status:complete + url gate, never a bare ping. Returns posts published (0 or 1).
 *
 * Invariant #2 waiver (deliberate, matches `runConnectsThen`): this step runs BEFORE the
 * engagement loop, so it does NOT pass through the run-time gate (RiskAssessor / BurstGuard /
 * quarantine / AUTOPILOT_MAY_ACT). The substitute gate for this irreversible public action is:
 * an explicit per-post human «Одобрить» + publishDays + the weekly postsPerWeek cap + one/run.
 */
async function publishApprovedThen(tabId: number): Promise<ModuleOutcome> {
  const res = await content.publishApprovedDrafts({
    store,
    clock,
    prepare: async () => {
      await navigateLinkedInTab(tabId, 'https://www.linkedin.com/feed/')
      setStage(tabId, PUBLISHING)
    },
    publish: (text) =>
      chrome.tabs
        .sendMessage(tabId, {
          type: 'EXECUTE_ACTION',
          action: { type: 'post', target: { url: 'https://www.linkedin.com/feed/' }, payload: { post: text } }
        })
        .catch(() => undefined)
  })
  return { executed: res.published, reason: res.reason ?? 'done' }
}

async function reinjectContentScript(tabId: number): Promise<boolean> {
  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js
  if (!files?.length) return false
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files })
    return true
  } catch {
    return false
  }
}

// Find a LinkedIn tab by URL (preferring the feed). More robust than querying
// the active tab of the current window, which is flaky when invoked from the SW
// in response to a side-panel click.
async function activeLinkedInTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' })
  return tabs.find((t) => (t.url ?? '').includes('/feed')) ?? tabs[0]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
