# Smart Connect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Smart Connect module that, inside the one-button run, searches LinkedIn people by keywords and sends bare connection requests up to a weekly budget — raising the SSI **people** + **relationships** pillars.

**Architecture:** Hexagonal. Pure core (`src/lib/connect/`) for URL building, weekly budget, per-run cap, candidate selection. Thin content adapters (`harvestPeople`, `executeConnect`) cross the LinkedIn DOM (search cards + invite modal in the `#interop-outlet` shadow root). SW orchestrates a connect step (`connectHandlers.ts`) wired into `startAutopilot`. UI exposes the module card. Spec: `docs/superpowers/specs/2026-06-26-smart-connect-design.md`. DOM contract: `docs/linkedin-dom-anchors.md` ("Smart Connect").

**Tech Stack:** Vue 3.5 + TS + Vite 6, Vitest + jsdom, Chrome MV3.

## Global Constraints

- File ≤ 300 lines; one responsibility (SOLID). Long fixtures live in their own file.
- core never imports `chrome`/`document`/`fetch` — only ports (`KeyValueStore`, `Clock`, `Rng`).
- `connect` is already a valid `ActionType` (`src/lib/types.ts:58`). Do NOT redefine it.
- Never trust a `chrome.storage` value's shape — read arrays via `asArray` (`src/lib/engagement/settings.ts`).
- Bare invite only (V1): click `Send without a note`. No personal note (monthly-capped on free).
- Anti-ban is non-negotiable: weekly cap (default 100), per-run sub-cap, human pacing, persisted sent-set.
- TDD: failing test → run (fail) → minimal code → run (pass) → commit. Commit straight to `main`.
- Before "done": `npx vitest run` green + `npm run build` clean.

---

### Task 1: PersonCandidate type + peopleSearchUrl (core)

**Files:**
- Modify: `src/lib/types.ts` (add `PersonCandidate` near the action model, ~line 71)
- Create: `src/lib/connect/peopleSearchUrl.ts`
- Test: `src/lib/connect/peopleSearchUrl.test.ts`

**Interfaces:**
- Produces: `interface PersonCandidate { memberId: string; name: string; headline: string; profileUrl: string }`
- Produces: `peopleSearchUrl(keywords: string): string`

- [ ] **Step 1: Add the type to `src/lib/types.ts`** (after the `ActionRequest` block, ~line 71)

```ts
/** A connectable person harvested from a LinkedIn people-search result card. */
export interface PersonCandidate {
  /** Stable LinkedIn member id (from the connect anchor's componentkey). Dedup key. */
  memberId: string
  name: string
  /** The professional sub-headline (shown for transparency in the run report). */
  headline: string
  profileUrl: string
}
```

- [ ] **Step 2: Write the failing test** (`src/lib/connect/peopleSearchUrl.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { peopleSearchUrl } from './peopleSearchUrl'

describe('peopleSearchUrl', () => {
  it('builds the people-search URL with url-encoded keywords', () => {
    expect(peopleSearchUrl('frontend recruiter')).toBe(
      'https://www.linkedin.com/search/results/people/?keywords=frontend%20recruiter'
    )
  })

  it('trims surrounding whitespace', () => {
    expect(peopleSearchUrl('  recruiter  ')).toContain('keywords=recruiter')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/connect/peopleSearchUrl.test.ts`
Expected: FAIL — cannot find module `./peopleSearchUrl`.

- [ ] **Step 4: Write minimal implementation** (`src/lib/connect/peopleSearchUrl.ts`)

```ts
/** Build the LinkedIn people-search URL for the given keywords. Pure. */
export function peopleSearchUrl(keywords: string): string {
  const q = encodeURIComponent(keywords.trim())
  return `https://www.linkedin.com/search/results/people/?keywords=${q}`
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/connect/peopleSearchUrl.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/connect/peopleSearchUrl.ts src/lib/connect/peopleSearchUrl.test.ts
git commit -m "feat(connect): PersonCandidate type + peopleSearchUrl (core)"
```

---

### Task 2: Connect settings — search keywords (core)

**Files:**
- Create: `src/lib/connect/settings.ts`
- Test: `src/lib/connect/settings.test.ts`

**Interfaces:**
- Consumes: `KeyValueStore` (`src/lib/ports.ts`), `ExpertiseProfile` (`src/lib/types.ts`)
- Produces: `CONNECT_SETTINGS_KEY`, `interface ConnectSettings { searchKeywords: string }`,
  `defaultConnectKeywords(expertise: ExpertiseProfile): string`,
  `loadConnectSettings(store): Promise<ConnectSettings>`, `saveConnectSettings(store, s): Promise<void>`

- [ ] **Step 1: Write the failing test** (`src/lib/connect/settings.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { defaultConnectKeywords, loadConnectSettings, saveConnectSettings, CONNECT_SETTINGS_KEY } from './settings'

function fakeStore(initial: Record<string, unknown> = {}) {
  const m = new Map<string, unknown>(Object.entries(initial))
  return {
    get: async <T>(k: string) => (m.get(k) as T) ?? null,
    set: async (k: string, v: unknown) => void m.set(k, v),
    map: m
  }
}

describe('connect settings', () => {
  it('defaults keywords to "<first stack> recruiter", or "recruiter" when no stack', () => {
    expect(defaultConnectKeywords({ headline: '', stack: ['React', 'Vue'] })).toBe('React recruiter')
    expect(defaultConnectKeywords({ headline: '', stack: [] })).toBe('recruiter')
  })

  it('loads stored keywords; empty store returns empty string (SW fills the default)', async () => {
    const empty = fakeStore()
    expect(await loadConnectSettings(empty)).toEqual({ searchKeywords: '' })
    const s = fakeStore({ [CONNECT_SETTINGS_KEY]: { searchKeywords: 'devops recruiter' } })
    expect(await loadConnectSettings(s)).toEqual({ searchKeywords: 'devops recruiter' })
  })

  it('round-trips via save', async () => {
    const s = fakeStore()
    await saveConnectSettings(s, { searchKeywords: 'qa hiring' })
    expect(await loadConnectSettings(s)).toEqual({ searchKeywords: 'qa hiring' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/connect/settings.test.ts`
Expected: FAIL — cannot find module `./settings`.

- [ ] **Step 3: Write minimal implementation** (`src/lib/connect/settings.ts`)

```ts
import type { KeyValueStore } from '../ports'
import type { ExpertiseProfile } from '../types'

export const CONNECT_SETTINGS_KEY = 'connect:settings'

/** The user's "who to search" keywords for Smart Connect. */
export interface ConnectSettings {
  searchKeywords: string
}

/** Prefill: first stack term + "recruiter" (recruiters + peers), else just "recruiter". */
export function defaultConnectKeywords(expertise: ExpertiseProfile): string {
  const stack = expertise.stack?.[0]?.trim()
  return stack ? `${stack} recruiter` : 'recruiter'
}

export async function loadConnectSettings(store: KeyValueStore): Promise<ConnectSettings> {
  const raw = await store.get<ConnectSettings>(CONNECT_SETTINGS_KEY)
  return { searchKeywords: typeof raw?.searchKeywords === 'string' ? raw.searchKeywords : '' }
}

export async function saveConnectSettings(store: KeyValueStore, s: ConnectSettings): Promise<void> {
  await store.set(CONNECT_SETTINGS_KEY, s)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/connect/settings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/connect/settings.ts src/lib/connect/settings.test.ts
git commit -m "feat(connect): connect settings + default search keywords (core)"
```

---

### Task 3: ConnectWeekBudget + per-run cap (core)

**Files:**
- Create: `src/lib/connect/ConnectWeekBudget.ts`
- Test: `src/lib/connect/ConnectWeekBudget.test.ts`

**Interfaces:**
- Consumes: `isoWeekKey` from `src/lib/content/PostWeekBudget.ts` (reuse the ISO logic), `Rng`, `ModuleState`
- Produces: `CONNECT_WEEK_BUDGET_KEY`, `DEFAULT_CONNECTS_PER_WEEK`, `interface ConnectWeek { week: string; used: number }`,
  `rolloverConnectWeek(prev, weekKey)`, `recordConnectWeek(state, n)`, `remainingConnects(state, limit)`,
  `connectsPerWeek(modulesState: unknown): number`, `connectRunCap(weeklyRemaining: number, perWeek: number, rng: Rng): number`

- [ ] **Step 1: Write the failing test** (`src/lib/connect/ConnectWeekBudget.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import {
  rolloverConnectWeek, recordConnectWeek, remainingConnects,
  connectsPerWeek, connectRunCap, DEFAULT_CONNECTS_PER_WEEK
} from './ConnectWeekBudget'
import type { Rng } from '../ports'

const rng = (v: number): Rng => ({ next: () => v })

describe('ConnectWeekBudget', () => {
  it('rolls over: same week keeps used, new week resets', () => {
    const a = rolloverConnectWeek({ week: '2026-W26', used: 5 }, '2026-W26')
    expect(a.used).toBe(5)
    const b = rolloverConnectWeek({ week: '2026-W26', used: 5 }, '2026-W27')
    expect(b).toEqual({ week: '2026-W27', used: 0 })
  })

  it('records and computes remaining (never negative)', () => {
    const s = recordConnectWeek({ week: 'w', used: 0 }, 3)
    expect(s.used).toBe(3)
    expect(remainingConnects(s, 100)).toBe(97)
    expect(remainingConnects({ week: 'w', used: 120 }, 100)).toBe(0)
  })

  it('connectsPerWeek reads the smart_connect module dailyLimit, default 100', () => {
    expect(connectsPerWeek([{ id: 'smart_connect', enabled: true, available: true, automationLevel: 'manual', dailyLimit: 40 }])).toBe(40)
    expect(connectsPerWeek([])).toBe(DEFAULT_CONNECTS_PER_WEEK)
    expect(connectsPerWeek({ 0: { id: 'smart_connect', dailyLimit: 25 } })).toBe(25) // array-like guard
  })

  it('per-run cap = min(weeklyRemaining, dailyShare) with downward-only jitter', () => {
    // perWeek 100 → dailyShare 14 (round(100/7)). rng=0 → max downward jitter; rng→1 → no jitter.
    expect(connectRunCap(100, 100, rng(1))).toBe(14)
    expect(connectRunCap(100, 100, rng(0))).toBeLessThan(14)
    expect(connectRunCap(100, 100, rng(0))).toBeGreaterThanOrEqual(0)
    // never exceeds the weekly remaining
    expect(connectRunCap(3, 100, rng(1))).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/connect/ConnectWeekBudget.test.ts`
Expected: FAIL — cannot find module `./ConnectWeekBudget`.

- [ ] **Step 3: Write minimal implementation** (`src/lib/connect/ConnectWeekBudget.ts`)

```ts
import type { ModuleState } from '../types'
import type { Rng } from '../ports'
import { asArray } from '../engagement/settings'
export { isoWeekKey } from '../content/PostWeekBudget'

export const CONNECT_WEEK_BUDGET_KEY = 'connects:budget'
export const DEFAULT_CONNECTS_PER_WEEK = 100

/** Persisted week-keyed connects/week counter (ISO-week, mirrors PostWeek). */
export interface ConnectWeek {
  week: string
  used: number
}

export function rolloverConnectWeek(prev: ConnectWeek | null, weekKey: string): ConnectWeek {
  if (prev && prev.week === weekKey) return prev
  return { week: weekKey, used: 0 }
}

export function recordConnectWeek(state: ConnectWeek, n: number): ConnectWeek {
  return { week: state.week, used: state.used + Math.max(0, n) }
}

export function remainingConnects(state: ConnectWeek, limit: number): number {
  return Math.max(0, limit - state.used)
}

/** The weekly connect cap = the smart_connect module's limit input (default 100). */
export function connectsPerWeek(modulesState: unknown): number {
  const m = asArray<ModuleState>(modulesState).find((x) => x?.id === 'smart_connect')
  return typeof m?.dailyLimit === 'number' && m.dailyLimit > 0 ? m.dailyLimit : DEFAULT_CONNECTS_PER_WEEK
}

/**
 * How many to attempt THIS run. Firing the whole weekly budget in one walk-away run
 * = instant restriction, so cap at a daily share with DOWNWARD-only jitter, bounded by
 * the weekly remaining. Pure (jitter via the Rng port).
 */
export function connectRunCap(weeklyRemaining: number, perWeek: number, rng: Rng): number {
  const dailyShare = Math.max(1, Math.round(perWeek / 7))
  const maxDown = Math.ceil(dailyShare * 0.4)
  const jittered = dailyShare - Math.floor(rng.next() * (maxDown + 1)) // [dailyShare-maxDown, dailyShare]
  return Math.max(0, Math.min(weeklyRemaining, jittered))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/connect/ConnectWeekBudget.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/connect/ConnectWeekBudget.ts src/lib/connect/ConnectWeekBudget.test.ts
git commit -m "feat(connect): weekly budget + downward-jitter per-run cap (core)"
```

---

### Task 4: selectCandidates (core)

**Files:**
- Create: `src/lib/connect/selectCandidates.ts`
- Test: `src/lib/connect/selectCandidates.test.ts`

**Interfaces:**
- Consumes: `PersonCandidate`
- Produces: `selectCandidates(harvested: PersonCandidate[], sent: Set<string>, cap: number): PersonCandidate[]`

- [ ] **Step 1: Write the failing test** (`src/lib/connect/selectCandidates.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { selectCandidates } from './selectCandidates'
import type { PersonCandidate } from '../types'

const p = (id: string): PersonCandidate => ({ memberId: id, name: id, headline: '', profileUrl: '' })

describe('selectCandidates', () => {
  it('drops already-sent ids and applies the cap', () => {
    const out = selectCandidates([p('1'), p('2'), p('3')], new Set(['2']), 1)
    expect(out.map((c) => c.memberId)).toEqual(['1'])
  })

  it('returns [] when cap is 0 or all are already sent', () => {
    expect(selectCandidates([p('1')], new Set(), 0)).toEqual([])
    expect(selectCandidates([p('1')], new Set(['1']), 5)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/connect/selectCandidates.test.ts`
Expected: FAIL — cannot find module `./selectCandidates`.

- [ ] **Step 3: Write minimal implementation** (`src/lib/connect/selectCandidates.ts`)

```ts
import type { PersonCandidate } from '../types'

/** Fresh (not-yet-sent) candidates, capped to this run's allowance. Pure. */
export function selectCandidates(
  harvested: PersonCandidate[],
  sent: Set<string>,
  cap: number
): PersonCandidate[] {
  return harvested.filter((c) => !sent.has(c.memberId)).slice(0, Math.max(0, cap))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/connect/selectCandidates.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/connect/selectCandidates.ts src/lib/connect/selectCandidates.test.ts
git commit -m "feat(connect): candidate selection (dedup vs sent-set + cap) (core)"
```

---

### Task 5: harvestPeople adapter (content, boundary test vs real HTML)

**Files:**
- Create: `src/content/harvestPeople.ts`
- Create: `src/content/__fixtures__/people-search-card.ts` (real captured HTML)
- Test: `src/content/harvestPeople.test.ts`

**Interfaces:**
- Consumes: `PersonCandidate`
- Produces: `harvestPeople(root: ParentNode): PersonCandidate[]`

- [ ] **Step 1: Create the fixture** (`src/content/__fixtures__/people-search-card.ts`) — real DOM captured live (svg/img stripped). Two connectable cards (a recruiter + a dev — both are valid targets) and one Follow-only control that must be EXCLUDED.

```ts
// Captured live 2026-06-26 from a real authorised people-search (read-only).
// Structure is what harvestPeople must parse; hashed classes are irrelevant.
export const PEOPLE_SEARCH_HTML = `
<div id="results">
  <div><figure></figure><div>
    <p><a href="https://www.linkedin.com/in/olena-diachenko-2a5784266/?x=1">Olena Diachenko</a><span><span> • 2nd</span></span></p>
    <div><p><span>Frontend Developer | JavaScript | React | TypeScript</span></p></div>
    <div><p><span>Kyiv, Kyiv City, Ukraine</span></p></div>
  </div><div><div componentkey="SearchResultsACoAAEFBGJ0">
    <a href="/preload/search-custom-invite/?vanityName=olena" componentkey="ConnectButtonstate:invitation:urn:li:member:1094785181_connect" aria-label="Invite Olena Diachenko to connect"><span><span>Connect</span></span></a>
  </div></div></div>
  <div><figure></figure><div>
    <p><a href="https://www.linkedin.com/in/predrag-vasic-18a273142/">Predrag Vasic</a><span><span> • 2nd</span></span></p>
    <div><p><span>Talent Acquisition Specialist | Technical Recruiter | IT Recruiter</span></p></div>
    <div><p><span>Serbia</span></p></div>
  </div><div><div componentkey="SearchResultsACoAACKRBDo">
    <a href="/preload/search-custom-invite/?vanityName=predrag" componentkey="ConnectButtonstate:invitation:urn:li:member:579929146_connect" aria-label="Invite Predrag Vasic to connect"><span><span>Connect</span></span></a>
  </div></div></div>
  <div><figure></figure><div>
    <p><a href="https://www.linkedin.com/in/shubh-yadav/">Shubh Yadav</a><span><span> • 2nd</span></span></p>
    <div><p><span>Engineering Recruiter</span></p></div>
  </div><div>
    <button aria-label="Follow Shubh Yadav">Follow</button>
  </div></div>
</div>`
```

- [ ] **Step 2: Write the failing test** (`src/content/harvestPeople.test.ts`)

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { harvestPeople } from './harvestPeople'
import { PEOPLE_SEARCH_HTML } from './__fixtures__/people-search-card'

describe('harvestPeople (real card HTML boundary)', () => {
  beforeEach(() => { document.body.innerHTML = PEOPLE_SEARCH_HTML })

  it('parses connectable cards with memberId, name, headline, profileUrl', () => {
    const people = harvestPeople(document)
    expect(people).toEqual([
      { memberId: '1094785181', name: 'Olena Diachenko', headline: 'Frontend Developer | JavaScript | React | TypeScript', profileUrl: 'https://www.linkedin.com/in/olena-diachenko-2a5784266/' },
      { memberId: '579929146', name: 'Predrag Vasic', headline: 'Talent Acquisition Specialist | Technical Recruiter | IT Recruiter', profileUrl: 'https://www.linkedin.com/in/predrag-vasic-18a273142/' }
    ])
  })

  it('excludes Follow-only people (no Connect anchor)', () => {
    expect(harvestPeople(document).some((p) => p.name === 'Shubh Yadav')).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/content/harvestPeople.test.ts`
Expected: FAIL — cannot find module `./harvestPeople`.

- [ ] **Step 4: Write minimal implementation** (`src/content/harvestPeople.ts`)

```ts
import type { PersonCandidate } from '@lib/types'

const CONNECT_ANCHOR = 'a[aria-label^="Invite "][aria-label$=" to connect"]'

/**
 * Parse connectable people from a LinkedIn people-search results DOM.
 * Anchors off the Connect `<a>` (NOT a button), reads memberId from its componentkey,
 * walks up to the card to read the headline (the 2nd <p>). Structural, jsdom-safe.
 */
export function harvestPeople(root: ParentNode): PersonCandidate[] {
  const out: PersonCandidate[] = []
  const seen = new Set<string>()
  for (const a of root.querySelectorAll<HTMLAnchorElement>(CONNECT_ANCHOR)) {
    const member = (a.getAttribute('componentkey') ?? '').match(/urn:li:member:(\d+)/)?.[1]
    if (!member || seen.has(member)) continue
    let card: Element | null = a.parentElement
    while (card && !card.querySelector('a[href*="/in/"]')) card = card.parentElement
    if (!card) continue
    const profile = card.querySelector<HTMLAnchorElement>('a[href*="/in/"]')
    const ps = card.querySelectorAll('p')
    seen.add(member)
    out.push({
      memberId: member,
      name: (a.getAttribute('aria-label') ?? '').replace(/^Invite /, '').replace(/ to connect$/, ''),
      headline: (ps[1]?.textContent ?? '').trim(),
      profileUrl: (profile?.getAttribute('href') ?? '').split('?')[0]
    })
  }
  return out
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/content/harvestPeople.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/content/harvestPeople.ts src/content/__fixtures__/people-search-card.ts src/content/harvestPeople.test.ts
git commit -m "feat(connect): harvestPeople parser + real-HTML boundary test"
```

---

### Task 6: executeConnect adapter (shadow-DOM, boundary test)

**Files:**
- Modify: `src/content/domActions.ts` (add `executeConnect` + 2 selectors; reuse `waitForValue`/`waitForCond`/`sleep`)
- Test: `src/content/domActions.connect.test.ts`

**Interfaces:**
- Consumes: `HumanDelay`, `ActionResult` (already in `domActions.ts`)
- Produces: `executeConnect(root: Document, candidate: { memberId: string; name: string }, delay: HumanDelay): Promise<ActionResult>`

- [ ] **Step 1: Write the failing test** (`src/content/domActions.connect.test.ts`)

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { executeConnect } from './domActions'
import { HumanDelay } from '@lib/engagement/HumanDelay'

const delay = new HumanDelay({ next: () => 0 }) // zero waits in tests

/** Build a search card + a pre-rendered invite modal in the interop shadow root. */
function setup() {
  document.body.innerHTML = ''
  const a = document.createElement('a')
  a.setAttribute('componentkey', 'ConnectButtonstate:invitation:urn:li:member:123_connect')
  a.setAttribute('aria-label', 'Invite Test User to connect')
  document.body.appendChild(a)
  const host = document.createElement('div')
  host.id = 'interop-outlet'
  const sr = host.attachShadow({ mode: 'open' })
  document.body.appendChild(host)
  // Real LinkedIn JS opens the modal on click; jsdom can't, so attach the Send button
  // when the anchor is clicked (simulating the async modal render).
  a.addEventListener('click', () => {
    const send = document.createElement('button')
    send.setAttribute('aria-label', 'Send without a note')
    send.addEventListener('click', () => send.remove()) // sending closes the modal
    sr.appendChild(send)
  })
  return { sr }
}

describe('executeConnect (shadow-DOM boundary)', () => {
  it('clicks Connect, then Send without a note, and confirms the modal closed', async () => {
    setup()
    const res = await executeConnect(document, { memberId: '123', name: 'Test User' }, delay)
    expect(res).toEqual({ ok: true })
  })

  it('fails cleanly when the connect anchor is missing', async () => {
    document.body.innerHTML = ''
    const res = await executeConnect(document, { memberId: '999', name: 'X' }, delay)
    expect(res).toEqual({ ok: false, reason: 'connect_anchor_not_found' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/content/domActions.connect.test.ts`
Expected: FAIL — `executeConnect` is not exported.

- [ ] **Step 3: Add selectors + implementation to `src/content/domActions.ts`** (after `executeComposerPost`, before `dismissComposer`; reuse existing helpers)

```ts
// ── Smart Connect: people-search invite. Connect control is an <a>; the invite
// modal renders ASYNC in the #interop-outlet shadow root (same host as composer).
// See docs/linkedin-dom-anchors.md "Smart Connect". ──
const SEND_NO_NOTE = 'button[aria-label="Send without a note"]'
const INVITE_DISMISS = 'button[aria-label="Dismiss"]'

/** The live invite-modal's "Send without a note" button (re-queried each poll). */
function findSendNoNote(root: ParentNode): HTMLButtonElement | null {
  const shadow = (root.querySelector(SHADOW_HOST) as HTMLElement | null)?.shadowRoot ?? null
  return shadow?.querySelector<HTMLButtonElement>(SEND_NO_NOTE) ?? null
}

/**
 * Send a bare connection request to a harvested candidate: click the Connect `<a>`
 * (located by member id), wait for the shadow invite modal, click "Send without a
 * note", confirm it closed. On failure → Dismiss. Edge — the real send is exercised
 * live, not in jsdom.
 */
export async function executeConnect(
  root: Document,
  candidate: { memberId: string; name: string },
  delay: HumanDelay
): Promise<ActionResult> {
  const anchor = root.querySelector<HTMLElement>(
    `a[componentkey*="member:${candidate.memberId}_connect"]`
  )
  if (!anchor) return { ok: false, reason: 'connect_anchor_not_found' }
  anchor.click()

  const send = await waitForValue(() => findSendNoNote(root), 6000)
  if (!send) {
    ;(root.querySelector(SHADOW_HOST) as HTMLElement | null)?.shadowRoot
      ?.querySelector<HTMLElement>(INVITE_DISMISS)
      ?.click()
    return { ok: false, reason: 'send_button_not_found' }
  }
  await sleep(delay.nextMs(300, 900)) // brief human pause before sending
  send.click()

  const closed = await waitForCond(() => findSendNoNote(root) === null, 6000)
  if (!closed) return { ok: false, reason: 'modal_did_not_close' }
  return { ok: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/content/domActions.connect.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/content/domActions.ts src/content/domActions.connect.test.ts
git commit -m "feat(connect): executeConnect shadow-DOM adapter + boundary test"
```

---

### Task 7: Content message wiring (HARVEST_PEOPLE + connect action)

**Files:**
- Modify: `src/lib/types.ts` (add `HARVEST_PEOPLE` to `BeaconMessage`, ~line 292)
- Modify: `src/content/index.ts` (import `harvestPeople`/`executeConnect`; handle `HARVEST_PEOPLE`; `connect` branch in `runAction`; exhaustive switch)

**Interfaces:**
- Consumes: `harvestPeople`, `executeConnect`, `PersonCandidate`
- Produces: message `{ type: 'HARVEST_PEOPLE' }` → content replies `PersonCandidate[]`; `EXECUTE_ACTION` with `action.type === 'connect'` (candidate in `target.meta`).

This is plumbing — verified by `npm run build` (exhaustive `assertNever` switch enforces completeness) plus the existing adapter tests from Tasks 5–6.

- [ ] **Step 1: Add the message variant to `src/lib/types.ts`** (in the `BeaconMessage` union, next to `PUBLISH_POST`)

```ts
  | { type: 'HARVEST_PEOPLE' }
```

- [ ] **Step 2: Wire `src/content/index.ts`**

Add to the imports (line 16 group):
```ts
import { executeComment, executeLike, executeComposerPost, executeConnect } from './domActions'
import { harvestPeople } from './harvestPeople'
```

Add a case in the `onMessage` switch (next to `REQUEST_FEED_POSTS`):
```ts
    case 'HARVEST_PEOPLE':
      sendResponse(harvestPeople(document))
      return false
```

Add the `connect` branch in `runAction` (before the final `return { ok: false, ... }`):
```ts
  if (action.type === 'connect') {
    const meta = action.target.meta ?? {}
    return executeConnect(document, { memberId: String(meta.memberId ?? ''), name: String(meta.name ?? '') }, delay)
  }
```

- [ ] **Step 3: Verify the build (exhaustive switch + types)**

Run: `npm run build`
Expected: PASS — no `vue-tsc` error. (If `HARVEST_PEOPLE` is missing a content case, `assertNever` fails the build — that's the guard working.)

- [ ] **Step 4: Run the full suite (no regressions)**

Run: `npx vitest run`
Expected: PASS (all existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/content/index.ts
git commit -m "feat(connect): wire HARVEST_PEOPLE + connect action into the content script"
```

---

### Task 8: runConnectStep SW handler (unit-tested with fakes)

**Files:**
- Create: `src/service-worker/connectHandlers.ts`
- Test: `src/service-worker/connectHandlers.test.ts`

**Interfaces:**
- Consumes: `KeyValueStore`, `Clock`, `Rng` ports; `PersonCandidate`; the connect core modules; `enabledModules`
- Produces: `interface ConnectDeps { store; clock; rng; navigate(url): Promise<void>; harvest(): Promise<PersonCandidate[]>; connect(c): Promise<{ok:boolean;reason?:string}|undefined>; pace(): Promise<void> }`,
  `runConnectStep(deps): Promise<{ executed: number; skipped: number; reason?: string }>`

- [ ] **Step 1: Write the failing test** (`src/service-worker/connectHandlers.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest'
import { runConnectStep } from './connectHandlers'
import { CONNECT_WEEK_BUDGET_KEY } from '@lib/connect/ConnectWeekBudget'
import { CONNECT_SENT_KEY } from './connectHandlers'
import type { PersonCandidate } from '@lib/types'

function deps(over: Partial<Record<string, unknown>> = {}) {
  const m = new Map<string, unknown>()
  m.set('modules:state', [{ id: 'smart_connect', enabled: true, available: true, automationLevel: 'manual', dailyLimit: 100 }])
  m.set('connect:settings', { searchKeywords: 'frontend recruiter' })
  const cand = (id: string): PersonCandidate => ({ memberId: id, name: id, headline: 'Recruiter', profileUrl: `/in/${id}` })
  return {
    store: { get: async <T>(k: string) => (m.get(k) as T) ?? null, set: async (k: string, v: unknown) => void m.set(k, v) },
    clock: { now: () => new Date('2026-06-26T00:00:00Z') },
    rng: { next: () => 1 }, // no downward jitter → dailyShare = 14
    navigate: vi.fn(async () => {}),
    harvest: vi.fn(async () => [cand('1'), cand('2')]),
    connect: vi.fn(async () => ({ ok: true })),
    pace: vi.fn(async () => {}),
    _m: m,
    ...over
  }
}

describe('runConnectStep', () => {
  it('navigates, harvests, connects fresh candidates, records week + sent-set', async () => {
    const d = deps()
    const res = await runConnectStep(d)
    expect(d.navigate).toHaveBeenCalledWith('https://www.linkedin.com/search/results/people/?keywords=frontend%20recruiter')
    expect(d.connect).toHaveBeenCalledTimes(2)
    expect(res.executed).toBe(2)
    expect(d._m.get(CONNECT_WEEK_BUDGET_KEY)).toMatchObject({ used: 2 })
    expect(d._m.get(CONNECT_SENT_KEY)).toEqual(['1', '2'])
  })

  it('skips already-sent candidates across runs', async () => {
    const d = deps()
    d._m.set(CONNECT_SENT_KEY, ['1'])
    const res = await runConnectStep(d)
    expect(d.connect).toHaveBeenCalledTimes(1)
    expect(res.executed).toBe(1)
  })

  it('returns early when the module is disabled', async () => {
    const d = deps()
    d._m.set('modules:state', [{ id: 'smart_connect', enabled: false, available: true, automationLevel: 'manual', dailyLimit: 100 }])
    const res = await runConnectStep(d)
    expect(res).toEqual({ executed: 0, skipped: 0, reason: 'disabled' })
    expect(d.navigate).not.toHaveBeenCalled()
  })

  it('returns early when the weekly budget is exhausted', async () => {
    const d = deps()
    d._m.set(CONNECT_WEEK_BUDGET_KEY, { week: '2026-W26', used: 100 })
    const res = await runConnectStep(d)
    expect(res.reason).toBe('budget')
    expect(d.harvest).not.toHaveBeenCalled()
  })

  it('returns early when there are no search keywords', async () => {
    const d = deps()
    d._m.set('connect:settings', { searchKeywords: '' })
    const res = await runConnectStep(d)
    expect(res.reason).toBe('no_keywords')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/service-worker/connectHandlers.test.ts`
Expected: FAIL — cannot find module `./connectHandlers`.

- [ ] **Step 3: Write minimal implementation** (`src/service-worker/connectHandlers.ts`)

```ts
// SW-side Smart Connect orchestration. Deps injected → unit-testable with fakes.
import type { Clock, KeyValueStore, Rng } from '@lib/ports'
import type { PersonCandidate } from '@lib/types'
import { asArray } from '@lib/engagement/settings'
import { enabledModules } from '@lib/autopilot/startGate'
import { peopleSearchUrl } from '@lib/connect/peopleSearchUrl'
import { loadConnectSettings } from '@lib/connect/settings'
import { selectCandidates } from '@lib/connect/selectCandidates'
import {
  isoWeekKey, rolloverConnectWeek, recordConnectWeek, remainingConnects,
  connectsPerWeek, connectRunCap, CONNECT_WEEK_BUDGET_KEY, type ConnectWeek
} from '@lib/connect/ConnectWeekBudget'

export const CONNECT_SENT_KEY = 'connects:sent'

export interface ConnectDeps {
  store: KeyValueStore
  clock: Clock
  rng: Rng
  navigate: (url: string) => Promise<void>
  harvest: () => Promise<PersonCandidate[]>
  connect: (c: PersonCandidate) => Promise<{ ok: boolean; reason?: string } | undefined>
  pace: () => Promise<void>
}

export interface ConnectStepResult {
  executed: number
  skipped: number
  reason?: string
}

/**
 * One Smart Connect pass inside the run: gate on module + weekly budget + keywords,
 * navigate to the people-search, harvest, select (dedup vs sent-set + per-run cap),
 * send bare invites with human pacing, persist the week usage + sent-set.
 */
export async function runConnectStep(deps: ConnectDeps): Promise<ConnectStepResult> {
  const modulesState = await deps.store.get('modules:state')
  if (!enabledModules(modulesState).some((m) => m.id === 'smart_connect')) {
    return { executed: 0, skipped: 0, reason: 'disabled' }
  }
  const perWeek = connectsPerWeek(modulesState)
  const budget = rolloverConnectWeek(
    (await deps.store.get<ConnectWeek>(CONNECT_WEEK_BUDGET_KEY)) ?? null,
    isoWeekKey(deps.clock.now())
  )
  const weeklyRemaining = remainingConnects(budget, perWeek)
  if (weeklyRemaining <= 0) return { executed: 0, skipped: 0, reason: 'budget' }
  const cap = connectRunCap(weeklyRemaining, perWeek, deps.rng)
  if (cap <= 0) return { executed: 0, skipped: 0 }

  const { searchKeywords } = await loadConnectSettings(deps.store)
  if (!searchKeywords.trim()) return { executed: 0, skipped: 0, reason: 'no_keywords' }

  await deps.navigate(peopleSearchUrl(searchKeywords))
  const harvested = await deps.harvest()
  const sent = new Set(asArray<string>(await deps.store.get<string[]>(CONNECT_SENT_KEY)))
  const chosen = selectCandidates(harvested, sent, cap)

  const newlySent: string[] = []
  for (const c of chosen) {
    const res = await deps.connect(c)
    if (res?.ok) newlySent.push(c.memberId)
    await deps.pace()
  }
  if (newlySent.length) {
    await deps.store.set(CONNECT_SENT_KEY, [...sent, ...newlySent])
    await deps.store.set(CONNECT_WEEK_BUDGET_KEY, recordConnectWeek(budget, newlySent.length))
  }
  return { executed: newlySent.length, skipped: harvested.length - newlySent.length }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/service-worker/connectHandlers.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/service-worker/connectHandlers.ts src/service-worker/connectHandlers.test.ts
git commit -m "feat(connect): runConnectStep SW orchestration + unit tests"
```

---

### Task 9: Wire the connect step into the one-button run

**Files:**
- Modify: `src/service-worker/index.ts` (`startAutopilot` — run connects before launching the engagement loop; add a `navigateLinkedInTab` helper; import `runConnectStep`)

**Interfaces:**
- Consumes: `runConnectStep`, `ConnectDeps`; existing `sendToLinkedInTab`, `reinjectContentScript`, `activeLinkedInTab`, `clock`, `delay`-equivalent.

**Approach (V1):** Connects run as the FIRST step of the launch sequence (simplest — no need to detect the engagement loop's end), then the tab returns to the feed and the existing engagement loop launches. Both are part of the single «Запустить». Navigating the tab re-injects the content script; `sendToLinkedInTab` already re-injects on failure.

- [ ] **Step 1: Add the navigate helper** (`src/service-worker/index.ts`, near `reinjectContentScript`)

```ts
/** Navigate the LinkedIn tab to a URL and wait until its content script answers PING. */
async function navigateLinkedInTab(tabId: number, url: string): Promise<void> {
  await chrome.tabs.update(tabId, { url })
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'PING' }).catch(() => null)
    if (pong) return
  }
}
```

- [ ] **Step 2: Add the connect-step runner** (`src/service-worker/index.ts`; import at top: `import { runConnectStep } from './connectHandlers'`)

```ts
/** Run the Smart Connect step against `tabId`, then return the tab to the feed. */
async function runConnectsThen(tabId: number, afterUrl: string): Promise<void> {
  const rng = new MathRandomRng()
  const pacer = new HumanDelay(rng)
  await runConnectStep({
    store, clock, rng,
    navigate: (url) => navigateLinkedInTab(tabId, url),
    harvest: async () =>
      (await chrome.tabs.sendMessage(tabId, { type: 'HARVEST_PEOPLE' }).catch(() => [])) ?? [],
    connect: (c) =>
      chrome.tabs
        .sendMessage(tabId, {
          type: 'EXECUTE_ACTION',
          action: { type: 'connect', target: { url: c.profileUrl, meta: { memberId: c.memberId, name: c.name } } }
        })
        .catch(() => undefined),
    pace: () => sleep(pacer.nextMs(8000, 30000))
  })
  await navigateLinkedInTab(tabId, afterUrl)
}
```

(Ensure `HumanDelay` and `MathRandomRng` are imported in `index.ts` — add `import { HumanDelay } from '@lib/engagement/HumanDelay'` if absent; `MathRandomRng` is already imported as `autopilotRng` uses it.)

- [ ] **Step 3: Invoke it in `startAutopilot`'s launch** (`src/service-worker/index.ts` ~line 142). Replace the `launch` body so connects run first when the module is enabled:

```ts
  const connectEnabled = enabledModules(modulesState).some((m) => m.id === 'smart_connect')
  const launch = async () => {
    if (tabId && connectEnabled) {
      await runConnectsThen(tabId, 'https://www.linkedin.com/feed/')
    }
    if (await startLoop()) return
    // Couldn't reach the page — roll back so the UI doesn't show a phantom "running".
    const s = await autopilotState()
    if (s) {
      s.running = false
      await saveAutopilot(s)
      broadcastStatus(s)
    }
  }
```

(`enabledModules` is already imported via `startGate` in `index.ts`; if not, add it.)

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: PASS (no type errors).

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add src/service-worker/index.ts
git commit -m "feat(connect): run Smart Connect step inside the one-button launch"
```

---

### Task 10: UI — smart_connect module card + keywords field

**Files:**
- Modify: `src/sidepanel/composables/useModules.ts` (smart_connect → `available: true`, `dailyLimit: 100`)
- Modify: `src/sidepanel/screens/ModulesScreen.vue` (label the limit "в неделю"; add «Кого искать» field bound to `connect:settings`)
- Test: `src/sidepanel/composables/useModules.spec.ts` (update the smart_connect availability expectation)

**Interfaces:**
- Consumes: `loadConnectSettings`/`saveConnectSettings`/`defaultConnectKeywords` (Task 2), `loadSettings` for expertise.

- [ ] **Step 1: Update the failing spec** (`src/sidepanel/composables/useModules.spec.ts`)

Change the smart_connect expectation from `available).toBe(false)` to `available).toBe(true)` (both the default-roster assertion ~line 25 and the merge assertion ~line 45 that pins availability). Run it first to see it fail against the current default.

Run: `npx vitest run src/sidepanel/composables/useModules.spec.ts`
Expected: FAIL (current default is `available: false`).

- [ ] **Step 2: Flip the default** (`src/sidepanel/composables/useModules.ts:13`)

```ts
    { id: 'smart_connect', enabled: false, automationLevel: 'manual', available: true, dailyLimit: 100 },
```

- [ ] **Step 3: Run the spec to verify it passes**

Run: `npx vitest run src/sidepanel/composables/useModules.spec.ts`
Expected: PASS.

- [ ] **Step 4: Update `ModulesScreen.vue`** — the smart_connect `ModuleCard` (~line 46): remove the «Скоро» (it follows `available`), keep the existing limit input but pass a weekly label, and add a keywords text field below it. Load/save `connect:settings` on mount/change:

```vue
<script setup lang="ts">
// add to existing imports:
import { ref, onMounted } from 'vue'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { loadConnectSettings, saveConnectSettings, defaultConnectKeywords } from '@lib/connect/settings'
import { loadSettings } from '@lib/engagement/settings'
import { panelBus } from '../lib/panelBus'

const connectKeywords = ref('')
const store = new ChromeStorageStore()
onMounted(async () => {
  if (!panelBus.available()) return
  const s = await loadConnectSettings(store)
  if (s.searchKeywords.trim()) { connectKeywords.value = s.searchKeywords; return }
  const { expertise } = await loadSettings(store)
  connectKeywords.value = defaultConnectKeywords(expertise)
})
function saveKeywords() {
  if (panelBus.available()) void saveConnectSettings(store, { searchKeywords: connectKeywords.value })
}
</script>
```

In the smart_connect `ModuleCard` block add the field (match the demo's input styling — verify against `docs/design-reference.html`):

```vue
      <label class="field">
        <span>Кого искать</span>
        <input v-model="connectKeywords" @change="saveKeywords" placeholder="frontend recruiter" />
      </label>
```

- [ ] **Step 5: Verify build + suite**

Run: `npm run build && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/composables/useModules.ts src/sidepanel/composables/useModules.spec.ts src/sidepanel/screens/ModulesScreen.vue
git commit -m "feat(connect): smart_connect module card available + «Кого искать» field"
```

---

### Task 11: Live verification + memory

**Files:** none (verification) → then memory-bank updates.

- [ ] **Step 1: Build + load unpacked**

Run: `npm run build` → load `dist/` in `chrome://extensions` (or reload).

- [ ] **Step 2: Live executeConnect (Vlad authorises ONE real connect)**

Open a people-search (e.g. `frontend recruiter`). Via the docked panel, enable smart_connect (limit 100), set «Кого искать», press «Запустить». Confirm: the tab navigates to search, ONE invite sends (a card flips to "Pending"), pacing is human, then it returns to the feed and the like loop runs. Verify the weekly counter + sent-set in `chrome.storage`. **Withdraw the test invite** from My Network → Sent invitations.

- [ ] **Step 3: Re-run guard check**

Press «Запустить» again — confirm already-sent people are NOT re-targeted (sent-set works).

- [ ] **Step 4: Verify the full suite + build once more**

Run: `npx vitest run && npm run build`
Expected: PASS / clean.

- [ ] **Step 5: Update memory-bank** (`progress.md` — Smart Connect shipped + live-verified; `gotchas.md` if any live surprise; confirm `docs/linkedin-dom-anchors.md` matches reality). Commit.

```bash
git add .claude/context/linkedin-beacon/
git commit -m "docs(memory): Smart Connect shipped + live-verified"
```

---

## Self-Review

**Spec coverage:** surface=search (Tasks 1,5,6,9) · broad targets/no scorer (Task 5 harvest, no filter) · bare invite (Task 6) · weekly+per-run budget (Task 3) · sent-set (Tasks 4,8) · keywords field (Tasks 2,10) · one-button integration (Task 9) · skip non-connectable (Task 5 — only Connect anchors) · search-limit banner detection → **gap**: deferred (note below). All other spec sections covered.

**Deferred from spec (intentional, low-risk for V1):** the search commercial-use-limit banner detection (spec §4) — not hit during recon; if it appears live (Task 11), add a banner check in `harvestPeople` (return `[]`) or `runConnectStep` (abort) as a fast follow. Flagged here so it isn't silently dropped.

**Placeholder scan:** none — every code/test step has real content.

**Type consistency:** `PersonCandidate { memberId, name, headline, profileUrl }` consistent across Tasks 1/5/6/8. `connect` ActionType reused (not redefined). `ConnectWeek`, `connectsPerWeek`, `connectRunCap`, `selectCandidates`, `CONNECT_*` keys consistent. `runConnectStep` deps (`navigate/harvest/connect/pace`) match the Task 9 wiring.
