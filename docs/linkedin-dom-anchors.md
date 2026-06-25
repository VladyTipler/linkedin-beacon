# LinkedIn feed DOM anchors (captured live 2026-06-24)

The current LinkedIn feed is a **hashed-class build**: no `data-urn`, no `role="article"`,
no semantic classes (`feed-shared-update-v2` etc. are gone). Parsing must key off the
few stable, semantic hooks below. Validated read-only against a live authorised session
(8 real posts). Re-confirm in field tests if LinkedIn ships a new build.

## Feed post

| What | Selector / rule |
|------|-----------------|
| Post root | element with `[componentkey]` that contains **exactly one** `button[aria-label^="Reaction button state"]` **and** a `button[aria-label^="Open control menu for post by "]` |
| Post id (urn) | the root's `componentkey`, normalised: strip `^expanded` and `FeedType_.*$`. Each post renders 3× (1 base + 2 `expanded<base>FeedType_MAIN_FEED_RELEVANCE`) → dedup on the normalised base |
| Author name | `button[aria-label^="Open control menu for post by "]` → strip the prefix |
| Body text | `[data-testid="expandable-text-box"]` textContent, minus the inline `[data-testid="expandable-text-button"]` ("…more") |
| Author profile | `a[href*="/in/"]` (people) or `a[href*="/company/"]` (companies); name also in `a[aria-label^="View "]` |

## Like (reaction)

| What | Selector / rule |
|------|-----------------|
| Like button | `button[aria-label^="Reaction button state"]` |
| Already liked? | aria-label `!== "Reaction button state: no reaction"` (e.g. `"...: Like"`) |
| Reactions menu | `button[aria-label="Open reactions menu"]` (hover for reaction types) |

## Comment

| What | Selector / rule |
|------|-----------------|
| Open editor | click `button[aria-label="Comment"]` on the post (editor is lazy-rendered) |
| Editor | `[data-testid="ui-core-tiptap-text-editor-wrapper"]` → `[contenteditable="true"][role="textbox"][aria-label="Text editor for creating comment"]` |
| Editor engine | **TipTap / ProseMirror** (`class="tiptap ProseMirror …"`). Setting `textContent` will NOT update editor state. |
| Insertion (validated live ✅) | focus editor → place caret → `document.execCommand('insertText', false, char)` per char. Confirmed read-only on the live editor: text persisted in ProseMirror state. Char-by-char with delays = anti-ban "human typing". |
| Submit | the enabled `Comment`/`Post`/`Reply` button that appears once the editor has text (confirm exact label in field test) |

## Post composer (share box) — captured live 2026-06-26, read-only

> ⚠️ **The composer lives in a SHADOW DOM, and its editor is Quill (NOT ProseMirror).**
> Two facts the comment flow does not prepare you for. Both validated live, read-only
> (typed + cleared + discarded; nothing was ever published).

| What | Selector / rule |
|------|-----------------|
| Open composer | click `[aria-label="Start a post"]` in the **light DOM** (top document, feed share box). Opens the sharebox modal. |
| Shadow host | `#interop-outlet` (also `[data-testid="interop-shadowdom"]`). Its `.shadowRoot` is **open** → everything below is reached via `host.shadowRoot.querySelector(...)`. A plain `document.querySelector` finds NONE of it. |
| Modal | `shadowRoot` → `[data-test-modal-id="sharebox"]` (`role="dialog"`, class `share-box-v2__modal`) |
| Editor | `shadowRoot` → `[data-test-ql-editor-contenteditable="true"]` (best, LinkedIn test hook) / `.ql-editor[contenteditable="true"]` / `[aria-label="Text editor for creating content"]` |
| Editor engine | **Quill** (`class="ql-editor ql-blank"`; `ql-blank` ⇒ empty/placeholder). |
| Insertion (validated live ✅) | focus editor → caret at end via `shadowRoot.getSelection()` → `document.execCommand('insertText', false, char)` per char. Text appears in the DOM, but **Quill commits its model ASYNCHRONOUSLY** (MutationObserver): right after typing, `ql-blank` is still present and Post is still disabled; after a tick they clear. Human-paced char-by-char (40–160 ms) naturally gives Quill time. |
| Submit (Post) | `shadowRoot` → `button.share-actions__primary-action` (text `Post`). **`disabled` until Quill registers text** → POLL `!btn.disabled` before clicking; never read synchronously after typing. |
| Close (no publish) | `shadowRoot` → `button[aria-label="Dismiss"]` → a confirm appears with **`Discard`** / `Save as draft`; click `Discard` to abandon cleanly. |

> Capture method: `agent-browser --cdp 9222` against real Windows Chrome (debug profile),
> read-only (snapshot/eval only). No like/comment/connect/post was ever submitted on the account.
