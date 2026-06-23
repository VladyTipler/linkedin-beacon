// Content script: the ONLY layer that runs inside the LinkedIn page DOM.
// SRP: bridge DOM ↔ core. All extraction logic is delegated to tested classes.

import { createSsiParser } from '@lib/ssi/createSsiParser'
import { FeedHarvester } from '@lib/feed/FeedHarvester'
import { DomSsiSource } from '@/adapters/DomSsiSource'
import { SystemClock } from '@/adapters/SystemClock'
import { assertNever, type BeaconMessage } from '@lib/types'

const parser = createSsiParser(new SystemClock())
const source = new DomSsiSource()
const harvester = new FeedHarvester()

function parseAndReport(): void {
  const root = source.getRoot()
  const snapshot = root ? parser.parse(root) : null
  if (snapshot) {
    send({ type: 'SSI_SNAPSHOT', payload: snapshot })
  } else {
    send({ type: 'SSI_PARSE_FAILED', reason: 'No SSI data on this page' })
  }
}

chrome.runtime.onMessage.addListener((message: BeaconMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'REQUEST_SSI':
      parseAndReport()
      sendResponse({ ok: true })
      return false
    case 'REQUEST_FEED_HARVEST': {
      const root = source.getRoot()
      const items = root ? harvester.harvest(root, message.limit) : []
      send({ type: 'FEED_ITEMS', payload: items })
      sendResponse({ ok: true })
      return false
    }
    case 'PING':
      sendResponse({ type: 'PONG' })
      return false
    // Outbound-only variants — content script never receives these.
    case 'SSI_SNAPSHOT':
    case 'SSI_PARSE_FAILED':
    case 'FEED_ITEMS':
    case 'PONG':
      return false
    default:
      return assertNever(message)
  }
})

function send(message: BeaconMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {})
}

// Auto-parse on landing directly on the SSI dashboard.
if (location.pathname.startsWith('/sales/ssi')) {
  // Defer to let LinkedIn hydrate its client-rendered numbers.
  setTimeout(parseAndReport, 1500)
}
