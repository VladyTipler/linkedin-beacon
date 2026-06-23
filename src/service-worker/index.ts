// MV3 service worker: message router + SSI persistence + background refresh.
// SRP: wiring only — parsing lives in the content script, storage in
// SsiRepository, refresh timing/lifecycle in BackgroundRefreshService.

import { SsiRepository } from '@lib/storage/SsiRepository'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { SystemClock } from '@/adapters/SystemClock'
import { ChromeTabController } from '@/adapters/ChromeTabController'
import { RefreshPolicy } from '@lib/refresh/RefreshPolicy'
import { SnapshotRegistry } from '@lib/refresh/SnapshotRegistry'
import { BackgroundRefreshService } from '@lib/refresh/BackgroundRefreshService'
import type { BeaconMessage } from '@lib/types'

const HOUR_MS = 60 * 60 * 1000
const REFRESH_INTERVAL_MS = 24 * HOUR_MS // refresh SSI at most once a day
const REFRESH_TIMEOUT_MS = 35 * 1000 // worker tab must parse within this window
const REFRESH_ALARM = 'beacon:ssi-refresh'

const store = new ChromeStorageStore()
const repo = new SsiRepository(store)
const registry = new SnapshotRegistry()

const refresher = new BackgroundRefreshService({
  policy: new RefreshPolicy(REFRESH_INTERVAL_MS),
  tabs: new ChromeTabController(),
  registry,
  store,
  clock: new SystemClock(),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs: REFRESH_TIMEOUT_MS
})

// ── Lifecycle: open panel on icon click, schedule the periodic refresh. ──
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {})
  // Poll a few times a day; RefreshPolicy gates the actual once-a-day cadence,
  // so an early alarm is cheap (it just no-ops as "skipped").
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 6 * 60 })
  void refresher.refreshIfDue()
})

chrome.runtime.onStartup.addListener(() => {
  void refresher.refreshIfDue()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) void refresher.refreshIfDue()
})

// ── Message routing. ──
chrome.runtime.onMessage.addListener((message: BeaconMessage, sender, sendResponse) => {
  switch (message.type) {
    case 'SSI_SNAPSHOT':
      // A snapshot arrived (active LinkedIn tab OR the background worker tab).
      // Persist + relay to any open panel, and hand it to a refresh awaiting
      // this specific tab so the worker window can be torn down.
      void repo.save(message.payload).then(() => {
        broadcast(message)
        sendResponse({ ok: true })
      })
      if (sender.tab?.id != null) registry.deliver(sender.tab.id, message.payload)
      return true // async response

    case 'REQUEST_SSI':
      // Panel asked the active LinkedIn tab to re-parse (instant, flicker-free
      // when the user is already on a LinkedIn page).
      void forwardToLinkedInTab(message)
      return false

    case 'REQUEST_REFRESH':
      // Panel opened — refresh in the background only if due.
      void refresher.refreshIfDue()
      return false

    case 'FORCE_REFRESH':
      // Manual refresh button — works from any page via the worker window.
      void refresher.refreshNow()
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
