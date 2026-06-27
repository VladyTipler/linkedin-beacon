# Beacon — Gotchas (hard-won, 2026-06-24..27)

Non-obvious traps discovered live. Each cost real debugging.

## Smart Connect — connect PER-PAGE + SW pace eviction (2026-06-27)

- **A candidate's Connect anchor exists only on ITS search page.** `harvestPeoplePaginated`
  walks pages 1..N collecting ~30 candidates, but `executeConnect` clicks
  `a[componentkey*="member:ID_connect"]` on the CURRENT (last) page. Anchors of candidates
  from earlier pages are gone from the DOM → `connect_anchor_not_found` on every one → 0
  invites even though harvest found 34. Yesterday worked because 1 page was enough; today
  4 pages → desync. **FIX: connect per-page** — harvest ONE page (`HARVEST_PEOPLE_PAGE`),
  connect its candidates, THEN `PEOPLE_NEXT_PAGE`. Never "harvest-all-then-connect".
- **Pace (anti-ban sleep) MUST live in the content script, not the SW.** `runConnectsThen`
  did `sleep(8–30s)` IN the service worker → MV3 evicts the idle SW mid-pause → the loop
  dies, the tab stays on /search, the overlay pill is stuck, STOP is lost (`running` stayed
  true because `stopAutopilot` never ran). FIX: pace via a `SLEEP` message to the content
  script; the SW `await`s the sendResponse, which KEEPS THE SW ALIVE. Bonus: the SLEEP
  handler runs `countdownActivity` → live "Пауза 22с" pill on the page.
- **`cancelled()` inversion trap.** When wiring "STOP interrupts the per-candidate loop",
  pass `isCancelled = async () => !await isRunning()`, NOT `isRunning`. `isRunning`
  returns true when ACTIVE → the loop thought every active run was "cancelled" and broke
  on candidate #1 → 0 invites, reason 'cancelled'. Found only via SW `console.trace`
  (showed `isRunning()->true` then `cancelled()=true` in the same breath).

## Comments — engage the topic, not the stack (2026-06-27)

- **SSI grows through feed ACTIVITY, so don't filter comments to your narrow stack.**
  `COMMENT_THRESHOLD=0.5` (RelevanceScorer vs `target.stack`) dropped most posts → rarely
  commented. Reworked: comment on any LIKED post (the LikeFilter already removed junk),
  prompt = ONE clarifying QUESTION about the post's topic, `CommentJudge` kept (anti-slop),
  `rollComment(rng, 1/3)` so only ~1/3 of liked posts attempt a comment (spread across the
  feed, not the first N in a row); `commentsPerDay` cap still bounds the total.
- **`CommentDraftService` `maxTokens:160` starves reasoning models** (same family as
  IdeaExtractor 600 / DraftGenerator 800) — gemini-3.x spends the budget on a reasoning
  phase BEFORE the content → empty/truncated → judge rejects → 0 comments. RULE (now 3×):
  **no `maxTokens` cap on generators; bound length via the PROMPT.**

## Run-outcome visibility — a 0 run must never be silent (2026-06-27)

- Every pre-loop step (views/connect/publish) returns a **machine reason** (disabled /
  no_keywords / nav_failed / empty_search / not_ready / none_fresh / not_publish_day /
  weekly_cap / cancelled / done / …) surfaced in the run report via `buildReportModules`.
  A do-nothing run printed `done` + 0 before — indistinguishable from a clean empty
  harvest. `reasonLabels.ts` → Russian hints in ReportsScreen. **If a module did 0, the
  report says WHY.**
- `navigateLinkedInTab` returns `boolean` (true only on status:complete + url + PING); a
  failed nav reports `nav_failed` instead of a silent empty harvest. `launch()` checks
  `isRunning()` BETWEEN steps so a STOP during views doesn't let connect/publish/loop run.
- `STOP_AUTOPILOT` now `sendResponse` and the panel `stop()` does PING-warmup + retry — a
  fire-and-forget STOP was silently lost when the SW was evicted on idle.

## Post composer (Content Layer 2) — SHADOW DOM + Quill (recon 2026-06-26)

- **The composer is NOT in the regular DOM and NOT in an iframe — it's in an OPEN
  SHADOW ROOT.** Host `#interop-outlet` (`[data-testid="interop-shadowdom"]`). A plain
  `document.querySelector` finds NOTHING of the modal. Pierce: `host.shadowRoot.querySelector(...)`.
  First recon wrongly "found" a `.ql-editor` — that's a **DECOY** in a hidden `/preload/`
  iframe. Always go strictly through `#interop-outlet.shadowRoot`; never global `.ql-editor`.
- **The composer editor is Quill, NOT ProseMirror** (the comment editor is ProseMirror).
  `[data-test-ql-editor-contenteditable="true"]` / `.ql-editor`. `execCommand('insertText')`
  inserts into the DOM, **but Quill commits its model ASYNCHRONOUSLY** (MutationObserver):
  right after typing, `ql-blank` is still present and the Post button is still `disabled`;
  after a tick they clear. **Poll `!postBtn.disabled` before clicking — never read it
  synchronously after typing.** (Trigger: `[aria-label="Start a post"]` light-DOM; close:
  shadow `[aria-label="Dismiss"]` → confirm `Discard`.)
- **Held node references go stale across a re-render.** Re-query via `findComposer(root)`
  on every poll AND at click time.
- **Live-verified 2026-06-26:** the adapter publishes a real post end-to-end from the
  content-script isolated world, then deleted.

## Live-testing via CDP — throttling will fake a "hang" (2026-06-26)

- **A backgrounded / OS-occluded LinkedIn tab throttles `setTimeout`** → adapter crawls to
  minutes and LOOKS hung. Fix for tests: attach a CDP session / re-`Target.activateTarget`
  each second — a debugger-attached page is not throttled. In production (panel docked next
  to a foreground tab) this is a non-issue.
- **crxjs SW first-message race:** the SW entry is an async loader; a message to a
  freshly-woken SW before `onMessage` registers is lost. Warm with a `PING` first.
- **`--load-extension` + opening the feed URL in the SAME launch** can race so the content
  script never injects (`"Receiving end does not exist"`). A page reload fixes it.

## LinkedIn DOM (new hashed-class build)

- **No `data-urn`, no `role=article`, no semantic classes.** Anchor off aria-labels +
  `[componentkey]` + `data-testid`. Full map in `docs/linkedin-dom-anchors.md`. Re-confirm
  if LinkedIn ships a new build.
- **Each post renders ~3× under different `componentkey`s:** base + `expanded<base>` +
  `expanded<base>FeedType_MAIN_FEED_RELEVANCE`. Normalise: strip `^expanded` and
  `FeedType_.*$`. Dedup on the normalised base.
- **The feed scrolls an inner `<main>` (overflow-y:scroll), NOT the window.**
  `window.scrollBy/scrollTo` moves nothing; find the scrollable ancestor of a post and set
  its `scrollTop`.
- **Comment editor is TipTap/ProseMirror** (`[data-testid="ui-core-tiptap-text-editor-wrapper"]`
  → `[contenteditable][role=textbox]`). `textContent` does NOT update editor state;
  `document.execCommand('insertText', false, char)` IS accepted (validated live).
- **like dedup:** `button[aria-label^="Reaction button state"]` — `!== "...: no reaction"`
  means already liked. Keep a local `actedUrns` set so a *failed* like isn't retried forever.
- **people-search "No results found" empty-state** = `/no results found/i` on body — use as
  the harvest `isEmptyState` sentinel to tell a dead search (`empty`) from a page that
  never rendered (`not_ready`).

## chrome.storage serialises Vue reactive arrays as objects

- Persisting the Vue **reactive** array → stored as `{0:..,1:..}` → read back non-array →
  `.find` crashes AND silent fallbacks. Fix both sides: persist a PLAIN array
  (`.map(m=>({...m}))`), read with `asArray()` (`Object.values` for array-like). **Rule:
  never trust the shape of a chrome.storage value.** `publishDays`/`targetRegions` hit the
  same family.

## MV3 service worker + content script

- **Reloading the unpacked extension orphans content scripts in already-open tabs**
  ("Receiving end does not exist", harvest returns 0). Fixes: F5 the feed tab, OR
  re-inject via `chrome.scripting.executeScript({files})` where `files` is read from the
  LIVE manifest (crxjs loader filename is hashed, changes every build).
- **Find the LinkedIn tab by URL** (`chrome.tabs.query({url:'*://*.linkedin.com/*'})`), not
  `{active:true,currentWindow:true}` (flaky from the SW).
- **SW is evicted on idle**; `setTimeout` for long pauses is unreliable there. The
  autopilot continuous loop lives in the CONTENT script; SW rehydrates state from storage
  each tick. (Pre-loop steps' pace also moved to content via `SLEEP` — see above.)
- **The content switch over `BeaconMessage` is EXHAUSTIVE (`assertNever` default).** Every
  NEW message variant (even sidepanel/SW-only ones like `LIST_MODELS`/`AUTOPILOT_STAGE`)
  MUST get a no-op `case` in `src/content/index.ts` or `vue-tsc` fails. SW switch uses
  `default: return false`.

## LLM / BYOK layer (Content module)

- **`listModels` returns a non-empty fallback on ANY failure** — a "models loaded" signal
  is NOT a key-validity signal. Real key-invalidity only surfaces at generation time.
- **`HttpGet` is a separate narrow port in `llm/contracts.ts`** (NOT a widened `HttpClient`).
  `FetchHttpClient` structurally satisfies `HttpClient & HttpGet`.
- **Boundary tests** inject a fake `HttpClient & HttpGet` returning the REAL OpenRouter
  shape `{choices:[{message:{content}}]}` → real mapper runs (crosses the LLM boundary
  without a live call).
- **`e.message` from a failed LLM call IS surfaced to the UI** (aids BYOK debugging).
  Safe: `FetchHttpClient` error strings are `status + statusText + body`, NOT the URL →
  the Gemini key (in the URL query) never leaks.

## Workflow / process

- **Todoist API is v1** — v2 returns "deprecated". Results under `.results`.
- **Spec→plan→TDD per increment.** Pure units first; SW message WIRING verified by build,
  but extract handler LOGIC into an injectable module so it gets real unit/boundary tests.
- Call **advisor** before edge-wiring and before "done".
- **Subagent-driven gotcha:** an implementer subagent that fixes test fakes but forgets to
  `git add` them → every later task's build passes against the DIRTY tree, masking a broken
  committed state. **After each subagent task AND at slice end, `git status` MUST be clean.**
- **Debugging by live CDP trace > guessing.** When a step returns 0 silently, add
  `console.trace`/log at the SW decision points and listen via the SW CDP target (warm it
  with a PING first — it's evicted on idle). This caught the `cancelled()` inversion and
  the per-page anchor desync in minutes after hours of wrong hypotheses.
