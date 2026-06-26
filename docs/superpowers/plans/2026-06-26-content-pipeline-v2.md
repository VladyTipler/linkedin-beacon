# Content Pipeline v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make idea generation visible+working, add a draft "Approve" gate, and auto-publish approved drafts as a gated step inside the single «Запустить».

**Architecture:** Hexagonal. New pure policy in `src/lib/content/` (100% unit-tested), a testable SW handler `publishApprovedDrafts` in `contentHandlers.ts`, thin wiring in `service-worker/index.ts` mirroring the existing Smart Connect step. The in-loop idea extractor gains a persisted `ideas:lastRun` diagnostic that the Content tab surfaces. Posts stay human-approved one-by-one; only the mechanical publish is automated.

**Tech Stack:** Chrome MV3, Vue 3.5 + TS, Vite 6, Vitest + @vue/test-utils + jsdom.

## Global Constraints

- File ≤ 300 lines, one responsibility (SOLID). Long prompts/constants extracted.
- core (`src/lib`) never imports `chrome`/`document`/`fetch` — only ports. Time via `Clock`, storage via `KeyValueStore`.
- **TDD:** failing test → minimal code → green → commit. Boundary tests must CROSS the boundary (real LLM mapper shape / real storage round-trip / real publish contract), not pure-unit both sides.
- **Never trust the shape of a chrome.storage value** — read arrays via `asArray()` (`src/lib/engagement/settings.ts`).
- Direct-to-`main` commits (Vlad's workflow). Laconic conventional commits ending with the Co-Authored-By trailer.
- `npx vitest run` green + `npm run build` (vue-tsc clean) before "done".
- Content settings live in `content:settings` (SSOT). Existing weekly cap default `DEFAULT_POSTS_PER_WEEK = 3`.
- The content switch in `src/content/index.ts` is EXHAUSTIVE (`assertNever`) — any new BeaconMessage variant needs a no-op case there (none expected in this plan — approve is client-side, publish reuses EXECUTE_ACTION).

---

## File Structure

- `src/lib/types.ts` — modify: `Draft.approved?: boolean`; new `IdeasLastRun`; `AutopilotState.postsPublished?`.
- `src/lib/content/DraftStore.ts` — modify: `setApproved(id, approved)`.
- `src/lib/content/settings.ts` — modify: `publishDays` field + default + validation.
- `src/lib/content/publishPolicy.ts` — **new**: `shouldPublishToday`, `pickOldestApproved`.
- `src/service-worker/contentHandlers.ts` — modify: `ideas:lastRun` writes in `extractRunIdeas`; new `publishApprovedDrafts`; the confirmed ideas root-cause fix.
- `src/service-worker/index.ts` — modify: `publishApprovedThen(tabId)` step in `launch()`; RunReport `content` line.
- `src/sidepanel/composables/useContent.ts` — modify: `approveDraft`, `lastRun` load + state.
- `src/sidepanel/screens/ContentScreen.vue` — modify: approve button + badge + sort + lastRun status line.
- `src/sidepanel/screens/SettingsScreen.vue` — modify: weekday checkboxes.
- `.claude/context/linkedin-beacon/architecture-overview.md` — modify: invariant #5 wording.

---

## Part 1 — Fix idea generation

### Task 1: Storage dump — pin the second cause (investigation, no production code)

**Files:** none (live diagnostic). Record the finding in the commit message of Task 4 and in memory-bank.

> Per advisor: dump BEFORE writing any Part 1 fix — three values discriminate every hypothesis.

- [ ] **Step 1: Launch the debug Chrome with the built extension**

```bash
npm run build
"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --remote-debugging-port=9222 --user-data-dir="E:\\chrome-debug" \
  --load-extension="$(wslpath -w dist)" "https://www.linkedin.com/feed/" &
```

- [ ] **Step 2: Read the persisted idea state** via the CDP storage trace (the node global-WebSocket CDP helper from `live-testing-cdp` memory; evaluate in the extension's service-worker or via `chrome.storage.local.get`). Capture exactly these:
  - `ideas:bank` — array length (0 = nothing ever banked)
  - `ideas:budget` — `{ day, used }`
  - `modules:state` → what `moduleLimit(modulesState, 'content', 5)` returns (the content card's «Модули» limit)
  - `ideas:lastRun` if present (won't exist until Task 2)

- [ ] **Step 3: Classify the cause from the three values:**
  - `ideas:budget.used >= moduleLimit('content')` AND `ideas:bank` empty → **budget-stuck / limit-too-low** (line 139 silently skips). Likely the limit collision: the content card limit is posts-oriented and read as ideas/day.
  - `moduleLimit('content')` is `0`/tiny → **limit collision** confirmed.
  - bank non-empty but tab shows nothing → UI/read bug, re-check `IdeaBank.all()` / `asArray`.
  - budget healthy, bank empty, used `0` → **LLM/parse**: do ONE manual «Сгенерировать идеи» and read the returned `error` (manual path surfaces it) to get the provider/parse message.

- [ ] **Step 4: Write the finding down** (one line) to carry into Task 4. Example: "ideas:budget={day:'2026-06-20',used:5}, moduleLimit('content')=3, bank=0 → stale-day budget never rolled because clock day mismatched / limit collision."

**No commit** (no code). This task gates Task 4.

---

### Task 2: `ideas:lastRun` diagnostic written on every `extractRunIdeas` path

**Files:**
- Modify: `src/lib/types.ts` (add `IdeasLastRun`)
- Modify: `src/service-worker/contentHandlers.ts:121-153` (`extractRunIdeas`)
- Test: `src/service-worker/contentHandlers.test.ts` (extend)

**Interfaces:**
- Produces: `interface IdeasLastRun { at: string; reason: 'ok'|'no_feed'|'disabled'|'no_key'|'no_expertise'|'budget_exhausted'|'error'; stored: number; budget?: { used: number; limit: number }; error?: string }`; storage key constant `IDEAS_LAST_RUN_KEY = 'ideas:lastRun'` (export from `contentHandlers.ts`).
- Consumes: existing `extractRunIdeas(deps: { store, http, clock }, posts)`.

- [ ] **Step 1: Write the failing test** — extend `contentHandlers.test.ts`. (Reuse the file's existing `memStore`/fake-http helpers and the `CONFIGURED`/`CONTENT_MODS` fixtures.)

```ts
import { IDEAS_LAST_RUN_KEY } from './contentHandlers'
import type { IdeasLastRun } from '../lib/types'

it('records lastRun=budget_exhausted (with counts) when the daily budget is spent', async () => {
  const store = memStore({ ...CONFIGURED, ...CONTENT_MODS, 'ideas:budget': { day: '2026-06-26', used: 5 } })
  const clock = { now: () => new Date('2026-06-26T10:00:00Z') }
  await extractRunIdeas({ store, http: okHttp, clock }, [FEED_POST])
  const last = await store.get<IdeasLastRun>(IDEAS_LAST_RUN_KEY)
  expect(last?.reason).toBe('budget_exhausted')
  expect(last?.budget).toEqual({ used: 5, limit: 5 })
  expect(last?.stored).toBe(0)
})

it('records lastRun=ok with the stored count on success', async () => {
  const store = memStore({ ...CONFIGURED, ...CONTENT_MODS })
  const clock = { now: () => new Date('2026-06-26T10:00:00Z') }
  await extractRunIdeas({ store, http: okHttp, clock }, [FEED_POST])
  const last = await store.get<IdeasLastRun>(IDEAS_LAST_RUN_KEY)
  expect(last?.reason).toBe('ok')
  expect(last?.stored).toBeGreaterThan(0)
})

it('records lastRun=error with the provider message when extraction throws', async () => {
  const store = memStore({ ...CONFIGURED, ...CONTENT_MODS })
  const clock = { now: () => new Date('2026-06-26T10:00:00Z') }
  await extractRunIdeas({ store, http: failHttp /* returns prose → ideas_not_json */, clock }, [FEED_POST])
  const last = await store.get<IdeasLastRun>(IDEAS_LAST_RUN_KEY)
  expect(last?.reason).toBe('error')
  expect(typeof last?.error).toBe('string')
})
```

> `okHttp` returns the real OpenRouter shape `{choices:[{message:{content:'[{"topic":"X","angle":"Y"}]'}}]}`; `failHttp` returns prose content so `parseIdeas` throws `ideas_not_json`. These cross the LLM mapper boundary.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/service-worker/contentHandlers.test.ts -t lastRun`
Expected: FAIL — `IDEAS_LAST_RUN_KEY` not exported / nothing written.

- [ ] **Step 3: Add the type** to `src/lib/types.ts`:

```ts
/** Diagnostic of the most recent in-loop idea extraction (surfaced on the Content tab). */
export interface IdeasLastRun {
  at: string
  reason: 'ok' | 'no_feed' | 'disabled' | 'no_key' | 'no_expertise' | 'budget_exhausted' | 'error'
  stored: number
  budget?: { used: number; limit: number }
  error?: string
}
```

- [ ] **Step 4: Make `extractRunIdeas` write `ideas:lastRun` on every path.** Add the key + a small writer helper at the top of `contentHandlers.ts`, and a write at each return:

```ts
export const IDEAS_LAST_RUN_KEY = 'ideas:lastRun'

// inside extractRunIdeas — write before each return:
const writeLast = (r: Omit<IdeasLastRun, 'at'>) =>
  deps.store.set(IDEAS_LAST_RUN_KEY, { at: deps.clock.now().toISOString(), ...r })

if (!posts.length) { await writeLast({ reason: 'no_feed', stored: 0 }); return { stored: 0, error: 'no_feed' } }
const modulesState = await deps.store.get('modules:state')
if (!enabledModules(modulesState).some((m) => m.id === 'content')) {
  await writeLast({ reason: 'disabled', stored: 0 }); return { stored: 0 }
}
const cfg = await loadLlmConfig(deps.store)
if (!cfg.apiKey.trim()) { await writeLast({ reason: 'no_key', stored: 0 }); return { stored: 0, error: 'no_key' } }
const { expertise } = await loadSettings(deps.store)
if (!expertise.headline.trim()) { await writeLast({ reason: 'no_expertise', stored: 0 }); return { stored: 0, error: 'no_expertise' } }

const limit = ideasPerDayLimit(modulesState)
const today = deps.clock.now().toISOString().slice(0, 10)
const budget = rolloverIdeaDay((await deps.store.get<IdeaDay>(IDEA_BUDGET_KEY)) ?? null, today)
const allowance = remainingIdeas(budget, limit)
if (allowance <= 0) {
  await writeLast({ reason: 'budget_exhausted', stored: 0, budget: { used: budget.used, limit } }); return { stored: 0 }
}

const provider = createLlmProvider(/* … */)
const bank = new IdeaBank(deps.store)
try {
  const before = (await bank.all()).length
  const ideas = await new IdeaExtractor(provider).extract(posts.map(feedPostToFeedItem), expertise)
  await bank.add(ideas.slice(0, allowance))
  const stored = (await bank.all()).length - before
  await deps.store.set(IDEA_BUDGET_KEY, recordIdeaDay(budget, stored))
  await writeLast({ reason: 'ok', stored, budget: { used: budget.used + stored, limit } })
  return { stored }
} catch (e) {
  const error = e instanceof Error ? e.message : 'llm_failed'
  await writeLast({ reason: 'error', stored: 0, error })
  return { stored: 0, error }
}
```

> Keep the function ≤ its current responsibility; if it nears 300 lines in the file, extract the writer. (`enabledModules`, `loadLlmConfig`, `loadSettings`, `ideasPerDayLimit`, `IdeaDay`, `IDEA_BUDGET_KEY`, `rolloverIdeaDay`, `remainingIdeas`, `recordIdeaDay`, `IdeaBank`, `IdeaExtractor`, `feedPostToFeedItem` are already imported.)

- [ ] **Step 5: Run to verify green**

Run: `npx vitest run src/service-worker/contentHandlers.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/service-worker/contentHandlers.ts src/service-worker/contentHandlers.test.ts
git commit -m "feat(ideas): persist ideas:lastRun on every extract path (no more silent zero)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Content tab surfaces `ideas:lastRun`

**Files:**
- Modify: `src/sidepanel/composables/useContent.ts`
- Modify: `src/sidepanel/screens/ContentScreen.vue`
- Test: `src/sidepanel/screens/ContentScreen.spec.ts` (extend)

**Interfaces:**
- Consumes: `IdeasLastRun`, `IDEAS_LAST_RUN_KEY` (`'ideas:lastRun'`).
- Produces: `useContent()` now returns `lastRun: Ref<IdeasLastRun | null>` and `loadLastRun()`.

- [ ] **Step 1: Write the failing component test** — extend `ContentScreen.spec.ts`:

```ts
it('shows the last auto-collect status on the ideas tab', async () => {
  // seed chrome.storage stub: ideas:lastRun = { at, reason:'budget_exhausted', stored:0, budget:{used:5,limit:5} }
  const w = mount(ContentScreen)
  await flushPromises()
  expect(w.find('[data-testid="ideas-last-run"]').text()).toContain('5/5')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/sidepanel/screens/ContentScreen.spec.ts -t last-collect`
Expected: FAIL — no `ideas-last-run` element.

- [ ] **Step 3: Add `lastRun` to the composable** (`useContent.ts`):

```ts
import type { IdeasLastRun } from '@lib/types'
const lastRun = ref<IdeasLastRun | null>(null)
async function loadLastRun() { lastRun.value = (await store.get<IdeasLastRun>('ideas:lastRun')) ?? null }
// add lastRun + loadLastRun to the returned object; call loadLastRun() inside generateIdeas() after the request too
```

- [ ] **Step 4: Render it** in `ContentScreen.vue` ideas tab, under the generate button. Add to the destructure + `onMounted(Promise.all([... loadLastRun()]))`:

```vue
<p v-if="lastRun" class="lbl" style="opacity:.7" data-testid="ideas-last-run">
  {{ lastRunText }}
</p>
```

```ts
import { computed } from 'vue'
const lastRunText = computed(() => {
  const r = lastRun.value; if (!r) return ''
  const t = new Date(r.at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
  if (r.reason === 'ok') return `Последний автосбор: +${r.stored} идей (${t})`
  if (r.reason === 'budget_exhausted') return `Бюджет идей на сегодня исчерпан (${r.budget?.used}/${r.budget?.limit})`
  if (r.reason === 'error') return `Ошибка автосбора: ${r.error} (${t})`
  return ERR[r.reason] ?? `Автосбор: ${r.reason}`
})
```

- [ ] **Step 5: Run to verify green**

Run: `npx vitest run src/sidepanel/screens/ContentScreen.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/composables/useContent.ts src/sidepanel/screens/ContentScreen.vue src/sidepanel/screens/ContentScreen.spec.ts
git commit -m "feat(ideas): surface ideas:lastRun status on the Content tab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Fix the confirmed root cause + regression test

**Files:** depends on Task 1 finding — most likely `src/service-worker/contentHandlers.ts` and/or `src/lib/ideas/IdeaDayBudget.ts`. Test: `src/service-worker/contentHandlers.test.ts` or `src/lib/ideas/IdeaDayBudget.test.ts`.

> Gated on Task 1. Write the regression test FIRST, reproducing the exact failing condition the dump revealed, then apply the matching fix. Apply ONLY the branch Task 1 confirmed.

- [ ] **Step 1: Write the failing regression test** for the confirmed condition. Example shapes per branch:
  - **Branch A — limit collision** (content card limit read as ideas/day, too small/0): assert `ideasPerDayLimit` returns a sane ideas/day value independent of the posts limit.

    ```ts
    it('ideas/day limit does not collapse to the posts-per-week card value', () => {
      const modulesState = [{ id: 'content', enabled: true, limit: 3 }] // card shows posts/week
      expect(ideasPerDayLimit(modulesState)).toBeGreaterThanOrEqual(DEFAULT_IDEAS_PER_DAY)
    })
    ```
    Fix: stop deriving ideas/day from the content card limit; use `DEFAULT_IDEAS_PER_DAY` (or a dedicated `ideasPerDay` setting), since the «Модули» content limit means posts/week.

  - **Branch B — stale/stuck budget** (`used` never rolls because the day key path differs): assert a new day resets allowance.

    ```ts
    it('a new day grants a fresh ideas allowance even if yesterday was spent', async () => {
      const store = memStore({ ...CONFIGURED, ...CONTENT_MODS, 'ideas:budget': { day: '2026-06-25', used: 5 } })
      const clock = { now: () => new Date('2026-06-26T10:00:00Z') }
      const r = await extractRunIdeas({ store, http: okHttp, clock }, [FEED_POST])
      expect(r.stored).toBeGreaterThan(0)
    })
    ```
    (If this already passes, the cause is not stale budget — move to the branch the dump confirmed.)

  - **Branch C — LLM/parse:** the message captured in Task 1 step 3 names the issue (e.g. model returns prose → `ideas_not_json`). The fix is model guidance / a stronger default; the regression test asserts `parseIdeas` tolerance for the exact shape observed, in `IdeaExtractor.test.ts`.

- [ ] **Step 2: Run to verify it fails** — `npx vitest run <the test>` → FAIL reproducing the bug.
- [ ] **Step 3: Apply the matching fix** (smallest change that makes the test green).
- [ ] **Step 4: Run to verify green** — `npx vitest run` (the file) → PASS.
- [ ] **Step 5: Re-dump live** (repeat Task 1 steps 1–2) and confirm `ideas:lastRun.reason === 'ok'` with `stored > 0` after a real feed run. This is the boundary-crossing proof the bug is actually dead.
- [ ] **Step 6: Commit** with the finding in the message:

```bash
git commit -am "fix(ideas): <confirmed cause> — ideas now bank during the run

Dump showed <ideas:budget / moduleLimit / bank values>. <one-line why>.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Part 2 — "Approve for publishing"

### Task 5: `Draft.approved?` + `DraftStore.setApproved`

**Files:**
- Modify: `src/lib/types.ts` (`Draft.approved?: boolean`)
- Modify: `src/lib/content/DraftStore.ts`
- Test: `src/lib/content/DraftStore.test.ts` (extend)

**Interfaces:**
- Produces: `DraftStore.setApproved(id: string, approved: boolean): Promise<void>`.

- [ ] **Step 1: Write the failing test:**

```ts
it('sets and clears the approved flag, round-tripping through storage', async () => {
  const store = memStore()
  const drafts = new DraftStore(store)
  await drafts.add({ id: 'a', ideaTopic: 't', ideaAngle: 'g', text: 'x', createdAt: '2026-06-26T00:00:00Z' })
  await drafts.setApproved('a', true)
  expect((await drafts.all())[0].approved).toBe(true)
  await drafts.setApproved('a', false)
  expect((await drafts.all())[0].approved).toBe(false)
})

it('setApproved on an unknown id is a no-op', async () => {
  const store = memStore()
  const drafts = new DraftStore(store)
  await drafts.setApproved('nope', true) // must not throw
  expect(await drafts.all()).toEqual([])
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/content/DraftStore.test.ts -t approved` → FAIL (`setApproved` undefined).

- [ ] **Step 3: Add the field + method.** `types.ts`: add `approved?: boolean` to `Draft`. `DraftStore.ts`:

```ts
async setApproved(id: string, approved: boolean): Promise<void> {
  const next = (await this.all()).map((d) => (d.id === id ? { ...d, approved } : d))
  await this.store.set(DRAFTS_KEY, next)
}
```

- [ ] **Step 4: Run to verify green** — `npx vitest run src/lib/content/DraftStore.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/content/DraftStore.ts src/lib/content/DraftStore.test.ts
git commit -m "feat(content): Draft.approved flag + DraftStore.setApproved

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Approve button + badge in the UI

**Files:**
- Modify: `src/sidepanel/composables/useContent.ts`
- Modify: `src/sidepanel/screens/ContentScreen.vue`
- Test: `src/sidepanel/screens/ContentScreen.spec.ts` (extend)

**Interfaces:**
- Consumes: `DraftStore.setApproved`.
- Produces: `useContent()` returns `approveDraft(id, approved)`; drafts sorted approved-first.

- [ ] **Step 1: Write the failing test:**

```ts
it('approve button sets the flag and shows the badge; approve is NOT gated by postsLeft', async () => {
  // seed one draft, postsPerWeek budget fully spent (postsLeft = 0)
  const w = mount(ContentScreen); await flushPromises()
  await w.find('[data-testid="subtab-drafts"]').trigger('click')
  const approve = w.find('[data-testid^="approve-"]')
  expect(approve.attributes('disabled')).toBeUndefined()   // approve works even at postsLeft=0
  await approve.trigger('click'); await flushPromises()
  expect(w.find('[data-testid^="approved-badge-"]').exists()).toBe(true)
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/sidepanel/screens/ContentScreen.spec.ts -t approve` → FAIL.

- [ ] **Step 3: Add `approveDraft` to the composable** (`useContent.ts`), client-side like `removeDraft`:

```ts
async function approveDraft(id: string, approved: boolean) {
  await drafts.setApproved(id, approved)
  await loadDrafts()
}
// sort approved-first, stable on createdAt, in loadDrafts:
async function loadDrafts() {
  const all = await drafts.all()
  draftList.value = [...all].sort((a, b) => Number(b.approved ?? false) - Number(a.approved ?? false))
}
// export approveDraft; drop publishDraft from the UI surface (keep PUBLISH_POST handler for internal reuse)
```

- [ ] **Step 4: Replace the publish button** in `ContentScreen.vue` drafts loop:

```vue
<div class="row">
  <span v-if="d.approved" class="lbl" :data-testid="`approved-badge-${d.id}`" style="color: var(--lime)">Одобрено ✓</span>
  <button v-if="!d.approved" class="btn primary" :data-testid="`approve-${d.id}`" @click="approveDraft(d.id, true)">
    Одобрить
  </button>
  <button v-else class="btn" :data-testid="`unapprove-${d.id}`" @click="approveDraft(d.id, false)">Отозвать</button>
  <button class="btn" data-testid="copy" @click="copy(d.text)">Копировать</button>
  <button class="btn" @click="toDraft({ topic: d.ideaTopic, angle: d.ideaAngle })">Перегенерировать</button>
  <button class="btn" @click="removeDraft(d.id)">Удалить</button>
</div>
```

> Keep the `posts-left` hint line (now informational — it reflects what auto-publish will consume). Remove the old `publish-${d.id}` button and the `:disabled="postsLeft<=0"` gate.

- [ ] **Step 5: Run to verify green** — `npx vitest run src/sidepanel/screens/ContentScreen.spec.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/composables/useContent.ts src/sidepanel/screens/ContentScreen.vue src/sidepanel/screens/ContentScreen.spec.ts
git commit -m "feat(content): «Одобрить» gate replaces publish-now (badge + un-approve, no postsLeft gate)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Part 3 — Auto-publish step

### Task 7: `ContentSettings.publishDays` (default Mon/Wed/Fri) + validation

**Files:**
- Modify: `src/lib/content/settings.ts`
- Test: `src/lib/content/settings.test.ts` (extend or create)

**Interfaces:**
- Produces: `ContentSettings.publishDays: number[]`; `DEFAULT_PUBLISH_DAYS = [1, 3, 5]` exported from `settings.ts`.

- [ ] **Step 1: Write the failing test:**

```ts
it('defaults publishDays to Mon/Wed/Fri when unset', async () => {
  expect((await loadContentSettings(memStore())).publishDays).toEqual([1, 3, 5])
})
it('sanitises persisted publishDays (array-as-object, out-of-range, dupes)', async () => {
  const store = memStore({ 'content:settings': { publishDays: { 0: 1, 1: 1, 2: 9, 3: -2 } } })
  expect((await loadContentSettings(store)).publishDays).toEqual([1])
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/content/settings.test.ts -t publishDays` → FAIL.

- [ ] **Step 3: Add the field, default, and validation** in `settings.ts`:

```ts
import { asArray } from '../engagement/settings'
export const DEFAULT_PUBLISH_DAYS = [1, 3, 5] // Mon, Wed, Fri (Date.getDay: 0=Sun..6=Sat)

function sanitiseDays(raw: unknown): number[] {
  const days = asArray<number>(raw)
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
  return days.length ? [...new Set(days)].sort((a, b) => a - b) : DEFAULT_PUBLISH_DAYS
}
// in ContentSettings interface: publishDays: number[]
// in loadContentSettings return object:
publishDays: sanitiseDays(raw?.publishDays),
```

> Note: empty-after-sanitise falls back to the default. An explicit "publish on no days" is expressed by disabling the content module, not by an empty array (keeps the type simple). Record this in the spec's out-of-scope note if questioned.

- [ ] **Step 4: Run to verify green** — `npx vitest run src/lib/content/settings.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/settings.ts src/lib/content/settings.test.ts
git commit -m "feat(content): publishDays setting (default Mon/Wed/Fri) + sanitiser

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Pure publish policy

**Files:**
- Create: `src/lib/content/publishPolicy.ts`
- Test: `src/lib/content/publishPolicy.test.ts`

**Interfaces:**
- Produces:
  - `shouldPublishToday(args: { weekday: number; publishDays: number[]; remainingPosts: number; hasApproved: boolean }): boolean`
  - `pickOldestApproved(drafts: Draft[]): Draft | null`

- [ ] **Step 1: Write the failing tests:**

```ts
import { shouldPublishToday, pickOldestApproved } from './publishPolicy'
import type { Draft } from '../types'

const base = { weekday: 1, publishDays: [1, 3, 5], remainingPosts: 1, hasApproved: true }
it('publishes only when weekday matches, budget left, and an approved draft exists', () => {
  expect(shouldPublishToday(base)).toBe(true)
  expect(shouldPublishToday({ ...base, weekday: 2 })).toBe(false)        // not a publish day
  expect(shouldPublishToday({ ...base, remainingPosts: 0 })).toBe(false) // cap spent
  expect(shouldPublishToday({ ...base, hasApproved: false })).toBe(false)
})

const d = (id: string, createdAt: string, approved?: boolean): Draft =>
  ({ id, ideaTopic: 't', ideaAngle: 'a', text: id, createdAt, approved })
it('picks the oldest approved draft by createdAt, ignoring un-approved', () => {
  const drafts = [d('new', '2026-06-26T03:00:00Z', true), d('old', '2026-06-26T01:00:00Z', true), d('x', '2026-06-26T00:00:00Z', false)]
  expect(pickOldestApproved(drafts)?.id).toBe('old')
  expect(pickOldestApproved([d('x', '2026-06-26T00:00:00Z', false)])).toBeNull()
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/content/publishPolicy.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `publishPolicy.ts`:

```ts
import type { Draft } from '../types'

export function shouldPublishToday(args: {
  weekday: number; publishDays: number[]; remainingPosts: number; hasApproved: boolean
}): boolean {
  return args.publishDays.includes(args.weekday) && args.remainingPosts > 0 && args.hasApproved
}

export function pickOldestApproved(drafts: Draft[]): Draft | null {
  const approved = drafts.filter((d) => d.approved)
  if (!approved.length) return null
  return approved.reduce((oldest, d) => (d.createdAt < oldest.createdAt ? d : oldest))
}
```

- [ ] **Step 4: Run to verify green** — `npx vitest run src/lib/content/publishPolicy.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/publishPolicy.ts src/lib/content/publishPolicy.test.ts
git commit -m "feat(content): pure publish policy (shouldPublishToday, pickOldestApproved)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: `publishApprovedDrafts` SW handler (testable, injected publish)

**Files:**
- Modify: `src/service-worker/contentHandlers.ts`
- Test: `src/service-worker/contentHandlers.test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  interface PublishApprovedDeps {
    store: KeyValueStore
    clock: Clock
    prepare: () => Promise<void>                                  // navigate+ready+activity; called ONLY right before publish
    publish: (text: string) => Promise<{ ok: boolean; reason?: string } | undefined>
  }
  publishApprovedDrafts(deps: PublishApprovedDeps): Promise<{ published: number; reason?: string }>
  ```
- Consumes: `shouldPublishToday`, `pickOldestApproved`, `loadContentSettings` (`publishDays`,`postsPerWeek`), `PostWeekBudget` helpers, `DraftStore`, `enabledModules`.

- [ ] **Step 1: Write the failing boundary test** (weekday-agnostic via all-days / no-days):

```ts
const allDays = { 'content:settings': { publishDays: [0,1,2,3,4,5,6], postsPerWeek: 3 } }
const approvedDraft = { id: 'a', ideaTopic: 't', ideaAngle: 'g', text: 'hello', createdAt: '2026-06-01T00:00:00Z', approved: true }
const clock = { now: () => new Date('2026-06-26T10:00:00Z') }

it('publishes the oldest approved draft, consumes it, records the week', async () => {
  const store = memStore({ ...CONTENT_MODS, ...allDays, 'content:drafts': [approvedDraft] })
  let prepared = false
  const r = await publishApprovedDrafts({
    store, clock,
    prepare: async () => { prepared = true },
    publish: async () => ({ ok: true })
  })
  expect(r.published).toBe(1)
  expect(prepared).toBe(true)
  expect(await new DraftStore(store).all()).toEqual([])                 // consumed
  expect((await store.get('posts:budget') as any).used).toBe(1)        // week recorded
})

it('does NOT publish (or prepare) when today is not a publish day', async () => {
  const store = memStore({ ...CONTENT_MODS, 'content:settings': { publishDays: [], postsPerWeek: 3 }, 'content:drafts': [approvedDraft] })
  let prepared = false
  const r = await publishApprovedDrafts({ store, clock, prepare: async () => { prepared = true }, publish: async () => ({ ok: true }) })
  expect(r.published).toBe(0); expect(prepared).toBe(false)
  expect((await new DraftStore(store).all()).length).toBe(1)           // kept
})

it('skips when there is no approved draft', async () => {
  const store = memStore({ ...CONTENT_MODS, ...allDays, 'content:drafts': [{ ...approvedDraft, approved: false }] })
  const r = await publishApprovedDrafts({ store, clock, prepare: async () => {}, publish: async () => ({ ok: true }) })
  expect(r.published).toBe(0)
})

it('skips when the weekly cap is exhausted', async () => {
  const store = memStore({ ...CONTENT_MODS, ...allDays, 'content:drafts': [approvedDraft], 'posts:budget': { week: isoWeekKey(clock.now()), used: 3 } })
  const r = await publishApprovedDrafts({ store, clock, prepare: async () => {}, publish: async () => ({ ok: true }) })
  expect(r.published).toBe(0)
})

it('keeps the draft + reports reason when the composer publish fails', async () => {
  const store = memStore({ ...CONTENT_MODS, ...allDays, 'content:drafts': [approvedDraft] })
  const r = await publishApprovedDrafts({ store, clock, prepare: async () => {}, publish: async () => ({ ok: false, reason: 'post_button_disabled' }) })
  expect(r).toEqual({ published: 0, reason: 'post_button_disabled' })
  expect((await new DraftStore(store).all()).length).toBe(1)
})
```

> `CONTENT_MODS` = `modules:state` with the content module enabled (reuse the existing fixture). Crosses the SW↔content publish contract + the storage side-effects (draft removal + week budget).

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/service-worker/contentHandlers.test.ts -t publishApproved` → FAIL.

- [ ] **Step 3: Implement `publishApprovedDrafts`** in `contentHandlers.ts` (mirror `publishPost`):

```ts
import { shouldPublishToday, pickOldestApproved } from '../lib/content/publishPolicy'

export interface PublishApprovedDeps {
  store: KeyValueStore
  clock: Clock
  prepare: () => Promise<void>
  publish: (text: string) => Promise<{ ok: boolean; reason?: string } | undefined>
}

/** Auto-publish step: publish ONE oldest approved draft if today∈publishDays AND weekly cap left. */
export async function publishApprovedDrafts(
  deps: PublishApprovedDeps
): Promise<{ published: number; reason?: string }> {
  const modulesState = await deps.store.get('modules:state')
  if (!enabledModules(modulesState).some((m) => m.id === 'content')) return { published: 0, reason: 'disabled' }

  const { publishDays, postsPerWeek } = await loadContentSettings(deps.store)
  const now = deps.clock.now()
  const budget = rolloverPostWeek((await deps.store.get<PostWeek>(POST_WEEK_BUDGET_KEY)) ?? null, isoWeekKey(now))
  const drafts = new DraftStore(deps.store)
  const all = await drafts.all()
  const draft = pickOldestApproved(all)

  const ok = shouldPublishToday({
    weekday: now.getDay(),
    publishDays,
    remainingPosts: remainingPosts(budget, postsPerWeek),
    hasApproved: draft !== null
  })
  if (!ok || !draft) return { published: 0 }

  await deps.prepare()
  const res = await deps.publish(draft.text)
  if (!res?.ok) return { published: 0, reason: res?.reason ?? 'publish_failed' }

  await drafts.remove(draft.id)
  await deps.store.set(POST_WEEK_BUDGET_KEY, recordPostWeek(budget, 1))
  return { published: 1 }
}
```

> All of `enabledModules`, `loadContentSettings`, `rolloverPostWeek`, `recordPostWeek`, `remainingPosts`, `isoWeekKey`, `POST_WEEK_BUDGET_KEY`, `PostWeek`, `DraftStore` are already imported in this file (used by `publishPost`). If `contentHandlers.ts` exceeds 300 lines, extract the auto-publish handler into `contentHandlers.publish.ts` and re-export.

- [ ] **Step 4: Run to verify green** — `npx vitest run src/service-worker/contentHandlers.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service-worker/contentHandlers.ts src/service-worker/contentHandlers.test.ts
git commit -m "feat(content): publishApprovedDrafts SW handler (oldest approved, weekday+cap gated, prepare-before-publish)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Wire the auto-publish step into `launch()` + RunReport

**Files:**
- Modify: `src/lib/types.ts` (`AutopilotState.postsPublished?: number`)
- Modify: `src/service-worker/index.ts` (`publishApprovedThen` + launch wiring + RunReport line)

> Wiring task — verified by `npm run build` + the manual Chrome check in Task 12; the LOGIC is covered by Task 9.

**Interfaces:**
- Consumes: `publishApprovedDrafts`, `navigateLinkedInTab`, `content` namespace, `PUBLISHING` label.

- [ ] **Step 1: Add `postsPublished?: number`** to `AutopilotState` in `types.ts` (next to `connectsExecuted?`).

- [ ] **Step 2: Add `publishApprovedThen`** near `runConnectsThen` in `index.ts` (`FEED_URL = 'https://www.linkedin.com/feed/'` — reuse the existing literal):

```ts
/** Auto-publish step: navigate+ready only when actually publishing (prepare callback). */
async function publishApprovedThen(tabId: number): Promise<number> {
  const res = await content.publishApprovedDrafts({
    store, clock,
    prepare: async () => {
      await navigateLinkedInTab(tabId, 'https://www.linkedin.com/feed/') // ready-gate (status:complete + url + ping)
      await chrome.tabs.sendMessage(tabId, { type: 'SET_ACTIVITY', active: true, label: PUBLISHING }).catch(() => {})
    },
    publish: (text) =>
      chrome.tabs.sendMessage(tabId, {
        type: 'EXECUTE_ACTION',
        action: { type: 'post', target: { url: 'https://www.linkedin.com/feed/' }, payload: { post: text } }
      }).catch(() => undefined)
  })
  return res.published
}
```

- [ ] **Step 3: Call it in `launch()`** between the connect block (ends line ~154) and `startLoop()` (line ~155), mirroring the connect try/catch:

```ts
if (tabId) {
  try {
    const published = await publishApprovedThen(tabId)
    if (published) {
      const s = await autopilotState()
      if (s) { s.postsPublished = published; await saveAutopilot(s) }
    }
  } catch {
    // Publish step threw (tab gone, storage error) — fall through to the engagement loop.
  }
}
```

- [ ] **Step 4: Add the RunReport `content` line** in `stopAutopilot` (after the `smart_connect` push, ~line 192):

```ts
if (s.postsPublished) {
  modules.push({ id: 'content', executed: s.postsPublished, skipped: 0, failed: 0 })
}
```

- [ ] **Step 5: Build** — `npm run build` → vue-tsc clean, no type errors. Then `npx vitest run` → all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/service-worker/index.ts
git commit -m "feat(content): auto-publish approved draft as a «Запустить» step (tab-ready gated) + RunReport content line

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Weekday checkboxes in Settings

**Files:**
- Modify: `src/sidepanel/screens/SettingsScreen.vue` (content block, next to `postsPerWeek` ~line 104)
- Modify: the settings composable backing that screen (whichever exposes `content.postsPerWeek`) to expose `content.publishDays`
- Test: `src/sidepanel/screens/SettingsScreen.spec.ts` (extend if present; else a focused composable test)

**Interfaces:**
- Consumes: `ContentSettings.publishDays`, `saveContentSettings`.

- [ ] **Step 1: Write the failing test** — toggling a weekday checkbox persists `publishDays`:

```ts
it('toggles a publish weekday and saves it', async () => {
  const w = mount(SettingsScreen); await flushPromises()
  await w.find('[data-testid="pubday-1"]').setValue(false) // un-check Monday
  await w.find('[data-testid="save"]').trigger('click'); await flushPromises()
  // assert saveContentSettings received publishDays without 1
})
```

- [ ] **Step 2: Run to verify it fails** — FAIL (no `pubday-*`).

- [ ] **Step 3: Render 7 checkboxes** in the content settings block (labels Пн–Вс mapped to getDay 1..6,0):

```vue
<div class="fld">
  <span class="k">Дни авто-публикации</span>
  <div class="row">
    <label v-for="day in WEEKDAYS" :key="day.n" class="chip">
      <input type="checkbox" :data-testid="`pubday-${day.n}`"
             :checked="content.publishDays.value.includes(day.n)"
             @change="togglePubDay(day.n)" />
      {{ day.label }}
    </label>
  </div>
</div>
```

```ts
const WEEKDAYS = [
  { n: 1, label: 'Пн' }, { n: 2, label: 'Вт' }, { n: 3, label: 'Ср' },
  { n: 4, label: 'Чт' }, { n: 5, label: 'Пт' }, { n: 6, label: 'Сб' }, { n: 0, label: 'Вс' }
]
function togglePubDay(n: number) {
  const cur = content.publishDays.value
  content.publishDays.value = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].sort((a, b) => a - b)
}
```

> Wire `publishDays` into the content settings composable's load (default from `loadContentSettings`) and its save (`saveContentSettings` includes `publishDays`). Match the existing `.fld`/`.row` design-system classes (gotchas: `.fld` is the universal form class). If `.chip` isn't defined, reuse the region-chip pattern from `ModulesScreen.vue` Smart Connect, or plain inline labels.

- [ ] **Step 4: Run to verify green** — `npx vitest run src/sidepanel/screens/SettingsScreen.spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/screens/SettingsScreen.vue src/sidepanel/composables/*.ts src/sidepanel/screens/SettingsScreen.spec.ts
git commit -m "feat(content): weekday checkboxes for auto-publish in Settings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Invariant #5 doc + final verification

**Files:**
- Modify: `.claude/context/linkedin-beacon/architecture-overview.md` (invariant #5)

- [ ] **Step 1: Update invariant #5** to the v2 wording (see spec "Invariant #5 shift"): posts still human-approved one-by-one (explicit «Одобрить»); only the mechanical publish is automated as a `publishDays`+`postsPerWeek`-gated run step (one per run).

- [ ] **Step 2: Full suite** — `npx vitest run` → all green. Capture the count.

- [ ] **Step 3: Build** — `npm run build` → vue-tsc clean.

- [ ] **Step 4: Manual Chrome check** (load unpacked `dist/`, side-by-side with `docs/design-reference.html`):
  - Content tab shows the `ideas:lastRun` status line.
  - Draft «Одобрить» → badge «Одобрено ✓»; «Отозвать» clears it; approve works at postsLeft=0.
  - Settings shows weekday checkboxes defaulting to Пн/Ср/Пт.
  - On a publish weekday with an approved draft + budget left, «Запустить» publishes ONE post (live-verify with a throwaway post, then delete it per `live-testing-cdp`).

- [ ] **Step 5: advisor** before declaring done (edge-wiring + completion gate).

- [ ] **Step 6: Commit the doc**

```bash
git add .claude/context/linkedin-beacon/architecture-overview.md
git commit -m "docs(memory): invariant #5 — approved posts auto-publish as a gated run step

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review notes (author)

- **Spec coverage:** Part 1 → Tasks 1–4; Part 2 → Tasks 5–6; Part 3 → Tasks 7–11; invariant shift → Task 12. ✔
- **Boundary tests:** `extractRunIdeas`/lastRun (Task 2, LLM+storage), `publishApprovedDrafts` (Task 9, publish contract + storage). ✔
- **Type consistency:** `IdeasLastRun`, `Draft.approved?`, `publishDays:number[]`, `PublishApprovedDeps`, `publishApprovedDrafts→{published,reason?}`, `AutopilotState.postsPublished?` used consistently across tasks. ✔
- **Nav race:** Task 9 `prepare` + Task 10 `navigateLinkedInTab` ready-gate addresses the advisor's load-bearing #1. ✔
- **Open:** Task 4 is genuinely cause-dependent (gated on the Task 1 dump) — concrete branches A/B/C coded, test-first.
