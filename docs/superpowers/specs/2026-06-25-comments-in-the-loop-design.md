# Comments-in-the-Loop — Design Spec (DRAFT — needs Vlad's review)

**Date:** 2026-06-25 (written autonomously while Vlad was away)
**Status:** DRAFT. **Not approved. Not started.** Conservative defaults proposed; the
open questions in §8 are genuine product/safety forks I should NOT decide solo because
**comments are irreversible public actions on Vlad's real account.** Read §8 first.

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

## 6. Conservative defaults I'd propose (Vlad overrides in §8)

- Module **disabled** by default; automation level **manual** (queue for approval).
- Comments/day: **3** (well under likes; anti-ban + quality over volume).
- Tone: **expert**. Candidate set: top **3–5** relevance posts per run that also pass a higher
  relevance threshold than likes.
- Comment also implies a like on the same post (commenting without liking looks odd).

## 7. Testing (TDD, boundary rule)

- Pure: candidate selection (relevance threshold + cap); the gate/judge already tested.
- **Boundary:** `COMMENT_ON_POST` SW handler test crossing the real OpenRouter mapper (fake
  HttpClient → real CommentDraftService → real comment text), asserting the gate outcome for
  each level (manual→queue, guardrails→quarantine, budget-exhausted→skip).
- Round-trip: enqueue → due() → markSent execution path.
- The DOM `executeComment` is verified by build + live CDP (Vlad), not unit.

## 8. OPEN QUESTIONS FOR VLAD (decide before implementation — these are yours, not mine)

1. **Default approval model (THE decision):** comments default to **manual review-queue**
   (you approve each before it sends — safest, more friction) OR **guardrails-quarantine**
   (auto-sends after a cancel window unless you cancel — less friction, more risk)? I propose
   manual. Full-auto stays an explicit opt-in either way.
2. **Candidate selection:** which posts get a comment — top-N by relevance? a higher threshold
   than likes? recruiter/ICP-authored only? How narrow?
3. **Comments/day cap** (anti-ban + quality). I propose 3. Your number?
4. **Tone:** fixed default (expert/friendly/question) or a per-run/per-module setting?
5. **Module shape:** separate «Комментарии» module card, or a second control under the existing
   «Вовлечённость» card (likes + comments together, since both engage the feed)?
6. **Approval surface:** where do pending/quarantined comments live for review — the Safety
   screen (next to quarantine), the Inbox, or a new one?
7. **Like+comment coupling:** comment also likes the same post (proposed), or comment-only?

## 9. Why this stopped at a spec (not implemented)

Comments POST PUBLICLY on your real LinkedIn — irreversible. Brainstorming a risky feature and
shipping its posting behavior solo would violate the project's safety-first / human-in-the-loop
rule. The code is well-scoped (the cubes exist), so once you answer §8 this is a fast
spec→plan→TDD execution like ideas-in-the-loop. **Awaiting your review of §8.**
