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
import { RelevanceScorer } from '@lib/engagement/RelevanceScorer'
import {
  EngagementOrchestrator,
  type ActionExecutor
} from '@lib/engagement/EngagementOrchestrator'
import { EngagementRunner } from '@lib/engagement/EngagementRunner'
import { loadSettings } from '@lib/engagement/settings'
import type { BeaconMessage, FeedPost } from '@lib/types'

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
  scorer: new RelevanceScorer(),
  orchestrator,
  pace: () => sleep(humanDelay.nextMs(8000, 45000))
})

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
      void runEngagement()
      return false

    case 'LIST_QUARANTINE':
      void quarantine.list().then(sendResponse)
      return true

    case 'CANCEL_QUARANTINE':
      void quarantine.cancel(message.id).then((ok) => sendResponse({ ok }))
      return true

    case 'PING':
      sendResponse({ type: 'PONG' })
      return false

    default:
      return false
  }
})

async function runEngagement(): Promise<void> {
  const settings = await loadSettings(store)
  const summary = await runner.run(settings)
  broadcast({ type: 'ENGAGEMENT_RESULT', summary })
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
    return undefined
  }
}

async function activeLinkedInTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.url?.includes('linkedin.com') ? tab : undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
