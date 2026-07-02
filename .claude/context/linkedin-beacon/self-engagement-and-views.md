# Self-engagement fix + Views harvest-all fix (2026-06-29, commits bddfef8 + f37da0a)

First live run bugs (Vlad): bot liked + commented ×3 his OWN auto-published post; Profile
Views did 3 of 40 (then 0). Both fixed `main`, 445 tests green, build clean. NOT pushed yet
(awaiting live smoke after extension Reload). Code: `src/content/readOwner.ts`, `LikeFilter`
ownerName, `harvestProfiles`, `viewHandlers` seen-aware harvest.

## Bug 2 — never like/comment your OWN posts (commit bddfef8)
- Root: `LikeFilter` had no owner check. After `publishApprovedThen` the fresh post sits atop
  the feed → harvest → like → comment. The **3×** = the post re-rendered under changing
  componentkeys `normaliseUrn` didn't collapse → urn-dedup missed it. **Matching by author
  NAME is immune** (every render shares the control-menu author).
- Fix: `readOwnerName(doc)` → `LikeFilter.worthLiking(post, ownerName)` skips
  `authorName===ownerName` (`own_post`). Fails OPEN + warn if owner unknown.
- **Owner-detection DOM (verified live):** vanity = FIRST `a[href*="/in/"]` on page (self-card,
  here `v-sandz`); name = first NON-EMPTY `alt` among `a[href*="/in/<vanity>"] img[alt]` — the
  owner has ~4 such anchors, only one has the name, the first img alt is `""` (must iterate, skip
  blanks; normalise stray spaces). NB: on the SEARCH page the first `/in/` is NOT the owner —
  readOwnerName is only valid on the FEED (where it's used).

## Bug 1 — Views 0/3 of 40: TWO causes, the PRIMARY one is the harvester (commit f37da0a)
- **PRIMARY (the real bug):** Views reused `harvestPeople`, which anchors on the
  **"Invite to connect"** `<a>`. Once Smart Connect has invited most of the search pool (38
  recruiters today), those show **"Pending"** → no Invite anchor → harvest returns 0 →
  `not_ready` → pagination never starts (`harvestPeoplePaginated` bails on a non-ok first page).
  "Yesterday worked" = fewer Pending then. **Verified live (CDP): pending cards keep the member
  componentkey `…urn:li:member:<id>_pending`** (only the suffix flips from `_connect`), so:
  - FIX: `harvestProfiles(root)` anchors on `[componentkey*="urn:li:member:"]` (connect+pending
    alike), walks up to the card → {memberId,name,headline,profileUrl}. SAME numeric memberId as
    harvestPeople → `views:seen` stays valid. New `HARVEST_PROFILES_PAGE` message; Views uses it,
    **Smart Connect keeps `harvestPeople`** (must only invite truly-connectable).
- **SECONDARY (already addressed, commit bddfef8):** even with a full pool, the blind
  paginate-then-dedup capped at the first 5 pages → seen-set (66) ate the fresh. `isFresh`
  predicate on `harvestPeoplePaginated` → pages DEEPER (max 20) until `cap` FRESH/unseen;
  `runViewStep` loads `views:seen` first, drives per-page pagination. Honest `pool_dry` reason.
- **Net:** harvestProfiles (sees everyone) + isFresh pagination + selectCandidates dedup → views
  visit DISTINCT, not-yet-viewed profiles and page deeper for fresh ones (Vlad's explicit ask).
- **Do NOT visit between pages** (advisor): visiting a profile navigates away, destroying the
  search DOM. Views = harvest-all-then-visit, NOT Connect's per-page interleave.

## DOM gotchas (people-search, hashed build, verified live 2026-06-29)
- The first `/in/` link INSIDE a feed/search post card is a social-context reactor, NOT the
  author → author-by-vanity unreliable; use the control-menu name (feed) / member componentkey
  (search).
- Pending vs connectable people: identical card; only the action element flips (Invite `<a>` →
  "Pending, click to withdraw" `<button>`), but BOTH carry `ConnectButtonstate:invitation:
  urn:li:member:<id>_<status>`.

## CDP recon method (honoring cdp-nav-artefacts)
Do NOT CDP `Page.navigate` (corrupts LinkedIn session). To recon a search page: navigate the
real tab via **extension-context `chrome.tabs.update` ONCE** (eval in the sidepanel/SW target,
which has chrome.tabs), let it render ~3s, then READ the DOM read-only. Restore the tab to /feed
after. Reading DOM via CDP is always safe; only CDP-driven *navigation* is the trap.

## Footprint flag (anti-ban North Star)
Run = 18 likes + 12 connects + 1 post + N views. If views climbs to ~40, ~70 actions/session —
Vlad's conscious call (lower views/day in «Модули» if wanted).

## Comment fixes (0.6.2–0.6.3, 2026-06-30)
- **All comments landed under ONE post.** `executeComment` found the editor with a GLOBAL
  `document.querySelector(EDITOR)` = the first open composer on the page; once one post's editor
  was open, every later comment typed into it. The editor renders INSIDE the post's visible
  (expanded) `[componentkey]` node (verified live: `findByUrn(urn)` returns exactly that node and
  `.contains(editor)`), so `findPostEditor(root, urn)` = `findByUrn(urn).querySelector(EDITOR)`
  scopes it per-post. Re-found each poll → robust to re-render.
- **Comments too long / always a question.** Prompt already said "1-2 sentences" but models
  overshoot → added deterministic `clampComment` (first 2 sentences, sentence-boundary, char
  backstop). Per Vlad: comment may be a **short opinion/take OR a question** — the prompt hard-
  forced "ONE clarifying QUESTION" overriding even the `commentTone` setting; removed the force,
  tone now drives voice not form.

## Durable long-term (NOT built)
Single static search pool still saturates `views:seen` eventually. Durable fix = **rotate the
search query** (keyword/region variants or random page offset) so each run surfaces a new slice.

Related: [[profile-views]], [[smart-connect]], [[cdp-nav-artefacts]], [[gotchas]].
