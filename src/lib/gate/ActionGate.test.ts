import { describe, it, expect } from 'vitest'
import { ActionGate } from './ActionGate'
import type { ActionRequest, Guardrails } from '@lib/types'

const guardrails: Guardrails = {
  minConfidence: 0.6,
  bannedPhrases: [],
  quarantineMinutes: 10,
  lenRange: [12, 280]
}

const like: ActionRequest = { type: 'like', target: { url: 'https://x/post/1' } }
const comment: ActionRequest = {
  type: 'comment',
  target: { url: 'https://x/post/1' },
  payload: { comment: 'A specific, sufficiently long expert comment here.' }
}
const okVerdict = { ok: true, reasons: [] }
const failVerdict = { ok: false, reasons: ['too_short'] }

describe('ActionGate', () => {
  const gate = new ActionGate()

  it('skips any action when the budget is exhausted', () => {
    const d = gate.decide({ action: like, level: 'full_auto', guardrails, budgetOk: false })
    expect(d.outcome).toBe('skip')
    expect(d.reasons).toContain('budget_exhausted')
  })

  it('queues everything in manual mode (await approval)', () => {
    expect(gate.decide({ action: like, level: 'manual', guardrails, budgetOk: true }).outcome).toBe('queue')
    expect(gate.decide({ action: comment, level: 'manual', guardrails, budgetOk: true }).outcome).toBe('queue')
  })

  it('executes immediately in full_auto mode', () => {
    expect(gate.decide({ action: like, level: 'full_auto', guardrails, budgetOk: true }).outcome).toBe('execute')
    expect(gate.decide({ action: comment, level: 'full_auto', guardrails, budgetOk: true }).outcome).toBe('execute')
  })

  it('executes a low-risk like directly under guardrails (reversible)', () => {
    const d = gate.decide({ action: like, level: 'auto_guardrails', guardrails, budgetOk: true })
    expect(d.outcome).toBe('execute')
  })

  it('quarantines a judged-ok comment under guardrails with the cancel window', () => {
    const d = gate.decide({
      action: comment,
      level: 'auto_guardrails',
      guardrails,
      budgetOk: true,
      judge: okVerdict
    })
    expect(d.outcome).toBe('quarantine')
    expect(d.quarantineMinutes).toBe(10)
  })

  it('executes (no wait) when guardrails quarantine window is 0', () => {
    const d = gate.decide({
      action: comment,
      level: 'auto_guardrails',
      guardrails: { ...guardrails, quarantineMinutes: 0 },
      budgetOk: true,
      judge: okVerdict
    })
    expect(d.outcome).toBe('execute')
  })

  it('blocks a comment whose judge verdict failed', () => {
    const d = gate.decide({
      action: comment,
      level: 'auto_guardrails',
      guardrails,
      budgetOk: true,
      judge: failVerdict
    })
    expect(d.outcome).toBe('block')
    expect(d.reasons).toContain('too_short')
  })

  it('blocks a content action under guardrails when no judge verdict is supplied', () => {
    const d = gate.decide({ action: comment, level: 'auto_guardrails', guardrails, budgetOk: true })
    expect(d.outcome).toBe('block')
    expect(d.reasons).toContain('no_judgement')
  })
})
