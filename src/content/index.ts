// Content script: the ONLY layer that runs inside the LinkedIn page DOM.
// SRP: bridge DOM ↔ core. All extraction/parsing is delegated to tested classes;
// all mutation goes through the gated executors in domActions.

import { createSsiParser } from '@lib/ssi/createSsiParser'
import { FeedReader } from '@lib/feed/FeedReader'
import { FeedAccumulator } from '@lib/feed/FeedAccumulator'
import { scrollHarvest } from '@lib/feed/scrollHarvest'
import { LikeFilter } from '@lib/engagement/LikeFilter'
import { rollComment } from '@lib/engagement/commentRoll'
import { HumanBreakPolicy } from '@lib/autopilot/HumanBreakPolicy'
import type { RiskMarker } from '@lib/autopilot/RiskAssessor'
import { HumanDelay } from '@lib/engagement/HumanDelay'
import { DomSsiSource } from '@/adapters/DomSsiSource'
import { SystemClock } from '@/adapters/SystemClock'
import { MathRandomRng } from '@/adapters/MathRandomRng'
import { executeComment, executeLike, executeComposerPost, executeConnect } from './domActions'
import { executeProfileView } from './profileView'
import { readOwnerName } from './readOwner'
import { harvestPeople, harvestProfiles, harvestPeoplePage, pymkScrollHarvest } from './harvestPeople'
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
import { assertNever, type BeaconMessage, type FeedItem, type StopReason } from '@lib/types'

const parser = createSsiParser(new SystemClock())
const source = new DomSsiSource()
const feed = new FeedReader()
const delay = new HumanDelay(new MathRandomRng())
const likeFilter = new LikeFilter()
const humanBreak = new HumanBreakPolicy()
const commentRng = new MathRandomRng()

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

// PYMK «People you may know based on your recent activity»: инлайн ~8; её «Show all»
// раскрывает полный список (~44) НА ТОМ ЖЕ URL. Graceful: нет кнопки → харвест инлайна.
async function expandPymkShowAll(): Promise<void> {
  const showAll = [...document.querySelectorAll<HTMLElement>('a,button')].find((e) =>
    /you may know based on your recent activity/i.test(e.getAttribute('aria-label') ?? '')
  )
  if (!showAll) return
  showAll.click()
  await sleep(2000) // дать раскрытому списку отрисоваться до харвеста
}

// Раскрытый PYMK-список скроллит ВНУТРЕННИЙ overflow-контейнер (как лента), НЕ окно.
// Скролл окна = no-op (это и был баг «берёт только инлайн 8»). Ищем scrollable-ancestor
// connect-контрола, чтобы scroll-to-bottom догружал (44 → 92+).
function pymkScroller(): Element {
  // Anchor off ANY member card (componentkey), not the connect control only — the Views
  // (profiles) harvest wants all members, and a fully-Pending cohort has no connect anchors
  // but still scrolls; keying off connect-only there would fall back to the window no-op.
  const anchor = document.querySelector('[componentkey*="urn:li:member:"]')
  let node: Element | null = anchor
  while (node && node !== document.body) {
    node = node.parentElement
    if (node && node.scrollHeight > node.clientHeight + 100) {
      const ov = getComputedStyle(node).overflowY
      if (ov === 'auto' || ov === 'scroll') return node
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

// Thin DOM adapter over the tested scrollHarvest. `shouldAbort` defaults to
// never-abort, so a STANDALONE harvest (manual "Generate ideas", no run active)
// collects normally; the autopilot loop passes `() => !autopilotRunning` so a STOP
// aborts its scroll mid-run.
function harvestByScrolling(
  target: number,
  shouldAbort: () => boolean = () => false
): Promise<ReturnType<FeedReader['parse']>> {
  return scrollHarvest(target, {
    parse: () => feed.parse(document),
    scrollToBottom: () => {
      const scroller = feedScroller()
      scroller.scrollTop = scroller.scrollHeight // to the bottom → triggers lazy-load
    },
    sleep: () => sleep(delay.nextMs(1500, 3000)),
    shouldAbort
  })
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
async function endRun(reason: StopReason): Promise<void> {
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
  // Run the end-of-run idea catch-up ONLY on a natural end (feed exhausted / budget / risk),
  // never after a user STOP (an extra EXTRACT_RUN_IDEAS re-lights the "Генерирую идеи" overlay
  // via the SW's withPageActivity — the "still scanning after Stop" bug). Set ONLY by synchronous
  // loop code at the natural-end points, so the async STOP_AUTOPILOT echo can't stomp it. Gating
  // the catch-up on `autopilotRunning` (c4981e5) was dead code: endRun() zeroes it before finally.
  let extractAtEnd = false
  const runBuffer = new FeedAccumulator()
  // Flags are captured per-run (locals, not ambient module state) so a second
  // RUN_LOOP message can't mutate a running loop's behaviour. wantLike never
  // changes mid-run, so the idle label is computed once.
  const wantLike = modules.engagement
  const wantIdeas = modules.content
  const wantComments = modules.comments
  const idleLabel = wantLike ? SCANNING : COLLECTING_IDEAS
  // Read the owner's name ONCE per run so the like/comment gate never acts on your OWN
  // posts (the self-engagement bug). Fail OPEN on a detection miss — a missed selector
  // must not block the whole engagement run, just the own-post guard for this run.
  const ownerName = readOwnerName(document) ?? undefined
  if (wantLike && !ownerName) {
    console.warn('[beacon] owner name not detected — own-post filter inactive this run')
  }
  showActivity(document, idleLabel)
  try {
    while (autopilotRunning) {
      setActivityLabel(idleLabel)
      const posts = await harvestByScrolling(25, () => !autopilotRunning)
      // Stop feeding the buffer once we've extracted — nothing reads it after.
      if (wantIdeas && !extractedThisRun) runBuffer.add(posts)

      // One grounded extraction per run, as soon as there's enough signal.
      if (wantIdeas && !extractedThisRun && runBuffer.size() >= IDEA_TARGET) {
        setActivityLabel(GENERATING_IDEAS)
        await ask({ type: 'EXTRACT_RUN_IDEAS', posts: runBuffer.items() })
        extractedThisRun = true
      }

      if (wantLike) {
        const { likeable } = likeFilter.select(posts, undefined, ownerName)
        const fresh = likeable.filter((p) => !actedUrns.has(p.urn))
        if (fresh.length === 0) {
          if (++emptyHarvests >= 2) {
            extractAtEnd = true
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

          const decision = await ask<{ action: string; waitMs?: number; reason?: StopReason }>({
            type: 'AUTOPILOT_MAY_ACT',
            actionType: 'like'
          })
          if (!decision) {
            await endRun('manual')
            break
          }
          if (decision.action === 'stop') {
            // budget/risk are natural ends → still worth banking the buffered ideas; only a
            // user 'manual' stop skips the catch-up (no overlay re-light after Stop).
            if (decision.reason !== 'manual') extractAtEnd = true
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
          if (res.ok && wantComments && rollComment(commentRng)) {
            setActivityLabel(COMMENTING)
            const c = await ask<{ ok: boolean; text?: string }>({ type: 'COMMENT_ON_POST', post })
            if (c?.ok && c.text) {
              await executeComment(document, post.urn, c.text, delay)
              await sleep(delay.nextMs(8000, 45000)) // pace after a comment too (anti-ban)
            }
          }
          const paceMs = delay.nextMs(8000, 45000)
          // shouldAbort lets STOP interrupt an 8–45s anti-ban pace mid-wait (otherwise the
          // overlay keeps counting down after the run is already halted).
          await countdownActivity(paceMs, pauseLabel, () => !autopilotRunning)
          const breakMs = humanBreak.nextBreakMs(actionsSinceBreak, new MathRandomRng())
          if (breakMs > 0) {
            actionsSinceBreak = 0
            await countdownActivity(breakMs, breakCountdownLabel, () => !autopilotRunning)
          }
        }
      } else {
        // Content-only run: no liking to pace — once ideas are in, we're done.
        if (extractedThisRun) {
          await endRun('feed_exhausted')
          break
        }
        if (++emptyHarvests >= 3) {
          extractAtEnd = true
          await endRun('feed_exhausted')
          break
        }
      }
    }
  } finally {
    // Catch-up: attempt one extraction at run end if we never did mid-run — even a small
    // buffer is worth banking, and it guarantees ideas:lastRun is written every content-enabled
    // run (so a 0-result run is visible on the Content tab, not silent). `extractAtEnd` is true
    // only on a NATURAL end (feed exhausted / budget / risk); a user STOP leaves it false so we
    // don't re-light the overlay with a post-stop LLM call ("still scanning after Stop" bug).
    if (extractAtEnd && wantIdeas && !extractedThisRun) {
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
      // Kill the overlay IMMEDIATELY — don't leave the lime border + "Генерирую идеи" pill
      // hanging while a mid-flight LLM call (EXTRACT_RUN_IDEAS / COMMENT_ON_POST) or a
      // harvest scroll finishes. finally→hideActivity only fires after those await; the user
      // pressed STOP, the page must look stopped now. refcount stays balanced: the loop's
      // finally still calls hideActivity (idempotent via Math.max(0,...)).
      hideActivity()
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

    case 'HARVEST_PEOPLE_PAGE':
      // ONE page only (no pagination) — Smart Connect connects per-page, so it harvests the
      // current page, connects its candidates, then asks PEOPLE_NEXT_PAGE to advance.
      // peopleCount = ALL member cards (incl. Pending) → tells "rendered but everyone already
      // invited" (none_connectable, page deeper) from "not rendered" (not_ready, bail).
      void harvestPeoplePage(
        () => harvestPeople(document),
        (ms) => sleep(ms),
        isPeopleSearchEmpty,
        40,
        500,
        () => harvestProfiles(document).length
      ).then(sendResponse)
      return true // async sendResponse

    case 'HARVEST_PROFILES_PAGE':
      // Profile Views: harvest ALL people on the page (connectable + already-Pending), so the
      // views pool doesn't go blind once most of the search is already invited.
      void harvestPeoplePage(() => harvestProfiles(document), (ms) => sleep(ms), isPeopleSearchEmpty)
        .then(sendResponse)
      return true // async sendResponse

    case 'PEOPLE_NEXT_PAGE':
      void goToNextPeoplePage().then(sendResponse)
      return true // async sendResponse

    case 'HARVEST_PYMK': {
      // Expand the recent-activity cohort's "Show all" (8 → ~44), then scroll-harvest its INNER
      // container (~44 → 92+). `profiles`: all members (Views) vs connectable (Smart Connect).
      // Verified live 2026-07-16 (memory-bank: pymk-deep-pool).
      const harvestFn = message.profiles
        ? () => harvestProfiles(document)
        : () => harvestPeople(document)
      void expandPymkShowAll()
        .then(() =>
          pymkScrollHarvest(
            harvestFn,
            async () => { const s = pymkScroller(); s.scrollTop = s.scrollHeight },
            () => sleep(1200),
            message.target
          )
        )
        .then(sendResponse)
      return true // async sendResponse
    }

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
    case 'PROFILE_VIEWS_SNAPSHOT':
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
    case 'AUTOPILOT_STAGE':
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
