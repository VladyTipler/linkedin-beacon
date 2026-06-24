import { assertNever, type ActionQueueItem, type ActionRequest, type ActionType, type AutomationLevel, type Guardrails } from '../types'
import type { Clock, KeyValueStore } from '../ports'
import { ActionGate } from '../gate/ActionGate'
import { QuarantineQueue } from '../gate/QuarantineQueue'
import { CommentJudge, type JudgeVerdict } from './CommentJudge'
import { DailyBudget, type DailyBudgetState } from './DailyBudget'

/** Performs a decided action in the page (implemented by content-script DOM adapters). */
export interface ActionExecutor {
  execute(action: ActionRequest): Promise<void>
}

export interface EngagementConfig {
  level: AutomationLevel
  guardrails: Guardrails
  /** Per-action-type daily caps (design-spec §5.2: daily.engage / daily.comments). */
  dailyLimits: Record<ActionType, number>
}

export type SubmitOutcome =
  | { status: 'executed' }
  | { status: 'queued'; id: string }
  | { status: 'quarantined'; id: string }
  | { status: 'blocked'; reasons: string[] }
  | { status: 'skipped'; reasons: string[] }

export const PENDING_KEY = 'engagement:pending'
const budgetKey = (type: ActionType): string => `engagement:budget:${type}`

export interface OrchestratorDeps {
  gate: ActionGate
  judge: CommentJudge
  quarantine: QuarantineQueue
  store: KeyValueStore
  clock: Clock
  executor: ActionExecutor
  newId: () => string
}

/**
 * Routes every engagement action through the safety pipeline (design-spec §5):
 * daily budget → comment judge → ActionGate decision → manual queue / quarantine
 * / execute. This is the single path actions take; nothing reaches the page
 * without passing here. Pure orchestration over injected collaborators, so the
 * whole bridge is tested on fakes.
 */
export class EngagementOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async submit(action: ActionRequest, config: EngagementConfig): Promise<SubmitOutcome> {
    const now = this.deps.clock.now()
    const budgetState = await this.budgetState(action.type)
    const budgetOk = this.budget(action, config).canSpend(budgetState, now)

    const decision = this.deps.gate.decide({
      action,
      level: config.level,
      guardrails: config.guardrails,
      budgetOk,
      judge: this.judgeIfContent(action, config.guardrails)
    })

    switch (decision.outcome) {
      case 'skip':
        return { status: 'skipped', reasons: decision.reasons }
      case 'block':
        return { status: 'blocked', reasons: decision.reasons }
      case 'queue':
        return { status: 'queued', id: await this.addPending(action, now) }
      case 'quarantine': {
        const minutes = decision.quarantineMinutes ?? config.guardrails.quarantineMinutes
        const item = await this.deps.quarantine.enqueue(action, minutes)
        return { status: 'quarantined', id: item.id }
      }
      case 'execute':
        await this.deps.executor.execute(action)
        await this.spend(action.type, budgetState, now)
        return { status: 'executed' }
      default:
        return assertNever(decision.outcome)
    }
  }

  /** Approve a manually-queued action: execute it now and drop it from the queue. */
  async approve(id: string): Promise<SubmitOutcome> {
    const pending = await this.pending()
    const item = pending.find((i) => i.id === id)
    if (!item) return { status: 'skipped', reasons: ['not_found'] }
    await this.deps.executor.execute(item)
    await this.spend(item.type, await this.budgetState(item.type), this.deps.clock.now())
    await this.savePending(pending.filter((i) => i.id !== id))
    return { status: 'executed' }
  }

  /** Send any quarantined actions whose cancel window has elapsed. Returns the count. */
  async releaseDue(): Promise<number> {
    const due = await this.deps.quarantine.due()
    for (const item of due) {
      await this.deps.executor.execute(item)
      await this.spend(item.type, await this.budgetState(item.type), this.deps.clock.now())
      await this.deps.quarantine.markSent(item.id)
    }
    return due.length
  }

  async pending(): Promise<ActionQueueItem[]> {
    const stored = await this.deps.store.get<ActionQueueItem[]>(PENDING_KEY)
    return Array.isArray(stored) ? stored : []
  }

  private judgeIfContent(action: ActionRequest, guardrails: Guardrails): JudgeVerdict | undefined {
    if (action.type !== 'comment' && action.type !== 'post') return undefined
    const text = action.payload?.comment ?? action.payload?.note ?? ''
    return this.deps.judge.judge(text, guardrails)
  }

  private budget(action: ActionRequest, config: EngagementConfig): DailyBudget {
    return new DailyBudget(config.dailyLimits[action.type] ?? 0)
  }

  private async budgetState(type: ActionType): Promise<DailyBudgetState | null> {
    return this.deps.store.get<DailyBudgetState>(budgetKey(type))
  }

  private async spend(type: ActionType, state: DailyBudgetState | null, now: Date): Promise<void> {
    // The limit is irrelevant to spend() (it just increments with day rollover).
    const next = new DailyBudget(0).spend(state, now)
    await this.deps.store.set(budgetKey(type), next)
  }

  private async addPending(action: ActionRequest, now: Date): Promise<string> {
    const item: ActionQueueItem = {
      ...action,
      id: this.deps.newId(),
      status: 'pending',
      createdAt: now.toISOString()
    }
    const pending = await this.pending()
    pending.push(item)
    await this.savePending(pending)
    return item.id
  }

  private async savePending(items: ActionQueueItem[]): Promise<void> {
    await this.deps.store.set(PENDING_KEY, items)
  }
}
