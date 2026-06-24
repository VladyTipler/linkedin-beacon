# Beacon — Progress (as of 2026-06-25)

`main` is the working branch (user commits directly to main this project). **239 tests
green, `npm run build` clean.** Repo: GitLab `v_sandz/linkedin-beacon`. Note: this
session's commits are LOCAL (not yet pushed to origin).

## Done & live-verified (on Vlad's real authorized LinkedIn account)

- **Phase 1 (SSI):** internal-API SSI + DOM fallback, background refresh, sidebar 4
  screens 1:1 with demo, LLM layer (OpenRouter + Gemini behind a factory).
- **Engagement increment 1 — broad likes + auto-scroll:** one click → scroll-harvest
  a batch → `LikeFilter` (broad, junk only) → gate → `executeLike` → 8–45s pacing →
  daily budget → summary via sendResponse. Live: real likes landed on DOM.
- **Autonomous mode:** one button → continuous loop → likes to a daily ceiling →
  BurstGuard + human breaks + RiskAssessor kill-switch. Reports tab + Start/Stop.

## Done & reviewed — pending Vlad's Chrome field-test (Content module Layer 1, 2026-06-25)

Spec `docs/superpowers/specs/2026-06-25-content-module-layer-1-design.md`, plan
`docs/superpowers/plans/2026-06-25-content-module-layer-1.md`. 14 tasks via
subagent-driven-development (impl + task-review + fixes each), final whole-branch
review on opus (verdict: no Critical), then a polish commit. Slice = **idea →
readable post draft** (auto-publish is Layer 2, out of scope).

- **BYOK LLM config** (`src/lib/llm/config.ts`, key `llm:config`, storage.local only):
  user picks provider (openrouter/gemini) + pastes their own key + picks a model.
- **Model catalog** (`src/lib/llm/models.ts` + `LlmProvider.listModels()` on both
  providers via a new `HttpGet` port, composition not HttpClient-widening). OpenRouter
  list is keyless/public; Gemini list needs the key + filters `generateContent`. On any
  fetch failure → curated `FALLBACK_MODELS`. Searchable dropdown in Settings.
- **Settings screen** (`v-settings`, ⚙ in TopBar): LLM section · Expertise (headline/
  stack/bio, edits the `expertise` sub-object of `engagement:settings` via no-clobber
  RMW `applyExpertiseForm`) · post-generator prompt (`content:settings`, ships
  `DEFAULT_POST_PROMPT`). `onSave` = `Promise.allSettled` + a `save-error` indicator.
- **Content tab** (`v-content`, 6th nav) with **Идеи | Черновики** sub-tabs
  (`useContent`): generate ideas from the live feed, per-idea «В черновик», drafts
  with edit/copy/regenerate/delete.
- **DraftGenerator** (`content/DraftGenerator.ts`, behind LlmProvider) + **DraftStore**
  (`content:drafts`, asArray-guarded). **IdeaBank.remove** added.
- **SW orchestration extracted to `src/service-worker/contentHandlers.ts`** (deps
  injected → unit-testable; keeps `index.ts` from growing further). 3 new messages
  only: `LIST_MODELS`, `GENERATE_IDEAS`, `GENERATE_DRAFT`. List/delete done directly
  from the panel via `chrome.storage.local` (useModules precedent) — no round-trip.
  **Boundary tests cross the real OpenRouter mapper** (fake HttpClient returns the
  real `{choices:[{message:{content}}]}` shape) for both generateIdeas & generateDraft.
- **Manifest:** host_permissions += `openrouter.ai`, `generativelanguage.googleapis.com`
  (only non-LinkedIn hosts; required for BYOK). LLM fetch runs in the SW.

**Field-test checklist (Vlad, in Chrome):** ⚙ → enter a real OpenRouter/Gemini key →
«Загрузить модели» → **CHECK THE COUNT**: the dropdown must show *many* models
(OpenRouter ~hundreds, Gemini ~dozens). If you see only ~4, the live fetch/parse
SILENTLY FAILED and you're looking at `FALLBACK_MODELS` — not a real success. → fill
Expertise → open the LinkedIn feed → Контент/Идеи → «Сгенерировать идеи» (real ideas
appear) → «В черновик» → Черновики (readable post) → edit/copy. **Run all the way
through a real generate** — that's the only place a bad key actually surfaces (HTTP 401
banner); "Модели загружены" alone proves nothing. Sanity-check UI against demo tokens.

⚠️ **Contract-test debt (CLAUDE.md rule not yet fully satisfied):** the OpenRouter/Gemini
`/models` JSON shapes in `models.test.ts` (`OPENROUTER_RAW`/`GEMINI_RAW`) are HAND-WRITTEN
assumptions, not captured from a real call — the boundary tests cross the mapper, not the
wire. If the live model count looks wrong, capture the real `/models` JSON during the
field-test and add a contract-snapshot test against it.

## Known limitations (honest — flagged, not silent)

- **keyValid indicator is structurally always-green** (accepted tradeoff, Vlad's call):
  `listModels` returns a non-empty fallback on failure and OpenRouter's list is keyless,
  so "Модели загружены" shows for any key. Real key-invalidity surfaces at generation
  time (the error banner shows the provider's HTTP error, e.g. 401). A true validity
  signal would need `listModels` to return `{models, fromFallback}` — deferred.
- **Autopilot budget pool still separate** from the manual "Run campaign" pool
  (`autopilot:state.used` vs `engagement:budget:like`). Combined daily volume not unified.
- **No live-verification yet** of the content pipeline end-to-end (needs Vlad's key + feed).
- `service-worker/index.ts` is ~385 lines (>300 strict rule) — pre-existing router debt;
  new content logic was extracted to `contentHandlers.ts` to avoid adding to it.

## Not built yet (future increments)

- **Content Layer 2:** auto-publish via a composer DOM adapter (the irreversible part,
  §5.5). Approve-first; full-auto for posts is a later opt-in.
- **Smart Connect** (recruiter connect + Note) — DOM adapters not built (Todoist Фаза 3).
- **Usage telemetry:** anonymous install-UUID heartbeat → control.kanev.space (opt-out).
- Unify the two budget pools (above).

## Todoist phase mapping (numbering differs from spec!)

"Фаза 2 — Модуль вовлечённости (лента)" = engagement = DONE & closed. Smart Connect =
Фаза 3; content autopilot = Фаза 4. Engagement-v2 (broad likes), autonomous mode, and
this content Layer 1 came from Vlad's mid-session redirections, not the original tree.
