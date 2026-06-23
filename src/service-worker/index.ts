// MV3 service worker: message router + SSI persistence orchestrator.
// SRP: wiring only — parsing lives in content script, storage in SsiRepository.

import { SsiRepository } from '@lib/storage/SsiRepository'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import type { BeaconMessage } from '@lib/types'

const repo = new SsiRepository(new ChromeStorageStore())

// Open the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {})
})

chrome.runtime.onMessage.addListener((message: BeaconMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'SSI_SNAPSHOT':
      // Content script parsed a snapshot → persist, then relay to any open panel.
      void repo.save(message.payload).then(() => {
        broadcast(message)
        sendResponse({ ok: true })
      })
      return true // async response

    case 'REQUEST_SSI':
      // Panel asked for a refresh → forward to the active LinkedIn tab.
      void forwardToLinkedInTab(message)
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
