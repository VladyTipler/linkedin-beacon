// Content script: the ONLY layer that runs inside the LinkedIn page DOM.
// SRP: bridge DOM ↔ core. All extraction/parsing is delegated to tested classes;
// all mutation goes through the gated executors in domActions.

import { createSsiParser } from '@lib/ssi/createSsiParser'
import { FeedReader } from '@lib/feed/FeedReader'
import { FeedAccumulator } from '@lib/feed/FeedAccumulator'
import { ScrollHarvestPolicy } from '@lib/feed/ScrollHarvestPolicy'
import { LikeFilter } from '@lib/engagement/LikeFilter'
import { HumanBreakPolicy } from '@lib/autopilot/HumanBreakPolicy'
import type { RiskMarker } from '@lib/autopilot/RiskAssessor'
import { HumanDelay } from '@lib/engagement/HumanDelay'
import { DomSsiSource } from '@/adapters/DomSsiSource'
import { SystemClock } from '@/adapters/SystemClock'
import { MathRandomRng } from '@/adapters/MathRandomRng'
import { executeComment, executeLike, executeComposerPost, executeConnect } from './domActions'
import { executeProfileView } from './profileView'
import { harvestPeople, harvestPeoplePage, harvestPeoplePaginated } from './harvestPeople'
import { showActivity, hideActivity, setActivityLabel, countdownActivity } from './activityOverlay'
import {
  SCANNING,
  LIKING,
  COMMENTING,
  GENERATING_IDEAS,
  COLLECTING_IDEAS,
  pauseLabel,
  breakCountdownLabel
} from '@lib/autopilot/statusLabels'
import { assertNever, type BeaconMessage, type FeedItem } from '@lib/types'

const parser = createSsiParser(new SystemClock())
const source = new DomSsiSource()
const feed = new FeedReader()
const delay = new HumanDelay(new MathRandomRng())
const likeFilter = new LikeFilter()
const humanBreak = new HumanBreakPolicy()

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
/**
 * LinkedIn's feed scrolls an inner `<main>` container (overflow-y: scroll), NOT
 * the window — `window.scrollBy` does nothing. Find the scrollable ancestor of a
 * post so we drive the real scroller and trigger lazy-load.
 */
function feedScroller(): Element {
  const anchor =
    document.querySelector('button[aria-label="Comment"]') ??
    document.querySelector('[data-testid="expandable-text-box"]')
  let node: Element | null = anchor
  while (node && node !== document.body) {
    node = node.parentElement
    if (node && node.scrollHeight > node.clientHeight + 80) {
      const overflow = getComputedStyle(node).overflowY
      if (overflow === 'auto' || overflow === 'scroll') return node
    }
  }
  return document.scrollingElement ?? document.documentElement
}

// Advance the people-search pagination (no infinite scroll — you switch pages). The
// current page button has aria-current="true"; click the next-numbered one and wait for
// the indicator to switch (its results then render; the harvest poll waits for them).
async function goToNextPeoplePage(): Promise<boolean> {
  const pageBtns = () => [...document.querySelectorAll<HTMLButtonElement>('button[aria-label^="Page "]')]
  const cur = pageBtns().find((b) => b.getAttribute('aria-current') === 'true')
  if (!cur) return false
  const curNum = parseInt((cur.getAttribute('aria-label') ?? '').replace('Page ', ''), 10)
  if (Number.isNaN(curNum)) return false
  const next = pageBtns().find((b) => b.getAttribute('aria-label') === `Page ${curNum + 1}`)
  if (!next || next.disabled) return false
  next.scrollIntoView()
  next.click()
  for (let i = 0; i < 16; i++) {
    await sleep(500)
    const now = pageBtns().find((b) => b.getAttribute('aria-current') === 'true')
    if (now?.getAttribute('aria-label') === `Page ${curNum + 1}`) {
      await sleep(1500) // settle: let the new page's cards replace the old before harvest
      return true
    }
  }
  return false
}

// People-search "No results found" empty-state (verified live 2026-06-27). Distinguishes
// a genuinely-empty search from a page that simply hasn't rendered its cards yet.
function isPeopleSearchEmpty(): boolean {
  return /no results found/i.test(document.body?.innerText ?? '')
}

async function harvestByScrolling(target: number): Promise<ReturnType<FeedReader['parse']>> {
  const acc = new FeedAccumulator()
  // LinkedIn lazy-loads on scroll and can be slow: generous read pauses (1.5–3s,
  // also more human) and 3 empty rounds before concluding the feed is exhausted.
  const policy = new ScrollHarvestPolicy({ maxStaleRounds: 3, maxRounds: 20 })
  let staleRounds = 0
  for (let round = 0; ; round++) {
    const added = acc.add(feed.parse(document))
    staleRounds = added > 0 ? 0 : staleRounds + 1
    if (policy.shouldStop({ collected: acc.size(), target, staleRounds, round })) break
    const scroller = feedScroller()
    scroller.scrollTop = scroller.scrollHeight // to the bottom → triggers lazy-load
    await sleep(delay.nextMs(1500, 3000))
  }
  return acc.items().slice(0, target)
}

const IDEA_TARGET = 25 // unique posts buffered before the one-per-run mid-run extraction

// ── Autopilot loop: the continuous engagement run lives here (survives SW
// eviction while this tab is open). SW is the authoritative gatekeeper. ──
let autopilotRunning = false
let actionsSinceBreak = 0
const actedUrns = new Set<string>()

/** Cheap per-action risk probe (design-spec §5.4). Detection only — SW judges. */
function detectRisk(): RiskMarker | null {
  if (document.querySelector('iframe[src*="captcha" i], [id*="captcha" i]')) return 'captcha'
  const body = document.body?.innerText ?? ''
  if (/unusual activity|verify it'?s you|security check|are you a human/i.test(body)) {
    return 'challenge'
  }
  return null
}

async function ask<T>(message: BeaconMessage): Promise<T | undefined> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T
  } catch {
    return undefined
  }
}

/** Tell the SW to finalize the run (single report; SW guards against double). */
async function endRun(reason: import('@lib/types').StopReason): Promise<void> {
  autopilotRunning = false
  await ask({ type: 'AUTOPILOT_ENDED', reason })
}

async function runAutopilotLoop(modules: {
  engagement: boolean
  content: boolean
  comments: boolean
}): Promise<void> {
  if (autopilotRunning) return
  autopilotRunning = true
  actedUrns.clear()
  actionsSinceBreak = 0
  let emptyHarvests = 0
  let extractedThisRun = false
  const runBuffer = new FeedAccumulator()
  // Flags are captured per-run (locals, not ambient module state) so a second
  // RUN_LOOP message can't mutate a running loop's behaviour. wantLike never
  // changes mid-run, so the idle label is computed once.
  const wantLike = modules.engagement
  const wantIdeas = modules.content
  const wantComments = modules.comments
  const idleLabel = wantLike ? SCANNING : COLLECTING_IDEAS
  showActivity(document, idleLabel)
  try {
    while (autopilotRunning) {
      setActivityLabel(idleLabel)
      const posts = await harvestByScrolling(25)
      // Stop feeding the buffer once we've extracted — nothing reads it after.
      if (wantIdeas && !extractedThisRun) runBuffer.add(posts)

      // One grounded extraction per run, as soon as there's enough signal.
      if (wantIdeas && !extractedThisRun && runBuffer.size() >= IDEA_TARGET) {
        setActivityLabel(GENERATING_IDEAS)
        await ask({ type: 'EXTRACT_RUN_IDEAS', posts: runBuffer.items() })
        extractedThisRun = true
      }

      if (wantLike) {
        const { likeable } = likeFilter.select(posts)
        const fresh = likeable.filter((p) => !actedUrns.has(p.urn))
        if (fresh.length === 0) {
          if (++emptyHarvests >= 2) {
            await endRun('feed_exhausted')
            break
          }
          continue
        }
        emptyHarvests = 0

        for (const post of fresh) {
          if (!autopilotRunning) break
          const risk = detectRisk()
          if (risk) await ask({ type: 'AUTOPILOT_RISK', marker: risk })

          const decision = await ask<{ action: string; waitMs?: number }>({
            type: 'AUTOPILOT_MAY_ACT',
            actionType: 'like'
          })
          if (!decision) {
            await endRun('manual')
            break
          }
          if (decision.action === 'stop') {
            autopilotRunning = false
            break
          }
          if (decision.action === 'wait') {
            await sleep(decision.waitMs ?? 30_000)
            continue
          }

          actedUrns.add(post.urn)
          setActivityLabel(LIKING)
          const res = executeLike(document, post.urn)
          await ask({ type: 'AUTOPILOT_ACTED', ok: res.ok })
          if (res.ok) actionsSinceBreak += 1
          // Comment implies a like (we just liked it). The SW gates relevance +
          // budget + quality-judge; we only execute what it approves (full-auto).
          if (res.ok && wantComments) {
            setActivityLabel(COMMENTING)
            const c = await ask<{ ok: boolean; text?: string }>({ type: 'COMMENT_ON_POST', post })
            if (c?.ok && c.text) {
              await executeComment(document, post.urn, c.text, delay)
              await sleep(delay.nextMs(8000, 45000)) // pace after a comment too (anti-ban)
            }
          }
          const paceMs = delay.nextMs(8000, 45000)
          await countdownActivity(paceMs, pauseLabel) // live "Пауза 11с → 10с → …" + waits paceMs
          const breakMs = humanBreak.nextBreakMs(actionsSinceBreak, new MathRandomRng())
          if (breakMs > 0) {
            actionsSinceBreak = 0
            await countdownActivity(breakMs, breakCountdownLabel) // live "Перерыв 2:09 ☕"
          }
        }
      } else {
        // Content-only run: no liking to pace — once ideas are in, we're done.
        if (extractedThisRun) {
          await endRun('feed_exhausted')
          break
        }
        if (++emptyHarvests >= 3) {
          await endRun('feed_exhausted')
          break
        }
      }
    }
  } finally {
    // Catch-up: ALWAYS attempt one extraction at run end if we never did mid-run —
    // even a small buffer is worth banking, and it guarantees ideas:lastRun is written
    // every content-enabled run (so a 0-result run is visible on the Content tab, not silent).
    if (wantIdeas && !extractedThisRun) {
      await ask({ type: 'EXTRACT_RUN_IDEAS', posts: runBuffer.items() })
    }
    autopilotRunning = false
    hideActivity()
  }
}

chrome.runtime.onMessage.addListener((message: BeaconMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'REQUEST_SSI':
      parseAndReport()
      sendResponse({ ok: true })
      return false

    case 'AUTOPILOT_RUN_LOOP':
      void runAutopilotLoop(message.modules)
      sendResponse({ ok: true })
      return false

    case 'STOP_AUTOPILOT':
      autopilotRunning = false
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

    case 'HARVEST_PEOPLE':
      // No infinite scroll: wait for each page to render, harvest it, then paginate.
      // isPeopleSearchEmpty lets harvest tell a dead search ('empty') from a page that
      // never rendered ('not_ready') — the SW surfaces these as different run reasons.
      void harvestPeoplePaginated(
        () => harvestPeoplePage(() => harvestPeople(document), (ms) => sleep(ms), isPeopleSearchEmpty),
        () => goToNextPeoplePage()
      ).then(sendResponse)
      return true // async sendResponse

    case 'HARVEST_PEOPLE_PAGE':
      // ONE page only (no pagination) — Smart Connect connects per-page, so it harvests the
      // current page, connects its candidates, then asks PEOPLE_NEXT_PAGE to advance.
      void harvestPeoplePage(() => harvestPeople(document), (ms) => sleep(ms), isPeopleSearchEmpty)
        .then(sendResponse)
      return true // async sendResponse

    case 'PEOPLE_NEXT_PAGE':
      void goToNextPeoplePage().then(sendResponse)
      return true // async sendResponse

    case 'EXECUTE_ACTION':
      void runAction(message).then(sendResponse)
      return true // async sendResponse

    case 'DWELL_PROFILE':
      void executeProfileView(document, delay).then(sendResponse)
      return true // async sendResponse

    case 'SLEEP':
      // Sleep HERE (content script is alive while its tab is open). The SW awaits the
      // sendResponse, which keeps the MV3 service worker from being evicted mid-pause —
      // a long setTimeout in the SW itself gets killed and orphans the run.
      // Live "Пауза 22с → 21с → …" pill so the user sees the anti-ban gap (not a freeze)
      // during connect/views pacing — same countdown the engagement loop uses.
      void countdownActivity(message.ms, pauseLabel).then(() => sendResponse({ ok: true }))
      return true // async sendResponse

    case 'PING':
      sendResponse({ type: 'PONG' })
      return false

    case 'SET_ACTIVITY':
      if (message.active) showActivity(document, message.label ?? '')
      else hideActivity()
      return false

    // Outbound / SW-only / sidepanel-only — content never handles these.
    case 'SSI_SNAPSHOT':
    case 'SSI_PARSE_FAILED':
    case 'FEED_ITEMS':
    case 'REQUEST_REFRESH':
    case 'FORCE_REFRESH':
    case 'LIST_QUARANTINE':
    case 'CANCEL_QUARANTINE':
    case 'START_AUTOPILOT':
    case 'AUTOPILOT_MAY_ACT':
    case 'AUTOPILOT_ACTED':
    case 'AUTOPILOT_RISK':
    case 'AUTOPILOT_ENDED':
    case 'AUTOPILOT_STATUS':
    case 'AUTOPILOT_REPORT':
    case 'LIST_REPORTS':
    case 'LIST_MODELS':
    case 'GENERATE_DRAFT':
    case 'GENERATE_IDEAS':
    case 'EXTRACT_RUN_IDEAS':
    case 'COMMENT_ON_POST':
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
  if (action.type === 'post') {
    return executeComposerPost(document, action.payload?.post ?? '', delay)
  }
  if (action.type === 'connect') {
    const meta = action.target.meta ?? {}
    return executeConnect(document, { memberId: String(meta.memberId ?? ''), name: String(meta.name ?? '') }, delay)
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
