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

## Smart Connect — people search + invite modal (captured live 2026-06-26, read-only)

> Candidate sourcing surface = LinkedIn **people search**. Invite modal lives in the
> SAME `#interop-outlet` shadow root as the post composer. Validated live on Vlad's
> authorised account; a Connect was clicked to open the modal, then **Dismissed without
> sending** (card stayed "Connect", no "Pending" anywhere — no invite was ever sent).

**Candidate harvest (people-search results, light DOM):**

| What | Selector / rule |
|------|-----------------|
| Search URL | `https://www.linkedin.com/search/results/people/?keywords=<urlencoded query>` (people vertical) |
| Connect control | tag varies by surface — **an `<a>` on people-search, a `<button>` on PYMK** (`/mynetwork/`); harvest with a tag-agnostic `[aria-label^="Invite "][aria-label$=" to connect"]` (text `Connect`). A hardcoded `a[...]` or `button[...]` query MISSES the other surface — that's the trap. |
| Person id (dedup key) | the connect anchor's `componentkey` = `ConnectButtonstate:invitation:urn:li:member:<numericId>_connect` → use `urn:li:member:<numericId>` |
| Name | strip `^Invite ` / ` to connect$` from the connect anchor's aria-label |
| Card root | walk up ~5 ancestors from the connect anchor to the first ancestor that contains an `a[href*="/in/"]` |
| Headline (for scoring) | within the card, the text line after the name + degree marker (e.g. `Talent Acquisition Specialist \| Technical Recruiter \| IT Recruiter`) |
| Degree | card text line matching `(1st\|2nd\|3rd)` (e.g. `• 2nd`) |
| Location | card text line after the headline (e.g. `Serbia`) |
| Profile URL | card `a[href*="/in/"]` (strip `?…`) |
| Other action states (skip) | `a[aria-label^="Follow "]` (no connect offered) / a `Message` button (already connected) — not connectable, skip |
| Pagination | `button[aria-label^="Page "]` (Page 1..N) |

**Invite modal (in `#interop-outlet`.shadowRoot — pierce like the composer):**

| What | Selector / rule |
|------|-----------------|
| Open | click the connect `<a>` → modal renders in the shadow root (does NOT send) |
| Modal | shadow `[role="dialog"][aria-labelledby="send-invite-modal"]` (heading "Add a note to your invitation?") |
| **Send bare invite** | shadow `button[aria-label="Send without a note"]` (text `Send without a note`) — **enabled immediately**; this is the V1 send path |
| Open note editor | shadow `button[aria-label="Add a note"]` |
| Note textarea | shadow `textarea#custom-message` (`textarea[name="message"]`, placeholder `Ex: We know each other from…`) |
| Send with note | shadow `button[aria-label="Send invitation"]` (text `Send`) — **disabled until the note is non-empty** → poll like the composer's Post button |
| Abandon (no send) | shadow `button[aria-label="Dismiss"]` (empty note ⇒ closes clean, no discard prompt) or the note screen's `Cancel` |
| Invite-sent signal | the result card flips `Connect` → `Pending`; the modal closes |

**⚠️ Free-account note cap (verified live, settles the open question):** the note editor
shows **"N personalized invitations remaining for this month."** (this account: 3) + a
"200" char counter + a Premium upsell. So personalized notes are a **monthly-capped scarce
resource** on free; **bare "Send without a note" is the unlimited default** (only the
overall weekly invite cap applies). V1 sends bare; notes (if ever) need a separate tiny
*monthly* budget for top targets.

**⚠️ PYMK (`/mynetwork/grow/`) connect flow — DIRECT-SEND, no modal (verified live 2026-07-14):**
Unlike people-search, clicking a PYMK Connect `<button>` **sends the bare invite IMMEDIATELY** —
NO "Send without a note" shadow modal renders. The control flips `…_connect` → `…_pending` on
the card in place. So `executeConnect` must race BOTH outcomes: the modal (people-search) OR a
Pending flip (`[componentkey*="member:<id>_pending"]`, PYMK). Treat the flip as "sent" and record
it — otherwise the invite goes out but the ban-safety cap never decrements. Withdraw path (for
reference): `/mynetwork/invitation-manager/sent/` → per-row `Withdraw` → confirm dialog
`button[aria-label^="Withdraw invitation sent to "]`.

> Same shadow-DOM gotchas as the composer apply: pierce strictly via `#interop-outlet.shadowRoot`,
> the modal renders async (poll the Send button's `disabled`), re-query nodes (held refs can
> go stale on re-render). Capture: read-only `agent-browser --cdp 9222` eval; nothing was sent.

**⚠️ PYMK deep-pool: recent-activity "Show all" + inner scroller (verified live 2026-07-16):**
The `/mynetwork/grow/` "People you may know based on your recent activity" cohort renders only
~8 cards inline. An `<a>`/`<button>` whose `aria-label` contains `you may know based on your
recent activity` (case-insensitive) is that cohort's **"Show all"** control — clicking it expands
the SAME cohort to ~44 cards **on the same URL** (no navigation). Absent selector → graceful
no-op, harvest just falls back to the inline 8.

Once expanded, the list is **NOT** scrolled by the window — `document.scrollingElement` is a
no-op there (this was the root cause of the "only ever harvests the inline 8" bug). It scrolls an
**inner overflow container**, found the same way as the feed's (`feedScroller`): walk up from a
connect control (`[aria-label^="Invite "][aria-label$=" to connect"]`) to the nearest ancestor
with `scrollHeight > clientHeight` and `overflow-y: auto|scroll`. Driving `scrollTop = scrollHeight`
on THAT container lazy-loads further cards, ~44 → 92+.
