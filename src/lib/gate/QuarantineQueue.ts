import type { AlarmScheduler, Clock, KeyValueStore } from '../ports'
import type { ActionQueueItem, ActionRequest } from '../types'

/** Storage key for the persisted quarantine queue. */
export const QUARANTINE_KEY = 'engagement:quarantine'
const ALARM_PREFIX = 'beacon:quarantine:'

export interface QuarantineDeps {
  store: KeyValueStore
  clock: Clock
  scheduler: AlarmScheduler
  /** Unique id source for queued items (injected for deterministic tests). */
  newId: () => string
}

/**
 * Delayed-send queue with a cancel window (design-spec §5.5 auto_guardrails):
 * a judged-ok action waits N minutes before sending; the user can cancel it in
 * that window. Backed by chrome.storage + chrome.alarms (via ports) so it
 * survives service-worker eviction — the alarm wakes the SW, not a JS timer.
 *
 * SRP: queue bookkeeping only. It does not decide (ActionGate does) nor execute
 * (the content script does) — `due()` hands ready items to the SW orchestrator.
 */
export class QuarantineQueue {
  constructor(private readonly deps: QuarantineDeps) {}

  /** Quarantine an action for `minutes`; returns the persisted item. */
  async enqueue(action: ActionRequest, minutes: number): Promise<ActionQueueItem> {
    const now = this.deps.clock.now()
    const sendAtMs = now.getTime() + minutes * 60_000
    const item: ActionQueueItem = {
      ...action,
      id: this.deps.newId(),
      status: 'quarantined',
      scheduledFor: new Date(sendAtMs).toISOString(),
      createdAt: now.toISOString()
    }
    const queue = await this.load()
    queue.push(item)
    await this.save(queue)
    this.deps.scheduler.schedule(ALARM_PREFIX + item.id, sendAtMs)
    return item
  }

  /** Cancel a still-quarantined action within its window. */
  async cancel(id: string): Promise<boolean> {
    const queue = await this.load()
    const item = queue.find((i) => i.id === id && i.status === 'quarantined')
    if (!item) return false
    item.status = 'skipped'
    await this.save(queue)
    this.deps.scheduler.clear(ALARM_PREFIX + id)
    return true
  }

  /** Quarantined items whose cancel window has elapsed and are ready to send. */
  async due(): Promise<ActionQueueItem[]> {
    const nowMs = this.deps.clock.now().getTime()
    const queue = await this.load()
    return queue.filter(
      (i) =>
        i.status === 'quarantined' &&
        i.scheduledFor !== undefined &&
        Date.parse(i.scheduledFor) <= nowMs
    )
  }

  /** Mark an item as sent (after the content script executed it). */
  async markSent(id: string): Promise<void> {
    const queue = await this.load()
    const item = queue.find((i) => i.id === id)
    if (item) item.status = 'done'
    await this.save(queue)
  }

  /** Full queue (for the UI quarantine panel). */
  list(): Promise<ActionQueueItem[]> {
    return this.load()
  }

  private async load(): Promise<ActionQueueItem[]> {
    return (await this.deps.store.get<ActionQueueItem[]>(QUARANTINE_KEY)) ?? []
  }

  private async save(queue: ActionQueueItem[]): Promise<void> {
    await this.deps.store.set(QUARANTINE_KEY, queue)
  }
}
