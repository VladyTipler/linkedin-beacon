// MV3 service worker: message router + SSI persistence/refresh + engagement
// orchestration. SRP: wiring only — decisions live in ActionGate, routing in
// EngagementOrchestrator, scoring in RelevanceScorer, DOM mutation in the content
// script. The SW never touches the DOM.

import { SsiRepository } from '@lib/storage/SsiRepository'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { SystemClock } from '@/adapters/SystemClock'
import { FetchHttpClient } from '@/adapters/FetchHttpClient'
import { ChromeCookieCsrfProvider } from '@/adapters/ChromeCookieCsrfProvider'
import { ChromeAlarmScheduler } from '@/adapters/ChromeAlarmScheduler'
import { randomId } from '@/adapters/randomId'
import { LinkedInSsiApiClient } from '@lib/ssi-api/LinkedInSsiApiClient'
import { RefreshPolicy } from '@lib/refresh/RefreshPolicy'
import { BackgroundRefreshService, type RefreshResult } from '@lib/refresh/BackgroundRefreshService'
import { MathRandomRng } from '@/adapters/MathRandomRng'
import { ActionGate } from '@lib/gate/ActionGate'
import { QuarantineQueue } from '@lib/gate/QuarantineQueue'
import { CommentJudge } from '@lib/engagement/CommentJudge'
import { HumanDelay } from '@lib/engagement/HumanDelay'
import { LikeFilter } from '@lib/engagement/LikeFilter'
import {
  EngagementOrchestrator,
  type ActionExecutor
} from '@lib/engagement/EngagementOrchestrator'
import { EngagementRunner } from '@lib/engagement/EngagementRunner'
import { loadSettings } from '@lib/engagement/settings'
import { ChromeWindows } from '@/adapters/ChromeWindows'
import { DailyCeiling } from '@lib/autopilot/DailyCeiling'
import { BurstGuard } from '@lib/autopilot/BurstGuard'
import { RiskAssessor, type RiskMarker } from '@lib/autopilot/RiskAssessor'
import { AutopilotGatekeeper } from '@lib/autopilot/AutopilotGatekeeper'
import { RunReportStore } from '@lib/autopilot/RunReportStore'
import type {
  AutopilotHost,
  AutopilotState,
  BeaconMessage,
  FeedPost,
  RunReport,
  StopReason
} from '@lib/types'

const HOUR_MS = 60 * 60 * 1000
const REFRESH_INTERVAL_MS = 24 * HOUR_MS
const REFRESH_ALARM = 'beacon:ssi-refresh'
const QUARANTINE_ALARM_PREFIX = 'beacon:quarantine:'

const store = new ChromeStorageStore()
const clock = new SystemClock()
const repo = new SsiRepository(store)

const refresher = new BackgroundRefreshService({
  policy: new RefreshPolicy(REFRESH_INTERVAL_MS),
  apiClient: new LinkedInSsiApiClient(new FetchHttpClient(), new ChromeCookieCsrfProvider()),
  store,
  clock
})

// ── Engagement pipeline. Actions execute in the content script via messaging. ──
const tabExecutor: ActionExecutor = {
  async execute(action) {
    const result = await sendToLinkedInTab<{ ok: boolean; reason?: string }>({
      type: 'EXECUTE_ACTION',
      action
    })
    if (!result?.ok) throw new Error(result?.reason ?? 'action_failed')
  }
}

const quarantine = new QuarantineQueue({
  store,
  clock,
  scheduler: new ChromeAlarmScheduler(),
  newId: randomId
})

const orchestrator = new EngagementOrchestrator({
  gate: new ActionGate(),
  judge: new CommentJudge(),
  quarantine,
  store,
  clock,
  executor: tabExecutor,
  newId: randomId
})

// 8–45s random pause between real actions — the anti-ban heartbeat (§5.1).
const humanDelay = new HumanDelay(new MathRandomRng())
const runner = new EngagementRunner({
  harvest: (limit) => harvestPosts(limit),
  likeFilter: new LikeFilter(),
  orchestrator,
  pace: () => sleep(humanDelay.nextMs(8000, 45000))
})

// ── Autopilot: the SW is the authoritative gatekeeper. The loop runs in the
// content script; here we own budget/burst/risk state and write run reports. ──
const AUTOPILOT_KEY = 'autopilot:state'
const autopilotRng = new MathRandomRng()
const reportsStore = new RunReportStore(store)
const gatekeeper = new AutopilotGatekeeper({ burst: new BurstGuard(), risk: new RiskAssessor() })
const dailyCeiling = new DailyCeiling()
const windows = new ChromeWindows()
let sessionRisk: RiskMarker[] = []

function autopilotState(): Promise<AutopilotState | null> {
  return store.get<AutopilotState>(AUTOPILOT_KEY)
}
function saveAutopilot(s: AutopilotState): Promise<void> {
  return store.set(AUTOPILOT_KEY, s)
}

async function startAutopilot(host: AutopilotHost): Promise<void> {
  const existing = await autopilotState()
  if (existing?.running) return
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
  const state: AutopilotState = {
    running: true,
    host,
    windowId,
    tabId,
    ceiling: dailyCeiling.forDay(autopilotRng),
    used: 0,
    actionTimestamps: [],
    actionsSinceBreak: 0,
    manualStop: false,
    startedAt: clock.now().toISOString()
  }
  await saveAutopilot(state)
  broadcastStatus(state)
  // A freshly-created window needs a moment to load the content script.
  const startLoop = () => {
    if (tabId) chrome.tabs.sendMessage(tabId, { type: 'AUTOPILOT_RUN_LOOP' }).catch(() => {})
  }
  if (host === 'window') setTimeout(startLoop, 4000)
  else startLoop()
}

async function stopAutopilot(reason: StopReason): Promise<void> {
  const s = await autopilotState()
  if (!s || !s.running) return // single-report guard: first stop wins
  s.running = false
  await saveAutopilot(s)
  if (s.tabId) chrome.tabs.sendMessage(s.tabId, { type: 'STOP_AUTOPILOT' }).catch(() => {})
  const report: RunReport = {
    id: randomId(),
    startedAt: s.startedAt,
    endedAt: clock.now().toISOString(),
    host: s.host,
    stopReason: reason,
    modules: [{ id: 'engagement', executed: s.used, skipped: 0, failed: 0 }]
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
  } else if (alarm.name.startsWith(QUARANTINE_ALARM_PREFIX)) {
    // A quarantined action's cancel window elapsed — send what's due.
    void orchestrator.releaseDue()
  }
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

    case 'RUN_ENGAGEMENT':
      void runEngagement().then(sendResponse)
      return true // async sendResponse — reliable result delivery to the panel

    case 'LIST_QUARANTINE':
      void quarantine.list().then(sendResponse)
      return true

    case 'CANCEL_QUARANTINE':
      void quarantine.cancel(message.id).then((ok) => sendResponse({ ok }))
      return true

    case 'START_AUTOPILOT':
      void startAutopilot(message.host)
      return false

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

async function runEngagement(): Promise<import('@lib/types').EngagementRunSummary> {
  const settings = await loadSettings(store)
  const summary = await runner.run(settings)
  broadcast({ type: 'ENGAGEMENT_RESULT', summary }) // also notify passive listeners
  return summary
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
