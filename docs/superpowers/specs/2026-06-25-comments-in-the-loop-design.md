# Comments-in-the-Loop — Design Spec

**Date:** 2026-06-25
**Status:** APPROVED direction (Vlad: "комменты — полностью автоматизировать; не такой
критичный момент, но SSI должен поднимать"). Implementing autonomously. One UI-placement
item still needs his confirmation (§8 Q5 — the demo has no standalone comments card).

## 0. Vlad's decision (2026-06-25)

**Full-auto comments** — no manual approval queue. Implemented SAFELY as **`auto_guardrails`
with `quarantineMinutes: 0`**: a generated comment is **always quality-judged**
(`CommentJudge`: length / banned phrases / no-slop) and, if it passes, **posts immediately
with no human step**; if it fails, it's dropped (never posted). This is "full auto" that still
protects the brand the feature exists to grow. Honest `full_auto` (skip the judge) and a
non-zero cancel window remain opt-in for later. Module **disabled by default**; conservative
comments/day + anti-ban pacing + the RiskAssessor kill-switch all still apply.

## 1. Problem & scope

The north-star engagement ladder is **likes → comments → recruiter connects → content.**
Likes ship and run in the autopilot loop. **Comments are the next rung** — and the LLM/gate
cubes are already BUILT and unit-tested, but **not wired into the live loop:**

- `CommentDraftService.draft({post, expertise, tone})` → anti-slop comment text (LLM). ✅ built, tested, **unused**.
- `CommentJudge.judge(comment, guardrails, confidence)` → `{ok, reasons[]}` (length / banned / confidence). ✅ built, tested, **unused**.
- `ActionGate.decide({action, level, guardrails, budgetOk, judge})` → `queue | quarantine | execute | block | skip`. ✅ built, tested. Already routes text actions: manual→queue, guardrails→judge→quarantine/execute/block, full_auto→execute.
- `QuarantineQueue` (enqueue w/ cancel window via alarms, `due()`, `markSent()`). ✅ built, tested.
- `executeComment(document, urn, text, delay)` (ProseMirror `execCommand`, validated live). ✅ built.
- `EngagementOrchestrator` already chains budget → judge → gate → queue/quarantine/execute — but it's the **orphaned one-shot path** (the removed `RUN_ENGAGEMENT` campaign). The live loop uses `AutopilotGatekeeper` (budget/risk/pacing) for **likes only**.

**So Phase C = wire the existing comment cubes into the autopilot loop (`runAutopilotLoop`)
safely**, add a comment module to «Модули», and route every comment through the gate +
quarantine. **The hard part is not code — it's the safety/approval model (§5, §8).**

**In scope:** comment generation + judge + gate/quarantine wired into the run; comment module
(disabled by default) with a comments/day limit + automation level; a place to review/approve
pending comments.
**Out of scope:** Smart Connect, content publishing (Layer 2), changing the like path.

## 2. North-star + the irreversibility constraint

- Comments ride **THE one run** (no second launch), gated by their own «Модули» toggle +
  comments/day limit — same one-button principle as ideas-in-the-loop.
- **But a comment is irreversible and public.** Project invariant: "likes broad (cheap/
  reversible); **comments narrow + judged**; posts approve-first (never full-auto by default)."
  So: comments target a NARROW, high-relevance subset (not every liked post), every comment is
  judged, and the **default automation level must NOT auto-post** (see §8 Q1).

## 3. Proposed architecture (reuse the cubes; minimal new code)

```
runAutopilotLoop (content): for a harvested post in the NARROW comment-candidate set
  → ask SW: COMMENT_ON_POST { post }                         (LLM lives in SW)
SW COMMENT_ON_POST:
  budget(comments/day) ok? → CommentDraftService.draft(post, expertise, tone)
  → CommentJudge.judge(text, guardrails)                     (if guardrails level)
  → ActionGate.decide({action:'comment', level, guardrails, budgetOk, judge})
     manual     → enqueue to a review queue → reply {outcome:'queue'}      (Vlad approves later)
     guardrails → QuarantineQueue.enqueue(cancel window) → reply {outcome:'quarantine'}
     full_auto  → reply {outcome:'execute', text}  → content executeComment (NOT default)
Approved/elapsed comments → SW tells content to executeComment(urn, text)
```

- **Candidate selection:** comments go to the top-relevance posts only (reuse `RelevanceScorer`
  — likes already sort by it). A small per-run cap (§8 Q2/Q3).
- **Execution boundary:** `executeComment` is in content (DOM). For queue/quarantine the comment
  is NOT sent immediately — the SW holds it and later messages content to execute (needs the
  feed tab alive; same constraint as the loop). Approval UI lives in the panel.
- **New messages:** `COMMENT_ON_POST {post}` (content→SW), and an execute path for
  approved/elapsed comments (reuse `EXECUTE_ACTION` which already exists for gated actions).
- **Reuse, not rebuild:** CommentDraftService / CommentJudge / ActionGate / QuarantineQueue /
  executeComment all exist. New code ≈ the SW handler + loop candidate-selection + module config
  + approval surface.

## 4. «Модули» — comment module

`comment` (or reuse `engagement`'s comment sub-setting?) → toggle (default **off**) + limit
«Комментов/день» (conservative default, §8 Q3) + automation level (§8 Q1). «Скоро» until built.
(Open: is commenting a separate module card, or a second control under the existing
«Вовлечённость» card alongside likes? — §8 Q5.)

## 5. Safety model (the point)

- **Module off by default** — nothing happens until Vlad enables it.
- **Never full_auto by default** — default level routes comments to a **review queue** (manual)
  or a **quarantine cancel-window** (guardrails). Full-auto is an explicit opt-in.
- **Every comment judged** (length/banned/confidence) before it can send.
- **Narrow targeting** — only top-relevance posts, small daily cap (anti-ban + quality).
- **Approval surface** — pending/quarantined comments visible in the panel (Safety/Inbox screen)
  with approve/cancel, before anything sends.

## 6. Resolved defaults (Vlad's full-auto decision + sensible, tunable values)

- Comments **disabled by default**; when enabled, level = `auto_guardrails` + `quarantineMinutes: 0`
  (auto-post judged comments, no human step) — per §0.
- **Comments/day: 5** (well under likes; anti-ban + quality over volume). Tunable.
- **Tone: expert** (a Settings control, like the post-prompt).
- **Candidate set:** the top relevance posts per run that pass a STRICTER threshold than likes
  (comments are narrow + judged); small per-run cap. Reuse `RelevanceScorer`.
- **Comment implies a like** on the same post (commenting without liking looks unnatural).
- **Config location (interim):** comment toggle + comments/day + tone live in the **Settings
  screen** next to the BYOK LLM key (comments need it), NOT a new «Модули» card — the demo has
  no comments card, and the эталон is authoritative (§8 Q5 to confirm).

## 7. Testing (TDD, boundary rule)

- Pure: candidate selection (relevance threshold + cap); the gate/judge already tested.
- **Boundary:** `COMMENT_ON_POST` SW handler test crossing the real OpenRouter mapper (fake
  HttpClient → real CommentDraftService → real comment text), asserting the gate outcome for
  each level (manual→queue, guardrails→quarantine, budget-exhausted→skip).
- Round-trip: enqueue → due() → markSent execution path.
- The DOM `executeComment` is verified by build + live CDP (Vlad), not unit.

## 8. Questions — status after Vlad's answer

1. ✅ **Approval model:** DECIDED — full-auto (= guardrails@0min, judged). §0.
2. ✅ **Candidate selection:** top relevance posts above a stricter-than-likes threshold, small
   per-run cap (defaulted; tunable later).
3. ✅ **Comments/day:** default 5 (tunable).
4. ✅ **Tone:** expert default, a Settings control.
5. ⚠️ **STILL NEEDS VLAD — UI placement:** comment config goes in **Settings** for now (no demo
   «Комментарии» card; эталон authoritative). Confirm, or fold a comments control into the
   «Вовлечённость» «Модули» card (would need the demo/эталон updated first).
6. ✅ **Surface:** with full-auto there's no approval queue; posted comments are logged in the
   run report (reuse `RunReport`).
7. ✅ **Like+comment coupling:** comment also likes the same post.

## 9. Implementation note

The cubes exist; this is a wiring + Settings-config + TDD job like ideas-in-the-loop. The only
unresolved item (Q5) is cosmetic placement and doesn't block the core (which is config-location-
agnostic). Auto-posting only fires when Vlad enables comments (off by default) + has a key +
runs — so building it is safe; live verification is his field-test.
