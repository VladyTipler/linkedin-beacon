// Content script: the ONLY layer that runs inside the LinkedIn page DOM.
// SRP: bridge DOM ↔ core. All extraction/parsing is delegated to tested classes;
// all mutation goes through the gated executors in domActions.

import { createSsiParser } from '@lib/ssi/createSsiParser'
import { FeedReader } from '@lib/feed/FeedReader'
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

// The feed lazy-renders. Poll FeedReader until posts appear (it is its own
// readiness probe — no duplicated selectors), bounded, then harvest.
async function harvestWhenReady(limit: number): Promise<ReturnType<FeedReader['parse']>> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const posts = feed.parse(document, limit)
    if (posts.length > 0) return posts
    await sleep(500)
  }
  return feed.parse(document, limit)
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
      void harvestWhenReady(message.limit).then(sendResponse)
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
