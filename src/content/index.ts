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

// LinkedIn (Sales Navigator / Ember) renders the SSI numbers client-side after
// hydration, so the DOM is empty for a beat on first paint. Poll until the
// parser succeeds rather than guessing a fixed delay. The parser itself is the
// readiness probe (DRY — no duplicated selectors). 1s interval survives the
// background-tab timer throttling that applies to the minimized worker window.
const POLL_INTERVAL_MS = 1000
const MAX_POLLS = 25 // ~25s ceiling, under the SW refresh timeout

function parseWhenReady(attempt = 0): void {
  const root = source.getRoot()
  const snapshot = root ? parser.parse(root) : null
  if (snapshot) {
    send({ type: 'SSI_SNAPSHOT', payload: snapshot })
    return
  }
  if (attempt >= MAX_POLLS) {
    send({ type: 'SSI_PARSE_FAILED', reason: 'SSI numbers did not render in time' })
    return
  }
  setTimeout(() => parseWhenReady(attempt + 1), POLL_INTERVAL_MS)
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
    // Outbound-only / SW-only variants — content script never receives these.
    case 'SSI_SNAPSHOT':
    case 'SSI_PARSE_FAILED':
    case 'FEED_ITEMS':
    case 'REQUEST_REFRESH':
    case 'FORCE_REFRESH':
    case 'PONG':
      return false
    default:
      return assertNever(message)
  }
})

function send(message: BeaconMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {})
}

// Auto-parse on landing directly on the SSI dashboard — covers both a real user
// visit and the background worker window opened by the service worker.
if (location.pathname.startsWith('/sales/ssi')) {
  parseWhenReady()
}
