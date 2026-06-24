// Content script: the ONLY layer that runs inside the LinkedIn page DOM.
// SRP: bridge DOM ↔ core. All extraction/parsing is delegated to tested classes;
// all mutation goes through the gated executors in domActions.

import { createSsiParser } from '@lib/ssi/createSsiParser'
import { FeedReader } from '@lib/feed/FeedReader'
import { FeedAccumulator } from '@lib/feed/FeedAccumulator'
import { ScrollHarvestPolicy } from '@lib/feed/ScrollHarvestPolicy'
import { HumanDelay } from '@lib/engagement/HumanDelay'
import { DomSsiSource } from '@/adapters/DomSsiSource'
import { SystemClock } from '@/adapters/SystemClock'
import { MathRandomRng } from '@/adapters/MathRandomRng'
import { executeComment, executeLike } from './domActions'
import { assertNever, type BeaconMessage, type FeedItem } from '@lib/types'

const parser = createSsiParser(new SystemClock())
const source = new DomSsiSource()
const feed = new FeedReader()
const delay = new HumanDelay(new MathRandomRng())

function parseAndReport(): void {
  const root = source.getRoot()
  const snapshot = root ? parser.parse(root) : null
  send(
    snapshot
      ? { type: 'SSI_SNAPSHOT', payload: snapshot }
      : { type: 'SSI_PARSE_FAILED', reason: 'No SSI data on this page' }
  )
}

// SSI numbers hydrate client-side after a beat. Poll until the parser succeeds
// rather than guessing a delay (the parser is its own readiness probe).
const POLL_INTERVAL_MS = 1000
const MAX_POLLS = 25

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

// Scroll the feed human-like, harvesting unique posts until the target is met or
// the feed stops yielding new posts. Variable pauses (Rng) = anti-ban. The pure
// FeedAccumulator/ScrollHarvestPolicy decide dedup + when to stop.
async function harvestByScrolling(target: number): Promise<ReturnType<FeedReader['parse']>> {
  const acc = new FeedAccumulator()
  // LinkedIn lazy-loads on scroll and can be slow: give it generous read pauses
  // (1.5–3s, also more human) and 3 empty rounds before concluding the feed is
  // exhausted, so we don't stop after the first viewport.
  const policy = new ScrollHarvestPolicy({ maxStaleRounds: 3, maxRounds: 20 })
  let staleRounds = 0
  for (let round = 0; ; round++) {
    const added = acc.add(feed.parse(document))
    staleRounds = added > 0 ? 0 : staleRounds + 1
    if (policy.shouldStop({ collected: acc.size(), target, staleRounds, round })) break
    window.scrollBy(0, Math.round(window.innerHeight * 0.85))
    await sleep(delay.nextMs(1500, 3000))
  }
  return acc.items().slice(0, target)
}

chrome.runtime.onMessage.addListener((message: BeaconMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'REQUEST_SSI':
      parseAndReport()
      sendResponse({ ok: true })
      return false

    case 'REQUEST_FEED_HARVEST': {
      // Lightweight FeedItem view for the idea pipeline.
      const items: FeedItem[] = feed
        .parse(document, message.limit)
        .map((p) => ({ id: p.urn, author: p.authorName, excerpt: p.text }))
      send({ type: 'FEED_ITEMS', payload: items })
      sendResponse({ ok: true })
      return false
    }

    case 'REQUEST_FEED_POSTS':
      void harvestByScrolling(message.limit).then(sendResponse)
      return true // async sendResponse

    case 'EXECUTE_ACTION':
      void runAction(message).then(sendResponse)
      return true // async sendResponse

    case 'PING':
      sendResponse({ type: 'PONG' })
      return false

    // Outbound / SW-only / sidepanel-only — content never handles these.
    case 'SSI_SNAPSHOT':
    case 'SSI_PARSE_FAILED':
    case 'FEED_ITEMS':
    case 'REQUEST_REFRESH':
    case 'FORCE_REFRESH':
    case 'RUN_ENGAGEMENT':
    case 'ENGAGEMENT_RESULT':
    case 'LIST_QUARANTINE':
    case 'CANCEL_QUARANTINE':
    case 'PONG':
      return false
    default:
      return assertNever(message)
  }
})

async function runAction(message: { action: import('@lib/types').ActionRequest }) {
  const { action } = message
  const urn = String(action.target.meta?.urn ?? '')
  if (action.type === 'like') return executeLike(document, urn)
  if (action.type === 'comment') {
    return executeComment(document, urn, action.payload?.comment ?? '', delay)
  }
  return { ok: false, reason: `unsupported_action:${action.type}` }
}

function send(message: BeaconMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {})
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Auto-parse on landing directly on the SSI dashboard.
if (location.pathname.startsWith('/sales/ssi')) {
  parseWhenReady()
}
