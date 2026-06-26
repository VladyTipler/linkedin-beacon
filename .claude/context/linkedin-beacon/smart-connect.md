# Smart Connect — shipped (2026-06-26)

Raises SSI **people + relationships**. Inside the ONE-BUTTON «Запустить»: search LinkedIn
people by keywords+regions → send **bare** connection requests (no note) up to budget →
return to feed → engagement loop. **Live-verified on Vlad's account (connects send).**
23 commits in local `main` (a55b543..87fec0b), 354 tests green. NOT pushed to origin yet.

## Flow (SW-orchestrated, runs BEFORE the feed loop in `launch()`)
`startAutopilot.launch()` → if `smart_connect` enabled → `runConnectsThen(tabId)`:
navigate worker tab to people-search → harvest → select → paced bare-connects → back to /feed → engagement loop.

## Files
- core `src/lib/connect/`: `peopleSearchUrl(keywords, geoUrns)` · `regions.ts` (REGION_GEO verified geoUrns + `geoUrnsForRegions`) · `settings.ts` (`searchKeywords` + `targetRegions`, default `['US']`) · `ConnectWeekBudget.ts` (weekly + **day-keyed** caps + `connectRunCap(weekly, daily, perWeek, rng)`) · `selectCandidates.ts` (dedup vs sent-set + cap) · `ConnectHistory.ts` (who+when, newest-first, capped).
- adapters `src/content/`: `harvestPeople.ts` (`harvestPeople` parser + `harvestPeoplePage` render-wait + `harvestPeoplePaginated`) · `domActions.ts:executeConnect` (shadow modal → "Send without a note") · `index.ts` `goToNextPeoplePage` (pagination), `HARVEST_PEOPLE` handler, `connect` action.
- SW `src/service-worker/`: `connectHandlers.ts:runConnectStep` (gates+budget+history) · `index.ts` `runConnectsThen`/`navigateLinkedInTab` + connect line in run report.
- UI: `ModulesScreen.vue` (card: toggle + weekly limit + «Кого искать» + region chips) · `ReportsScreen.vue` («Добавленные контакты» list + Лайки/Коннекты split).
- DOM selectors: `docs/linkedin-dom-anchors.md` "Smart Connect".

## Decisions (locked)
- Source = people-SEARCH (NOT feed — feed authors only offer Follow). PYMK/suggestions deferred (they reflect your CURRENT network = CIS-skewed; search+geoUrn hits global directly).
- Targets broad (recruiters + peers); the search query targets, no relevance scorer.
- Bare invite only (free-account note cap ~3/mo; verified live). Note deferred.
- Multi-region geoUrns OR'd into one search (no round-robin). Verified geoUrns: US 103644278, Canada 101174742, UAE 104305776, Germany 101282230, UK 101165590, India 102713980, Singapore 102454443.
- Anti-ban: weekly cap (default 100) + **day-keyed** cap (~weekly/7) + per-run jitter-down + human pace + sent-set. Gate is a fixed module property (auto), not a user toggle.

## Gotchas (hard-won this session — each cost real debugging)
- **Navigation race (the big one):** after `chrome.tabs.update(→/search/)`, PING-ing for readiness races — the OLD /feed content script answers PING mid-transition, so the harvest hits a dying context → "message channel closed before response" → empty → 0 connects → "enters /search/ then snaps back to feed". FIX: `navigateLinkedInTab` gates on `chrome.tabs.get` `status:'complete'` + `url.startsWith(target)` BEFORE pinging the NEW content script.
- **Search results render ~3s AFTER load** (measured: 0 anchors @2s, 10 @3s) AND there is **NO infinite scroll** — it's PAGINATION (`button[aria-label="Page N"]`, current has `aria-current="true"`; click N+1, wait for the indicator to switch). So harvest must (a) poll for render, (b) paginate, not scroll.
- **`targetRegions` array-as-object:** persisting a Vue reactive array → chrome.storage stores `{0:..,1:..}` → `Array.isArray` false → regions silently dropped to default US. FIX: `asArray` on load + persist plain array (`[...ref]`). Same family as the modules:state gotcha.
- **Activity overlay/pill dies on each navigation** (page reload destroys the content script). Re-assert `SET_ACTIVITY` from the SW after every navigation in the connect step.
- **Ideas bug (gemini-3.5-flash is a REASONING model):** `IdeaExtractor` capped `maxTokens:600`; reasoning consumes the budget → `content` empty/truncated → parse fails → 0 ideas (error swallowed by the in-loop fire-and-forget). FIX (`bf69521`): drop the cap (match Draft/Comment extractors). Live-proven at the LLM boundary; NOT yet confirmed ideas appear end-to-end.

## Open / next (→ "Content Pipeline v2", next session)
- **Ideas still empty on the Content tab** per Vlad even after the cap fix → SECOND cause to debug (in-loop extraction error still swallowed? budget? parse?). Surface in-loop extraction errors to the UI.
- **Auto-publish redesign** (Vlad's design, approved direction): draft gets «Одобрить для публикации» → bot auto-publishes approved drafts on configured **weekdays** (NO time — whenever the bot runs that day), as a step in «Запустить», gated by `postsPerWeek`. Changes invariant #5's mechanism (human still approves each post; publishing automated). Needs brainstorm→spec→plan→TDD.
- Minor debt: `design-reference.html` smart_connect card still shows old Note/fake-stats (diverged for honesty — sync or update spec). Deferred SDD minors (test assertions) in `.superpowers/sdd/progress.md`.
