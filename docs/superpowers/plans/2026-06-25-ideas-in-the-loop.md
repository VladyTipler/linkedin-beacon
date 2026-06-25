# Ideas-in-the-Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While the autopilot run scrolls the feed for likes, passively collect the posts it already harvests and, once per run, batch-extract **grounded** content ideas into the bank — no new button, no extra scroll.

**Architecture:** Hexagon, dependencies inward. Pure core (`Idea.spark`, `IdeaExtractor`, `IdeaDayBudget`, `DraftGenerator`, `runLoopModules`) is unit-tested; the SW orchestrates LLM extraction (`contentHandlers.extractRunIdeas`, crosses the real OpenRouter mapper); the content loop is the only DOM edge. The run reuses `FeedAccumulator` as the signal buffer and the existing `generateIdeas` LLM plumbing.

**Tech Stack:** Chrome MV3, Vue 3.5 + TS, Vite 6, Vitest. LLM behind `LlmProvider`/`HttpClient`+`HttpGet`. Spec: `docs/superpowers/specs/2026-06-25-ideas-in-the-loop-design.md`.

## Global Constraints

- File ≤ 300 lines, one responsibility (SOLID). Core never imports `chrome`/`document`/`fetch`.
- TDD: failing test → minimal code → green → commit. `npx vitest run` green + `npm run build` clean before "done". `git status` clean after each task.
- **Boundary rule (law):** the LLM boundary MUST be crossed by a test — a fake `HttpClient & HttpGet` returning the **real** OpenRouter shape `{choices:[{message:{content}}]}`, so the real mapper runs.
- Every NEW `BeaconMessage` variant gets a no-op `case` in the content `assertNever` switch (`src/content/index.ts`) or `vue-tsc` fails. SW switch is lenient (`default: return false`).
- `chrome.storage` array reads use `asArray`/`Array.isArray` guards (the array-as-object gotcha).
- Constants (spec §8): `IDEA_TARGET = 25`, `IDEA_FLOOR = 8`, default ideas/day = `5`.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit directly to `main` (solo).

---

## File Structure

**Create**
- `src/lib/ideas/IdeaDayBudget.ts` — day-keyed ideas/day budget + `ideasPerDayLimit` (pure).
- `src/lib/ideas/IdeaDayBudget.test.ts`

**Modify**
- `src/lib/types.ts` — `IdeaSpark`, `Idea.spark?`; `AUTOPILOT_RUN_LOOP` payload; new `EXTRACT_RUN_IDEAS`.
- `src/lib/ideas/IdeaExtractor.ts` (+ `.test.ts`) — prompt asks sourceIndex/claim/quote; parser maps to `spark`.
- `src/lib/content/DraftGenerator.ts` (+ `.test.ts`) — ground the draft in `idea.spark` when present.
- `src/lib/autopilot/startGate.ts` (+ `startGate.test.ts`) — add `runLoopModules`.
- `src/service-worker/contentHandlers.ts` (+ `contentHandlers.test.ts`) — add `extractRunIdeas`.
- `src/service-worker/index.ts` — `sendRunLoop` carries modules; handle `EXTRACT_RUN_IDEAS`.
- `src/content/index.ts` — loop buffers + conditional like + extract trigger; RUN_LOOP reads modules; no-op case.
- `src/sidepanel/composables/useModules.ts` (+ `useModules.spec.ts`) — content `available:true`, ideas/day default.
- `src/sidepanel/screens/ModulesScreen.vue` — content card labels (ideas/day).
- `src/sidepanel/screens/ContentScreen.vue` — show `spark` provenance on the idea card.

---

## Task 1: `Idea.spark` + grounded `IdeaExtractor`

**Files:**
- Modify: `src/lib/types.ts` (Idea interface)
- Modify: `src/lib/ideas/IdeaExtractor.ts`
- Test: `src/lib/ideas/IdeaExtractor.test.ts`

**Interfaces:**
- Produces: `IdeaSpark = { claim: string; quote: string; source?: { author: string; id: string } }`; `Idea = { topic: string; angle: string; spark?: IdeaSpark }`; `parseIdeas(raw: string, posts: FeedItem[]): Idea[]`.

- [ ] **Step 1: Write the failing test** — in `src/lib/ideas/IdeaExtractor.test.ts`, (a) add `parseIdeas` to the existing import line so it reads `import { IdeaExtractor, parseIdeas } from './IdeaExtractor'`, then (b) append a new describe block that REUSES the file's existing `posts` const (`posts[0]` = `{ id: '1', author: 'Dev A' }`):

```ts
describe('parseIdeas spark grounding', () => {
  it('maps sourceIndex (1-based) to provenance + keeps claim/quote', () => {
    const raw = JSON.stringify([
      { topic: 'Architecture', angle: 'Pragmatism', sourceIndex: 1, claim: 'Speed over purity', quote: 'ship fast' }
    ])
    const [idea] = parseIdeas(raw, posts)
    expect(idea.spark).toEqual({
      claim: 'Speed over purity',
      quote: 'ship fast',
      source: { author: 'Dev A', id: '1' }
    })
  })

  it('keeps the idea but omits spark when claim is missing', () => {
    const [idea] = parseIdeas(JSON.stringify([{ topic: 'T', angle: 'A', sourceIndex: 2 }]), posts)
    expect(idea).toEqual({ topic: 'T', angle: 'A' })
    expect(idea.spark).toBeUndefined()
  })

  it('builds spark without source when sourceIndex is out of range', () => {
    const [idea] = parseIdeas(JSON.stringify([{ topic: 'T', angle: 'A', claim: 'C', quote: 'Q', sourceIndex: 9 }]), posts)
    expect(idea.spark).toEqual({ claim: 'C', quote: 'Q' })
  })

  it('still drops entries missing topic or angle', () => {
    const raw = JSON.stringify([{ topic: '', angle: 'A', claim: 'C' }, { topic: 'T', angle: 'A2' }])
    expect(parseIdeas(raw, posts).map((i) => i.angle)).toEqual(['A2'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ideas/IdeaExtractor.test.ts`
Expected: FAIL — `parseIdeas` is called with 2 args but currently takes 1 (`spark` undefined). The existing `extract` tests still compile (they don't call `parseIdeas` directly).

- [ ] **Step 3: Extend the `Idea` type** in `src/lib/types.ts` — replace the `Idea` interface:

```ts
export interface IdeaSpark {
  /** The specific point/tension in the source post worth a take. */
  claim: string
  /** A short snippet from the source as evidence (may be empty). */
  quote: string
  /** Provenance: which feed post sparked it (absent if the model gave a bad index). */
  source?: { author: string; id: string }
}

export interface Idea {
  topic: string
  angle: string
  /** Optional grounding in a real resonating post — the anti-slop anchor. */
  spark?: IdeaSpark
}
```

- [ ] **Step 4: Rewrite the parser + prompt** in `src/lib/ideas/IdeaExtractor.ts`. Replace the `extract` body's `system`/`user`/return, and the whole `parseIdeas` function:

```ts
// inside extract(): replace the system array's last line and the user array, and the return
    const system = [
      'You surface CONTENT IDEAS for the user to post on LinkedIn.',
      `The user is: ${expertise.headline}. Stack: ${expertise.stack.join(', ')}.`,
      'The feed posts below are a SIGNAL of which topics resonate now — NOT examples to imitate.',
      'Do not copy, summarise or paraphrase the posts. Echoing the feed is AI-slop and is forbidden.',
      "Cross each resonant topic with the user's own expertise to produce an original angle.",
      'Ground EACH idea in ONE specific post. Return ONLY a JSON array of',
      '[{"topic": string, "angle": string, "sourceIndex": number, "claim": string, "quote": string}].',
      'sourceIndex = the 1-based number of the post that sparked it. claim = its point/tension worth a take.',
      'quote = a short (<140 char) snippet from that post. No prose outside the JSON.'
    ].join(' ')

    const user = [
      'Feed posts (signal only):',
      ...posts.map((p, i) => `${i + 1}. ${p.excerpt}`),
      'Produce 3–6 ideas as the JSON array.'
    ].join('\n')

    const completion = await this.provider.complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.8,
      maxTokens: 600
    })
    return parseIdeas(completion.text, posts)
```

```ts
// replace the whole parseIdeas function:
interface RawIdea {
  topic: unknown
  angle: unknown
  sourceIndex?: unknown
  claim?: unknown
  quote?: unknown
}

/** Tolerantly parse ideas, grounding each in its source post (spark). Handles ``` fences. */
export function parseIdeas(raw: string, posts: FeedItem[]): Idea[] {
  const json = extractJsonArray(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('IdeaExtractor: model response was not valid JSON')
  }
  if (!Array.isArray(parsed)) {
    throw new Error('IdeaExtractor: expected a JSON array of ideas')
  }
  return parsed
    .filter(
      (e): e is RawIdea =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as RawIdea).topic === 'string' &&
        ((e as RawIdea).topic as string).length > 0 &&
        typeof (e as RawIdea).angle === 'string' &&
        ((e as RawIdea).angle as string).length > 0
    )
    .map((e) => {
      const idea: Idea = { topic: e.topic as string, angle: e.angle as string }
      if (typeof e.claim === 'string' && e.claim.length > 0) {
        const quote = typeof e.quote === 'string' ? e.quote : ''
        const i = typeof e.sourceIndex === 'number' ? e.sourceIndex - 1 : -1
        idea.spark =
          i >= 0 && i < posts.length
            ? { claim: e.claim, quote, source: { author: posts[i].author, id: posts[i].id } }
            : { claim: e.claim, quote }
      }
      return idea
    })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/ideas/IdeaExtractor.test.ts`
Expected: PASS (all, including the pre-existing extract tests — the fake provider just returns the richer JSON or the old shape; old-shape ideas simply have no spark).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/ideas/IdeaExtractor.ts src/lib/ideas/IdeaExtractor.test.ts
git commit -m "feat(ideas): ground ideas in a source-post spark (anti-slop core)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `DraftGenerator` grounds the draft in `spark`

**Files:**
- Modify: `src/lib/content/DraftGenerator.ts`
- Test: `src/lib/content/DraftGenerator.test.ts`

**Interfaces:**
- Consumes: `Idea.spark` (Task 1).
- Produces: unchanged signature `DraftGenerator.generate(idea, expertise, postPrompt): Promise<string>`.

- [ ] **Step 1: Write the failing test** — append a new describe block to `src/lib/content/DraftGenerator.test.ts`, REUSING the file's existing `FakeProvider` class (it captures `.last`), `idea` (no spark) and `expertise`:

```ts
describe('DraftGenerator spark grounding', () => {
  it('feeds the spark claim/quote into the prompt when present', async () => {
    const provider = new FakeProvider('x')
    const sparked: Idea = {
      topic: 'T', angle: 'A',
      spark: { claim: 'Speed over purity', quote: 'ship fast', source: { author: 'Anna', id: 'urn:a' } }
    }
    await new DraftGenerator(provider).generate(sparked, expertise, 'be punchy')
    const joined = provider.last!.messages.map((m) => m.content).join('\n')
    expect(joined).toContain('Speed over purity')
    expect(joined).toContain('ship fast')
    expect(joined).toMatch(/do NOT paraphrase|do not echo/i)
  })

  it('omits spark wording when the idea has no spark', async () => {
    const provider = new FakeProvider('x')
    await new DraftGenerator(provider).generate(idea, expertise, 'be punchy') // existing `idea` has no spark
    expect(provider.last!.messages.map((m) => m.content).join('\n')).not.toMatch(/sparked by/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content/DraftGenerator.test.ts`
Expected: FAIL — prompt lacks the spark lines.

- [ ] **Step 3: Use spark in the prompt** — in `src/lib/content/DraftGenerator.ts` replace the `const user = [...]` block:

```ts
    const user = [
      `Topic: ${idea.topic}`,
      `My angle: ${idea.angle}`,
      ...(idea.spark
        ? [
            '',
            'This idea was sparked by a real post resonating now:',
            `- Their point: ${idea.spark.claim}`,
            idea.spark.quote ? `- They wrote: "${idea.spark.quote}"` : '',
            'Respond to / extend that point from YOUR experience. Do NOT paraphrase or echo their wording.'
          ].filter(Boolean)
        : []),
      '',
      'Author the post following these instructions:',
      postPrompt
    ].join('\n')
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/content/DraftGenerator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/DraftGenerator.ts src/lib/content/DraftGenerator.test.ts
git commit -m "feat(content): ground the draft in the idea spark (respond, don't echo)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `IdeaDayBudget` (day-keyed ideas/day cap)

**Files:**
- Create: `src/lib/ideas/IdeaDayBudget.ts`
- Test: `src/lib/ideas/IdeaDayBudget.test.ts`

**Interfaces:**
- Produces: `IdeaDay = { day: string; used: number }`; `IDEA_BUDGET_KEY`; `DEFAULT_IDEAS_PER_DAY`; `ideasPerDayLimit(modulesState: unknown): number`; `rolloverIdeaDay(prev, today): IdeaDay`; `recordIdeaDay(state, n): IdeaDay`; `remainingIdeas(state, limit): number`.

- [ ] **Step 1: Write the failing test** — `src/lib/ideas/IdeaDayBudget.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  ideasPerDayLimit, rolloverIdeaDay, recordIdeaDay, remainingIdeas, DEFAULT_IDEAS_PER_DAY
} from './IdeaDayBudget'
import type { ModuleState } from '../types'

const content = (dailyLimit: number): ModuleState => ({
  id: 'content', enabled: true, automationLevel: 'manual', available: true, dailyLimit
})

describe('ideasPerDayLimit', () => {
  it('reads the content module limit', () => {
    expect(ideasPerDayLimit([content(8)])).toBe(8)
  })
  it('falls back to the default when missing/zero/array-as-object', () => {
    expect(ideasPerDayLimit([])).toBe(DEFAULT_IDEAS_PER_DAY)
    expect(ideasPerDayLimit([content(0)])).toBe(DEFAULT_IDEAS_PER_DAY)
    expect(ideasPerDayLimit({ 0: content(6) })).toBe(6)
  })
})

describe('idea day budget', () => {
  it('carries over the same day, resets on a new day', () => {
    const a = recordIdeaDay(rolloverIdeaDay(null, '2026-06-25'), 3)
    expect(rolloverIdeaDay(a, '2026-06-25')).toEqual({ day: '2026-06-25', used: 3 })
    expect(rolloverIdeaDay(a, '2026-06-26')).toEqual({ day: '2026-06-26', used: 0 })
  })
  it('remaining clamps at 0', () => {
    const s = recordIdeaDay(rolloverIdeaDay(null, 'd'), 6)
    expect(remainingIdeas(s, 5)).toBe(0)
    expect(remainingIdeas({ day: 'd', used: 2 }, 5)).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ideas/IdeaDayBudget.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/lib/ideas/IdeaDayBudget.ts`:

```ts
import type { ModuleState } from '../types'
import { asArray } from '../engagement/settings'

/** Persisted day-keyed ideas/day counter (mirrors the autopilot daily budget). */
export interface IdeaDay {
  day: string
  used: number
}

export const IDEA_BUDGET_KEY = 'ideas:budget'
export const DEFAULT_IDEAS_PER_DAY = 5

/** The content module's ideas/day limit (its dailyLimit); guards the array-as-object shape. */
export function ideasPerDayLimit(modulesState: unknown): number {
  const m = asArray<ModuleState>(modulesState).find((x) => x?.id === 'content')
  const n = m?.dailyLimit
  return typeof n === 'number' && n > 0 ? n : DEFAULT_IDEAS_PER_DAY
}

/** Same-day carry-over (don't re-grant); a new day resets used to 0. Pure. */
export function rolloverIdeaDay(prev: IdeaDay | null, today: string): IdeaDay {
  if (prev && prev.day === today) return prev
  return { day: today, used: 0 }
}

export function recordIdeaDay(state: IdeaDay, n: number): IdeaDay {
  return { day: state.day, used: state.used + Math.max(0, n) }
}

export function remainingIdeas(state: IdeaDay, limit: number): number {
  return Math.max(0, limit - state.used)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/ideas/IdeaDayBudget.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ideas/IdeaDayBudget.ts src/lib/ideas/IdeaDayBudget.test.ts
git commit -m "feat(ideas): day-keyed ideas/day budget + content limit reader

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `contentHandlers.extractRunIdeas` (SW boundary, crosses the LLM mapper)

**Files:**
- Modify: `src/service-worker/contentHandlers.ts`
- Test: `src/service-worker/contentHandlers.test.ts`

**Interfaces:**
- Consumes: `IdeaDayBudget` (Task 3), `Idea.spark` (Task 1), existing `loadLlmConfig`/`loadSettings`/`createLlmProvider`/`IdeaBank`/`feedPostToFeedItem`.
- Produces: `RunIdeaDeps = { store: KeyValueStore; http: LlmHttp; clock: Clock }`; `extractRunIdeas(deps, posts: FeedPost[]): Promise<{ stored: number; error?: string }>`.

- [ ] **Step 1: Write the failing boundary test** — in `src/service-worker/contentHandlers.test.ts`, (a) add `extractRunIdeas` to the existing import so it reads `import { extractRunIdeas, generateDraft, generateIdeas } from './contentHandlers'`, then (b) append a new describe block REUSING the file's existing `memStore`, `fakeHttp`, `fixedClock` (`now` = `2026-06-25T00:00:00Z`), `posts` (`[{ urn:'urn:1', authorName:'A', text:'hiring vue devs' }]`) and `CONFIGURED`:

```ts
const CONTENT_MODS = {
  'modules:state': [{ id: 'content', enabled: true, available: true, automationLevel: 'manual', dailyLimit: 5 }]
}
const SPARK_JSON = JSON.stringify([
  { topic: 'Architecture', angle: 'Pragmatism', sourceIndex: 1, claim: 'Speed over purity', quote: 'ship fast' }
])

describe('extractRunIdeas (LLM boundary)', () => {
  it('banks sparked ideas from the supplied buffer and records the day budget', async () => {
    const store = memStore({ ...CONFIGURED, ...CONTENT_MODS })
    const res = await extractRunIdeas({ store, http: fakeHttp(SPARK_JSON), clock: fixedClock }, posts)
    expect(res.stored).toBe(1)
    const bank = (await store.get('ideas:bank')) as any[]
    expect(bank[0].spark.source).toEqual({ author: 'A', id: 'urn:1' })
    expect(await store.get('ideas:budget')).toEqual({ day: '2026-06-25', used: 1 })
  })

  it('errors no_key without calling the model when the key is empty', async () => {
    const store = memStore({ ...CONTENT_MODS })
    expect(await extractRunIdeas({ store, http: fakeHttp(SPARK_JSON), clock: fixedClock }, posts)).toEqual({
      stored: 0,
      error: 'no_key'
    })
  })

  it('skips extraction silently when the daily budget is exhausted', async () => {
    const store = memStore({ ...CONFIGURED, ...CONTENT_MODS, 'ideas:budget': { day: '2026-06-25', used: 5 } })
    expect(await extractRunIdeas({ store, http: fakeHttp(SPARK_JSON), clock: fixedClock }, posts)).toEqual({ stored: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/service-worker/contentHandlers.test.ts`
Expected: FAIL — `extractRunIdeas` not exported.

- [ ] **Step 3: Implement** — add to `src/service-worker/contentHandlers.ts` (imports at top, function at end):

```ts
// add to imports:
import { ideasPerDayLimit, rolloverIdeaDay, recordIdeaDay, remainingIdeas, IDEA_BUDGET_KEY, type IdeaDay } from '@lib/ideas/IdeaDayBudget'

export interface RunIdeaDeps {
  store: KeyValueStore
  http: LlmHttp
  clock: Clock
}

/**
 * Extract ideas from a buffer the autopilot loop already harvested (no re-scroll),
 * capped by the day-keyed ideas/day budget. Crosses the real LLM mapper. Returns how
 * many NEW ideas were banked (dedup-aware) so a failed/duplicate extraction costs no budget.
 */
export async function extractRunIdeas(
  deps: RunIdeaDeps,
  posts: FeedPost[]
): Promise<{ stored: number; error?: string }> {
  if (!posts.length) return { stored: 0, error: 'no_feed' }
  const cfg = await loadLlmConfig(deps.store)
  if (!cfg.apiKey.trim()) return { stored: 0, error: 'no_key' }
  const { expertise } = await loadSettings(deps.store)
  if (!expertise.headline.trim()) return { stored: 0, error: 'no_expertise' }

  const limit = ideasPerDayLimit(await deps.store.get('modules:state'))
  const today = deps.clock.now().toISOString().slice(0, 10)
  const budget = rolloverIdeaDay((await deps.store.get<IdeaDay>(IDEA_BUDGET_KEY)) ?? null, today)
  const allowance = remainingIdeas(budget, limit)
  if (allowance <= 0) return { stored: 0 }

  const provider = createLlmProvider({ provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model }, deps.http)
  const bank = new IdeaBank(deps.store)
  try {
    const before = (await bank.all()).length
    const ideas = await new IdeaExtractor(provider).extract(posts.map(feedPostToFeedItem), expertise)
    await bank.add(ideas.slice(0, allowance))
    const stored = (await bank.all()).length - before
    await deps.store.set(IDEA_BUDGET_KEY, recordIdeaDay(budget, stored))
    return { stored }
  } catch (e) {
    return { stored: 0, error: e instanceof Error ? e.message : 'llm_failed' }
  }
}
```

- [ ] **Step 3b: Harden `IdeaBank.all()`** (spec §5, defensive — the bank is now written from two paths). In `src/lib/ideas/IdeaBank.ts` add `import { asArray } from '../engagement/settings'` and change `all()`:

```ts
  async all(): Promise<Idea[]> {
    return asArray<Idea>(await this.store.get<Idea[]>(IDEA_BANK_KEY))
  }
```
No behavior change for valid arrays (`asArray` passes them through); it just can't crash on an array-as-object shape. Exercised by the extractRunIdeas test reading the bank back.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/service-worker/contentHandlers.test.ts`
Expected: PASS. If `contentHandlers.ts` now > 300 lines, that's acceptable here (it's the SW orchestration boundary module); do not split mid-task.

- [ ] **Step 5: Commit**

```bash
git add src/service-worker/contentHandlers.ts src/service-worker/contentHandlers.test.ts src/lib/ideas/IdeaBank.ts
git commit -m "feat(content): extractRunIdeas — bank ideas from the run buffer under a daily cap

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Messages + `runLoopModules` + SW wiring

**Files:**
- Modify: `src/lib/types.ts` (BeaconMessage)
- Modify: `src/lib/autopilot/startGate.ts`
- Test: `src/lib/autopilot/startGate.test.ts`
- Modify: `src/service-worker/index.ts`
- Modify: `src/content/index.ts` (no-op case only)

**Interfaces:**
- Consumes: `enabledModules` (existing), `extractRunIdeas` (Task 4).
- Produces: `runLoopModules(modulesState): { engagement: boolean; content: boolean }`; message `AUTOPILOT_RUN_LOOP { modules: { engagement: boolean; content: boolean } }`; message `EXTRACT_RUN_IDEAS { posts: FeedPost[] }`.

- [ ] **Step 1: Write the failing test** — append to `src/lib/autopilot/startGate.test.ts`:

```ts
import { runLoopModules } from './startGate'

describe('runLoopModules', () => {
  it('flags engagement and content independently from enabled+available', () => {
    expect(runLoopModules([mod(), mod({ id: 'content' })])).toEqual({ engagement: true, content: true })
  })
  it('excludes a disabled or unavailable module', () => {
    expect(runLoopModules([mod(), mod({ id: 'content', available: false })])).toEqual({ engagement: true, content: false })
    expect(runLoopModules([mod({ enabled: false })])).toEqual({ engagement: false, content: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/autopilot/startGate.test.ts`
Expected: FAIL — `runLoopModules` not exported.

- [ ] **Step 3: Add `runLoopModules`** to `src/lib/autopilot/startGate.ts`:

```ts
/** Which runnable modules the loop should drive — flags for the content loop. */
export function runLoopModules(modulesState: unknown): { engagement: boolean; content: boolean } {
  const ids = new Set(enabledModules(modulesState).map((m) => m.id))
  return { engagement: ids.has('engagement'), content: ids.has('content') }
}
```

- [ ] **Step 4: Add the message variants** in `src/lib/types.ts` — replace the `AUTOPILOT_RUN_LOOP` line and add `EXTRACT_RUN_IDEAS`:

```ts
  /** SW → content: begin the harvest→act loop; flags say which modules to drive. */
  | { type: 'AUTOPILOT_RUN_LOOP'; modules: { engagement: boolean; content: boolean } }
  /** content → SW: extract ideas from the run buffer; replies { stored, error? }. */
  | { type: 'EXTRACT_RUN_IDEAS'; posts: FeedPost[] }
```

- [ ] **Step 5: Wire the SW** — in `src/service-worker/index.ts`:

(a) import `runLoopModules`:
```ts
import { decideAutopilotStart, runLoopModules } from '@lib/autopilot/startGate'
```
(b) `sendRunLoop` carries the flags — replace its body:
```ts
async function sendRunLoop(tabId: number): Promise<boolean> {
  try {
    const modules = runLoopModules(await store.get('modules:state'))
    await chrome.tabs.sendMessage(tabId, { type: 'AUTOPILOT_RUN_LOOP', modules })
    return true
  } catch {
    return false
  }
}
```
(c) handle `EXTRACT_RUN_IDEAS` — add a case next to `GENERATE_IDEAS`:
```ts
    case 'EXTRACT_RUN_IDEAS':
      void withPageActivity(
        () => content.extractRunIdeas({ store, http: llmHttp, clock }, message.posts),
        GENERATING_IDEAS
      ).then(sendResponse)
      return true
```

- [ ] **Step 6: Content no-op case** — in `src/content/index.ts`, add `EXTRACT_RUN_IDEAS` to the SW-only no-op group (with `GENERATE_IDEAS` etc.):
```ts
    case 'EXTRACT_RUN_IDEAS':
```
(place it among the existing `case 'GENERATE_IDEAS':` block above `return false`.)

- [ ] **Step 7: Verify build + the new unit test**

Run: `npx vitest run src/lib/autopilot/startGate.test.ts && npm run build`
Expected: tests PASS; build clean (the exhaustive content switch now compiles with the new variant).

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/autopilot/startGate.ts src/lib/autopilot/startGate.test.ts src/service-worker/index.ts src/content/index.ts
git commit -m "feat(autopilot): RUN_LOOP carries module flags + EXTRACT_RUN_IDEAS message

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Content loop — buffer, conditional like, extract trigger

**Files:**
- Modify: `src/content/index.ts`

**Interfaces:**
- Consumes: `AUTOPILOT_RUN_LOOP.modules` + `EXTRACT_RUN_IDEAS` (Task 5), `FeedAccumulator` (existing), `GENERATING_IDEAS` (statusLabels).

This task is the DOM edge — no unit test (the harvest/like loop is verified by `npm run build` + live CDP, per the established pattern; its pure pieces are tested in Tasks 1/3/5). Keep the existing like body byte-for-byte; only add the buffer/flags/trigger around it.

- [ ] **Step 1: Imports + constants + flags** — in `src/content/index.ts`:

(a) extend the statusLabels import:
```ts
import { SCANNING, LIKING, GENERATING_IDEAS, pauseLabel, breakLabel } from '@lib/autopilot/statusLabels'
```
(b) add constants near `IDEA`-less top (after the `feed`/`likeFilter` consts):
```ts
const IDEA_TARGET = 25 // unique posts buffered before the one-per-run extraction
const IDEA_FLOOR = 8 // minimum buffer to bother extracting at run end
```
(c) add module-level flags by the autopilot state:
```ts
let wantLike = true
let wantIdeas = false
```

- [ ] **Step 2: RUN_LOOP reads the flags** — replace the `AUTOPILOT_RUN_LOOP` case:
```ts
    case 'AUTOPILOT_RUN_LOOP':
      wantLike = message.modules.engagement
      wantIdeas = message.modules.content
      void runAutopilotLoop()
      sendResponse({ ok: true })
      return false
```

- [ ] **Step 3: Replace `runAutopilotLoop`** with the buffered, conditional version (keep the inner like body identical to the current code):

```ts
async function runAutopilotLoop(): Promise<void> {
  if (autopilotRunning) return
  autopilotRunning = true
  actedUrns.clear()
  actionsSinceBreak = 0
  let emptyHarvests = 0
  let extractedThisRun = false
  const runBuffer = new FeedAccumulator()
  const idleLabel = () => (wantLike ? SCANNING : GENERATING_IDEAS)
  showActivity(document, idleLabel())
  try {
    while (autopilotRunning) {
      setActivityLabel(idleLabel())
      const posts = await harvestByScrolling(25)
      if (wantIdeas) runBuffer.add(posts)

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
          const paceMs = delay.nextMs(8000, 45000)
          setActivityLabel(pauseLabel(paceMs))
          await sleep(paceMs)
          const breakMs = humanBreak.nextBreakMs(actionsSinceBreak, new MathRandomRng())
          if (breakMs > 0) {
            actionsSinceBreak = 0
            setActivityLabel(breakLabel(breakMs))
            await sleep(breakMs)
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
    // Catch-up: extract from a smaller buffer if the run ended before the target.
    if (wantIdeas && !extractedThisRun && runBuffer.size() >= IDEA_FLOOR) {
      await ask({ type: 'EXTRACT_RUN_IDEAS', posts: runBuffer.items() })
    }
    autopilotRunning = false
    hideActivity()
  }
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean (no type errors).

- [ ] **Step 5: Commit**

```bash
git add src/content/index.ts
git commit -m "feat(content): collect grounded ideas during the autopilot run (rides the harvest)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Content becomes a real module (UI)

**Files:**
- Modify: `src/sidepanel/composables/useModules.ts`
- Test: `src/sidepanel/composables/useModules.spec.ts`
- Modify: `src/sidepanel/screens/ModulesScreen.vue`
- Modify: `src/sidepanel/screens/ContentScreen.vue`

**Interfaces:**
- Consumes: `Idea.spark` (Task 1) for the idea-card provenance line.

- [ ] **Step 1: Write the failing test** — append to `src/sidepanel/composables/useModules.spec.ts`:

```ts
it('ships content as a real module with an ideas/day limit', () => {
  const c = defaultModules().find((m) => m.id === 'content')!
  expect(c.available).toBe(true)
  expect(c.enabled).toBe(false)
  expect(c.dailyLimit).toBe(5)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sidepanel/composables/useModules.spec.ts`
Expected: FAIL — content is `available:false`, `dailyLimit:3`.

- [ ] **Step 3: Flip the default** — in `src/sidepanel/composables/useModules.ts` replace the content line:
```ts
    { id: 'content', enabled: false, automationLevel: 'manual', available: true, dailyLimit: 5 },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sidepanel/composables/useModules.spec.ts`
Expected: PASS.

- [ ] **Step 5: Update the content card labels** — in `src/sidepanel/screens/ModulesScreen.vue`, replace the content `ModuleCard` opening attrs + demo stats:
```html
    <ModuleCard
      :module="byId(modules, 'content')"
      title="Контент — идеи из ленты"
      desc="Пока автопилот листает ленту, собирает идеи для постов с привязкой к реальному поводу · черновик по клику"
      limit-label="Идей/день"
      recommended="рек. 3–6"
      @toggle="$emit('toggle', 'content')"
      @set-limit="(n) => $emit('setLimit', 'content', n)"
    >
      <template #icon>
        <svg viewBox="0 0 24 24" fill="none"><path d="M5 3h10l4 4v14H5z" stroke="#c4ff4d" stroke-width="1.8" stroke-linejoin="round" /><path d="M14 3v5h5M8.5 13h7M8.5 16.5h5" stroke="#c4ff4d" stroke-width="1.8" stroke-linecap="round" /></svg>
      </template>
      <div class="note" style="border-style:dashed">
        <div class="lbl">Как работает</div>
        Включи модуль и запусти автопилот на Dash — идеи появятся во вкладке «Контент». Публикация постов — отдельно, позже.
      </div>
    </ModuleCard>
```

- [ ] **Step 6: Show the spark on the idea card** — in `src/sidepanel/screens/ContentScreen.vue`, inside the idea `v-for` `note`, add a provenance line after `{{ idea.angle }}`:
```html
        <div v-if="idea.spark" class="lbl" style="margin-top:8px;opacity:.75" :data-testid="`spark-${i}`">
          ↳ повод: {{ idea.spark.claim }}<span v-if="idea.spark.source"> · {{ idea.spark.source.author }}</span>
        </div>
```

- [ ] **Step 7: Verify build + tests**

Run: `npx vitest run src/sidepanel/composables/useModules.spec.ts && npm run build`
Expected: PASS + clean build.

- [ ] **Step 8: Commit**

```bash
git add src/sidepanel/composables/useModules.ts src/sidepanel/composables/useModules.spec.ts src/sidepanel/screens/ModulesScreen.vue src/sidepanel/screens/ContentScreen.vue
git commit -m "feat(modules): content is a real module (ideas/day) + spark shown on idea card

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Integration gate + memory-bank

**Files:** none new — verification + docs.

- [ ] **Step 1: Full suite**

Run: `npx vitest run`
Expected: all green (≈ 268 + the new tests).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean (`vue-tsc` + vite).

- [ ] **Step 3: Clean tree**

Run: `git status --short`
Expected: empty (no dangling modified test fakes — the subagent gotcha).

- [ ] **Step 4: Update memory-bank** — via `memory_bank_write`/`memory_bank_update` on `linkedin-beacon`:
  - `progress.md`: ideas-in-the-loop shipped (grounded ideas ride the run; content is a real module with ideas/day; Layer 2 publishing still pending). Note follow-up #1 (`32dbfee`) closed earlier this session.
  - `gotchas.md`: if anything new surfaced during the loop edit (e.g. content-only stop condition, budget recorded on stored-not-extracted).

- [ ] **Step 5: Field-test note** — remind Vlad of the live CDP checklist from spec §7 (enable both modules → run → ideas cite a real source post; content-only run scrolls without liking; ideas/day cap holds across two runs).

---

## Notes for the implementer

- **Match existing fakes:** Task 4's fake `http` must use the same method names/shape as the existing `generateIdeas` boundary test in `contentHandlers.test.ts`. Read that test first and copy its fake.
- **Don't reformat untouched code.** Only add the buffer/flag/trigger lines in Task 6; the like body stays identical.
- **One extraction per run** is enforced by `extractedThisRun`; `IdeaBank` dedup + the day budget make re-runs safe and bounded.
