# Content Module — Layer 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first content-pipeline slice — generate content ideas from the live feed, turn an idea + a custom prompt into a readable LinkedIn post draft, and manage drafts (edit/copy/regenerate/delete). No auto-publish.

**Architecture:** Hexagonal, deps point inward. New pure core modules under `src/lib` (`llm/config`, `llm/models`, `content/*`) behind the existing `KeyValueStore` / `LlmProvider` / HTTP ports, 100% unit-tested with fakes. The service worker owns the three operations that need it (LLM fetch + feed harvest): `LIST_MODELS`, `GENERATE_IDEAS`, `GENERATE_DRAFT`. The side panel reads/writes pure storage (config, ideas, drafts, expertise) directly via core classes — the `useModules` precedent — so only three messages are added.

**Tech Stack:** Vue 3.5 `<script setup>` + TS, Vite 6, `@crxjs/vite-plugin`, Vitest + `@vue/test-utils` + jsdom. Chrome MV3 (sidePanel, service worker, content script).

## Global Constraints

- File ≤ 300 lines, one responsibility (SOLID). Long prompts/constants extracted.
- Core (`src/lib`) never imports `chrome` / `document` / `fetch` — only narrow ports.
- TDD: contract/unit test written and failing BEFORE implementation. `npm test` green + `npm run build` clean before every commit.
- Commit directly to `main` (solo project — Vlad's choice). Conventional commits, terse.
- Path aliases: `@lib` → `src/lib`, `@` → `src`, `@/adapters` → `src/adapters`.
- BYOK posture: the LLM key lives ONLY in `chrome.storage.local`. Never committed, never `chrome.storage.sync`, never logged.
- `chrome.storage` serialises arrays as array-like objects — every array read from storage MUST pass through `asArray` (`src/lib/engagement/settings.ts`).
- LLM provider ids are exactly `'openrouter' | 'gemini'` (`LlmProviderId`).
- UI uses the demo's existing `styles.css` primitives / tokens; new screens verified live in Chrome (no pixel reference exists for them).

---

# Checkpoint A — LLM config + model catalog + Settings/LLM section

## Task A1: `llm/config.ts` — persisted BYOK config

**Files:**
- Create: `src/lib/llm/config.ts`
- Test: `src/lib/llm/config.test.ts`

**Interfaces:**
- Consumes: `KeyValueStore` (`@lib/ports`), `LlmProviderId` (`./contracts`).
- Produces: `LlmConfig { provider: LlmProviderId; apiKey: string; model?: string }`, `LLM_CONFIG_KEY = 'llm:config'`, `DEFAULT_LLM_CONFIG`, `loadLlmConfig(store): Promise<LlmConfig>`, `saveLlmConfig(store, cfg): Promise<void>`, `hasLlmKey(cfg): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/llm/config.test.ts
import { describe, it, expect } from 'vitest'
import { loadLlmConfig, saveLlmConfig, DEFAULT_LLM_CONFIG, hasLlmKey } from './config'
import type { KeyValueStore } from '@lib/ports'

function memStore(): KeyValueStore {
  const m = new Map<string, unknown>()
  return {
    async get<T>(k: string) { return m.has(k) ? (m.get(k) as T) : null },
    async set<T>(k: string, v: T) { m.set(k, v) }
  }
}

describe('llm config', () => {
  it('returns the default when nothing is stored', async () => {
    expect(await loadLlmConfig(memStore())).toEqual(DEFAULT_LLM_CONFIG)
  })

  it('round-trips a saved config', async () => {
    const store = memStore()
    await saveLlmConfig(store, { provider: 'gemini', apiKey: 'AIza-x', model: 'gemini-2.5-flash' })
    expect(await loadLlmConfig(store)).toEqual({ provider: 'gemini', apiKey: 'AIza-x', model: 'gemini-2.5-flash' })
  })

  it('hasLlmKey is false for an empty key, true otherwise', () => {
    expect(hasLlmKey({ provider: 'openrouter', apiKey: '' })).toBe(false)
    expect(hasLlmKey({ provider: 'openrouter', apiKey: 'sk-1' })).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/llm/config.test.ts`
Expected: FAIL — cannot find module `./config`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/llm/config.ts
import type { KeyValueStore } from '../ports'
import type { LlmProviderId } from './contracts'

/** Storage key for the BYOK LLM config. Lives in chrome.storage.local only. */
export const LLM_CONFIG_KEY = 'llm:config'

/** User-supplied LLM settings (BYOK). The key never leaves the device. */
export interface LlmConfig {
  provider: LlmProviderId
  apiKey: string
  /** Chosen model id; provider falls back to its built-in default when unset. */
  model?: string
}

export const DEFAULT_LLM_CONFIG: LlmConfig = { provider: 'openrouter', apiKey: '' }

export async function loadLlmConfig(store: KeyValueStore): Promise<LlmConfig> {
  const raw = await store.get<LlmConfig>(LLM_CONFIG_KEY)
  if (!raw || (raw.provider !== 'openrouter' && raw.provider !== 'gemini')) {
    return DEFAULT_LLM_CONFIG
  }
  return { provider: raw.provider, apiKey: raw.apiKey ?? '', model: raw.model }
}

export async function saveLlmConfig(store: KeyValueStore, cfg: LlmConfig): Promise<void> {
  await store.set(LLM_CONFIG_KEY, cfg)
}

export function hasLlmKey(cfg: LlmConfig): boolean {
  return cfg.apiKey.trim().length > 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/llm/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/config.ts src/lib/llm/config.test.ts
git commit -m "feat(llm): BYOK config store (llm:config, local-only)"
```

---

## Task A2: `llm/models.ts` + `listModels()` on both providers

**Files:**
- Create: `src/lib/llm/models.ts`
- Modify: `src/lib/llm/contracts.ts` (add `HttpGet` port; add `listModels` to `LlmProvider`)
- Modify: `src/lib/llm/OpenRouterProvider.ts`, `src/lib/llm/GeminiProvider.ts` (implement `listModels`, widen ctor http type)
- Modify: `src/lib/llm/createLlmProvider.ts` (widen http param type)
- Test: `src/lib/llm/models.test.ts`

**Interfaces:**
- Consumes: `HttpGet` (new, `./contracts`), `LlmProviderId`.
- Produces: `LlmModel { id: string; label?: string }`, `FALLBACK_MODELS: Record<LlmProviderId, LlmModel[]>`, `parseOpenRouterModels(raw): LlmModel[]`, `parseGeminiModels(raw): LlmModel[]`; `LlmProvider.listModels(): Promise<LlmModel[]>` (returns fallback on any failure).

- [ ] **Step 1: Write the failing test** (crosses the provider HTTP boundary for BOTH shapes + fallback)

```ts
// src/lib/llm/models.test.ts
import { describe, it, expect } from 'vitest'
import { OpenRouterProvider } from './OpenRouterProvider'
import { GeminiProvider } from './GeminiProvider'
import { FALLBACK_MODELS, parseOpenRouterModels, parseGeminiModels } from './models'
import type { HttpClient, HttpGet } from './contracts'

/** Fake implementing both ports; getJson can be told to throw. */
class FakeHttp implements HttpClient, HttpGet {
  lastGetUrl = ''
  constructor(private readonly getResponse: unknown, private readonly fail = false) {}
  async postJson<T>(): Promise<T> { return {} as T }
  async getJson<T>(url: string): Promise<T> {
    this.lastGetUrl = url
    if (this.fail) throw new Error('network')
    return this.getResponse as T
  }
}

const OPENROUTER_RAW = {
  data: [
    { id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' },
    { id: 'google/gemini-2.5-flash', name: 'Google: Gemini 2.5 Flash' }
  ]
}

const GEMINI_RAW = {
  models: [
    { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
    { name: 'models/embedding-001', displayName: 'Embedding 001', supportedGenerationMethods: ['embedContent'] }
  ]
}

describe('parseOpenRouterModels', () => {
  it('maps data[].id/name to LlmModel', () => {
    expect(parseOpenRouterModels(OPENROUTER_RAW)).toEqual([
      { id: 'openai/gpt-4o', label: 'OpenAI: GPT-4o' },
      { id: 'google/gemini-2.5-flash', label: 'Google: Gemini 2.5 Flash' }
    ])
  })
})

describe('parseGeminiModels', () => {
  it('keeps only generateContent models and strips the models/ prefix', () => {
    expect(parseGeminiModels(GEMINI_RAW)).toEqual([
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }
    ])
  })
})

describe('OpenRouterProvider.listModels', () => {
  it('GETs the models endpoint and parses the list', async () => {
    const http = new FakeHttp(OPENROUTER_RAW)
    const provider = new OpenRouterProvider({ provider: 'openrouter', apiKey: 'sk' }, http)
    const models = await provider.listModels()
    expect(http.lastGetUrl).toBe('https://openrouter.ai/api/v1/models')
    expect(models[0]).toEqual({ id: 'openai/gpt-4o', label: 'OpenAI: GPT-4o' })
  })

  it('falls back to the curated list on fetch failure', async () => {
    const http = new FakeHttp(null, true)
    const provider = new OpenRouterProvider({ provider: 'openrouter', apiKey: 'sk' }, http)
    expect(await provider.listModels()).toEqual(FALLBACK_MODELS.openrouter)
  })
})

describe('GeminiProvider.listModels', () => {
  it('GETs the models endpoint with the key in the query string', async () => {
    const http = new FakeHttp(GEMINI_RAW)
    const provider = new GeminiProvider({ provider: 'gemini', apiKey: 'AIza-1' }, http)
    const models = await provider.listModels()
    expect(http.lastGetUrl).toContain('https://generativelanguage.googleapis.com/v1beta/models')
    expect(http.lastGetUrl).toContain('key=AIza-1')
    expect(models).toEqual([{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }])
  })

  it('falls back to the curated list on fetch failure', async () => {
    const http = new FakeHttp(null, true)
    const provider = new GeminiProvider({ provider: 'gemini', apiKey: 'AIza-1' }, http)
    expect(await provider.listModels()).toEqual(FALLBACK_MODELS.gemini)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/llm/models.test.ts`
Expected: FAIL — `./models` not found / `listModels` not a function / `HttpGet` not exported.

- [ ] **Step 3a: Add the `HttpGet` port and `listModels` to the contract**

In `src/lib/llm/contracts.ts`, after the `HttpClient` interface add:

```ts
/**
 * Narrow GET port (DIP), mirror of HttpClient for read-only catalog calls
 * (model lists). Declared here — not imported from ssi-api — to keep the LLM
 * layer self-contained. FetchHttpClient structurally satisfies it.
 */
export interface HttpGet {
  getJson<TResponse>(url: string, headers: Record<string, string>): Promise<TResponse>
}
```

In the same file, add `listModels` to the `LlmProvider` interface:

```ts
export interface LlmProvider {
  readonly id: LlmProviderId
  complete(request: LlmRequest): Promise<LlmCompletion>
  /** The provider's available models (falls back to a curated list on failure). */
  listModels(): Promise<LlmModel[]>
}
```

And add the import at the top of `contracts.ts`:

```ts
import type { LlmModel } from './models'
```

- [ ] **Step 3b: Write `src/lib/llm/models.ts`**

```ts
// src/lib/llm/models.ts
import type { LlmProviderId } from './contracts'

/** A selectable model in the settings dropdown. */
export interface LlmModel {
  id: string
  label?: string
}

/** Shown when the live catalog can't be fetched (bad key / offline). */
export const FALLBACK_MODELS: Record<LlmProviderId, LlmModel[]> = {
  openrouter: [
    { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' }
  ],
  gemini: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }
  ]
}

interface OpenRouterModelsResponse {
  data?: { id?: unknown; name?: unknown }[]
}
interface GeminiModelsResponse {
  models?: { name?: unknown; displayName?: unknown; supportedGenerationMethods?: unknown }[]
}

export function parseOpenRouterModels(raw: unknown): LlmModel[] {
  const data = (raw as OpenRouterModelsResponse)?.data
  if (!Array.isArray(data)) return []
  return data
    .filter((m) => typeof m?.id === 'string' && (m.id as string).length > 0)
    .map((m) => ({ id: m.id as string, label: typeof m.name === 'string' ? (m.name as string) : undefined }))
}

export function parseGeminiModels(raw: unknown): LlmModel[] {
  const models = (raw as GeminiModelsResponse)?.models
  if (!Array.isArray(models)) return []
  return models
    .filter(
      (m) =>
        typeof m?.name === 'string' &&
        Array.isArray(m.supportedGenerationMethods) &&
        (m.supportedGenerationMethods as unknown[]).includes('generateContent')
    )
    .map((m) => ({
      id: (m.name as string).replace(/^models\//, ''),
      label: typeof m.displayName === 'string' ? (m.displayName as string) : undefined
    }))
}
```

- [ ] **Step 3c: Implement `listModels` in `OpenRouterProvider`**

Change the ctor http type and add the method. New full file `src/lib/llm/OpenRouterProvider.ts`:

```ts
import type { HttpClient, HttpGet, LlmCompletion, LlmProvider, LlmProviderConfig, LlmRequest } from './contracts'
import { toOpenRouterBody, fromOpenRouterResponse } from './mappers'
import { FALLBACK_MODELS, parseOpenRouterModels, type LlmModel } from './models'

/**
 * OpenRouter backend (OpenAI-compatible). Depends only on the HTTP ports (DIP) —
 * no direct `fetch`, so it is fully unit-testable with a fake.
 */
export class OpenRouterProvider implements LlmProvider {
  readonly id = 'openrouter' as const
  readonly defaultModel: string
  private static readonly ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
  private static readonly MODELS = 'https://openrouter.ai/api/v1/models'

  constructor(
    private readonly config: LlmProviderConfig,
    private readonly http: HttpClient & HttpGet
  ) {
    this.defaultModel = config.model ?? 'google/gemini-2.5-flash-lite'
  }

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    const body = toOpenRouterBody(request, this.defaultModel)
    const res = await this.http.postJson<unknown>(OpenRouterProvider.ENDPOINT, body, {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json'
    })
    return { text: fromOpenRouterResponse(res), model: body.model, provider: this.id }
  }

  async listModels(): Promise<LlmModel[]> {
    try {
      const raw = await this.http.getJson<unknown>(OpenRouterProvider.MODELS, {})
      const models = parseOpenRouterModels(raw)
      return models.length ? models : FALLBACK_MODELS.openrouter
    } catch {
      return FALLBACK_MODELS.openrouter
    }
  }
}
```

- [ ] **Step 3d: Implement `listModels` in `GeminiProvider`**

New full file `src/lib/llm/GeminiProvider.ts`:

```ts
import type { HttpClient, HttpGet, LlmCompletion, LlmProvider, LlmProviderConfig, LlmRequest } from './contracts'
import { toGeminiBody, fromGeminiResponse } from './mappers'
import { FALLBACK_MODELS, parseGeminiModels, type LlmModel } from './models'

/**
 * Google Gemini API backend (direct). Auth goes in the query string (Google
 * convention), never in headers. Depends only on the HTTP ports (DIP).
 */
export class GeminiProvider implements LlmProvider {
  readonly id = 'gemini' as const
  readonly defaultModel: string
  private static readonly BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

  constructor(
    private readonly config: LlmProviderConfig,
    private readonly http: HttpClient & HttpGet
  ) {
    this.defaultModel = config.model ?? 'gemini-2.5-flash'
  }

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    const model = request.model ?? this.defaultModel
    const url = `${GeminiProvider.BASE}/${model}:generateContent?key=${encodeURIComponent(this.config.apiKey)}`
    const body = toGeminiBody(request)
    const res = await this.http.postJson<unknown>(url, body, { 'Content-Type': 'application/json' })
    return { text: fromGeminiResponse(res), model, provider: this.id }
  }

  async listModels(): Promise<LlmModel[]> {
    try {
      const url = `${GeminiProvider.BASE}?key=${encodeURIComponent(this.config.apiKey)}`
      const raw = await this.http.getJson<unknown>(url, {})
      const models = parseGeminiModels(raw)
      return models.length ? models : FALLBACK_MODELS.gemini
    } catch {
      return FALLBACK_MODELS.gemini
    }
  }
}
```

- [ ] **Step 3e: Widen the factory's http param**

In `src/lib/llm/createLlmProvider.ts` change the import and signatures so `http` is `HttpClient & HttpGet`:

```ts
import type { HttpClient, HttpGet, LlmProvider, LlmProviderConfig, LlmProviderId } from './contracts'
import { OpenRouterProvider } from './OpenRouterProvider'
import { GeminiProvider } from './GeminiProvider'

const REGISTRY: Record<
  LlmProviderId,
  (config: LlmProviderConfig, http: HttpClient & HttpGet) => LlmProvider
> = {
  openrouter: (config, http) => new OpenRouterProvider(config, http),
  gemini: (config, http) => new GeminiProvider(config, http)
}

export function createLlmProvider(config: LlmProviderConfig, http: HttpClient & HttpGet): LlmProvider {
  const factory = REGISTRY[config.provider]
  if (!factory) {
    throw new Error(`Unsupported LLM provider: ${config.provider}`)
  }
  return factory(config, http)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/llm/`
Expected: PASS — `models.test.ts` (6) + existing `providers.test.ts` still green (the `FakeHttp` there only implements `postJson`; it is passed where `HttpClient & HttpGet` is expected — update that fake to also implement a throwing `getJson` so the type checks).

Add to the `FakeHttp` in `src/lib/llm/providers.test.ts`:

```ts
  async getJson<T>(): Promise<T> { throw new Error('not used') }
```

- [ ] **Step 5: Verify the full LLM suite + types**

Run: `npx vitest run src/lib/llm/ && npx vue-tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/llm/
git commit -m "feat(llm): listModels port + OpenRouter/Gemini catalogs + fallback"
```

---

## Task A3: `contentHandlers.ts` + `LIST_MODELS` message + manifest hosts

> **Why a new file:** `src/service-worker/index.ts` is already 371 lines (over the strict ≤300 constraint). The three content/LLM handlers carry real orchestration (key checks, harvest, map, extract, error handling) and cross the LLM boundary, so they live in their own focused, dependency-injected, unit-testable module `src/service-worker/contentHandlers.ts`. `index.ts` only wires switch cases (thin). `generateIdeas`/`generateDraft` get boundary tests in B3/C4.

**Files:**
- Create: `src/service-worker/contentHandlers.ts` (just `listModels` this task; `generateIdeas` added in B3, `generateDraft` in C4)
- Modify: `src/lib/types.ts` (add `LIST_MODELS` to `BeaconMessage`)
- Modify: `manifest.config.ts` (host_permissions += LLM hosts)
- Modify: `src/service-worker/index.ts` (import the module; wire `LIST_MODELS`)
- Test: `listModels` is a one-line delegate to `createLlmProvider(...).listModels()` (fully covered in A2); SW switch wiring verified by build + live.

**Interfaces:**
- Consumes: `createLlmProvider` (A2), `HttpClient & HttpGet`, `LlmModel`, `LlmProviderId`, `FetchHttpClient`.
- Produces: `listModels(http: HttpClient & HttpGet, provider: LlmProviderId, apiKey: string): Promise<LlmModel[]>` in `contentHandlers.ts`; message `{ type: 'LIST_MODELS'; provider: LlmProviderId; apiKey: string }` → SW replies `LlmModel[]`.

- [ ] **Step 1: Extend the message union**

In `src/lib/types.ts`, add the import (with the existing imports) and the variant inside `BeaconMessage` (before `PING`):

```ts
import type { LlmModel } from './llm/models'
import type { LlmProviderId } from './llm/contracts'
```
```ts
  /** sidepanel → SW: list models for a provider+key; SW replies LlmModel[]. */
  | { type: 'LIST_MODELS'; provider: LlmProviderId; apiKey: string }
```

- [ ] **Step 2: Add the LLM hosts to the manifest**

In `manifest.config.ts` replace the `host_permissions` line:

```ts
  host_permissions: [
    'https://www.linkedin.com/*',
    'https://openrouter.ai/*',
    'https://generativelanguage.googleapis.com/*'
  ],
```

- [ ] **Step 3: Create `contentHandlers.ts` with `listModels`**

```ts
// src/service-worker/contentHandlers.ts
// SW-side content/LLM orchestration, extracted from index.ts (SRP + ≤300).
// All deps are injected so each handler is unit-testable with fakes (the LLM
// boundary is crossed by a fake HttpClient returning real-shape responses).
import { createLlmProvider } from '@lib/llm/createLlmProvider'
import type { HttpClient, HttpGet } from '@lib/llm/contracts'
import type { LlmModel } from '@lib/llm/models'
import type { LlmProviderId } from '@lib/llm/contracts'

export type LlmHttp = HttpClient & HttpGet

/** List a provider's models for the settings dropdown (fallback list on failure). */
export async function listModels(
  http: LlmHttp,
  provider: LlmProviderId,
  apiKey: string
): Promise<LlmModel[]> {
  return createLlmProvider({ provider, apiKey }, http).listModels()
}
```

- [ ] **Step 4: Wire the SW switch case**

In `src/service-worker/index.ts` add near the other imports:

```ts
import { FetchHttpClient } from '@/adapters/FetchHttpClient'
import * as content from './contentHandlers'
```
(`FetchHttpClient` is already imported — reuse the existing import; just add the `content` import.)

Add one module-level line near the other singletons (e.g. after `const reportsStore = …`):

```ts
const llmHttp = new FetchHttpClient()
```

Add the case inside the `onMessage` switch (next to `LIST_QUARANTINE`):

```ts
    case 'LIST_MODELS':
      void content.listModels(llmHttp, message.provider, message.apiKey).then(sendResponse)
      return true
```

- [ ] **Step 5: Verify build + types**

Run: `npm run build`
Expected: success — `vue-tsc --noEmit` clean, `dist/` written, `manifest.json` includes the two new hosts:

```bash
grep -o 'openrouter.ai\|generativelanguage.googleapis.com' dist/manifest.json
```
Expected: both hosts printed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts manifest.config.ts src/service-worker/index.ts src/service-worker/contentHandlers.ts
git commit -m "feat(llm): contentHandlers.listModels + LIST_MODELS wiring + LLM hosts"
```

---

## Task A4: Settings screen + LLM section + nav wiring (gear)

**Files:**
- Modify: `src/sidepanel/composables/useNavigation.ts` (add `v-content`, `v-settings` to `ViewId`)
- Modify: `src/sidepanel/components/TopBar.vue` (add a ⚙ button emitting `open-settings`)
- Create: `src/sidepanel/composables/useLlmSettings.ts`
- Create: `src/sidepanel/screens/SettingsScreen.vue`
- Modify: `src/sidepanel/App.vue` (route `v-settings`, wire gear)
- Test: `src/sidepanel/screens/SettingsScreen.spec.ts`

**Interfaces:**
- Consumes: `loadLlmConfig`/`saveLlmConfig`/`LlmConfig` (A1), `panelBus.request` with `LIST_MODELS` (A3), `LlmModel`.
- Produces: `useLlmSettings()` → `{ config, models, modelQuery, filteredModels, keyValid, load, save, fetchModels }`. `SettingsScreen` emits nothing (self-contained). `TopBar` emits `open-settings`.

- [ ] **Step 1: Extend `ViewId`**

In `src/sidepanel/composables/useNavigation.ts` change the type (leave `NAV_ITEMS` unchanged — settings is reached via the gear, not the bottom nav):

```ts
export type ViewId = 'v-dash' | 'v-auto' | 'v-inbox' | 'v-set' | 'v-reports' | 'v-content' | 'v-settings'
```

- [ ] **Step 2: Write the failing composable test**

```ts
// src/sidepanel/composables/useLlmSettings.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useLlmSettings } from './useLlmSettings'

// chrome.storage.local mock
const mem = new Map<string, unknown>()
beforeEach(() => {
  mem.clear()
  ;(globalThis as any).chrome = {
    runtime: { id: 'x', sendMessage: vi.fn().mockResolvedValue([{ id: 'm1', label: 'M1' }]) },
    storage: {
      local: {
        get: vi.fn(async (k: string) => ({ [k]: mem.get(k) })),
        set: vi.fn(async (o: Record<string, unknown>) => { for (const k in o) mem.set(k, o[k]) })
      }
    }
  }
})

describe('useLlmSettings', () => {
  it('saves and reloads the config', async () => {
    const s = useLlmSettings()
    s.config.value = { provider: 'gemini', apiKey: 'AIza', model: 'gemini-2.5-flash' }
    await s.save()
    const s2 = useLlmSettings()
    await s2.load()
    expect(s2.config.value).toEqual({ provider: 'gemini', apiKey: 'AIza', model: 'gemini-2.5-flash' })
  })

  it('filters models by the search query', async () => {
    const s = useLlmSettings()
    s.models.value = [
      { id: 'openai/gpt-4o', label: 'GPT-4o' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini' }
    ]
    s.modelQuery.value = 'gemini'
    expect(s.filteredModels.value.map((m) => m.id)).toEqual(['google/gemini-2.5-flash'])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/sidepanel/composables/useLlmSettings.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `useLlmSettings`**

```ts
// src/sidepanel/composables/useLlmSettings.ts
import { ref, computed } from 'vue'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { loadLlmConfig, saveLlmConfig, type LlmConfig } from '@lib/llm/config'
import type { LlmModel } from '@lib/llm/models'
import { panelBus } from '../lib/panelBus'

/** Settings-screen state for the BYOK LLM config + the searchable model catalog. */
export function useLlmSettings() {
  const store = new ChromeStorageStore()
  const config = ref<LlmConfig>({ provider: 'openrouter', apiKey: '' })
  const models = ref<LlmModel[]>([])
  const modelQuery = ref('')
  const keyValid = ref<boolean | null>(null)
  const loading = ref(false)

  const filteredModels = computed(() => {
    const q = modelQuery.value.trim().toLowerCase()
    if (!q) return models.value
    return models.value.filter(
      (m) => m.id.toLowerCase().includes(q) || (m.label ?? '').toLowerCase().includes(q)
    )
  })

  async function load() {
    config.value = await loadLlmConfig(store)
  }

  async function save() {
    await saveLlmConfig(store, { ...config.value })
  }

  async function fetchModels() {
    loading.value = true
    const list = await panelBus.request<LlmModel[]>({
      type: 'LIST_MODELS',
      provider: config.value.provider,
      apiKey: config.value.apiKey
    })
    loading.value = false
    if (list && list.length) {
      models.value = list
      keyValid.value = true
    } else {
      keyValid.value = false
    }
  }

  return { config, models, modelQuery, filteredModels, keyValid, loading, load, save, fetchModels }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/sidepanel/composables/useLlmSettings.spec.ts`
Expected: PASS (2).

- [ ] **Step 6: Write the screen + a render test**

```ts
// src/sidepanel/screens/SettingsScreen.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SettingsScreen from './SettingsScreen.vue'

beforeEach(() => {
  ;(globalThis as any).chrome = {
    runtime: { id: 'x', sendMessage: vi.fn().mockResolvedValue([]) },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } }
  }
})

describe('SettingsScreen', () => {
  it('renders the provider select and a password key input', () => {
    const wrapper = mount(SettingsScreen)
    expect(wrapper.find('[data-testid="llm-provider"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="llm-key"]').attributes('type')).toBe('password')
  })
})
```

```vue
<!-- src/sidepanel/screens/SettingsScreen.vue -->
<script setup lang="ts">
import { onMounted } from 'vue'
import { useLlmSettings } from '../composables/useLlmSettings'

const { config, modelQuery, filteredModels, keyValid, loading, load, save, fetchModels } = useLlmSettings()
onMounted(load)

async function onSave() {
  await save()
}
</script>

<template>
  <section class="view" id="v-settings">
    <div class="sect-lbl">LLM · ключ и модель</div>

    <label class="fld">
      <span class="k">Провайдер</span>
      <select v-model="config.provider" data-testid="llm-provider" @change="config.model = undefined">
        <option value="openrouter">OpenRouter</option>
        <option value="gemini">Google Gemini</option>
      </select>
    </label>

    <label class="fld">
      <span class="k">API-ключ</span>
      <input v-model="config.apiKey" type="password" data-testid="llm-key" placeholder="sk-… / AIza…" />
    </label>

    <button class="btn" :disabled="loading" data-testid="llm-fetch" @click="fetchModels">
      {{ loading ? 'Загрузка…' : 'Загрузить модели' }}
    </button>
    <span v-if="keyValid === true" class="v ok" data-testid="llm-valid">ключ валиден</span>
    <span v-else-if="keyValid === false" class="v" data-testid="llm-invalid">не удалось — фолбэк-список</span>

    <label class="fld" v-if="filteredModels.length">
      <span class="k">Модель</span>
      <input v-model="modelQuery" placeholder="поиск модели…" data-testid="model-search" />
      <select v-model="config.model" data-testid="model-select" size="6">
        <option v-for="m in filteredModels" :key="m.id" :value="m.id">{{ m.label ?? m.id }}</option>
      </select>
    </label>

    <button class="btn primary" data-testid="llm-save" @click="onSave">Сохранить</button>
  </section>
</template>
```

- [ ] **Step 7: Wire the gear + route**

In `src/sidepanel/components/TopBar.vue` add an emit and a button inside `.brandrow` (after `.status`):

```vue
<script setup lang="ts">
defineProps<{ active?: boolean }>()
defineEmits<{ 'open-settings': [] }>()
</script>
```
```vue
      <button class="gear" data-testid="open-settings" title="Настройки" @click="$emit('open-settings')">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.9" /><path d="M12 3v3m0 12v3m9-9h-3M6 12H3m13.5-6.5l-2 2m-7 7l-2 2m11 0l-2-2m-7-7l-2-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
      </button>
```

In `src/sidepanel/App.vue`: import `SettingsScreen`, add it to the template, and pass the gear handler to `TopBar`:

```ts
import SettingsScreen from './screens/SettingsScreen.vue'
```
```vue
    <TopBar :active="anyActive" @open-settings="go('v-settings')" />
```
```vue
      <SettingsScreen v-else-if="active === 'v-settings'" />
```
(Place the `SettingsScreen` branch before the final `<SafetyScreen v-else …>`.)

- [ ] **Step 8: Run tests + build**

Run: `npx vitest run src/sidepanel/ && npm run build`
Expected: PASS, build clean.

- [ ] **Step 9: Add minimal styles**

In `src/sidepanel/styles.css` append (match existing token vars):

```css
.fld{display:flex;flex-direction:column;gap:6px;margin:10px 0}
.fld .k{font-size:11px;color:var(--mut)}
.fld input,.fld select,.fld textarea{background:#0e1422;border:1px solid var(--line);border-radius:9px;color:#fff;padding:9px 11px;font:inherit}
.btn{background:#141c2e;border:1px solid var(--line);border-radius:9px;color:#fff;padding:9px 13px;cursor:pointer}
.btn.primary{background:var(--lime,#c4ff4d);color:#0a0e17;border:none;font-weight:600}
.gear{margin-left:8px;background:none;border:none;color:var(--mut);cursor:pointer;width:24px;height:24px}
```

- [ ] **Step 10: Commit**

```bash
git add src/sidepanel/ src/lib/types.ts
git commit -m "feat(sidepanel): Settings screen — BYOK LLM key + searchable model catalog"
```

**Checkpoint A done when:** `npm test` green, `npm run build` clean, gear opens Settings, provider/key/model persist, "Загрузить модели" populates the dropdown (live: real OpenRouter list with a key, fallback without).

---

# Checkpoint B — Expertise editing + idea generation + Ideas screen

## Task B1: Expertise read-modify-write helper (no clobber)

**Files:**
- Modify: `src/lib/engagement/settings.ts` (add `ExpertiseForm` + `applyExpertiseForm`)
- Test: `src/lib/engagement/settings.test.ts` (add cases — file exists)

**Interfaces:**
- Consumes: `EngagementSettings`, `parseCsv` (same file).
- Produces: `ExpertiseForm { headline: string; stack: string; bio: string }`, `applyExpertiseForm(current: EngagementSettings, form: ExpertiseForm): EngagementSettings`.

- [ ] **Step 1: Write the failing boundary test** (RMW must NOT clobber `target`)

Add to `src/lib/engagement/settings.test.ts`:

```ts
import { applyExpertiseForm, DEFAULT_SETTINGS } from './settings'

describe('applyExpertiseForm', () => {
  it('updates expertise without clobbering target or config', () => {
    const current = {
      ...DEFAULT_SETTINGS,
      target: { ...DEFAULT_SETTINGS.target, stack: ['Vue', 'TS'], watchlistCompanies: ['Wise'] }
    }
    const next = applyExpertiseForm(current, {
      headline: 'Frontend TechLead, 11y Vue/TS',
      stack: 'Vue, TypeScript, Nuxt',
      bio: 'Mentor & TeamLead'
    })
    expect(next.expertise).toEqual({
      headline: 'Frontend TechLead, 11y Vue/TS',
      stack: ['Vue', 'TypeScript', 'Nuxt'],
      bio: 'Mentor & TeamLead'
    })
    // critical: the rest of the blob is preserved
    expect(next.target).toEqual(current.target)
    expect(next.config).toEqual(current.config)
    expect(next.relevanceThreshold).toEqual(current.relevanceThreshold)
  })

  it('omits bio when empty', () => {
    const next = applyExpertiseForm(DEFAULT_SETTINGS, { headline: 'X', stack: 'Vue', bio: '   ' })
    expect(next.expertise.bio).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/engagement/settings.test.ts`
Expected: FAIL — `applyExpertiseForm` not exported.

- [ ] **Step 3: Implement the helper**

Append to `src/lib/engagement/settings.ts`:

```ts
export interface ExpertiseForm {
  headline: string
  stack: string
  bio: string
}

/** Apply the expertise form, preserving target/config/threshold (no clobber). */
export function applyExpertiseForm(current: EngagementSettings, form: ExpertiseForm): EngagementSettings {
  const bio = form.bio.trim()
  return {
    ...current,
    expertise: {
      headline: form.headline.trim(),
      stack: parseCsv(form.stack),
      ...(bio ? { bio } : {})
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/engagement/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engagement/settings.ts src/lib/engagement/settings.test.ts
git commit -m "feat(content): expertise RMW form helper (no target clobber)"
```

---

## Task B2: `FeedPost → FeedItem` mapper + `IdeaBank.remove`

**Files:**
- Create: `src/lib/ideas/feedItem.ts`
- Modify: `src/lib/ideas/IdeaBank.ts` (add `remove`)
- Test: `src/lib/ideas/feedItem.test.ts`, `src/lib/ideas/IdeaBank.test.ts` (add a case)

**Interfaces:**
- Consumes: `FeedPost`, `FeedItem`, `Idea` (`@lib/types`).
- Produces: `feedPostToFeedItem(post: FeedPost): FeedItem`; `IdeaBank.remove(idea: Idea): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/ideas/feedItem.test.ts
import { describe, it, expect } from 'vitest'
import { feedPostToFeedItem } from './feedItem'
import type { FeedPost } from '@lib/types'

describe('feedPostToFeedItem', () => {
  it('maps urn/authorName/text to id/author/excerpt', () => {
    const post: FeedPost = { urn: 'urn:li:activity:1', authorName: 'Anna K', text: 'Hiring Vue devs' }
    expect(feedPostToFeedItem(post)).toEqual({ id: 'urn:li:activity:1', author: 'Anna K', excerpt: 'Hiring Vue devs' })
  })
})
```

Add to `src/lib/ideas/IdeaBank.test.ts`:

```ts
it('removes an idea by topic+angle (normalised)', async () => {
  const bank = new IdeaBank(memStore())
  await bank.add([a, b])
  await bank.remove({ topic: '  TRPC vs REST ', angle: 'Type-safety from a Vue codebase' })
  expect(await bank.all()).toEqual([b])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/ideas/`
Expected: FAIL — `feedItem` missing, `remove` not a function.

- [ ] **Step 3: Implement the mapper**

```ts
// src/lib/ideas/feedItem.ts
import type { FeedItem, FeedPost } from '../types'

/** Reuse the engagement harvest (FeedPost) as idea signal — text is richer than excerpt. */
export function feedPostToFeedItem(post: FeedPost): FeedItem {
  return { id: post.urn, author: post.authorName, excerpt: post.text }
}
```

- [ ] **Step 4: Implement `IdeaBank.remove`**

In `src/lib/ideas/IdeaBank.ts` add inside the class (reuses the file-local `key`):

```ts
  async remove(idea: Idea): Promise<void> {
    const target = key(idea)
    const next = (await this.all()).filter((i) => key(i) !== target)
    await this.store.set(IDEA_BANK_KEY, next)
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/ideas/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ideas/
git commit -m "feat(content): FeedPost→FeedItem mapper + IdeaBank.remove"
```

---

## Task B3: `generateIdeas` handler (boundary-tested) + `GENERATE_IDEAS` message

**Files:**
- Create/Modify: `src/service-worker/contentHandlers.ts` (add `generateIdeas` + `IdeaDeps`)
- Modify: `src/lib/types.ts` (add `GENERATE_IDEAS`)
- Modify: `src/service-worker/index.ts` (wire the switch case)
- Test: `src/service-worker/contentHandlers.test.ts` — TDD, crosses the LLM boundary (fake `HttpClient & HttpGet` returns a real-shape OpenRouter completion whose content is the ideas JSON).

**Interfaces:**
- Consumes: `feedPostToFeedItem` (B2), `IdeaExtractor`, `IdeaBank`, `loadLlmConfig` (A1), `createLlmProvider` (A2), `loadSettings` (expertise), `LlmHttp` (A3), `KeyValueStore`, `FeedPost`, `Idea`.
- Produces: `generateIdeas(deps: IdeaDeps): Promise<{ ideas: Idea[]; error?: string }>` where `IdeaDeps { store: KeyValueStore; http: LlmHttp; harvest: (limit: number) => Promise<FeedPost[]> }`; message `{ type: 'GENERATE_IDEAS' }` → SW replies `{ ideas, error? }`.

- [ ] **Step 1: Write the failing boundary test**

```ts
// src/service-worker/contentHandlers.test.ts
import { describe, it, expect } from 'vitest'
import { generateIdeas } from './contentHandlers'
import type { KeyValueStore } from '@lib/ports'
import type { HttpClient, HttpGet } from '@lib/llm/contracts'
import type { FeedPost } from '@lib/types'

function memStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const m = new Map<string, unknown>(Object.entries(initial))
  return {
    async get<T>(k: string) { return m.has(k) ? (m.get(k) as T) : null },
    async set<T>(k: string, v: T) { m.set(k, v) }
  }
}

/** Returns a real-shape OpenRouter completion whose content is `text`. */
function fakeHttp(text: string): HttpClient & HttpGet {
  return {
    async postJson<T>() { return { choices: [{ message: { content: text } }] } as T },
    async getJson<T>() { return {} as T }
  }
}

const CONFIGURED = {
  'llm:config': { provider: 'openrouter', apiKey: 'sk-1' },
  'engagement:settings': {
    config: { level: 'manual' }, target: { stack: [] },
    expertise: { headline: 'Frontend TechLead', stack: ['Vue'] }, relevanceThreshold: 0.3
  }
}
const posts: FeedPost[] = [{ urn: 'urn:1', authorName: 'A', text: 'hiring vue devs' }]

describe('generateIdeas', () => {
  it('errors no_key when the key is empty', async () => {
    const res = await generateIdeas({ store: memStore(), http: fakeHttp('[]'), harvest: async () => posts })
    expect(res).toEqual({ ideas: [], error: 'no_key' })
  })

  it('errors no_expertise when the headline is blank', async () => {
    const store = memStore({ 'llm:config': { provider: 'openrouter', apiKey: 'sk-1' } })
    const res = await generateIdeas({ store, http: fakeHttp('[]'), harvest: async () => posts })
    expect(res).toEqual({ ideas: [], error: 'no_expertise' })
  })

  it('errors no_feed when harvest is empty', async () => {
    const res = await generateIdeas({ store: memStore(CONFIGURED), http: fakeHttp('[]'), harvest: async () => [] })
    expect(res).toEqual({ ideas: [], error: 'no_feed' })
  })

  it('extracts ideas via the LLM and banks them', async () => {
    const ideasJson = JSON.stringify([{ topic: 'tRPC vs REST', angle: 'type-safety from Vue' }])
    const store = memStore(CONFIGURED)
    const res = await generateIdeas({ store, http: fakeHttp(ideasJson), harvest: async () => posts })
    expect(res.error).toBeUndefined()
    expect(res.ideas).toContainEqual({ topic: 'tRPC vs REST', angle: 'type-safety from Vue' })
    // persisted to the bank
    expect(await store.get('ideas:bank')).toEqual([{ topic: 'tRPC vs REST', angle: 'type-safety from Vue' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/service-worker/contentHandlers.test.ts`
Expected: FAIL — `generateIdeas` not exported.

- [ ] **Step 3: Implement `generateIdeas` in `contentHandlers.ts`**

Add imports at the top of `src/service-worker/contentHandlers.ts`:

```ts
import { loadLlmConfig } from '@lib/llm/config'
import { loadSettings } from '@lib/engagement/settings'
import { IdeaExtractor } from '@lib/ideas/IdeaExtractor'
import { IdeaBank } from '@lib/ideas/IdeaBank'
import { feedPostToFeedItem } from '@lib/ideas/feedItem'
import type { KeyValueStore } from '@lib/ports'
import type { FeedPost, Idea } from '@lib/types'
```

Append:

```ts
export interface IdeaDeps {
  store: KeyValueStore
  http: LlmHttp
  harvest: (limit: number) => Promise<FeedPost[]>
}

/** Harvest the feed → extract ideas (LLM) → bank them. Returns the full bank. */
export async function generateIdeas(deps: IdeaDeps): Promise<{ ideas: Idea[]; error?: string }> {
  const cfg = await loadLlmConfig(deps.store)
  if (!cfg.apiKey.trim()) return { ideas: [], error: 'no_key' }
  const { expertise } = await loadSettings(deps.store)
  if (!expertise.headline.trim()) return { ideas: [], error: 'no_expertise' }
  const posts = await deps.harvest(20)
  if (!posts.length) return { ideas: [], error: 'no_feed' }

  const provider = createLlmProvider({ provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model }, deps.http)
  const bank = new IdeaBank(deps.store)
  try {
    const ideas = await new IdeaExtractor(provider).extract(posts.map(feedPostToFeedItem), expertise)
    await bank.add(ideas)
    return { ideas: await bank.all() }
  } catch (e) {
    return { ideas: [], error: e instanceof Error ? e.message : 'llm_failed' }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/service-worker/contentHandlers.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Extend the message union**

In `src/lib/types.ts` add inside `BeaconMessage`:

```ts
  /** sidepanel → SW: harvest feed → extract ideas → bank; replies { ideas, error? }. */
  | { type: 'GENERATE_IDEAS' }
```

- [ ] **Step 6: Wire the switch case**

In `src/service-worker/index.ts` add the case (the `content` import + `llmHttp` already exist from A3; `harvestPosts` is the existing SW function):

```ts
    case 'GENERATE_IDEAS':
      void content.generateIdeas({ store, http: llmHttp, harvest: harvestPosts }).then(sendResponse)
      return true
```

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/service-worker/contentHandlers.ts src/service-worker/contentHandlers.test.ts src/service-worker/index.ts
git commit -m "feat(content): generateIdeas handler (boundary-tested) + GENERATE_IDEAS"
```

---

## Task B4: Content screen + Ideas sub-tab + nav (6th tab)

**Files:**
- Modify: `src/sidepanel/composables/useNavigation.ts` (add `v-content` to `NAV_ITEMS`)
- Modify: `src/sidepanel/components/BottomNav.vue` (6th button)
- Create: `src/sidepanel/composables/useContent.ts`
- Create: `src/sidepanel/screens/ContentScreen.vue`
- Modify: `src/sidepanel/App.vue` (route `v-content`)
- Test: `src/sidepanel/composables/useContent.spec.ts`, `src/sidepanel/screens/ContentScreen.spec.ts`

**Interfaces:**
- Consumes: `IdeaBank` (direct via `ChromeStorageStore`), `panelBus.request` with `GENERATE_IDEAS` (B3) and `GENERATE_DRAFT` (Checkpoint C — wired here, used in C), `Idea`, `Draft`.
- Produces: `useContent()` → `{ tab, ideas, drafts, generating, error, loadIdeas, generateIdeas, removeIdea, toDraft, loadDrafts, removeDraft, updateDraft }`. `ContentScreen` self-contained. `NAV_ITEMS` gains `{ id: 'v-content', label: 'Контент' }`.

> Note: `useContent` covers BOTH sub-tabs (ideas now, drafts in Checkpoint C). The draft-related members are created here but exercised in C5. This avoids a second composable.

- [ ] **Step 1: Add the nav item + bottom-nav button**

In `useNavigation.ts` append to `NAV_ITEMS`:

```ts
  { id: 'v-content', label: 'Контент' }
```

In `src/sidepanel/components/BottomNav.vue` add a 6th button before `</nav>`:

```vue
    <button :class="{ on: active === 'v-content' }" data-testid="nav-v-content" @click="$emit('go', 'v-content')">
      <svg viewBox="0 0 24 24" fill="none"><path d="M5 3h10l4 4v14H5z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" /><path d="M14 3v5h5M8.5 13h7M8.5 16.5h5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
      <span>Контент</span>
    </button>
```

- [ ] **Step 2: Write the failing composable test**

```ts
// src/sidepanel/composables/useContent.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useContent } from './useContent'

const mem = new Map<string, unknown>()
beforeEach(() => {
  mem.clear()
  ;(globalThis as any).chrome = {
    runtime: {
      id: 'x',
      sendMessage: vi.fn().mockResolvedValue({ ideas: [{ topic: 'T', angle: 'A' }] })
    },
    storage: {
      local: {
        get: vi.fn(async (k: string) => ({ [k]: mem.get(k) })),
        set: vi.fn(async (o: Record<string, unknown>) => { for (const k in o) mem.set(k, o[k]) })
      }
    }
  }
})

describe('useContent', () => {
  it('generates ideas via the SW and loads them from the bank', async () => {
    mem.set('ideas:bank', [{ topic: 'T', angle: 'A' }])
    const c = useContent()
    await c.generateIdeas()
    expect(c.ideas.value).toEqual([{ topic: 'T', angle: 'A' }])
  })

  it('removes an idea from the bank', async () => {
    mem.set('ideas:bank', [{ topic: 'T', angle: 'A' }, { topic: 'U', angle: 'B' }])
    const c = useContent()
    await c.loadIdeas()
    await c.removeIdea({ topic: 'T', angle: 'A' })
    expect(c.ideas.value).toEqual([{ topic: 'U', angle: 'B' }])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/sidepanel/composables/useContent.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `useContent`**

```ts
// src/sidepanel/composables/useContent.ts
import { ref } from 'vue'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { IdeaBank } from '@lib/ideas/IdeaBank'
import { DraftStore } from '@lib/content/DraftStore'
import type { Idea, Draft } from '@lib/types'
import { panelBus } from '../lib/panelBus'

/** Side-panel state for the Content screen: idea bank + draft queue. */
export function useContent() {
  const store = new ChromeStorageStore()
  const bank = new IdeaBank(store)
  const drafts = new DraftStore(store)

  const tab = ref<'ideas' | 'drafts'>('ideas')
  const ideas = ref<Idea[]>([])
  const draftList = ref<Draft[]>([])
  const generating = ref(false)
  const error = ref<string | null>(null)

  async function loadIdeas() {
    ideas.value = await bank.all()
  }

  async function generateIdeas() {
    generating.value = true
    error.value = null
    const res = await panelBus.request<{ ideas: Idea[]; error?: string }>({ type: 'GENERATE_IDEAS' })
    generating.value = false
    if (res?.error) error.value = res.error
    ideas.value = res?.ideas ?? (await bank.all())
  }

  async function removeIdea(idea: Idea) {
    await bank.remove(idea)
    await loadIdeas()
  }

  async function loadDrafts() {
    draftList.value = await drafts.all()
  }

  async function toDraft(idea: Idea) {
    generating.value = true
    error.value = null
    const res = await panelBus.request<{ draft: Draft | null; error?: string }>({ type: 'GENERATE_DRAFT', idea })
    generating.value = false
    if (res?.error) error.value = res.error
    await loadDrafts()
    if (res?.draft) tab.value = 'drafts'
  }

  async function removeDraft(id: string) {
    await drafts.remove(id)
    await loadDrafts()
  }

  async function updateDraft(id: string, text: string) {
    await drafts.update(id, text)
    await loadDrafts()
  }

  return {
    tab, ideas, drafts: draftList, generating, error,
    loadIdeas, generateIdeas, removeIdea,
    loadDrafts, toDraft, removeDraft, updateDraft
  }
}
```

> This composable imports `DraftStore` and `Draft` (created in Checkpoint C, Tasks C1/C2). Implement B4 AFTER C2 if executing strictly top-to-bottom, OR stub `DraftStore` first. Recommended order: do C1–C3 before B4/B5 so types exist. (See "Execution order" note at the end.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/sidepanel/composables/useContent.spec.ts`
Expected: PASS (2).

- [ ] **Step 6: Write the screen + render test**

```ts
// src/sidepanel/screens/ContentScreen.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ContentScreen from './ContentScreen.vue'

beforeEach(() => {
  ;(globalThis as any).chrome = {
    runtime: { id: 'x', sendMessage: vi.fn().mockResolvedValue({ ideas: [] }) },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } }
  }
})

describe('ContentScreen', () => {
  it('renders the Ideas / Drafts sub-tabs', () => {
    const wrapper = mount(ContentScreen)
    expect(wrapper.find('[data-testid="subtab-ideas"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="subtab-drafts"]').exists()).toBe(true)
  })
})
```

```vue
<!-- src/sidepanel/screens/ContentScreen.vue -->
<script setup lang="ts">
import { onMounted } from 'vue'
import { useContent } from '../composables/useContent'

const {
  tab, ideas, drafts, generating, error,
  loadIdeas, generateIdeas, removeIdea, toDraft,
  loadDrafts, removeDraft, updateDraft
} = useContent()

onMounted(async () => {
  await loadIdeas()
  await loadDrafts()
})

const ERR: Record<string, string> = {
  no_key: 'Задай LLM-ключ в настройках (⚙).',
  no_expertise: 'Заполни профиль экспертизы в настройках (⚙).',
  no_feed: 'Открой вкладку ленты LinkedIn.'
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text) } catch { /* clipboard blocked */ }
}
</script>

<template>
  <section class="view" id="v-content">
    <div class="subtabs">
      <button :class="{ on: tab === 'ideas' }" data-testid="subtab-ideas" @click="tab = 'ideas'">Идеи</button>
      <button :class="{ on: tab === 'drafts' }" data-testid="subtab-drafts" @click="tab = 'drafts'">Черновики</button>
    </div>

    <p v-if="error" class="banner">{{ ERR[error] ?? `Ошибка: ${error}` }}</p>

    <!-- IDEAS -->
    <template v-if="tab === 'ideas'">
      <button class="btn primary" :disabled="generating" data-testid="gen-ideas" @click="generateIdeas">
        {{ generating ? 'Генерация…' : 'Сгенерировать идеи' }}
      </button>
      <p v-if="!ideas.length" class="banner">Пока нет идей. Открой ленту и нажми «Сгенерировать».</p>
      <div v-for="(idea, i) in ideas" :key="i" class="note" :data-testid="`idea-${i}`">
        <div class="lbl">{{ idea.topic }}</div>
        {{ idea.angle }}
        <div class="row">
          <button class="btn" data-testid="to-draft" @click="toDraft(idea)">В черновик</button>
          <button class="btn" @click="removeIdea(idea)">Удалить</button>
        </div>
      </div>
    </template>

    <!-- DRAFTS -->
    <template v-else>
      <p v-if="!drafts.length" class="banner">Нет черновиков. Сгенерируй пост из идеи.</p>
      <div v-for="d in drafts" :key="d.id" class="note" :data-testid="`draft-${d.id}`">
        <div class="lbl">{{ d.ideaTopic }}</div>
        <textarea :value="d.text" rows="6" @change="updateDraft(d.id, ($event.target as HTMLTextAreaElement).value)" />
        <div class="row">
          <button class="btn" data-testid="copy" @click="copy(d.text)">Копировать</button>
          <button class="btn" @click="toDraft({ topic: d.ideaTopic, angle: d.ideaAngle })">Перегенерировать</button>
          <button class="btn" @click="removeDraft(d.id)">Удалить</button>
        </div>
      </div>
    </template>
  </section>
</template>
```

In `src/sidepanel/App.vue` import + route:

```ts
import ContentScreen from './screens/ContentScreen.vue'
```
```vue
      <ContentScreen v-else-if="active === 'v-content'" />
```

- [ ] **Step 7: Styles for sub-tabs + row**

Append to `src/sidepanel/styles.css`:

```css
.subtabs{display:flex;gap:8px;margin-bottom:12px}
.subtabs button{flex:1;padding:8px;border:1px solid var(--line);border-radius:9px;background:#0e1422;color:var(--mut);cursor:pointer}
.subtabs button.on{background:#141c2e;color:#fff;border-color:var(--lime,#c4ff4d)}
.note .row{display:flex;gap:8px;margin-top:9px}
.note textarea{width:100%;margin-top:8px;background:#0e1422;border:1px solid var(--line);border-radius:9px;color:#fff;padding:9px;font:inherit;resize:vertical}
```

- [ ] **Step 8: Run tests + build**

Run: `npx vitest run src/sidepanel/ && npm run build`
Expected: PASS, clean.

- [ ] **Step 9: Commit**

```bash
git add src/sidepanel/ src/lib/types.ts
git commit -m "feat(sidepanel): Content screen — Ideas/Drafts sub-tabs + idea actions"
```

---

## Task B5: Settings — Expertise section

**Files:**
- Modify: `src/sidepanel/composables/useLlmSettings.ts` → rename concern OR add `useExpertiseSettings.ts`
- Create: `src/sidepanel/composables/useExpertiseSettings.ts`
- Modify: `src/sidepanel/screens/SettingsScreen.vue` (add the expertise section)
- Test: `src/sidepanel/composables/useExpertiseSettings.spec.ts`

**Interfaces:**
- Consumes: `loadSettings`, `saveSettings`, `applyExpertiseForm` (B1), `ChromeStorageStore`.
- Produces: `useExpertiseSettings()` → `{ form, load, save }` where `form: Ref<ExpertiseForm>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/sidepanel/composables/useExpertiseSettings.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useExpertiseSettings } from './useExpertiseSettings'

const mem = new Map<string, unknown>()
beforeEach(() => {
  mem.clear()
  ;(globalThis as any).chrome = {
    runtime: { id: 'x' },
    storage: {
      local: {
        get: vi.fn(async (k: string) => ({ [k]: mem.get(k) })),
        set: vi.fn(async (o: Record<string, unknown>) => { for (const k in o) mem.set(k, o[k]) })
      }
    }
  }
})

describe('useExpertiseSettings', () => {
  it('saves expertise and preserves the rest of engagement settings', async () => {
    mem.set('engagement:settings', {
      config: { level: 'manual' }, target: { stack: ['Vue'] }, expertise: { headline: '', stack: [] }, relevanceThreshold: 0.3
    })
    const s = useExpertiseSettings()
    await s.load()
    s.form.value = { headline: 'TechLead', stack: 'Vue, TS', bio: 'mentor' }
    await s.save()
    expect((mem.get('engagement:settings') as any).expertise).toEqual({ headline: 'TechLead', stack: ['Vue', 'TS'], bio: 'mentor' })
    expect((mem.get('engagement:settings') as any).target).toEqual({ stack: ['Vue'] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sidepanel/composables/useExpertiseSettings.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/sidepanel/composables/useExpertiseSettings.ts
import { ref } from 'vue'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { loadSettings, saveSettings, applyExpertiseForm, type ExpertiseForm } from '@lib/engagement/settings'

/** Settings-screen state for the user's expertise (lives in engagement:settings, SSOT). */
export function useExpertiseSettings() {
  const store = new ChromeStorageStore()
  const form = ref<ExpertiseForm>({ headline: '', stack: '', bio: '' })

  async function load() {
    const s = await loadSettings(store)
    form.value = {
      headline: s.expertise.headline,
      stack: s.expertise.stack.join(', '),
      bio: s.expertise.bio ?? ''
    }
  }

  async function save() {
    const current = await loadSettings(store)
    await saveSettings(store, applyExpertiseForm(current, form.value))
  }

  return { form, load, save }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sidepanel/composables/useExpertiseSettings.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add the expertise section to `SettingsScreen.vue`**

In the `<script setup>` add:

```ts
import { useExpertiseSettings } from '../composables/useExpertiseSettings'
const exp = useExpertiseSettings()
onMounted(exp.load)

async function onSave() {
  await save()
  await exp.save()
}
```
(Replace the existing `onSave` that only called `save()`.)

In the template, before the final Save button, add:

```vue
    <div class="sect-lbl">Экспертиза</div>
    <label class="fld">
      <span class="k">Заголовок</span>
      <input v-model="exp.form.value.headline" data-testid="exp-headline" placeholder="Frontend TechLead, 11y Vue/TS" />
    </label>
    <label class="fld">
      <span class="k">Стек (через запятую)</span>
      <input v-model="exp.form.value.stack" data-testid="exp-stack" placeholder="Vue, TypeScript, Nuxt" />
    </label>
    <label class="fld">
      <span class="k">О себе</span>
      <textarea v-model="exp.form.value.bio" rows="3" data-testid="exp-bio" />
    </label>
```

- [ ] **Step 6: Run tests + build**

Run: `npx vitest run src/sidepanel/ && npm run build`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/
git commit -m "feat(sidepanel): Settings — expertise section (SSOT, no clobber)"
```

**Checkpoint B done when:** `npm test` green, build clean, gear→Settings edits expertise, Контент tab generates real ideas from the live feed (live test with a key + expertise + open feed tab).

---

# Checkpoint C — Draft generation + Drafts management

> **Execution order note:** C1–C3 (types + stores + generator) should be implemented BEFORE B4/B5 so `DraftStore`/`Draft` exist for `useContent`. The plan lists B then C for narrative flow, but a clean run is: A1–A4 → C1, C2, C3 → C4 → B1, B2, B3 → B4, B5 → C5. Subagent-driven execution: dispatch in that order.

## Task C1: `Draft` type + `content/settings.ts`

**Files:**
- Modify: `src/lib/types.ts` (add `Draft`)
- Create: `src/lib/content/settings.ts`
- Test: `src/lib/content/settings.test.ts`

**Interfaces:**
- Produces: `Draft { id: string; ideaTopic: string; ideaAngle: string; text: string; createdAt: string }`; `ContentSettings { postPrompt: string }`, `CONTENT_SETTINGS_KEY = 'content:settings'`, `DEFAULT_POST_PROMPT`, `loadContentSettings(store)`, `saveContentSettings(store, s)`.

- [ ] **Step 1: Add the `Draft` type**

In `src/lib/types.ts` near `Idea`:

```ts
/** A generated post draft (design-spec §4.3). Not published until Layer 2. */
export interface Draft {
  id: string
  ideaTopic: string
  ideaAngle: string
  /** The full generated post body. */
  text: string
  /** ISO timestamp. */
  createdAt: string
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/content/settings.test.ts
import { describe, it, expect } from 'vitest'
import { loadContentSettings, saveContentSettings, DEFAULT_POST_PROMPT } from './settings'
import type { KeyValueStore } from '@lib/ports'

function memStore(): KeyValueStore {
  const m = new Map<string, unknown>()
  return {
    async get<T>(k: string) { return m.has(k) ? (m.get(k) as T) : null },
    async set<T>(k: string, v: T) { m.set(k, v) }
  }
}

describe('content settings', () => {
  it('returns the default prompt when unset', async () => {
    const s = await loadContentSettings(memStore())
    expect(s.postPrompt).toBe(DEFAULT_POST_PROMPT)
  })

  it('round-trips a custom prompt', async () => {
    const store = memStore()
    await saveContentSettings(store, { postPrompt: 'Write like a pirate.' })
    expect((await loadContentSettings(store)).postPrompt).toBe('Write like a pirate.')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/content/settings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// src/lib/content/settings.ts
import type { KeyValueStore } from '../ports'

export const CONTENT_SETTINGS_KEY = 'content:settings'

/** The user's post-generator voice/structure prompt. */
export interface ContentSettings {
  postPrompt: string
}

/** Sensible default so generation works before the user customises it. */
export const DEFAULT_POST_PROMPT = [
  'Write a single LinkedIn post in my voice.',
  'Open with a concrete hook (no "I am excited to share").',
  'Body: one specific insight from my own experience — not generic advice.',
  'Keep it under 1300 characters, short paragraphs, no hashtag spam (0–3 max).',
  'No emojis-as-bullets. End with a question or a takeaway, not a CTA to like/follow.'
].join(' ')

export async function loadContentSettings(store: KeyValueStore): Promise<ContentSettings> {
  const raw = await store.get<ContentSettings>(CONTENT_SETTINGS_KEY)
  return { postPrompt: raw?.postPrompt?.trim() ? raw.postPrompt : DEFAULT_POST_PROMPT }
}

export async function saveContentSettings(store: KeyValueStore, s: ContentSettings): Promise<void> {
  await store.set(CONTENT_SETTINGS_KEY, s)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/content/settings.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/content/settings.ts src/lib/content/settings.test.ts
git commit -m "feat(content): Draft type + content settings (default post prompt)"
```

---

## Task C2: `DraftStore`

**Files:**
- Create: `src/lib/content/DraftStore.ts`
- Test: `src/lib/content/DraftStore.test.ts`

**Interfaces:**
- Consumes: `KeyValueStore`, `Draft`, `asArray` (`@lib/engagement/settings`).
- Produces: `DraftStore` with `add(draft)`, `all()`, `remove(id)`, `update(id, text)`, `clear()`; key `content:drafts`.

- [ ] **Step 1: Write the failing test** (incl. the `asArray` chrome.storage gotcha)

```ts
// src/lib/content/DraftStore.test.ts
import { describe, it, expect } from 'vitest'
import { DraftStore } from './DraftStore'
import type { KeyValueStore } from '@lib/ports'
import type { Draft } from '@lib/types'

function memStore(initial?: Record<string, unknown>): KeyValueStore {
  const m = new Map<string, unknown>(Object.entries(initial ?? {}))
  return {
    async get<T>(k: string) { return m.has(k) ? (m.get(k) as T) : null },
    async set<T>(k: string, v: T) { m.set(k, v) }
  }
}

const d: Draft = { id: '1', ideaTopic: 'T', ideaAngle: 'A', text: 'post', createdAt: '2026-06-25T00:00:00Z' }

describe('DraftStore', () => {
  it('adds and lists drafts', async () => {
    const s = new DraftStore(memStore())
    await s.add(d)
    expect(await s.all()).toEqual([d])
  })

  it('removes by id', async () => {
    const s = new DraftStore(memStore())
    await s.add(d)
    await s.remove('1')
    expect(await s.all()).toEqual([])
  })

  it('updates the text by id', async () => {
    const s = new DraftStore(memStore())
    await s.add(d)
    await s.update('1', 'edited')
    expect((await s.all())[0].text).toBe('edited')
  })

  it('survives chrome.storage serialising the array as an object', async () => {
    // chrome.storage returns {0:..,1:..} for arrays — asArray must rescue it.
    const s = new DraftStore(memStore({ 'content:drafts': { 0: d } }))
    expect(await s.all()).toEqual([d])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content/DraftStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/content/DraftStore.ts
import type { KeyValueStore } from '../ports'
import type { Draft } from '../types'
import { asArray } from '../engagement/settings'

/** Storage key for the generated-post draft queue. */
export const DRAFTS_KEY = 'content:drafts'

/**
 * Persisted queue of generated post drafts (design-spec §4.3). SRP: storage only —
 * generation lives in DraftGenerator. Reads guard the chrome.storage array-as-object
 * gotcha via asArray.
 */
export class DraftStore {
  constructor(private readonly store: KeyValueStore) {}

  async all(): Promise<Draft[]> {
    return asArray<Draft>(await this.store.get<Draft[]>(DRAFTS_KEY))
  }

  async add(draft: Draft): Promise<void> {
    const current = await this.all()
    current.unshift(draft) // newest first
    await this.store.set(DRAFTS_KEY, current)
  }

  async remove(id: string): Promise<void> {
    const next = (await this.all()).filter((d) => d.id !== id)
    await this.store.set(DRAFTS_KEY, next)
  }

  async update(id: string, text: string): Promise<void> {
    const next = (await this.all()).map((d) => (d.id === id ? { ...d, text } : d))
    await this.store.set(DRAFTS_KEY, next)
  }

  async clear(): Promise<void> {
    await this.store.set(DRAFTS_KEY, [])
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content/DraftStore.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/DraftStore.ts src/lib/content/DraftStore.test.ts
git commit -m "feat(content): DraftStore (add/list/remove/update, asArray guard)"
```

---

## Task C3: `DraftGenerator`

**Files:**
- Create: `src/lib/content/DraftGenerator.ts`
- Test: `src/lib/content/DraftGenerator.test.ts`

**Interfaces:**
- Consumes: `LlmProvider` (`@lib/llm/contracts`), `Idea`, `ExpertiseProfile` (`@lib/types`).
- Produces: `DraftGenerator` with `generate(idea: Idea, expertise: ExpertiseProfile, postPrompt: string): Promise<string>`.

- [ ] **Step 1: Write the failing test** (fake provider — asserts prompt content + trimming)

```ts
// src/lib/content/DraftGenerator.test.ts
import { describe, it, expect } from 'vitest'
import { DraftGenerator } from './DraftGenerator'
import type { LlmProvider, LlmRequest, LlmCompletion } from '@lib/llm/contracts'
import type { Idea, ExpertiseProfile } from '@lib/types'

class FakeProvider implements LlmProvider {
  readonly id = 'openrouter' as const
  last?: LlmRequest
  constructor(private readonly text: string) {}
  async complete(req: LlmRequest): Promise<LlmCompletion> {
    this.last = req
    return { text: this.text, model: 'm', provider: this.id }
  }
  async listModels() { return [] }
}

const idea: Idea = { topic: 'tRPC vs REST', angle: 'type-safety from a Vue codebase' }
const expertise: ExpertiseProfile = { headline: 'Frontend TechLead, 11y Vue/TS', stack: ['Vue', 'TS'] }

describe('DraftGenerator', () => {
  it('returns the trimmed post text', async () => {
    const gen = new DraftGenerator(new FakeProvider('  Here is the post.  \n'))
    expect(await gen.generate(idea, expertise, 'Write like an expert.')).toBe('Here is the post.')
  })

  it('feeds the idea, expertise and custom prompt into the request', async () => {
    const provider = new FakeProvider('x')
    await new DraftGenerator(provider).generate(idea, expertise, 'MY_CUSTOM_PROMPT')
    const joined = provider.last!.messages.map((m) => m.content).join('\n')
    expect(joined).toContain('tRPC vs REST')
    expect(joined).toContain('type-safety from a Vue codebase')
    expect(joined).toContain('Frontend TechLead')
    expect(joined).toContain('MY_CUSTOM_PROMPT')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content/DraftGenerator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/content/DraftGenerator.ts
import type { LlmProvider } from '../llm/contracts'
import type { ExpertiseProfile, Idea } from '../types'

/**
 * Turns an idea + the user's custom prompt into a full LinkedIn post draft
 * (design-spec §4.3). Anti-slop: the idea is the user's ORIGINAL angle, the
 * custom prompt carries voice/structure, the expertise grounds it in their
 * experience. Behind LlmProvider → fake-tested.
 */
export class DraftGenerator {
  constructor(private readonly provider: LlmProvider) {}

  async generate(idea: Idea, expertise: ExpertiseProfile, postPrompt: string): Promise<string> {
    const system = [
      'You write LinkedIn posts in the user\'s own voice.',
      `The user is: ${expertise.headline}. Stack: ${expertise.stack.join(', ')}.`,
      expertise.bio ? `Background: ${expertise.bio}.` : '',
      'Write ONE post. Output only the post text — no preamble, no markdown headers, no quotes.',
      'Never sound like generic AI thought-leadership; be specific and grounded in the user\'s experience.'
    ]
      .filter(Boolean)
      .join(' ')

    const user = [
      `Topic: ${idea.topic}`,
      `My angle: ${idea.angle}`,
      '',
      'Author the post following these instructions:',
      postPrompt
    ].join('\n')

    const completion = await this.provider.complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.8,
      maxTokens: 800
    })
    return completion.text.trim()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content/DraftGenerator.test.ts`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/DraftGenerator.ts src/lib/content/DraftGenerator.test.ts
git commit -m "feat(content): DraftGenerator (idea+prompt → post draft)"
```

---

## Task C4: `generateDraft` handler (boundary-tested) + `GENERATE_DRAFT` message

**Files:**
- Modify: `src/service-worker/contentHandlers.ts` (add `generateDraft` + `DraftDeps`)
- Modify: `src/lib/types.ts` (add `GENERATE_DRAFT`)
- Modify: `src/service-worker/index.ts` (wire the switch case)
- Test: `src/service-worker/contentHandlers.test.ts` (add cases) — TDD, crosses the LLM boundary (fake http returns a real-shape completion whose content is the post body).

**Interfaces:**
- Consumes: `DraftGenerator` (C3), `DraftStore` (C2), `loadLlmConfig`, `createLlmProvider`, `loadSettings` (expertise), `loadContentSettings` (C1), `Clock`, `LlmHttp` (A3), `KeyValueStore`, `Idea`, `Draft`.
- Produces: `generateDraft(deps: DraftDeps, idea: Idea): Promise<{ draft: Draft | null; error?: string }>` where `DraftDeps { store: KeyValueStore; http: LlmHttp; clock: Clock; newId: () => string }`; message `{ type: 'GENERATE_DRAFT'; idea: Idea }` → replies `{ draft, error? }`.

- [ ] **Step 1: Write the failing boundary test** (append to `contentHandlers.test.ts`)

```ts
import { generateDraft } from './contentHandlers'
import type { Clock } from '@lib/ports'

const fixedClock: Clock = { now: () => new Date('2026-06-25T00:00:00.000Z') }

describe('generateDraft', () => {
  it('errors no_key when the key is empty', async () => {
    const res = await generateDraft(
      { store: memStore(), http: fakeHttp('x'), clock: fixedClock, newId: () => 'id1' },
      { topic: 'T', angle: 'A' }
    )
    expect(res).toEqual({ draft: null, error: 'no_key' })
  })

  it('generates a post via the LLM and stores the draft', async () => {
    const store = memStore(CONFIGURED)
    const res = await generateDraft(
      { store, http: fakeHttp('My post body.'), clock: fixedClock, newId: () => 'id1' },
      { topic: 'tRPC vs REST', angle: 'type-safety from Vue' }
    )
    expect(res.error).toBeUndefined()
    expect(res.draft).toEqual({
      id: 'id1',
      ideaTopic: 'tRPC vs REST',
      ideaAngle: 'type-safety from Vue',
      text: 'My post body.',
      createdAt: '2026-06-25T00:00:00.000Z'
    })
    expect(await store.get('content:drafts')).toEqual([res.draft])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/service-worker/contentHandlers.test.ts`
Expected: FAIL — `generateDraft` not exported.

- [ ] **Step 3: Implement `generateDraft` in `contentHandlers.ts`**

Add imports at the top:

```ts
import { loadContentSettings } from '@lib/content/settings'
import { DraftGenerator } from '@lib/content/DraftGenerator'
import { DraftStore } from '@lib/content/DraftStore'
import type { Clock } from '@lib/ports'
import type { Draft } from '@lib/types'
```

Append:

```ts
export interface DraftDeps {
  store: KeyValueStore
  http: LlmHttp
  clock: Clock
  newId: () => string
}

/** Idea + custom prompt → post draft (LLM) → store. Returns the new draft. */
export async function generateDraft(
  deps: DraftDeps,
  idea: Idea
): Promise<{ draft: Draft | null; error?: string }> {
  const cfg = await loadLlmConfig(deps.store)
  if (!cfg.apiKey.trim()) return { draft: null, error: 'no_key' }
  const { expertise } = await loadSettings(deps.store)
  const { postPrompt } = await loadContentSettings(deps.store)
  const provider = createLlmProvider({ provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model }, deps.http)
  try {
    const text = await new DraftGenerator(provider).generate(idea, expertise, postPrompt)
    const draft: Draft = {
      id: deps.newId(),
      ideaTopic: idea.topic,
      ideaAngle: idea.angle,
      text,
      createdAt: deps.clock.now().toISOString()
    }
    await new DraftStore(deps.store).add(draft)
    return { draft }
  } catch (e) {
    return { draft: null, error: e instanceof Error ? e.message : 'llm_failed' }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/service-worker/contentHandlers.test.ts`
Expected: PASS (6 total).

- [ ] **Step 5: Extend the message union**

In `src/lib/types.ts`:

```ts
  /** sidepanel → SW: idea + prompt → post draft; replies { draft, error? }. */
  | { type: 'GENERATE_DRAFT'; idea: Idea }
```

- [ ] **Step 6: Wire the switch case**

In `src/service-worker/index.ts` add the case (`content`, `llmHttp`, `store`, `clock`, `randomId` all already exist):

```ts
    case 'GENERATE_DRAFT':
      void content.generateDraft({ store, http: llmHttp, clock, newId: randomId }, message.idea).then(sendResponse)
      return true
```

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/service-worker/contentHandlers.ts src/service-worker/contentHandlers.test.ts src/service-worker/index.ts
git commit -m "feat(content): generateDraft handler (boundary-tested) + GENERATE_DRAFT"
```

---

## Task C5: Settings — post-prompt section (final wiring)

**Files:**
- Create: `src/sidepanel/composables/useContentSettings.ts`
- Modify: `src/sidepanel/screens/SettingsScreen.vue` (prompt section + include in save)
- Test: `src/sidepanel/composables/useContentSettings.spec.ts`

**Interfaces:**
- Consumes: `loadContentSettings`, `saveContentSettings`, `DEFAULT_POST_PROMPT` (C1).
- Produces: `useContentSettings()` → `{ prompt, load, save }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/sidepanel/composables/useContentSettings.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useContentSettings } from './useContentSettings'
import { DEFAULT_POST_PROMPT } from '@lib/content/settings'

const mem = new Map<string, unknown>()
beforeEach(() => {
  mem.clear()
  ;(globalThis as any).chrome = {
    runtime: { id: 'x' },
    storage: {
      local: {
        get: vi.fn(async (k: string) => ({ [k]: mem.get(k) })),
        set: vi.fn(async (o: Record<string, unknown>) => { for (const k in o) mem.set(k, o[k]) })
      }
    }
  }
})

describe('useContentSettings', () => {
  it('loads the default prompt, saves a custom one', async () => {
    const s = useContentSettings()
    await s.load()
    expect(s.prompt.value).toBe(DEFAULT_POST_PROMPT)
    s.prompt.value = 'Custom voice.'
    await s.save()
    expect((mem.get('content:settings') as any).postPrompt).toBe('Custom voice.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sidepanel/composables/useContentSettings.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/sidepanel/composables/useContentSettings.ts
import { ref } from 'vue'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { loadContentSettings, saveContentSettings } from '@lib/content/settings'

/** Settings-screen state for the post-generator prompt. */
export function useContentSettings() {
  const store = new ChromeStorageStore()
  const prompt = ref('')

  async function load() {
    prompt.value = (await loadContentSettings(store)).postPrompt
  }

  async function save() {
    await saveContentSettings(store, { postPrompt: prompt.value })
  }

  return { prompt, load, save }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sidepanel/composables/useContentSettings.spec.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `SettingsScreen.vue`**

In `<script setup>` add:

```ts
import { useContentSettings } from '../composables/useContentSettings'
const content = useContentSettings()
onMounted(content.load)
```

Extend `onSave`:

```ts
async function onSave() {
  await save()
  await exp.save()
  await content.save()
}
```

In the template before the final Save button:

```vue
    <div class="sect-lbl">Промпт генератора постов</div>
    <label class="fld">
      <span class="k">Голос / структура (используется при «В черновик»)</span>
      <textarea v-model="content.prompt.value" rows="6" data-testid="post-prompt" />
    </label>
```

- [ ] **Step 6: Full validation**

Run: `npx vitest run && npm run build`
Expected: ALL green, build clean.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/
git commit -m "feat(sidepanel): Settings — post-generator prompt section"
```

**Checkpoint C done when:** `npm test` fully green, build clean, and live: an idea → «В черновик» produces a readable post in the Drafts sub-tab; edit/copy/regenerate/delete all work; the custom prompt changes the output.

---

# Self-Review

**Spec coverage:**
- BYOK config (local-only) → A1 ✓
- `listModels` both providers + fallback → A2 ✓
- `LIST_MODELS` SW + host_permissions → A3 ✓
- Settings LLM section (provider/key/searchable model) → A4 ✓
- Expertise RMW (no clobber) → B1 ✓ + Settings section B5 ✓
- Feed signal via `REQUEST_FEED_POSTS` + map → B2/B3 ✓
- Ideas screen (generate/list/remove/to-draft) → B4 ✓
- `IdeaBank.remove` → B2 ✓
- `DraftGenerator` → C3 ✓
- `DraftStore` (asArray guard) → C2 ✓
- `content:settings` + default prompt → C1 ✓ + Settings section C5 ✓
- `GENERATE_DRAFT` SW → C4 ✓
- Drafts sub-tab (edit/copy/regenerate/delete) → B4 (template) ✓
- Nav: gear → v-settings, 6th «Контент» tab, sub-tabs → A4 + B4 ✓
- Contract tests before code → every core task ✓

**Type consistency:** `LlmConfig`/`LlmModel`/`Draft`/`ExpertiseForm` names are identical across producer and consumer tasks. `useContent` consumes `DraftStore.update(id,text)`/`remove(id)`/`all()` exactly as defined in C2. SW `generateIdeas`/`generateDraft` reply shapes match the composable's `panelBus.request<...>` generics.

**Placeholder scan:** none — every code step contains real code; every run step has an exact command + expected result.

**Cross-task dependency flagged:** `useContent` (B4) imports `DraftStore`/`Draft` (C1/C2). Execution order note added at the top of Checkpoint C: A → C1–C4 → B1–B5 → C5.

# Out of scope (Layer 2 / later)

Auto-publish via composer DOM adapter, manual idea entry without the feed, post scheduling, full-auto posting.
