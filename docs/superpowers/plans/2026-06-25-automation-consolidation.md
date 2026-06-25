# Automation Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse Beacon to one launch (already on Dash) + per-module limits configured in «Модули», feed the engagement limit into the autopilot ceiling (jitter preserved), and delete the redundant campaign path.

**Architecture:** `ModuleState` gains a `dailyLimit`; «Модули» edits it instead of an automation-level selector. The engagement module's limit becomes the `DailyCeiling` base (so the daily cap is user-set, still `base ± jitter`). The one-shot campaign (`RUN_ENGAGEMENT`) and its second budget counter are removed; `autopilot:state` is the single budget.

**Tech Stack:** Vue 3.5 `<script setup>` + TS, Vitest + @vue/test-utils + jsdom, Chrome MV3 (service worker, content script, side panel).

## Global Constraints

- File ≤ 300 lines, one responsibility (SOLID).
- Core (`src/lib`) never imports chrome/document/fetch — only ports.
- TDD: failing test before implementation; `npx vitest run` green + `npm run build` clean before every commit.
- Commit directly to `main`. Conventional commits, terse.
- `chrome.storage` array reads go through `asArray` (`src/lib/engagement/settings.ts`).
- Jitter is mandatory: the daily ceiling is `base ± jitter` (+ warmup) — never a fixed number. Only the base source changes.
- Aliases: `@lib` → `src/lib`, `@` → `src`, `@/adapters` → `src/adapters`.
- Today only the engagement (likes) module acts; smart_connect/content are `available:false` («Скоро») — configurable but not executing.

---

## Task A: «Модули» — per-module daily limit replaces the automation-level selector

**Files:**
- Modify: `src/lib/types.ts` (`ModuleState` += `dailyLimit`)
- Modify: `src/sidepanel/composables/useModules.ts` (defaults += `dailyLimit`; `setLevel` → `setLimit`; smart_connect/content → `available:false`)
- Modify: `src/sidepanel/components/ModuleCard.vue` (number input replaces the level buttons)
- Modify: `src/sidepanel/screens/ModulesScreen.vue` (pass limit label/hint; `@set-level` → `@set-limit`)
- Modify: `src/sidepanel/App.vue` (`setLevel` → `setLimit`)
- Modify: `src/sidepanel/App.spec.ts` (the level test → a limit test)
- Test: `src/sidepanel/composables/useModules.spec.ts` (new)

**Interfaces:**
- Produces: `ModuleState { id; enabled; automationLevel; available; dailyLimit: number }`; `useModules()` returns `{ modules, toggle, setLimit }` where `setLimit(id: ModuleId, n: number)`; `ModuleCard` emits `setLimit: [n: number]`, prop `limitLabel?: string`, `recommended?: string`, testid `limit-<id>`.

- [ ] **Step 1: Add `dailyLimit` to the type**

In `src/lib/types.ts`, extend `ModuleState`:

```ts
export interface ModuleState {
  id: ModuleId
  enabled: boolean
  automationLevel: AutomationLevel
  /** Whether the module is shipped or "coming soon" in the current build. */
  available: boolean
  /** Per-module budget: likes/day (engagement), connects/week, posts/week. */
  dailyLimit: number
}
```

- [ ] **Step 2: Write the failing composable test**

```ts
// src/sidepanel/composables/useModules.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useModules, defaultModules } from './useModules'

const mem = new Map<string, unknown>()
beforeEach(() => {
  mem.clear()
  ;(globalThis as any).chrome = {
    runtime: { id: 'x' },
    storage: {
      local: {
        get: vi.fn(async (k: string) => ({ [k]: mem.get(k) })),
        set: vi.fn(async (o: Record<string, unknown>) => { for (const k in o) mem.set(k, o[k]) })
      }
    }
  }
})

describe('useModules', () => {
  it('defaults carry a dailyLimit and mark unbuilt modules unavailable', () => {
    const d = defaultModules()
    const eng = d.find((m) => m.id === 'engagement')!
    expect(eng.dailyLimit).toBe(35)
    expect(eng.available).toBe(true)
    expect(d.find((m) => m.id === 'smart_connect')!.available).toBe(false)
    expect(d.find((m) => m.id === 'content')!.available).toBe(false)
  })

  it('setLimit updates the module limit and persists a plain array', async () => {
    const m = useModules()
    m.setLimit('engagement', 50)
    expect(m.modules.value.find((x) => x.id === 'engagement')!.dailyLimit).toBe(50)
    // persisted shape is a real array (not a reactive proxy / array-like object)
    expect(Array.isArray(mem.get('modules:state'))).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/sidepanel/composables/useModules.spec.ts`
Expected: FAIL — `setLimit`/`defaultModules` shape mismatch.

- [ ] **Step 4: Update `useModules`**

Rewrite `src/sidepanel/composables/useModules.ts`:

```ts
import { ref, onMounted } from 'vue'
import type { ModuleId, ModuleState } from '@lib/types'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { asArray } from '@lib/engagement/settings'
import { panelBus } from '../lib/panelBus'

const STORE_KEY = 'modules:state'

/** Default module roster. Only engagement acts today; the rest are "coming soon". */
export function defaultModules(): ModuleState[] {
  return [
    { id: 'engagement', enabled: true, automationLevel: 'manual', available: true, dailyLimit: 35 },
    { id: 'smart_connect', enabled: false, automationLevel: 'manual', available: false, dailyLimit: 80 },
    { id: 'content', enabled: false, automationLevel: 'manual', available: false, dailyLimit: 3 },
    { id: 'auto_apply', enabled: false, automationLevel: 'manual', available: false, dailyLimit: 0 }
  ]
}

/** Owns module enable + per-module daily limit with persistence. SRP: module config. */
export function useModules() {
  const modules = ref<ModuleState[]>(defaultModules())
  const store = new ChromeStorageStore()

  const persist = () => {
    // Persist a PLAIN array, not the Vue reactive proxy — chrome.storage serialises
    // a reactive array as an array-like object {0:..,1:..}, which reads back non-array.
    if (panelBus.available()) void store.set(STORE_KEY, modules.value.map((m) => ({ ...m })))
  }

  onMounted(async () => {
    if (!panelBus.available()) return
    const saved = asArray<ModuleState>(await store.get<ModuleState[]>(STORE_KEY).catch(() => null))
    if (saved.length) modules.value = mergeWithDefaults(saved)
  })

  const find = (id: ModuleId) => modules.value.find((m) => m.id === id)

  const toggle = (id: ModuleId) => {
    const m = find(id)
    if (!m || !m.available) return
    m.enabled = !m.enabled
    persist()
  }

  const setLimit = (id: ModuleId, n: number) => {
    const m = find(id)
    if (!m) return
    m.dailyLimit = Math.max(0, Math.round(n))
    persist()
  }

  return { modules, toggle, setLimit }
}

/** Keep new default modules if storage predates them; backfill a missing dailyLimit. */
function mergeWithDefaults(saved: ModuleState[]): ModuleState[] {
  return defaultModules().map((def) => {
    const s = saved.find((x) => x.id === def.id)
    return s ? { ...def, ...s, dailyLimit: typeof s.dailyLimit === 'number' ? s.dailyLimit : def.dailyLimit } : def
  })
}
```

- [ ] **Step 5: Run the composable test (GREEN)**

Run: `npx vitest run src/sidepanel/composables/useModules.spec.ts`
Expected: PASS (2).

- [ ] **Step 6: Replace the level selector with a limit input in `ModuleCard`**

Rewrite `src/sidepanel/components/ModuleCard.vue`:

```vue
<script setup lang="ts">
import type { ModuleState } from '@lib/types'

defineProps<{
  module: ModuleState
  title: string
  desc: string
  /** When set, render a daily-limit input (omit for modules without a budget, e.g. auto_apply). */
  limitLabel?: string
  recommended?: string
}>()
defineEmits<{ toggle: []; setLimit: [n: number] }>()
</script>

<template>
  <div class="mod" :class="{ active: module.available && module.enabled }">
    <div class="mod-head">
      <div class="mic"><slot name="icon" /></div>
      <div class="mod-ttl">
        <h3>{{ title }}</h3>
        <p>{{ desc }}</p>
      </div>
      <span v-if="!module.available" class="soon">Скоро</span>
      <div
        v-else
        class="sw"
        :class="{ on: module.enabled }"
        :data-testid="`toggle-${module.id}`"
        @click="$emit('toggle')"
      />
    </div>

    <slot />

    <label v-if="limitLabel" class="fld" style="margin-top:10px">
      <span class="k">{{ limitLabel }} <span style="color:var(--mut)">{{ recommended }}</span></span>
      <input
        type="number"
        min="0"
        :value="module.dailyLimit"
        :disabled="!module.available"
        :data-testid="`limit-${module.id}`"
        @change="$emit('setLimit', Number(($event.target as HTMLInputElement).value))"
      />
    </label>
  </div>
</template>
```

- [ ] **Step 7: Wire `ModulesScreen` to limits**

In `src/sidepanel/screens/ModulesScreen.vue`: change the script and each card. New script block:

```ts
import type { ModuleId, ModuleState } from '@lib/types'
import ModuleCard from '../components/ModuleCard.vue'
import EngagementSettingsForm from '../components/EngagementSettingsForm.vue'

defineProps<{ modules: ModuleState[] }>()
defineEmits<{ toggle: [id: ModuleId]; setLimit: [id: ModuleId, n: number] }>()

const byId = (modules: ModuleState[], id: ModuleId) => modules.find((m) => m.id === id)!
```

For the **engagement** card replace `@set-level="..."` with limit props + handler:

```vue
    <ModuleCard
      :module="byId(modules, 'engagement')"
      title="Вовлечённость в ленте"
      desc="Умные лайки + AI-комментарии к постам твоей ЦА и рекрутёров"
      limit-label="Лайков/день"
      recommended="рек. 30–40"
      @toggle="$emit('toggle', 'engagement')"
      @set-limit="(n) => $emit('setLimit', 'engagement', n)"
    >
```

For **smart_connect** card:

```vue
      limit-label="Коннектов/неделю"
      recommended="рек. 60–80"
      @toggle="$emit('toggle', 'smart_connect')"
      @set-limit="(n) => $emit('setLimit', 'smart_connect', n)"
```

For **content** card:

```vue
      limit-label="Постов/неделю"
      recommended="рек. 2–3"
      @toggle="$emit('toggle', 'content')"
      @set-limit="(n) => $emit('setLimit', 'content', n)"
```

For **auto_apply** card: remove the `@set-level` line entirely (no `limit-label`, no limit input — it has no budget):

```vue
    <ModuleCard
      :module="byId(modules, 'auto_apply')"
      title="Авто-отклики"
      desc="Easy Apply + cover letter (свой движок или через Job Radar)"
      @toggle="$emit('toggle', 'auto_apply')"
    >
```

(Leave each card's existing inner stat/limit-bar/note markup and the `EngagementSettingsForm` slot content as-is.)

- [ ] **Step 8: Update `App.vue`**

In `src/sidepanel/App.vue` change the `useModules` destructure and the `ModulesScreen` wiring:

```ts
const { modules, toggle, setLimit } = useModules()
```
```vue
      <ModulesScreen
        v-else-if="active === 'v-auto'"
        :modules="modules"
        @toggle="toggle"
        @set-limit="setLimit"
      />
```

- [ ] **Step 9: Update the App spec — limit input instead of the level selector**

In `src/sidepanel/App.spec.ts` replace the `changes automation level…` test with:

```ts
  it('edits the engagement daily limit', async () => {
    const w = await mountApp()
    await w.find('[data-testid="nav-v-auto"]').trigger('click')
    const input = w.find('[data-testid="limit-engagement"]')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('35')
    await input.setValue('50')
    await input.trigger('change')
    expect((w.find('[data-testid="limit-engagement"]').element as HTMLInputElement).value).toBe('50')
  })
```

- [ ] **Step 10: Run the full suite + build**

Run: `npx vitest run && npm run build`
Expected: PASS, clean. (`vue-tsc` confirms no dangling `setLevel`/`automationLevel` UI refs.)

- [ ] **Step 11: Commit**

```bash
git add src/lib/types.ts src/sidepanel/composables/useModules.ts src/sidepanel/composables/useModules.spec.ts src/sidepanel/components/ModuleCard.vue src/sidepanel/screens/ModulesScreen.vue src/sidepanel/App.vue src/sidepanel/App.spec.ts
git commit -m "feat(modules): per-module daily limit replaces the automation-level selector"
```

---

## Task B: Autopilot ceiling base from the engagement limit (jitter preserved)

**Files:**
- Create: `src/lib/autopilot/engagementLimit.ts`
- Test: `src/lib/autopilot/engagementLimit.test.ts`
- Test: `src/lib/autopilot/DailyCeiling.test.ts` (add a base-centering case if absent)
- Modify: `src/service-worker/index.ts` (build the ceiling from the configured base)

**Interfaces:**
- Consumes: `ModuleState` (with `dailyLimit`, Task A), `asArray`, `DailyCeiling({ base }).forDay(rng)`.
- Produces: `engagementLimit(modulesState: unknown): number`, `DEFAULT_LIKES_PER_DAY = 35`.

- [ ] **Step 1: Write the failing helper test**

```ts
// src/lib/autopilot/engagementLimit.test.ts
import { describe, it, expect } from 'vitest'
import { engagementLimit, DEFAULT_LIKES_PER_DAY } from './engagementLimit'

const eng = (dailyLimit: number) => ({ id: 'engagement', enabled: true, automationLevel: 'manual', available: true, dailyLimit })

describe('engagementLimit', () => {
  it('returns the engagement module dailyLimit', () => {
    expect(engagementLimit([eng(50)])).toBe(50)
  })

  it('falls back to the default when missing or non-positive', () => {
    expect(engagementLimit([])).toBe(DEFAULT_LIKES_PER_DAY)
    expect(engagementLimit([eng(0)])).toBe(DEFAULT_LIKES_PER_DAY)
    expect(engagementLimit(null)).toBe(DEFAULT_LIKES_PER_DAY)
  })

  it('survives chrome.storage serialising the array as an object', () => {
    expect(engagementLimit({ 0: eng(42) })).toBe(42)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/autopilot/engagementLimit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// src/lib/autopilot/engagementLimit.ts
import type { ModuleState } from '../types'
import { asArray } from '../engagement/settings'

/** Default likes/day when the engagement module has no configured limit. */
export const DEFAULT_LIKES_PER_DAY = 35

/**
 * The configured likes/day for the engagement module — the BASE for the autopilot
 * daily ceiling (DailyCeiling then applies ± jitter + warmup). Reads from the
 * persisted modules:state roster; guards the chrome.storage array-as-object gotcha.
 */
export function engagementLimit(modulesState: unknown): number {
  const m = asArray<ModuleState>(modulesState).find((x) => x?.id === 'engagement')
  const n = m?.dailyLimit
  return typeof n === 'number' && n > 0 ? n : DEFAULT_LIKES_PER_DAY
}
```

- [ ] **Step 4: Run the helper test (GREEN)**

Run: `npx vitest run src/lib/autopilot/engagementLimit.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Add a base-centering test for `DailyCeiling`**

In `src/lib/autopilot/DailyCeiling.test.ts` (create if absent) add:

```ts
import { describe, it, expect } from 'vitest'
import { DailyCeiling } from './DailyCeiling'

const rng = (v: number) => ({ next: () => v })

describe('DailyCeiling base from config', () => {
  it('centres the jittered ceiling on the configured base', () => {
    const c = new DailyCeiling({ base: 35, jitter: 10 })
    expect(c.forDay(rng(0.5))).toBe(35) // centre
    expect(c.forDay(rng(0))).toBe(25)   // base - jitter
    expect(c.forDay(rng(1))).toBe(45)   // base + jitter
  })
})
```

Run: `npx vitest run src/lib/autopilot/DailyCeiling.test.ts`
Expected: PASS (skip this step's new block if an equivalent assertion already exists — do not duplicate).

- [ ] **Step 6: Wire the SW ceiling to the configured base**

In `src/service-worker/index.ts`:

1. Add the import near the other `@lib/autopilot` imports:
```ts
import { engagementLimit } from '@lib/autopilot/engagementLimit'
```
2. Remove the module-level singleton `const dailyCeiling = new DailyCeiling()` (it is replaced by a per-run construction; `DailyCeiling` stays imported).
3. In `startAutopilot`, replace the `budget` line:
```ts
  const prev = existing ? { day: existing.day, ceiling: existing.ceiling, used: existing.used } : null
  const base = engagementLimit(await store.get('modules:state'))
  const budget = resolveDailyBudget(prev, dayKey(), new DailyCeiling({ base }).forDay(autopilotRng))
```

- [ ] **Step 7: Verify build (and full suite)**

Run: `npm run build && npx vitest run`
Expected: clean + green. (Live check happens after Task C.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/autopilot/engagementLimit.ts src/lib/autopilot/engagementLimit.test.ts src/lib/autopilot/DailyCeiling.test.ts src/service-worker/index.ts
git commit -m "feat(autopilot): daily ceiling base from the engagement module limit (jitter kept)"
```

---

## Task C: Remove the campaign path (`RUN_ENGAGEMENT`) — single budget

**Files:**
- Modify: `src/lib/types.ts` (drop `RUN_ENGAGEMENT`, `ENGAGEMENT_RESULT` variants)
- Modify: `src/content/index.ts` (drop their no-op switch cases)
- Modify: `src/service-worker/index.ts` (drop the case, `runEngagement`, and the runner/orchestrator chain it solely used)
- Modify: `src/sidepanel/composables/useEngagement.ts` (drop `runCampaign` + `summary` + the `ENGAGEMENT_RESULT` listener)
- Modify: `src/sidepanel/screens/SafetyScreen.vue` (drop the campaign button + the run-summary block)
- Modify: `src/sidepanel/App.vue` (drop `summary`/`runCampaign` wiring)

**Interfaces:**
- Produces: `useEngagement()` returns `{ quarantined, cancel, loadQuarantine }` (no `summary`/`runCampaign`). `BeaconMessage` no longer has `RUN_ENGAGEMENT`/`ENGAGEMENT_RESULT`. `SafetyScreen` props `{ quarantined? }`, emits `{ cancel, pauseAll }`.

- [ ] **Step 1: Remove the two message variants**

In `src/lib/types.ts`, delete these two lines from `BeaconMessage`:
```ts
  | { type: 'RUN_ENGAGEMENT' }
  ...
  | { type: 'ENGAGEMENT_RESULT'; summary: EngagementRunSummary }
```
(Keep the `EngagementRunSummary` interface — `EngagementRunner` in `src/lib` still uses it.)

- [ ] **Step 2: Remove the content-script no-op cases**

In `src/content/index.ts`, delete the `case 'RUN_ENGAGEMENT':` and `case 'ENGAGEMENT_RESULT':` lines from the exhaustive switch's `return false` group (the `assertNever` default now enforces both are gone).

- [ ] **Step 3: Remove the SW campaign chain**

In `src/service-worker/index.ts`:

1. Delete the `case 'RUN_ENGAGEMENT':` block (the `void withPageActivity(runEngagement, SCANNING).then(sendResponse); return true`).
2. Delete the `runEngagement` function (the one that calls `runner.run` and broadcasts `ENGAGEMENT_RESULT`).
3. Delete the composition-root consts that are now unused **only by the campaign**: `tabExecutor`, `orchestrator`, `humanDelay`, `runner`. KEEP `quarantine` (still used by `LIST_QUARANTINE` / `CANCEL_QUARANTINE`) and `store`/`clock`.
4. Delete the now-unused imports: `EngagementOrchestrator`, `type ActionExecutor`, `EngagementRunner`, `CommentJudge`, `HumanDelay`, `LikeFilter`, `ActionGate`. KEEP `QuarantineQueue`, `loadSettings` (used by content handlers), `SCANNING`/`GENERATING_IDEAS` (GENERATE_IDEAS still uses `withPageActivity`).

> The build (`vue-tsc` with `noUnusedLocals`) is the guard here: if any of the above is still referenced, the build fails — fix by removing the reference, never by re-adding the const.

- [ ] **Step 4: Trim `useEngagement`**

Rewrite `src/sidepanel/composables/useEngagement.ts`:

```ts
import { ref, onMounted, onUnmounted } from 'vue'
import type { ActionQueueItem } from '@lib/types'
import { panelBus } from '../lib/panelBus'

/**
 * Side-panel view of the quarantine queue: list pending gated actions and cancel
 * within the window. (The one-shot campaign trigger was removed — automation runs
 * via the autopilot from the Dash; the quarantine surface stays for gated comments.)
 */
export function useEngagement() {
  const quarantined = ref<ActionQueueItem[]>([])

  const loadQuarantine = async () => {
    const items = await panelBus.request<ActionQueueItem[]>({ type: 'LIST_QUARANTINE' })
    quarantined.value = (items ?? []).filter((i) => i.status === 'quarantined')
  }

  const cancel = async (id: string) => {
    await panelBus.request({ type: 'CANCEL_QUARANTINE', id })
    await loadQuarantine()
  }

  let off = () => {}
  onMounted(() => {
    void loadQuarantine()
    off = panelBus.onMessage(() => {})
  })
  onUnmounted(() => off())

  return { quarantined, cancel, loadQuarantine }
}
```

- [ ] **Step 5: Trim `SafetyScreen`**

In `src/sidepanel/screens/SafetyScreen.vue`:

1. Script: drop `summary` from props and `runCampaign` from emits:
```ts
import type { ActionQueueItem } from '@lib/types'

withDefaults(defineProps<{ quarantined?: ActionQueueItem[] }>(), { quarantined: () => [] })
defineEmits<{ pauseAll: []; cancel: [id: string] }>()

const authorOf = (item: ActionQueueItem) => String(item.target.meta?.author ?? 'пост')
```
2. Template: delete the run-summary block (`<div v-if="summary" … data-testid="run-summary">…</div>`) and the campaign button (`<button class="cta" data-testid="run-campaign" …>Запустить сегодняшнюю кампанию</button>`). Keep the anti-ban panel, the quarantine list, and «Пауза всех модулей».

- [ ] **Step 6: Update `App.vue`**

In `src/sidepanel/App.vue`:
1. Drop `summary` and `runCampaign` from the `useEngagement` destructure:
```ts
const { quarantined, cancel } = useEngagement()
```
2. In the `SafetyScreen` element, remove `:summary="summary"` and `@run-campaign="runCampaign"` (keep `:quarantined`, `@pause-all`, `@cancel`).

- [ ] **Step 7: Full validation**

Run: `npx vitest run && npm run build`
Expected: ALL green, build clean. Grep confirms the campaign is gone:
```bash
grep -rn "RUN_ENGAGEMENT\|ENGAGEMENT_RESULT\|runCampaign\|run-campaign" src && echo "LEFTOVERS" || echo "clean"
```
Expected: `clean`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/content/index.ts src/service-worker/index.ts src/sidepanel/composables/useEngagement.ts src/sidepanel/screens/SafetyScreen.vue src/sidepanel/App.vue
git commit -m "refactor(automation): remove the one-shot campaign path — single budget via the autopilot"
```

**Done when:** `npm test` green, build clean, and live (CDP): set «Лайков/день» in «Модули», launch from Dash, confirm the autopilot ceiling ≈ the set value ± jitter and likes land; «Защита» has no campaign button.

---

# Self-Review

**Spec coverage:**
- Dash single launch (already present) → no task needed ✓
- «Модули» limit input replaces level selector → Task A ✓
- smart_connect/content → «Скоро» (`available:false`) → Task A (defaults) ✓
- Limit feeds the ceiling, jitter preserved → Task B ✓
- Remove campaign + automationLevel UI → Task A (level UI) + Task C (campaign) ✓
- Single budget (`engagement:budget:like` dropped with the campaign) → Task C ✓
- automationLevel field left vestigial → kept on `ModuleState`, no UI editor ✓
- Out of scope (connects/content execution, deep automationLevel removal) → untouched ✓

**Placeholder scan:** none — every code step is concrete; every run step has a command + expected result.

**Type consistency:** `ModuleState.dailyLimit: number` defined in Task A and consumed by `engagementLimit` (Task B); `useModules` exposes `setLimit(id, n)` consumed by `ModulesScreen`/`App.vue`; `useEngagement` post-Task-C returns `{ quarantined, cancel, loadQuarantine }` matching `App.vue`'s destructure. `ModuleCard` emits `setLimit: [n]` consumed by `ModulesScreen`.

**Execution order:** A → B → C (B needs `ModuleState.dailyLimit` from A; C is independent but touches App.vue/SW, so run last to avoid churn).
