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
import { loadContentSettings } from '@lib/content/settings'
import { BurstGuard } from '@lib/autopilot/BurstGuard'
import { RiskAssessor, type RiskMarker } from '@lib/autopilot/RiskAssessor'
import { AutopilotGatekeeper } from '@lib/autopilot/AutopilotGatekeeper'
import { RunReportStore } from '@lib/autopilot/RunReportStore'
import { resolveDailyBudget } from '@lib/autopilot/resolveDailyBudget'
import { GENERATING_IDEAS, PUBLISHING, SEARCHING_PEOPLE, CONNECTING } from '@lib/autopilot/statusLabels'
import type {
  AutopilotHost,
  AutopilotState,
  BeaconMessage,
  FeedPost,
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
  const connectEnabled = enabledModules(modulesState).some((m) => m.id === 'smart_connect')
  const launch = async () => {
    if (tabId && connectEnabled) {
      try {
        const executed = await runConnectsThen(tabId, 'https://www.linkedin.com/feed/')
        const s = await autopilotState()
        if (s) { s.connectsExecuted = executed; await saveAutopilot(s) }
      } catch {
        // Connect step threw (tab gone, storage error, etc.) — fall through to the engagement loop.
      }
    }
    if (tabId) {
      try {
        const published = await publishApprovedThen(tabId)
        if (published) {
          const s = await autopilotState()
          if (s) { s.postsPublished = published; await saveAutopilot(s) }
        }
      } catch {
        // Publish step threw (tab gone, composer error) — fall through to the engagement loop.
      }
    }
    if (await startLoop()) return
    // Couldn't reach the page — roll back so the UI doesn't show a phantom "running".
    const s = await autopilotState()
    if (s) {
      s.running = false
      await saveAutopilot(s)
      broadcastStatus(s)
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
  const modules: RunReport['modules'] = [{ id: 'engagement', executed: s.used, skipped: 0, failed: 0 }]
  if (s.connectsExecuted) {
    modules.push({ id: 'smart_connect', executed: s.connectsExecuted, skipped: 0, failed: 0 })
  }
  if (s.postsPublished) {
    modules.push({ id: 'content', executed: s.postsPublished, skipped: 0, failed: 0 })
  }
  const report: RunReport = {
    id: randomId(),
    startedAt: s.startedAt,
    endedAt: clock.now().toISOString(),
    host: s.host,
    stopReason: reason,
    modules
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
      void stopAutopilot('manual')
      return false

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
async function navigateLinkedInTab(tabId: number, url: string): Promise<void> {
  await chrome.tabs.update(tabId, { url })
  const target = url.split('?')[0]
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    if (!tab || tab.status !== 'complete' || !(tab.url ?? '').startsWith(target)) continue
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'PING' }).catch(() => null)
    if (pong) return
  }
}

/** Run the Smart Connect step against `tabId`, return the tab to the feed, report count sent. */
async function runConnectsThen(tabId: number, afterUrl: string): Promise<number> {
  const rng = new MathRandomRng()
  const pacer = new HumanDelay(rng)
  const setActivity = (label: string) =>
    chrome.tabs.sendMessage(tabId, { type: 'SET_ACTIVITY', active: true, label }).catch(() => {})
  const res = await runConnectStep({
    store, clock, rng,
    navigate: async (url) => {
      await navigateLinkedInTab(tabId, url)
      // Each navigation destroys the content script + its overlay/pill — re-assert it
      // on the freshly-loaded page so the "agent is working" UI stays consistent.
      await setActivity(SEARCHING_PEOPLE)
    },
    harvest: async () =>
      (await chrome.tabs.sendMessage(tabId, { type: 'HARVEST_PEOPLE' }).catch(() => [])) ?? [],
    connect: async (c) => {
      await setActivity(CONNECTING)
      return chrome.tabs
        .sendMessage(tabId, {
          type: 'EXECUTE_ACTION',
          action: { type: 'connect', target: { url: c.profileUrl, meta: { memberId: c.memberId, name: c.name } } }
        })
        .catch(() => undefined)
    },
    pace: () => sleep(pacer.nextMs(8000, 30000))
  })
  await navigateLinkedInTab(tabId, afterUrl)
  return res.executed
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
async function publishApprovedThen(tabId: number): Promise<number> {
  const res = await content.publishApprovedDrafts({
    store,
    clock,
    prepare: async () => {
      await navigateLinkedInTab(tabId, 'https://www.linkedin.com/feed/')
      await chrome.tabs.sendMessage(tabId, { type: 'SET_ACTIVITY', active: true, label: PUBLISHING }).catch(() => {})
    },
    publish: (text) =>
      chrome.tabs
        .sendMessage(tabId, {
          type: 'EXECUTE_ACTION',
          action: { type: 'post', target: { url: 'https://www.linkedin.com/feed/' }, payload: { post: text } }
        })
        .catch(() => undefined)
  })
  return res.published
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
