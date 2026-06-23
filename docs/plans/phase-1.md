# Phase 1 — MVP (executable plan)

> Source of truth: design-spec → https://artifacts.kanev.space/beacon-design-spec/ (v0.4)
> Design reference (pixel-target): docs/design-reference.html (= demo artifact, copied verbatim)
> Methodology: Spec → Plan → TDD. Tests precede implementation. SOLID throughout.

## Scope of Phase 1

In:
- MV3 skeleton: sidepanel (Vue 3) + service worker + content script, wired by messaging.
- **SSI engine**: parse `/sales/ssi`, normalise to `SsiSnapshot`, surface in the SSI screen.
- **Engagement module in `manual` mode only**: harvest feed items (read-only), no auto-actions yet.
- UI: 1:1 reproduction of the demo (4 screens, bottom nav, design tokens).
- Storage layer (chrome.storage abstraction) + typed messaging.

Out (later phases):
- Smart Connect / Content autopilot / Auto-apply execution.
- `auto_guardrails` / `full_auto` automation levels (only the data model lands now).
- Dedicated worker-window orchestration (design only).
- LLM providers wiring (interfaces land; calls are stubbed/mocked in tests).

## SOLID contract (how we keep it honest)

- **SRP** — one reason to change per unit. Parsing ≠ storage ≠ messaging ≠ rendering.
- **OCP** — SSI parsing and LLM providers are **strategy sets**: add a class, don't edit a switch.
- **LSP** — every `SsiParseStrategy` / `LlmProvider` is fully substitutable; orchestrators never type-check concretes.
- **ISP** — narrow ports: `SsiSource`, `KeyValueStore`, `Clock`. No god-interfaces.
- **DIP** — core logic depends on abstractions injected at the edges; `document`/`chrome.*` only touched in thin adapters.

## Architecture layers

```
adapters (impure, untested-by-unit)      core (pure, 100% unit-tested)
─────────────────────────────────        ──────────────────────────────
DomSsiSource (reads document)      ──►    SsiParser (strategies[])
ChromeStorageStore (chrome.storage)──►    SsiRepository
ChromeRuntimeBus (chrome.runtime)  ──►    (message contracts in types.ts)
SystemClock (Date.now)             ──►    parse-helpers (pure fns)
```

Dependency rule: arrows point inward. Core never imports `chrome` or touches globals.

## Build order (each step = red→green→refactor)

1. `lib/ssi/parse-helpers.ts` — `parseScore`, `clampPillar(0..25)`, `normaliseRank`, `sumPillars`. Pure. **Tests first.**
2. `lib/ssi/SsiParser.ts` + `SsiParseStrategy` port — orchestrates strategies, returns first non-null. **Tests with HTML fixtures.**
3. `lib/ssi/strategies/DomSelectorStrategy.ts` + `TextScanStrategy.ts` (fallback). **Tests against fixtures/ssi-page.html.**
4. `lib/ports.ts` — `SsiSource`, `KeyValueStore`, `Clock` interfaces.
5. `lib/storage/SsiRepository.ts` — persist/read latest + history. **Tests with in-memory fake store.**
6. Adapters: `adapters/DomSsiSource.ts`, `adapters/ChromeStorageStore.ts`, `adapters/SystemClock.ts` (thin, no unit tests — covered by manual/integration).
7. `service-worker/index.ts` — message router: on `REQUEST_SSI` → ask content script → persist → broadcast `SSI_SNAPSHOT`.
8. `content/index.ts` — on demand, run `SsiParser` over `document`, reply.
9. `sidepanel/` — Vue app, 4 screens 1:1 with demo, reads snapshot via bus.

## Test plan (Phase 1 acceptance)

- `parse-helpers.test.ts` — number parsing edge cases ("23,4", "Top 4%", missing, garbage, clamp >25/<0).
- `SsiParser.test.ts` — strategy fallthrough (primary null → fallback runs); total = Σpillars; capturedAt set via injected Clock.
- `strategies/*.test.ts` — extract from realistic fixture; resilient to whitespace/locale.
- `SsiRepository.test.ts` — save→load roundtrip; history capped; latest wins.
- `sidepanel/*.spec.ts` — renders 4 screens, bottom-nav switches, SSI gauge shows parsed total.

Green bar (`npm test`) is the gate before any "done" claim.

## Open items carried (non-blocking)

- Q4 connect/note weekly limits → feeds anti-ban config in Phase 2.
- Live `/sales/ssi` DOM capture → confirm selectors in `DomSelectorStrategy` (fixture is synthetic until then).
