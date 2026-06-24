# Content Module — Layer 1: «idea → readable post draft»

**Date:** 2026-06-25
**Status:** Design approved, pending plan
**Scope:** First slice of the content pipeline (design-spec §4.3). Stops at a
readable, editable, copyable post draft. Auto-publish to LinkedIn (composer DOM
adapter) is **Layer 2** — explicitly out of scope here.

## Why this slice

The content pipeline has three stages:

```
1. Feed → IdeaExtractor      → Idea {topic, angle}     (what to write — feed = signal, anti-slop)
2. Idea + custom prompt → DraftGenerator → Post draft  (idea + prompt = post — this layer's payoff)
3. Draft → approve/edit → publish to LinkedIn          (composer DOM, irreversible §5.5 — Layer 2)
```

Layer 1 delivers stages 1+2: the user gets a **readable post** generated from
their own feed signal crossed with their expertise. The only thing deferred is
the genuinely irreversible part — a robot typing into the LinkedIn composer and
hitting Post (§5.5: a post under the user's real name is the most public, least
reversible action). Until Layer 2, the user copies the draft and posts manually.

This slice also lays the **LLM-key plumbing** (BYOK) that every later LLM feature
(draft regeneration, comments, future content) reuses.

## BYOK posture (reframes invariant #6)

Product invariant #6 ("keys via backend proxy, never in the extension") exists to
stop a **shared key being bundled in the distributed build**. BYOK does not
violate that: the key is **not in the build or git** — the user supplies their
own at runtime, and it lives only in `chrome.storage.local` (device-local, never
synced to Google). Gemini's free tier (design-spec §10) makes this friendly for
users who don't want to pay. A backend proxy remains a valid future alternative
but is a separate infra task and would block this slice.

**Posture, stated explicitly:** key is local-only (`chrome.storage.local`), never
committed, never `chrome.storage.sync`, never logged.

## Architecture (hexagon preserved — deps point inward)

### New core modules (`src/lib`, pure, 100% unit-tested)

- **`llm/config.ts`** — `LlmConfig { provider: LlmProviderId; apiKey: string; model?: string }`,
  `loadLlmConfig(store)` / `saveLlmConfig(store, cfg)` under key `llm:config`.
  Read-tolerant (returns a safe default when unset). Lives in `storage.local`.
- **`llm/models.ts`** — `LlmModel { id: string; label?: string }` + a curated
  `FALLBACK_MODELS: Record<LlmProviderId, LlmModel[]>`. New port method
  `LlmProvider.listModels(): Promise<LlmModel[]>`. Providers are constructed with
  a `JsonHttpGet` port (composition, ISP — we do **not** widen `HttpClient` with a
  getter):
  - **OpenRouter:** `GET https://openrouter.ai/api/v1/models` → `data[].id`
    (label `data[].name`). No key required for the list.
  - **Gemini:** `GET https://generativelanguage.googleapis.com/v1beta/models?key=<key>`
    → keep `models[]` whose `supportedGenerationMethods` includes
    `generateContent`; id = `models[].name` (e.g. `models/gemini-1.5-flash`),
    label = `displayName`.
  - On any fetch failure (bad key / offline) → return `FALLBACK_MODELS[provider]`
    so Settings is never a dead end.
- **`content/DraftGenerator.ts`** — LLM service mirroring `IdeaExtractor`:
  `generate(idea: Idea, expertise: ExpertiseProfile, postPrompt: string): Promise<string>`.
  System message = anti-slop guardrails + the user's expertise/voice; user message
  = the idea (topic/angle) + the user's custom `postPrompt`. Returns post text
  (trimmed plain string). Behind `LlmProvider` → fake-tested.
- **`content/DraftStore.ts`** + type `Draft { id; ideaTopic; ideaAngle; text; createdAt }`
  under key `content:drafts`. `add` / `all` / `remove` / `clear`. Array reads
  guarded with `asArray` (chrome.storage serialises arrays as objects — known gotcha).
- **`content/settings.ts`** — `ContentSettings { postPrompt: string }` under key
  `content:settings`, with a sensible `DEFAULT_POST_PROMPT` shipped so generation
  works out of the box. Read-tolerant load + save.

### Reused as-is

`IdeaExtractor`, `IdeaBank` (gains a `remove(idea)` method keyed by the existing
normalised topic+angle key, for per-card delete), `createLlmProvider` (registry),
`FetchHttpClient` (`postJson` + `getJson`), `FeedReader` via the existing
`REQUEST_FEED_POSTS` path, `ChromeStorageStore` (already `storage.local`).

### Adapters / manifest

- `manifest.config.ts`: `host_permissions` += `https://openrouter.ai/*` and
  `https://generativelanguage.googleapis.com/*`. Explicit, disclosed expansion —
  the only non-LinkedIn hosts, required for BYOK LLM calls.
- **All LLM fetches run in the service worker** (with the new host_permissions
  CORS bypass is unambiguous). `getJson`'s `credentials:'include'` is harmless to
  LLM hosts (sends only their own-origin cookies, not LinkedIn's).

## Data flow

- **Generate ideas:** Ideas tab «Сгенерировать» → SW `GENERATE_IDEAS` → harvest
  via `REQUEST_FEED_POSTS` (`FeedPost[]`) → map `FeedPost → FeedItem`
  (`author=authorName`, `excerpt=text` — richer signal than `excerpt`) →
  `IdeaExtractor.extract(items, expertise)` → `IdeaBank.add` → list refresh.
  Requires an open LinkedIn feed tab + a saved key + a non-empty expertise; UI
  disables the button with a hint otherwise.
- **Generate draft:** idea card «В черновик» → SW `GENERATE_DRAFT {idea}` →
  `DraftGenerator.generate(idea, expertise, postPrompt)` → `DraftStore.add` → UI
  switches to the Drafts sub-tab.
- **Model list:** provider + key chosen in Settings → `LIST_MODELS {provider, apiKey}`
  → SW `provider.listModels()` → searchable dropdown (fallback list on error).
- **Expertise edit:** Settings edits the `expertise` sub-object inside
  `engagement:settings` via **read-modify-write** of the full `EngagementSettings`
  blob (never clobber `target` / module-merge) — covered by a boundary test (this
  is exactly the silent-corruption class CLAUDE.md was carved from).

### Messages (`BeaconMessage +=`)

Only three messages are added to `BeaconMessage` (the ones that genuinely need
the SW — feed harvest + LLM fetch): `LIST_MODELS`, `GENERATE_IDEAS`,
`GENERATE_DRAFT`. Reliable request/response via `panelBus.request` + SW
`sendResponse`. Listing and deleting ideas/drafts is done directly from the
panel composable via `chrome.storage.local` (the `useModules` precedent) — no
round-trip message needed. Content switch stays exhaustive (`assertNever`); SW
switch keeps `default: return false`.

### Storage keys

`llm:config` (new), `content:settings` (new), `content:drafts` (new),
`ideas:bank` (exists), expertise inside `engagement:settings` (exists).

## UI

No pixel reference exists for these screens (the demo only has the content
*module card* + dead `.post` CSS). We design new screens in the **established
demo tokens/components** (lime `#c4ff4d` + blue `#4d9fff` on dark, Space Grotesk /
Spline Sans Mono, existing `styles.css` primitives) and Vlad verifies live in
Chrome. Per CLAUDE.md, if a screen needs to become canonical, the reference/spec
is updated first.

- **TopBar:** add a ⚙ icon → navigates to `v-settings`. TopBar gains a nav emit.
- **BottomNav:** add a 6th tab «Контент» (`v-content`). `ViewId += 'v-content' | 'v-settings'`.
- **ContentScreen (`v-content`):** internal sub-tabs **Идеи | Черновики** (Drafts
  sub-tab is populated this layer; the split scales to Layer 2 without a 7th nav slot).
  - *Идеи:* «Сгенерировать идеи» button (disabled + hint when key/expertise/feed
    missing), list of idea cards (topic bold + angle), per-card «В черновик» +
    delete, «Очистить».
  - *Черновики:* draft cards (full post text + source idea), actions Редактировать
    (inline textarea) / Копировать (clipboard) / Перегенерировать / Удалить.
- **SettingsScreen (`v-settings`):** three sections — **LLM** (provider select,
  key password input, model searchable dropdown), **Экспертиза** (headline, stack
  chips, bio), **Промпт генератора** (textarea pre-filled with the default).
  Save button + a key-validity indicator driven by a successful `listModels`.

## Testing (TDD — contract tests written BEFORE code)

- `listModels` for **both** providers, against real-shape JSON (OpenRouter
  `data[].id`; Gemini `models[].name` + the `generateContent` filter). Crosses the
  provider HTTP boundary via a fake `JsonHttpGet`.
- `DraftGenerator` response parse/trim (fake `LlmProvider`).
- `DraftStore` array reads survive the chrome.storage `asArray` gotcha.
- Expertise RMW does **not** clobber `target` in `engagement:settings` (boundary test).
- `loadLlmConfig` / `saveLlmConfig` round-trip (incl. unset → default).
- `listModels` returns `FALLBACK_MODELS` on fetch failure.
- `ContentSettings` load returns `DEFAULT_POST_PROMPT` when unset.

## Implementation plan — 3 green, commit-sized checkpoints

- **A — LLM config + models + Settings/LLM.** `llm/config.ts`, `llm/models.ts` +
  `listModels` on both providers + fallback, `LIST_MODELS` message + SW handler,
  Settings screen LLM section, manifest host_permissions. Green + build.
- **B — Expertise + ideas.** Expertise RMW helper + Settings expertise section,
  `GENERATE_IDEAS` SW wiring (harvest→map→extract→bank), `LIST_IDEAS`/`DELETE_IDEA`,
  ContentScreen + Идеи sub-tab. Green + build.
- **C — Drafts.** `DraftGenerator`, `DraftStore`, `content/settings.ts` +
  Settings prompt section, `GENERATE_DRAFT`/`LIST_DRAFTS`/`DELETE_DRAFT`, Черновики
  sub-tab with edit/copy/regenerate/delete. Green + build.

## Out of scope (→ Layer 2 / later)

Auto-publish via the composer DOM adapter (the irreversible part), manual idea
entry (without the feed), post scheduling, full-auto posting. Likes stay broad/auto;
posts stay approve-first.

## Open questions

None blocking. Defaults chosen: feed signal via `REQUEST_FEED_POSTS` (not a new
harvest), expertise stays in `engagement:settings` (SSOT, shared with comments),
LLM config in its own `llm:config` key (distinct concern, ISP).
