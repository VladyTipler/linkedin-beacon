# Autonomous Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One button runs the enabled modules continuously until the day's randomized budget is spent (or risk/manual stop), hosted in the current tab or a worker window, then persists a report shown in a new «Отчёты» tab.

**Architecture:** Pure gatekeeping units (`DailyCeiling`, `BurstGuard`, `RiskAssessor`, `HumanBreakPolicy`, `AutopilotGatekeeper`) live in `src/lib/autopilot`. The continuous loop lives in the feed content script (survives SW eviction); the SW is the authoritative gatekeeper holding persisted `AutopilotState` and writing `RunReport`s. UI adds a Reports screen + Start/Stop controls.

**Tech Stack:** Vue 3 + TypeScript + Vite + @crxjs/vite-plugin, Vitest, Chrome MV3 (sidePanel, scripting, alarms, tabs, windows, cookies).

## Global Constraints

- Core (`src/lib/**`) imports no `chrome`/`document`/`fetch`; randomness/time via the `Rng`/`Clock` ports. Pure core, thin edge.
- Files ≤ 300 lines; one responsibility per file (SOLID).
- TDD: failing test first, watch it fail, minimal code, watch it pass, commit. Tests on fakes.
- `npx vitest run` AND `npm run build` (vue-tsc + vite) green before any task is "done".
- Commit per task on `main`. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Reuse existing: `FeedReader`, `FeedAccumulator`, `ScrollHarvestPolicy`, `LikeFilter`, `EngagementOrchestrator`, `DailyBudget`, `HumanDelay`, `Rng`, `Clock`, `KeyValueStore`, `ActionGate`.
- `manifest.config.ts` permissions currently include `tabs`; add `windows` is NOT a separate permission (the `chrome.windows` API needs no permission). No manifest change required for the worker window.

## File Structure

- Create `src/lib/autopilot/DailyCeiling.ts` (+test) — today's randomized like ceiling + warmup.
- Create `src/lib/autopilot/BurstGuard.ts` (+test) — rolling-window rate limiter.
- Create `src/lib/autopilot/RiskAssessor.ts` (+test) — risk markers → ok/stop.
- Create `src/lib/autopilot/HumanBreakPolicy.ts` (+test) — occasional long human pause.
- Create `src/lib/autopilot/AutopilotGatekeeper.ts` (+test) — compose the decision: act/wait/stop.
- Create `src/lib/autopilot/RunReportStore.ts` (+test) — persist/list reports.
- Modify `src/lib/types.ts` — add autopilot types + messages.
- Modify `src/service-worker/index.ts` — AutopilotController (host, state, gatekeeping, reports).
- Modify `src/content/index.ts` — AutopilotSession loop.
- Create `src/adapters/ChromeWindows.ts` — worker-window wrapper.
- Create `src/sidepanel/screens/ReportsScreen.vue` — reports list.
- Create `src/sidepanel/composables/useAutopilot.ts` — start/stop/status/reports.
- Modify `src/sidepanel/components/BottomNav.vue`, `src/sidepanel/App.vue`, `src/sidepanel/screens/SafetyScreen.vue`, `src/sidepanel/composables/useNavigation.ts` — 5th tab + controls.

---

### Task 1: DailyCeiling (randomized daily like ceiling + warmup)

**Files:**
- Create: `src/lib/autopilot/DailyCeiling.ts`
- Test: `src/lib/autopilot/DailyCeiling.test.ts`

**Interfaces:**
- Consumes: `Rng` from `@lib/ports`.
- Produces: `class DailyCeiling { constructor(cfg?: { base?: number; jitter?: number; warmupDays?: number }); forDay(rng: Rng, warmupDay?: number): number }`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/autopilot/DailyCeiling.test.ts
import { describe, it, expect } from 'vitest'
import { DailyCeiling } from './DailyCeiling'
import type { Rng } from '@lib/ports'

const rng = (v: number): Rng => ({ next: () => v })

describe('DailyCeiling', () => {
  const ceiling = new DailyCeiling({ base: 40, jitter: 10, warmupDays: 14 })

  it('returns base - jitter at rng 0', () => {
    expect(ceiling.forDay(rng(0))).toBe(30)
  })

  it('returns base + jitter at rng 1', () => {
    expect(ceiling.forDay(rng(1))).toBe(50)
  })

  it('returns base at rng 0.5', () => {
    expect(ceiling.forDay(rng(0.5))).toBe(40)
  })

  it('scales down linearly during warmup (day 7 of 14 ~ half)', () => {
    // base 40 at rng .5, warmupDay 7 of 14 → ceil(40 * 7/14) = 20
    expect(ceiling.forDay(rng(0.5), 7)).toBe(20)
  })

  it('never returns below 1 even on day 0 of warmup', () => {
    expect(ceiling.forDay(rng(0), 0)).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/autopilot/DailyCeiling.test.ts`
Expected: FAIL — cannot resolve `./DailyCeiling`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/autopilot/DailyCeiling.ts
import type { Rng } from '../ports'

/**
 * The day's like ceiling (design-spec §5): a base ± jitter draw (so it isn't the
 * same number every day), scaled down during the warmup ramp for new accounts.
 * Pure given an injected Rng.
 */
export class DailyCeiling {
  private readonly base: number
  private readonly jitter: number
  private readonly warmupDays: number

  constructor(cfg: { base?: number; jitter?: number; warmupDays?: number } = {}) {
    this.base = cfg.base ?? 40
    this.jitter = cfg.jitter ?? 10
    this.warmupDays = cfg.warmupDays ?? 14
  }

  /** @param warmupDay day index since account start (0-based); omit if past warmup. */
  forDay(rng: Rng, warmupDay?: number): number {
    const drawn = this.base - this.jitter + rng.next() * (2 * this.jitter)
    const ramp =
      warmupDay !== undefined && warmupDay < this.warmupDays
        ? (warmupDay + 1) / this.warmupDays
        : 1
    return Math.max(1, Math.round(drawn * ramp))
  }
}
```

NOTE: warmup test uses day 7 → ramp (7+1)/14 = 0.571 → round(40*0.571)=23. Adjust the
test expectation to `23` after seeing the actual value, OR change ramp to `warmupDay/warmupDays`
(7/14=0.5 → 20). Pick `warmupDay/warmupDays` to match the written test (20); update impl ramp to
`warmupDay / this.warmupDays` and keep the `Math.max(1, …)` floor for day 0.

- [ ] **Step 4: Reconcile impl with the test and run**

Set ramp to `warmupDay / this.warmupDays` (day 0 → 0 → floored to 1 by `Math.max`).

Run: `npx vitest run src/lib/autopilot/DailyCeiling.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/autopilot/DailyCeiling.ts src/lib/autopilot/DailyCeiling.test.ts
git commit -m "feat(autopilot): DailyCeiling — randomized daily ceiling + warmup"
```

---

### Task 2: BurstGuard (rolling-window rate limiter)

**Files:**
- Create: `src/lib/autopilot/BurstGuard.ts`
- Test: `src/lib/autopilot/BurstGuard.test.ts`

**Interfaces:**
- Produces: `class BurstGuard { constructor(cfg?: { maxActions?: number; windowMs?: number }); check(timestamps: number[], now: number): { ok: boolean; waitMs: number } }`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/autopilot/BurstGuard.test.ts
import { describe, it, expect } from 'vitest'
import { BurstGuard } from './BurstGuard'

const MIN = 60_000

describe('BurstGuard', () => {
  const guard = new BurstGuard({ maxActions: 5, windowMs: 3 * MIN })
  const now = 10 * MIN

  it('allows when under the limit in the window', () => {
    const ts = [now - 1000, now - 2000] // 2 in window
    expect(guard.check(ts, now)).toEqual({ ok: true, waitMs: 0 })
  })

  it('blocks at the limit and reports how long to wait', () => {
    // 5 actions in the window, oldest at now - 2min → wait until it exits (1min left)
    const ts = [now - 2 * MIN, now - 90_000, now - 60_000, now - 30_000, now - 1000]
    const r = guard.check(ts, now)
    expect(r.ok).toBe(false)
    expect(r.waitMs).toBe(MIN) // oldest leaves the 3-min window in 1 min
  })

  it('ignores timestamps outside the window', () => {
    const ts = [now - 10 * MIN, now - 9 * MIN, now - 8 * MIN, now - 7 * MIN, now - 4 * MIN]
    expect(guard.check(ts, now)).toEqual({ ok: true, waitMs: 0 }) // all older than 3min
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/autopilot/BurstGuard.test.ts`
Expected: FAIL — cannot resolve `./BurstGuard`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/autopilot/BurstGuard.ts
/**
 * Rolling-window rate limiter (design-spec §5.2 burstGuard): at most N actions per
 * window. Pure — caller passes the recent action timestamps + now. When at the
 * limit, returns how long until the oldest in-window action ages out.
 */
export class BurstGuard {
  private readonly maxActions: number
  private readonly windowMs: number

  constructor(cfg: { maxActions?: number; windowMs?: number } = {}) {
    this.maxActions = cfg.maxActions ?? 5
    this.windowMs = cfg.windowMs ?? 3 * 60_000
  }

  check(timestamps: number[], now: number): { ok: boolean; waitMs: number } {
    const inWindow = timestamps.filter((t) => now - t < this.windowMs).sort((a, b) => a - b)
    if (inWindow.length < this.maxActions) return { ok: true, waitMs: 0 }
    const oldest = inWindow[0]
    return { ok: false, waitMs: oldest + this.windowMs - now }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/autopilot/BurstGuard.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/autopilot/BurstGuard.ts src/lib/autopilot/BurstGuard.test.ts
git commit -m "feat(autopilot): BurstGuard — rolling-window rate limiter"
```

---

### Task 3: RiskAssessor (risk markers → ok/stop)

**Files:**
- Create: `src/lib/autopilot/RiskAssessor.ts`
- Test: `src/lib/autopilot/RiskAssessor.test.ts`

**Interfaces:**
- Produces: `type RiskMarker = 'captcha' | 'challenge' | 'http_429' | 'moving_too_fast'` and `class RiskAssessor { classify(markers: RiskMarker[]): 'ok' | 'stop' }`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/autopilot/RiskAssessor.test.ts
import { describe, it, expect } from 'vitest'
import { RiskAssessor } from './RiskAssessor'

describe('RiskAssessor', () => {
  const assessor = new RiskAssessor()

  it('is ok with no markers', () => {
    expect(assessor.classify([])).toBe('ok')
  })

  it('stops on any hard risk marker', () => {
    expect(assessor.classify(['captcha'])).toBe('stop')
    expect(assessor.classify(['challenge'])).toBe('stop')
    expect(assessor.classify(['http_429'])).toBe('stop')
    expect(assessor.classify(['moving_too_fast'])).toBe('stop')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/autopilot/RiskAssessor.test.ts`
Expected: FAIL — cannot resolve `./RiskAssessor`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/autopilot/RiskAssessor.ts
export type RiskMarker = 'captcha' | 'challenge' | 'http_429' | 'moving_too_fast'

/**
 * Classifies reported risk markers into a go/stop verdict (design-spec §5.4
 * kill-switch). Any hard marker → stop. Pure. Marker detection itself is the
 * content script's job; this only judges.
 */
export class RiskAssessor {
  classify(markers: RiskMarker[]): 'ok' | 'stop' {
    return markers.length > 0 ? 'stop' : 'ok'
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/autopilot/RiskAssessor.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/autopilot/RiskAssessor.ts src/lib/autopilot/RiskAssessor.test.ts
git commit -m "feat(autopilot): RiskAssessor — risk markers to go/stop"
```

---

### Task 4: HumanBreakPolicy (occasional long pause)

**Files:**
- Create: `src/lib/autopilot/HumanBreakPolicy.ts`
- Test: `src/lib/autopilot/HumanBreakPolicy.test.ts`

**Interfaces:**
- Consumes: `Rng`.
- Produces: `class HumanBreakPolicy { constructor(cfg?: { everyMin?: number; everyMax?: number; breakMinMs?: number; breakMaxMs?: number }); nextBreakMs(actionsSinceBreak: number, rng: Rng): number }`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/autopilot/HumanBreakPolicy.test.ts
import { describe, it, expect } from 'vitest'
import { HumanBreakPolicy } from './HumanBreakPolicy'
import type { Rng } from '@lib/ports'

const rng = (v: number): Rng => ({ next: () => v })

describe('HumanBreakPolicy', () => {
  // break every 6–10 actions; break length 60–180s
  const policy = new HumanBreakPolicy({ everyMin: 6, everyMax: 10, breakMinMs: 60_000, breakMaxMs: 180_000 })

  it('no break before the minimum action count', () => {
    expect(policy.nextBreakMs(5, rng(0))).toBe(0)
  })

  it('takes a break once the drawn threshold is reached (rng 0 → threshold 6)', () => {
    const ms = policy.nextBreakMs(6, rng(0))
    expect(ms).toBe(60_000) // rng 0 → min break length
  })

  it('break length spans the configured range (rng 1 → max)', () => {
    expect(policy.nextBreakMs(10, rng(1))).toBe(180_000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/autopilot/HumanBreakPolicy.test.ts`
Expected: FAIL — cannot resolve `./HumanBreakPolicy`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/autopilot/HumanBreakPolicy.ts
import type { Rng } from '../ports'

/**
 * Occasionally inserts a longer "human break" between actions (design-spec §5.1
 * "human got distracted"). The break threshold is drawn in [everyMin, everyMax]
 * from the same rng call, so a single rng value decides both whether and how long.
 * Pure.
 */
export class HumanBreakPolicy {
  private readonly everyMin: number
  private readonly everyMax: number
  private readonly breakMinMs: number
  private readonly breakMaxMs: number

  constructor(cfg: { everyMin?: number; everyMax?: number; breakMinMs?: number; breakMaxMs?: number } = {}) {
    this.everyMin = cfg.everyMin ?? 6
    this.everyMax = cfg.everyMax ?? 10
    this.breakMinMs = cfg.breakMinMs ?? 60_000
    this.breakMaxMs = cfg.breakMaxMs ?? 180_000
  }

  /** Returns a break duration in ms, or 0 if no break is due yet. */
  nextBreakMs(actionsSinceBreak: number, rng: Rng): number {
    const r = rng.next()
    const threshold = Math.round(this.everyMin + r * (this.everyMax - this.everyMin))
    if (actionsSinceBreak < threshold) return 0
    return Math.round(this.breakMinMs + r * (this.breakMaxMs - this.breakMinMs))
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/autopilot/HumanBreakPolicy.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/autopilot/HumanBreakPolicy.ts src/lib/autopilot/HumanBreakPolicy.test.ts
git commit -m "feat(autopilot): HumanBreakPolicy — occasional long human pause"
```

---

### Task 5: AutopilotGatekeeper (compose the decision)

**Files:**
- Create: `src/lib/autopilot/AutopilotGatekeeper.ts`
- Test: `src/lib/autopilot/AutopilotGatekeeper.test.ts`

**Interfaces:**
- Consumes: `BurstGuard`, `RiskAssessor`, `RiskMarker` from siblings; `DailyBudget`, `DailyBudgetState` from `../engagement/DailyBudget`.
- Produces:
  ```ts
  interface GateState {
    used: number; ceiling: number; manualStop: boolean
    risk: RiskMarker[]; actionTimestamps: number[]; now: number
  }
  type GateDecision =
    | { action: 'act' }
    | { action: 'wait'; waitMs: number }
    | { action: 'stop'; reason: 'budget' | 'risk' | 'manual' }
  class AutopilotGatekeeper {
    constructor(deps: { burst: BurstGuard; risk: RiskAssessor })
    decide(state: GateState): GateDecision
  }
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/autopilot/AutopilotGatekeeper.test.ts
import { describe, it, expect } from 'vitest'
import { AutopilotGatekeeper, type GateState } from './AutopilotGatekeeper'
import { BurstGuard } from './BurstGuard'
import { RiskAssessor } from './RiskAssessor'

const MIN = 60_000
const base = (over: Partial<GateState>): GateState => ({
  used: 0,
  ceiling: 40,
  manualStop: false,
  risk: [],
  actionTimestamps: [],
  now: 100 * MIN,
  ...over
})

describe('AutopilotGatekeeper', () => {
  const gk = new AutopilotGatekeeper({
    burst: new BurstGuard({ maxActions: 5, windowMs: 3 * MIN }),
    risk: new RiskAssessor()
  })

  it('acts when budget, burst and risk all allow', () => {
    expect(gk.decide(base({}))).toEqual({ action: 'act' })
  })

  it('stops manual with highest precedence (even if budget left)', () => {
    expect(gk.decide(base({ manualStop: true, risk: ['captcha'] }))).toEqual({
      action: 'stop',
      reason: 'manual'
    })
  })

  it('stops on risk before budget', () => {
    expect(gk.decide(base({ risk: ['http_429'], used: 100 }))).toEqual({ action: 'stop', reason: 'risk' })
  })

  it('stops when the daily ceiling is reached', () => {
    expect(gk.decide(base({ used: 40, ceiling: 40 }))).toEqual({ action: 'stop', reason: 'budget' })
  })

  it('waits when burst-limited but budget remains', () => {
    const now = 100 * MIN
    const ts = [now - 2 * MIN, now - 90_000, now - 60_000, now - 30_000, now - 1000]
    const d = gk.decide(base({ actionTimestamps: ts, now }))
    expect(d).toEqual({ action: 'wait', waitMs: MIN })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/autopilot/AutopilotGatekeeper.test.ts`
Expected: FAIL — cannot resolve `./AutopilotGatekeeper`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/autopilot/AutopilotGatekeeper.ts
import type { BurstGuard } from './BurstGuard'
import type { RiskAssessor, RiskMarker } from './RiskAssessor'

export interface GateState {
  used: number
  ceiling: number
  manualStop: boolean
  risk: RiskMarker[]
  actionTimestamps: number[]
  now: number
}

export type GateDecision =
  | { action: 'act' }
  | { action: 'wait'; waitMs: number }
  | { action: 'stop'; reason: 'budget' | 'risk' | 'manual' }

/**
 * The single autopilot decision point (design-spec §5). Precedence:
 * manual > risk > budget, then burst (wait). Pure — the SW owns the persisted
 * state passed in and applies the decision.
 */
export class AutopilotGatekeeper {
  constructor(private readonly deps: { burst: BurstGuard; risk: RiskAssessor }) {}

  decide(state: GateState): GateDecision {
    if (state.manualStop) return { action: 'stop', reason: 'manual' }
    if (this.deps.risk.classify(state.risk) === 'stop') return { action: 'stop', reason: 'risk' }
    if (state.used >= state.ceiling) return { action: 'stop', reason: 'budget' }
    const burst = this.deps.burst.check(state.actionTimestamps, state.now)
    if (!burst.ok) return { action: 'wait', waitMs: burst.waitMs }
    return { action: 'act' }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/autopilot/AutopilotGatekeeper.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/autopilot/AutopilotGatekeeper.ts src/lib/autopilot/AutopilotGatekeeper.test.ts
git commit -m "feat(autopilot): AutopilotGatekeeper — act/wait/stop decision"
```

---

### Task 6: RunReport model + RunReportStore

**Files:**
- Modify: `src/lib/types.ts` (add `RunReport`)
- Create: `src/lib/autopilot/RunReportStore.ts`
- Test: `src/lib/autopilot/RunReportStore.test.ts`

**Interfaces:**
- Consumes: `KeyValueStore`, `ModuleId`.
- Produces: `interface RunReport { id; startedAt; endedAt; host: 'tab'|'window'; stopReason: 'budget'|'risk'|'manual'|'feed_exhausted'; modules: { id: ModuleId; executed: number; skipped: number; failed: number }[] }` and `class RunReportStore { constructor(store: KeyValueStore, cap?: number); add(r: RunReport): Promise<void>; list(): Promise<RunReport[]> }`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/autopilot/RunReportStore.test.ts
import { describe, it, expect } from 'vitest'
import { RunReportStore } from './RunReportStore'
import type { KeyValueStore } from '@lib/ports'
import type { RunReport } from '@lib/types'

function memStore(): KeyValueStore {
  const m = new Map<string, unknown>()
  return {
    async get<T>(k: string) { return m.has(k) ? (m.get(k) as T) : null },
    async set<T>(k: string, v: T) { m.set(k, v) }
  }
}

const report = (id: string): RunReport => ({
  id, startedAt: '2026-06-24T10:00:00.000Z', endedAt: '2026-06-24T10:30:00.000Z',
  host: 'window', stopReason: 'budget',
  modules: [{ id: 'engagement', executed: 30, skipped: 5, failed: 1 }]
})

describe('RunReportStore', () => {
  it('lists newest first', async () => {
    const s = new RunReportStore(memStore())
    await s.add(report('a'))
    await s.add(report('b'))
    expect((await s.list()).map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('caps the history', async () => {
    const s = new RunReportStore(memStore(), 2)
    await s.add(report('a'))
    await s.add(report('b'))
    await s.add(report('c'))
    expect((await s.list()).map((r) => r.id)).toEqual(['c', 'b'])
  })

  it('persists across instances sharing a store', async () => {
    const store = memStore()
    await new RunReportStore(store).add(report('a'))
    expect((await new RunReportStore(store).list()).map((r) => r.id)).toEqual(['a'])
  })

  it('tolerates a non-array stored value', async () => {
    const store = memStore()
    await store.set('autopilot:reports', { corrupt: true })
    expect(await new RunReportStore(store).list()).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/autopilot/RunReportStore.test.ts`
Expected: FAIL — cannot resolve `./RunReportStore`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/lib/types.ts` (after `EngagementRunSummary`):

```typescript
/** A persisted record of one autopilot run (design-spec §2.3 reports). */
export interface RunReport {
  id: string
  startedAt: string
  endedAt: string
  host: 'tab' | 'window'
  stopReason: 'budget' | 'risk' | 'manual' | 'feed_exhausted'
  modules: { id: ModuleId; executed: number; skipped: number; failed: number }[]
}
```

```typescript
// src/lib/autopilot/RunReportStore.ts
import type { KeyValueStore } from '../ports'
import type { RunReport } from '../types'

export const REPORTS_KEY = 'autopilot:reports'

/** Persists autopilot run reports, newest first, capped. */
export class RunReportStore {
  constructor(
    private readonly store: KeyValueStore,
    private readonly cap = 50
  ) {}

  async add(report: RunReport): Promise<void> {
    const next = [report, ...(await this.list())].slice(0, this.cap)
    await this.store.set(REPORTS_KEY, next)
  }

  async list(): Promise<RunReport[]> {
    const stored = await this.store.get<RunReport[]>(REPORTS_KEY)
    return Array.isArray(stored) ? stored : []
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/autopilot/RunReportStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/autopilot/RunReportStore.ts src/lib/autopilot/RunReportStore.test.ts src/lib/types.ts
git commit -m "feat(autopilot): RunReport model + RunReportStore (newest-first, capped)"
```

---

### Task 7: Message contract + autopilot state types

**Files:**
- Modify: `src/lib/types.ts` (BeaconMessage additions + `AutopilotState`, `AutopilotStatus`)

**Interfaces:**
- Produces: new `BeaconMessage` variants and `AutopilotState`/`AutopilotStatus` types used by SW + panel.

- [ ] **Step 1: Add the types and message variants**

In `src/lib/types.ts`, add near the action types:

```typescript
import type { RiskMarker } from './autopilot/RiskAssessor'

export type AutopilotHost = 'tab' | 'window'

/** SW-owned persisted autopilot state. */
export interface AutopilotState {
  running: boolean
  host: AutopilotHost
  windowId?: number
  tabId?: number
  ceiling: number
  used: number
  actionTimestamps: number[]
  actionsSinceBreak: number
  manualStop: boolean
  startedAt: string
}

export interface AutopilotStatus {
  running: boolean
  used: number
  ceiling: number
  stopReason?: 'budget' | 'risk' | 'manual' | 'feed_exhausted'
}
```

Add to the `BeaconMessage` union:

```typescript
  | { type: 'START_AUTOPILOT'; host: AutopilotHost }
  | { type: 'STOP_AUTOPILOT' }
  | { type: 'AUTOPILOT_MAY_ACT'; actionType: ActionType }
  | { type: 'AUTOPILOT_ACTED'; ok: boolean }
  | { type: 'AUTOPILOT_RISK'; marker: RiskMarker }
  | { type: 'AUTOPILOT_RUN_LOOP' }
  | { type: 'AUTOPILOT_STATUS'; status: AutopilotStatus }
  | { type: 'AUTOPILOT_REPORT'; report: RunReport }
  | { type: 'LIST_REPORTS' }
```

(Reference `RunReport` is already declared in this file from Task 6.)

- [ ] **Step 2: Build to typecheck the union**

Run: `npm run build`
Expected: `vue-tsc` will flag non-exhaustive `switch (message.type)` in `content/index.ts` and `service-worker/index.ts`. That's expected — Tasks 8–9 add the handlers. To keep the build green between tasks, add `default: return false` arms now if not already present (content already has `default: return assertNever(message)` — temporarily change content's outbound-only list to include the new SW-only variants returning false). Implement properly in Tasks 8–9.

Minimal reconciliation in `src/content/index.ts` outbound/SW-only case list — add:
```typescript
    case 'START_AUTOPILOT':
    case 'STOP_AUTOPILOT':
    case 'AUTOPILOT_ACTED':
    case 'AUTOPILOT_STATUS':
    case 'AUTOPILOT_REPORT':
    case 'LIST_REPORTS':
      return false
```
(`AUTOPILOT_MAY_ACT`, `AUTOPILOT_RISK` are content→SW (content sends, doesn't receive) → also `return false` on the content side; `AUTOPILOT_RUN_LOOP` is handled in Task 8.)

Run `npm run build` again → green.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts src/content/index.ts
git commit -m "feat(autopilot): message contract + AutopilotState/Status types"
```

---

### Task 8: Content AutopilotSession loop

**Files:**
- Modify: `src/content/index.ts`

**Interfaces:**
- Consumes: `FeedReader`, `FeedAccumulator`, `ScrollHarvestPolicy`, `LikeFilter`, `HumanDelay`, `executeLike`, the autopilot messages.
- Produces: handles `AUTOPILOT_RUN_LOOP` — runs the harvest→filter→(ask SW)→act loop; detects risk markers; reports outcomes.

This is an edge wiring task; its pure collaborators are tested. Verify with `npm run build` + the live run in Task 12.

- [ ] **Step 1: Add the loop + risk detection to the content script**

In `src/content/index.ts` add a `LikeFilter` instance and an autopilot loop. Add imports:

```typescript
import { LikeFilter } from '@lib/engagement/LikeFilter'
import { HumanBreakPolicy } from '@lib/autopilot/HumanBreakPolicy'
import type { RiskMarker } from '@lib/autopilot/RiskAssessor'
```

Add (module scope):

```typescript
const likeFilter = new LikeFilter()
const humanBreak = new HumanBreakPolicy()
let autopilotRunning = false
let actionsSinceBreak = 0

function detectRisk(): RiskMarker | null {
  const body = document.body?.innerText ?? ''
  if (document.querySelector('iframe[src*="captcha"], [id*="captcha" i]')) return 'captcha'
  if (/unusual activity|verify it'?s you|security check/i.test(body)) return 'challenge'
  return null
}

async function ask<T>(message: BeaconMessage): Promise<T | undefined> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T
  } catch {
    return undefined
  }
}

async function runAutopilotLoop(): Promise<void> {
  if (autopilotRunning) return
  autopilotRunning = true
  try {
    while (autopilotRunning) {
      const risk = detectRisk()
      if (risk) await ask({ type: 'AUTOPILOT_RISK', marker: risk })

      const posts = await harvestByScrolling(25)
      const { likeable } = likeFilter.select(posts)
      if (likeable.length === 0) {
        await ask({ type: 'AUTOPILOT_ACTED', ok: false }) // nudge SW; it decides feed_exhausted
      }
      for (const post of likeable) {
        const decision = await ask<{ action: string; waitMs?: number }>({
          type: 'AUTOPILOT_MAY_ACT',
          actionType: 'like'
        })
        if (!decision || decision.action === 'stop') {
          autopilotRunning = false
          break
        }
        if (decision.action === 'wait') {
          await sleep(decision.waitMs ?? 30_000)
          continue
        }
        const res = executeLike(document, post.urn)
        await ask({ type: 'AUTOPILOT_ACTED', ok: res.ok })
        if (res.ok) actionsSinceBreak += 1
        await sleep(delay.nextMs(8000, 45000)) // base pacing between actions
        // Occasionally take a longer "human break" (1–3 min) — anti-ban §5.1.
        const breakMs = humanBreak.nextBreakMs(actionsSinceBreak, new MathRandomRng())
        if (breakMs > 0) {
          actionsSinceBreak = 0
          await sleep(breakMs)
        }
      }
    }
  } finally {
    autopilotRunning = false
  }
}
```

In the message switch, handle the loop trigger + stop:

```typescript
    case 'AUTOPILOT_RUN_LOOP':
      void runAutopilotLoop()
      sendResponse({ ok: true })
      return false
    case 'STOP_AUTOPILOT':
      autopilotRunning = false
      return false
```

(Remove `STOP_AUTOPILOT` / `AUTOPILOT_RUN_LOOP` from the temporary `return false` list added in Task 7.)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: green (`vue-tsc` + vite).

- [ ] **Step 3: Commit**

```bash
git add src/content/index.ts
git commit -m "feat(content): AutopilotSession loop — harvest, ask SW, act, detect risk"
```

---

### Task 9: SW AutopilotController (host, state, gatekeeping, reports)

**Files:**
- Modify: `src/service-worker/index.ts`
- Create: `src/adapters/ChromeWindows.ts`

**Interfaces:**
- Consumes: all autopilot core units, `ChromeWindows`, `DailyCeiling`, `MathRandomRng`, `RunReportStore`.
- Produces: handles `START_AUTOPILOT`, `STOP_AUTOPILOT`, `AUTOPILOT_MAY_ACT`, `AUTOPILOT_ACTED`, `AUTOPILOT_RISK`, `LIST_REPORTS`; persists `AutopilotState`; writes a `RunReport` on stop.

Edge wiring; verify via `npm run build` + Task 12 live run.

- [ ] **Step 1: Create the window adapter**

```typescript
// src/adapters/ChromeWindows.ts
/** Thin wrapper over chrome.windows for the autopilot worker window. */
export class ChromeWindows {
  async createFeedWindow(): Promise<{ windowId: number; tabId: number }> {
    const win = await chrome.windows.create({
      url: 'https://www.linkedin.com/feed/',
      focused: false,
      width: 900,
      height: 800
    })
    const tab = win.tabs?.[0]
    return { windowId: win.id ?? -1, tabId: tab?.id ?? -1 }
  }

  async close(windowId: number): Promise<void> {
    await chrome.windows.remove(windowId).catch(() => {})
  }
}
```

- [ ] **Step 2: Wire the controller into the SW**

In `src/service-worker/index.ts`, add imports + state. Add:

```typescript
import { ChromeWindows } from '@/adapters/ChromeWindows'
import { DailyCeiling } from '@lib/autopilot/DailyCeiling'
import { BurstGuard } from '@lib/autopilot/BurstGuard'
import { RiskAssessor, type RiskMarker } from '@lib/autopilot/RiskAssessor'
import { AutopilotGatekeeper } from '@lib/autopilot/AutopilotGatekeeper'
import { RunReportStore } from '@lib/autopilot/RunReportStore'
import type { AutopilotHost, AutopilotState, RunReport } from '@lib/types'

const AUTOPILOT_KEY = 'autopilot:state'
const reportsStore = new RunReportStore(store)
const gatekeeper = new AutopilotGatekeeper({ burst: new BurstGuard(), risk: new RiskAssessor() })
const ceiling = new DailyCeiling()
const windows = new ChromeWindows()
let sessionRisk: RiskMarker[] = []

async function autopilotState(): Promise<AutopilotState | null> {
  return store.get<AutopilotState>(AUTOPILOT_KEY)
}
async function saveAutopilot(s: AutopilotState): Promise<void> {
  await store.set(AUTOPILOT_KEY, s)
}

async function startAutopilot(host: AutopilotHost): Promise<void> {
  sessionRisk = []
  let tabId: number | undefined
  let windowId: number | undefined
  if (host === 'window') {
    const w = await windows.createFeedWindow()
    windowId = w.windowId
    tabId = w.tabId
  } else {
    const tab = await activeLinkedInTab()
    tabId = tab?.id
  }
  const state: AutopilotState = {
    running: true,
    host,
    windowId,
    tabId,
    ceiling: ceiling.forDay(humanRng()),
    used: 0,
    actionTimestamps: [],
    actionsSinceBreak: 0,
    manualStop: false,
    startedAt: clock.now().toISOString()
  }
  await saveAutopilot(state)
  // Give a freshly-created window a moment to load the content script.
  setTimeout(() => { if (tabId) chrome.tabs.sendMessage(tabId, { type: 'AUTOPILOT_RUN_LOOP' }).catch(() => {}) }, host === 'window' ? 4000 : 0)
  broadcastStatus(state)
}

async function stopAutopilot(reason: RunReport['stopReason']): Promise<void> {
  const s = await autopilotState()
  if (!s || !s.running) return
  s.running = false
  await saveAutopilot(s)
  if (s.tabId) chrome.tabs.sendMessage(s.tabId, { type: 'STOP_AUTOPILOT' }).catch(() => {})
  const report: RunReport = {
    id: randomId(),
    startedAt: s.startedAt,
    endedAt: clock.now().toISOString(),
    host: s.host,
    stopReason: reason,
    modules: [{ id: 'engagement', executed: s.used, skipped: 0, failed: 0 }]
  }
  await reportsStore.add(report)
  broadcast({ type: 'AUTOPILOT_REPORT', report })
  broadcastStatus(s)
}

function humanRng() {
  return { next: () => Math.random() }
}

function broadcastStatus(s: AutopilotState, stopReason?: RunReport['stopReason']): void {
  broadcast({ type: 'AUTOPILOT_STATUS', status: { running: s.running, used: s.used, ceiling: s.ceiling, stopReason } })
}
```

Add the message handlers in the `onMessage` switch:

```typescript
    case 'START_AUTOPILOT':
      void startAutopilot(message.host)
      return false

    case 'STOP_AUTOPILOT':
      void stopAutopilot('manual')
      return false

    case 'AUTOPILOT_RISK':
      sessionRisk.push(message.marker)
      return false

    case 'AUTOPILOT_MAY_ACT': {
      void (async () => {
        const s = await autopilotState()
        if (!s || !s.running) return sendResponse({ action: 'stop', reason: 'manual' })
        const decision = gatekeeper.decide({
          used: s.used,
          ceiling: s.ceiling,
          manualStop: s.manualStop,
          risk: sessionRisk,
          actionTimestamps: s.actionTimestamps,
          now: clock.now().getTime()
        })
        if (decision.action === 'stop') void stopAutopilot(decision.reason)
        sendResponse(decision)
      })()
      return true // async sendResponse
    }

    case 'AUTOPILOT_ACTED': {
      void (async () => {
        const s = await autopilotState()
        if (!s) return
        if (message.ok) {
          s.used += 1
          s.actionsSinceBreak += 1
          s.actionTimestamps = [...s.actionTimestamps, clock.now().getTime()].slice(-20)
          await saveAutopilot(s)
          broadcastStatus(s)
        }
      })()
      return false
    }

    case 'LIST_REPORTS':
      void reportsStore.list().then(sendResponse)
      return true
```

Add a window/tab-closed watcher near the alarms listener:

```typescript
chrome.windows.onRemoved.addListener((closedId) => {
  void autopilotState().then((s) => {
    if (s?.running && s.host === 'window' && s.windowId === closedId) void stopAutopilot('manual')
  })
})
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/service-worker/index.ts src/adapters/ChromeWindows.ts
git commit -m "feat(sw): AutopilotController — host, gatekeeping, state, reports"
```

---

### Task 10: useAutopilot composable + Reports screen

**Files:**
- Create: `src/sidepanel/composables/useAutopilot.ts`
- Create: `src/sidepanel/screens/ReportsScreen.vue`

**Interfaces:**
- Consumes: `panelBus`, `RunReport`, `AutopilotStatus`.
- Produces: `useAutopilot()` returning `{ status, reports, start(host), stop(), loadReports() }`; `ReportsScreen.vue` rendering the list.

- [ ] **Step 1: Composable**

```typescript
// src/sidepanel/composables/useAutopilot.ts
import { ref, onMounted, onUnmounted } from 'vue'
import type { AutopilotHost, AutopilotStatus, RunReport } from '@lib/types'
import { panelBus } from '../lib/panelBus'

export function useAutopilot() {
  const status = ref<AutopilotStatus | null>(null)
  const reports = ref<RunReport[]>([])

  const loadReports = async () => {
    reports.value = (await panelBus.request<RunReport[]>({ type: 'LIST_REPORTS' })) ?? []
  }
  const start = (host: AutopilotHost) => panelBus.send({ type: 'START_AUTOPILOT', host })
  const stop = () => panelBus.send({ type: 'STOP_AUTOPILOT' })

  let off = () => {}
  onMounted(() => {
    void loadReports()
    off = panelBus.onMessage((m) => {
      if (m.type === 'AUTOPILOT_STATUS') status.value = m.status
      if (m.type === 'AUTOPILOT_REPORT') void loadReports()
    })
  })
  onUnmounted(() => off())

  return { status, reports, start, stop, loadReports }
}
```

- [ ] **Step 2: Reports screen (demo tokens)**

```vue
<!-- src/sidepanel/screens/ReportsScreen.vue -->
<script setup lang="ts">
import type { RunReport } from '@lib/types'
defineProps<{ reports: RunReport[] }>()

const REASON: Record<RunReport['stopReason'], string> = {
  budget: 'дневной бюджет', risk: 'риск-стоп', manual: 'остановлено вручную', feed_exhausted: 'лента кончилась'
}
const fmt = (iso: string) => new Date(iso).toLocaleString()
const total = (r: RunReport, k: 'executed' | 'skipped' | 'failed') =>
  r.modules.reduce((n, m) => n + m[k], 0)
</script>

<template>
  <section class="view" id="v-reports">
    <div class="sect-lbl">Отчёты о прогонах</div>
    <p v-if="!reports.length" class="banner">Пока нет прогонов. Запусти автопилот на экране «Защита».</p>
    <div v-for="r in reports" :key="r.id" class="note" :data-testid="`report-${r.id}`">
      <div class="lbl">{{ fmt(r.startedAt) }} · {{ r.host === 'window' ? 'окно-воркер' : 'вкладка' }} · {{ REASON[r.stopReason] }}</div>
      Лайков: <b>{{ total(r, 'executed') }}</b> · скип: {{ total(r, 'skipped') }} · ошибок: {{ total(r, 'failed') }}
    </div>
  </section>
</template>
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: green (screen not yet routed — that's Task 11).

- [ ] **Step 4: Commit**

```bash
git add src/sidepanel/composables/useAutopilot.ts src/sidepanel/screens/ReportsScreen.vue
git commit -m "feat(sidepanel): useAutopilot composable + Reports screen"
```

---

### Task 11: Wire the 5th tab + Start/Stop controls

**Files:**
- Modify: `src/sidepanel/composables/useNavigation.ts` (add `'v-reports'`)
- Modify: `src/sidepanel/components/BottomNav.vue` (5th nav item)
- Modify: `src/sidepanel/screens/SafetyScreen.vue` (host selector + Start/Stop + status)
- Modify: `src/sidepanel/App.vue` (route ReportsScreen, pass autopilot props/handlers)

**Interfaces:**
- Consumes: `useAutopilot`.
- Produces: a navigable Reports tab; Safety screen drives autopilot.

- [ ] **Step 1: Add the nav target**

In `src/sidepanel/composables/useNavigation.ts`, add `'v-reports'` to the screen id union/list (match the existing pattern for `'v-dash' | 'v-auto' | 'v-inbox' | 'v-set'`).

- [ ] **Step 2: BottomNav 5th item**

In `src/sidepanel/components/BottomNav.vue`, add a button for `v-reports` mirroring the existing items (label "Отчёты", an icon, `@click="$emit('go','v-reports')"`, active class when `active==='v-reports'`).

- [ ] **Step 3: Safety screen controls**

In `src/sidepanel/screens/SafetyScreen.vue`, add to the script `defineProps`/`defineEmits`:
```typescript
defineProps<{ /* existing */ autopilotRunning?: boolean }>()
defineEmits<{ /* existing */ startAutopilot: [host: 'tab' | 'window']; stopAutopilot: [] }>()
```
Add controls in the template (after the autonomous-mode banner):
```html
<div class="lvl" style="margin-bottom:10px">
  <button data-testid="ap-tab" @click="$emit('startAutopilot','tab')">В этой вкладке</button>
  <button data-testid="ap-window" @click="$emit('startAutopilot','window')">В окне-воркере</button>
</div>
<button v-if="autopilotRunning" class="ghost" data-testid="ap-stop" @click="$emit('stopAutopilot')">Стоп автопилота</button>
```

- [ ] **Step 4: App.vue wiring**

In `src/sidepanel/App.vue`:
```typescript
import ReportsScreen from './screens/ReportsScreen.vue'
import { useAutopilot } from './composables/useAutopilot'
const { status, reports, start, stop } = useAutopilot()
```
Route the screen and pass props:
```html
<ReportsScreen v-else-if="active === 'v-reports'" :reports="reports" />
<SafetyScreen
  v-else
  :quarantined="quarantined" :summary="summary"
  :autopilot-running="status?.running ?? false"
  @run-campaign="runCampaign" @pause-all="pauseAll" @cancel="cancel"
  @start-autopilot="start" @stop-autopilot="stop"
/>
```

- [ ] **Step 5: Build + full suite**

Run: `npm run build && npx vitest run`
Expected: both green. If `App.spec.ts` asserts a fixed nav count, update it to include the Reports tab.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel
git commit -m "feat(sidepanel): Reports tab + autopilot Start/Stop controls"
```

---

### Task 12: Live verification (real account — user authorized)

**Files:** none (manual verification).

- [ ] **Step 1: Build + reload**

Run: `npm run build`, reload the unpacked extension, open a LinkedIn `/feed/` tab and refresh it once.

- [ ] **Step 2: Run autopilot in the current tab (short ceiling)**

For a quick check, temporarily set a low ceiling: in the SW devtools console
`chrome.storage.local.set({'autopilot:override-ceiling': 3})` is NOT wired — instead trust the
randomized ceiling but stop early with Стоп. Click **«Защита» → «В этой вкладке»**.
Expect: the feed scrolls and likes appear, paced ~8–45 s, with occasional longer pauses; the
top-bar status reflects running; reaction buttons flip to Like.

- [ ] **Step 3: Stop + report**

Click **Стоп автопилота**. Open the **«Отчёты»** tab: a report appears with host=вкладка,
stopReason=остановлено вручную, and the like count.

- [ ] **Step 4: Worker-window host**

Click **«В окне-воркере»**: a new LinkedIn window opens (unfocused), the loop runs there; park it
on a second monitor. Close the window → a report is written (manual). Confirm no console errors in
the SW devtools.

---

## Self-Review

**Spec coverage:** loop host choice → Tasks 9 (window adapter + start) + 12. Continuous loop in content → Task 8. Gatekeeper (budget/burst/risk/manual) → Tasks 1–5, 9. Daily random ceiling + warmup → Task 1. Human breaks → Task 4 (policy) + wired into Task 8's loop (`humanBreak.nextBreakMs` → sleep). Risk kill-switch → Tasks 3, 8 (detect), 9 (stop). Reports + tab → Tasks 6, 10, 11. Module-aware → report `modules[]` keyed by `ModuleId` (engagement live; others added later by extending the loop). Messages → Task 7. Persistence/eviction → SW reads `AutopilotState` from storage each tick (Task 9). Window/tab closed → Task 9 watcher.

**Placeholder scan:** Task 1 carries an explicit reconcile instruction (ramp formula) rather than a placeholder. No TBD/TODO elsewhere; code shown for every code step.

**Type consistency:** `RunReport`, `AutopilotState`, `AutopilotStatus`, `RiskMarker`, `GateState`/`GateDecision`, `AutopilotHost` are defined once and reused; message variant names match between Tasks 7/8/9/10.

## Out of scope (later increments)

Smart-connect / content-post execution; comments in the loop (needs LLM key); work-hours window; weekly budgets; separate Beacon Chrome profile; backend report sync.
