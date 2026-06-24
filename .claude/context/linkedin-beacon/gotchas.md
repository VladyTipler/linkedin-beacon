# Beacon — Gotchas (hard-won, 2026-06-24)

Non-obvious traps discovered live. Each cost real debugging.

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
  RunReportStore). **Rule: never trust the shape of a chrome.storage value.**

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

## Testing harness (no subagent browser; use CDP directly)

- Live testing = real Windows Chrome via CDP, NOT Playwright headed (LinkedIn flags bots).
  Launch: `chrome.exe --remote-debugging-port=9222 --user-data-dir="E:\chrome-debug"
  --load-extension="H:\...\dist" "https://www.linkedin.com/feed/"`. Vlad logs into
  LinkedIn once in that window (session persists in the debug profile).
- `agent-browser --cdp 9222` attaches to the WRONG tab when several exist (Gemini/Wappalyzer
  pages). Reliable path: raw CDP via a tiny python helper (`websockets` lib) targeting a
  specific `webSocketDebuggerUrl` from `/json/list`. Helper used this session lives in the
  session scratchpad (`cdp_eval.py`) — re-create if needed (Runtime.evaluate over ws).
- Drive the extension from the **sidepanel page context** (open a tab to
  `chrome-extension://<id>/src/sidepanel/index.html`) — it has `chrome.runtime`/`chrome.storage`.
  Beacon extension id this session: `mcaopdffmgobjbkmmfejfhjhnechmkek` (changes per load).
- For a fast autopilot test, START then patch `autopilot:state.ceiling = 2` in storage.

## Workflow / process

- **Todoist API is v1** — v2 returns "deprecated". Results under `.results`.
- **Spec→plan→TDD per increment** (superpowers brainstorming → writing-plans →
  executing-plans). Pure units first (full TDD), edge wiring verified by build + live run.
- Call **advisor** before edge-wiring and before "done" — it caught the burst-once-per-batch
  risk gap, the infinite-loop-on-empty-feed, and the "daily budget isn't daily" issues.
