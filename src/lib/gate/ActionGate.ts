import { assertNever, type ActionRequest, type AutomationLevel, type Guardrails } from '../types'
import type { JudgeVerdict } from '../engagement/CommentJudge'

/** What the gate decided should happen to an action (the SW executes it). */
export type GateOutcome = 'queue' | 'quarantine' | 'execute' | 'block' | 'skip'

export interface GateDecision {
  outcome: GateOutcome
  /** Violation/skip codes; empty for queue/execute/quarantine. */
  reasons: string[]
  /** Cancel-window length when outcome is 'quarantine'. */
  quarantineMinutes?: number
}

export interface GateInput {
  action: ActionRequest
  level: AutomationLevel
  guardrails: Guardrails
  /** Whether the daily budget still allows this action (caller computes it). */
  budgetOk: boolean
  /** Judge verdict for content actions under guardrails (caller runs CommentJudge). */
  judge?: JudgeVerdict
}

/**
 * The single decision point every action passes through (design-spec §5, §5.5).
 * Pure: it decides, it does not execute, fetch, or touch chrome. The invariant is
 * that NO action reaches the page without a decision here.
 *
 *   budget exhausted        → skip
 *   manual                  → queue (await approval)
 *   full_auto               → execute
 *   auto_guardrails · like  → execute (low-risk, reversible)
 *   auto_guardrails · text  → judge → quarantine (cancel window) | execute (window 0) | block
 *
 * OCP: Phase 3 adds work-hours / risk-score guards by composing more checks
 * before the level switch, without rewriting these branches.
 */
export class ActionGate {
  decide(input: GateInput): GateDecision {
    if (!input.budgetOk) return { outcome: 'skip', reasons: ['budget_exhausted'] }

    switch (input.level) {
      case 'manual':
        return { outcome: 'queue', reasons: [] }
      case 'full_auto':
        return { outcome: 'execute', reasons: [] }
      case 'auto_guardrails':
        return this.decideGuardrails(input)
      default:
        return assertNever(input.level)
    }
  }

  private decideGuardrails(input: GateInput): GateDecision {
    // Low-risk reversible actions (likes) act within budget, no cancel window.
    if (!requiresJudge(input.action)) return { outcome: 'execute', reasons: [] }

    if (!input.judge) return { outcome: 'block', reasons: ['no_judgement'] }
    if (!input.judge.ok) return { outcome: 'block', reasons: input.judge.reasons }

    const minutes = input.guardrails.quarantineMinutes
    return minutes > 0
      ? { outcome: 'quarantine', reasons: [], quarantineMinutes: minutes }
      : { outcome: 'execute', reasons: [] }
  }
}

/** Content actions carry public, hard-to-reverse text → they must be judged. */
function requiresJudge(action: ActionRequest): boolean {
  return action.type === 'comment' || action.type === 'post'
}
