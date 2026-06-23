// MV3 service worker: message router + SSI persistence + background refresh.
// SRP: wiring only — JSON interpretation lives in the SSI mapper, transport in
// the API client, storage in SsiRepository, refresh timing in
// BackgroundRefreshService. DOM parsing (active-tab fast path) lives in the
// content script.

import { SsiRepository } from '@lib/storage/SsiRepository'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { SystemClock } from '@/adapters/SystemClock'
import { FetchHttpClient } from '@/adapters/FetchHttpClient'
import { ChromeCookieCsrfProvider } from '@/adapters/ChromeCookieCsrfProvider'
import { LinkedInSsiApiClient } from '@lib/ssi-api/LinkedInSsiApiClient'
import { RefreshPolicy } from '@lib/refresh/RefreshPolicy'
import {
  BackgroundRefreshService,
  type RefreshResult
} from '@lib/refresh/BackgroundRefreshService'
import type { BeaconMessage } from '@lib/types'

const HOUR_MS = 60 * 60 * 1000
const REFRESH_INTERVAL_MS = 24 * HOUR_MS // refresh SSI at most once a day
const REFRESH_ALARM = 'beacon:ssi-refresh'

const store = new ChromeStorageStore()
const repo = new SsiRepository(store)

const refresher = new BackgroundRefreshService({
  policy: new RefreshPolicy(REFRESH_INTERVAL_MS),
  apiClient: new LinkedInSsiApiClient(
    new FetchHttpClient(),
    new ChromeCookieCsrfProvider()
  ),
  store,
  clock: new SystemClock()
})

/** Persist + relay a snapshot produced by a background API refresh. */
async function handleRefresh(result: RefreshResult): Promise<void> {
  if (result.status !== 'refreshed') return
  await repo.save(result.snapshot)
  broadcast({ type: 'SSI_SNAPSHOT', payload: result.snapshot })
}

// ── Lifecycle: open panel on icon click, schedule the periodic refresh. ──
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {})
  // Poll a few times a day; RefreshPolicy gates the actual once-a-day cadence,
  // so an early alarm is cheap (it just no-ops as "skipped").
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 6 * 60 })
  void refresher.refreshIfDue().then(handleRefresh)
})

chrome.runtime.onStartup.addListener(() => {
  void refresher.refreshIfDue().then(handleRefresh)
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) void refresher.refreshIfDue().then(handleRefresh)
})

// ── Message routing. ──
chrome.runtime.onMessage.addListener((message: BeaconMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'SSI_SNAPSHOT':
      // A snapshot parsed by the content script (user is on /sales/ssi).
      // Persist + relay to any open panel.
      void repo.save(message.payload).then(() => {
        broadcast(message)
        sendResponse({ ok: true })
      })
      return true // async response

    case 'REQUEST_SSI':
      // Panel asked the active LinkedIn tab to re-parse (instant, flicker-free
      // when the user is already on a LinkedIn page).
      void forwardToLinkedInTab(message)
      return false

    case 'REQUEST_REFRESH':
      // Panel opened — refresh in the background via the API only if due.
      void refresher.refreshIfDue().then(handleRefresh)
      return false

    case 'FORCE_REFRESH':
      // Manual refresh button — API call, works from any page, no tab needed.
      void refresher.refreshNow().then(handleRefresh)
      return false

    case 'PING':
      sendResponse({ type: 'PONG' })
      return false

    default:
      return false
  }
})

/** Relay a message to extension views (sidepanel). Ignores "no receiver" noise. */
function broadcast(message: BeaconMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {})
}

/** Send a message to the content script of the current LinkedIn tab. */
async function forwardToLinkedInTab(message: BeaconMessage): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id && tab.url?.includes('linkedin.com')) {
    chrome.tabs.sendMessage(tab.id, message).catch(() => {})
  }
}
