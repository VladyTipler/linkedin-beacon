# Beacon — Gotchas (hard-won, 2026-06-24..26)

Non-obvious traps discovered live. Each cost real debugging.

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
  synchronously after typing.** (Trigger to open: `[aria-label="Start a post"]` in the
  LIGHT dom; close: shadow `[aria-label="Dismiss"]` → confirm `Discard`.)
- **Held node references go stale across a re-render.** artdeco/Ember may REPLACE the Post
  button node on the disabled→enabled transition. If you capture `const post = ...` once and
  keep it, `post.disabled` can read a stale `true` forever → false `post_button_disabled`.
  **Re-query via `findComposer(root)` on every poll AND at click time.** (Recon hid this
  because it re-queried each read; the first adapter held the ref — advisor caught it.)
- **Selection inside a shadow root:** `shadowRoot.getSelection()` (Chrome supports it;
  fall back to `window.getSelection()`). `execCommand`/selection are DOM ops on the SHARED
  DOM, so they behave the same in the content-script isolated world as in MAIN world — the
  only world-specific thing (the page's Quill JS instance) is NOT used by the adapter.
- Capture method: `agent-browser --cdp 9222`, read-only (typed throwaway → cleared →
  Discard). Never published during recon.
- **Live-verified 2026-06-26:** the adapter publishes a real post end-to-end from the
  content-script isolated world ("Post successful" toast, post found in feed, then
  deleted). The held-vs-requery probe showed artdeco does NOT replace the Post node in
  this build (`sameNode:true`), so the re-query fix is defensive, not load-bearing — keep it.

## Live-testing the publish via CDP — throttling will fake a "hang" (2026-06-26)

- **A backgrounded / OS-occluded LinkedIn tab throttles `setTimeout`**, so the composer
  adapter (which paces typing + polls via `sleep`) crawls to minutes and LOOKS hung.
  Driving Chrome headless from WSL, the window is OS-occluded → the feed tab throttles
  even though `document.visibilityState === 'visible'`. Symptom seen: `EXECUTE_ACTION`
  /`PUBLISH_POST` "never returns" in a 40 s poll, draft not consumed, no post.
- **Fix for tests:** attach a CDP session to the LinkedIn page (`Target.attachToTarget`)
  and/or re-`Target.activateTarget` it each second — a debugger-attached page is not
  throttled. With that, the full SW→content→adapter→real-post chain returns `{ok:true}`
  in ~6 s. **In production this is a non-issue:** the side panel is docked next to the
  user's genuinely-foreground LinkedIn tab, so timers run at full speed.
- **crxjs SW first-message race:** the MV3 service-worker entry is an async loader, so a
  message sent to a freshly-woken SW before its `onMessage` registers is lost (returns
  `undefined`). Warm it with a `PING` first when scripting. (Same family as the orphaned-
  content-script reload gotcha.)
- **Test-harness artifact, not a product bug:** `--load-extension` + opening the feed URL
  in the SAME launch can race so the content script never injects (`"Receiving end does
  not exist"`). A page reload (manifest auto-inject) fixes it. In real use the user opens
  LinkedIn AFTER the extension is installed, so injection is normal.
- **Deleting a test post via CDP:** the post's ⋯ menu → "Delete post" → a light-DOM
  confirm modal with `Cancel`/`Delete` (NOT in the interop shadow root). On the home feed
  your own fresh post may drop out after reload; find it on `…/in/me/recent-activity/all/`.

## LinkedIn DOM (new hashed-class build)

- **No `data-urn`, no `role=article`, no semantic classes.** Old `feed-shared-update-v2`
  selectors are DEAD. Anchor off aria-labels + `[componentkey]` + `data-testid`. Full
  map in `docs/linkedin-dom-anchors.md`. Re-confirm if LinkedIn ships a new build.
- **Each post renders ~3× under different `componentkey`s:** a base key + `expanded<base>` +
  `expanded<base>FeedType_MAIN_FEED_RELEVANCE`. Normalise: strip `^expanded` and
  `FeedType_.*$`. Dedup on the normalised base, or you triple-count. (Synthetic fixtures
  hide this — only the live cross-check caught it.)
- **The feed scrolls an inner `<main>` (overflow-y:scroll), NOT the window.**
  `window.scrollBy/scrollTo` moves nothing and lazy-load never fires (harvest stuck at
  ~7 posts). Find the scrollable ancestor of a post and set its `scrollTop`. Then it
  loads 11→16→…→35.
- **Comment editor is TipTap/ProseMirror** (`[data-testid="ui-core-tiptap-text-editor-wrapper"]`
  → `[contenteditable][role=textbox]`). Setting `textContent` does NOT update editor
  state. `document.execCommand('insertText', false, char)` IS accepted (validated live).
- **like dedup:** read `button[aria-label^="Reaction button state"]` — `!== "...: no reaction"`
  means already liked. After `executeLike`, the button flips to "...: Like" immediately,
  so re-harvest naturally filters it out. Also keep a local `actedUrns` set so a *failed*
  like isn't retried forever (else infinite loop).

## chrome.storage serialises Vue reactive arrays as objects

- `useModules` persisted the Vue **reactive** array; `chrome.storage` stored it as
  `{0:..,1:..}` (array-like object), which read back non-array → `.find` crashed AND the
  level bridge silently fell back to `manual` (so `full_auto` was ignored).
- **Fix both sides:** persist a PLAIN array (`.map(m=>({...m}))`), and read with `asArray()`
  (`Object.values` for array-like) in `src/lib/engagement/settings.ts`. All array reads
  from storage use `Array.isArray`/`asArray` guards now (QuarantineQueue, orchestrator,
  RunReportStore, **DraftStore**). **Rule: never trust the shape of a chrome.storage value.**

## MV3 service worker + content script

- **Reloading the unpacked extension orphans content scripts in already-open tabs**
  ("Receiving end does not exist", harvest returns 0). Fixes: F5 the feed tab, OR the SW
  re-injects via `chrome.scripting.executeScript({files})` where `files` is read from the
  LIVE manifest (`chrome.runtime.getManifest().content_scripts[0].js`) — the crxjs loader
  filename is hashed and changes every build, so never hardcode it.
- **Find the LinkedIn tab by URL** (`chrome.tabs.query({url:'*://*.linkedin.com/*'})`), not
  `{active:true,currentWindow:true}` — the active-tab query is flaky from the SW.
- **SW is evicted on idle**; `setTimeout` for long pauses is unreliable there. So the
  autopilot continuous loop lives in the CONTENT script (alive while its tab is open) and
  asks the SW per-action; the SW rehydrates state from storage each tick.
- **Background tabs are throttled** → lazy-load stalls. The worker-window host keeps the
  feed tab `visible` (active in its own window) so the loop doesn't degrade (spec §2.3).
- **The content switch over `BeaconMessage` is EXHAUSTIVE (`assertNever` default).** Every
  NEW message variant (even sidepanel→SW-only ones like `LIST_MODELS`/`GENERATE_*`) MUST
  get a no-op `case` in `src/content/index.ts` (grouped with the other `return false`
  cases) or `vue-tsc` fails. SW switch uses `default: return false` so it's lenient.

## LLM / BYOK layer (Content module)

- **`listModels` returns a non-empty fallback on ANY failure, and OpenRouter's list is
  keyless.** So a "models loaded" signal is NOT a key-validity signal — it's green for any
  key. Real key-invalidity only surfaces at generation time (provider HTTP error in the
  error banner). If you ever need a true validity light, make `listModels` return
  `{models, fromFallback}` and drive the indicator off `fromFallback`.
- **`HttpGet` is a separate narrow port in `llm/contracts.ts`** (NOT a widened
  `HttpClient`). `FetchHttpClient` structurally satisfies `HttpClient & HttpGet`. Keeps ISP.
- **Boundary tests for SW content handlers** (`contentHandlers.test.ts`) inject a fake
  `HttpClient & HttpGet` that returns the REAL OpenRouter shape `{choices:[{message:
  {content}}]}`, so `createLlmProvider` → `OpenRouterProvider` → the real mapper runs.
  That genuinely crosses the LLM boundary (CLAUDE.md's iron rule) without a live call.
- **`e.message` from a failed LLM call IS surfaced to the UI** (kept deliberately — it
  aids BYOK debugging: the user sees e.g. "HTTP 401 …"). Safe because `FetchHttpClient`
  error strings are `status + statusText + response body`, NOT the URL — so the Gemini
  key (which lives in the URL query) never leaks into the message.

## Workflow / process

- **Todoist API is v1** — v2 returns "deprecated". Results under `.results`.
- **Spec→plan→TDD per increment** (superpowers brainstorming → writing-plans →
  executing-plans / subagent-driven-development). Pure units first (full TDD); SW message
  WIRING verified by build, but extract handler LOGIC into an injectable module
  (`contentHandlers.ts`) so it gets real unit/boundary tests instead of "build-only".
- Call **advisor** before edge-wiring and before "done" — it caught the burst-once-per-batch
  risk gap, the infinite-loop-on-empty-feed, the "daily budget isn't daily", and the
  expertise-RMW-clobber / harvest-type-mismatch issues this slice.
- **Subagent-driven gotcha (2026-06-25):** an implementer subagent fixed two test fakes
  (added `listModels` to inline `LlmProvider` fakes) but **forgot to `git add` them**.
  Every later task's build passed because it ran against the DIRTY working tree — the
  uncommitted fix masked a broken committed state (a clean checkout would fail `vue-tsc`).
  **After each subagent task AND at slice end, run `git status` — it MUST be clean.** A
  dangling modified file = the history is broken even though the suite is "green".
