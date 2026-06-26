import { describe, it, expect } from 'vitest'
import {
  rolloverConnectWeek, recordConnectWeek, remainingConnects,
  connectsPerWeek, connectRunCap, DEFAULT_CONNECTS_PER_WEEK
} from './ConnectWeekBudget'
import type { Rng } from '../ports'

const rng = (v: number): Rng => ({ next: () => v })

describe('ConnectWeekBudget', () => {
  it('rolls over: same week keeps used, new week resets', () => {
    const a = rolloverConnectWeek({ week: '2026-W26', used: 5 }, '2026-W26')
    expect(a.used).toBe(5)
    const b = rolloverConnectWeek({ week: '2026-W26', used: 5 }, '2026-W27')
    expect(b).toEqual({ week: '2026-W27', used: 0 })
  })

  it('records and computes remaining (never negative)', () => {
    const s = recordConnectWeek({ week: 'w', used: 0 }, 3)
    expect(s.used).toBe(3)
    expect(remainingConnects(s, 100)).toBe(97)
    expect(remainingConnects({ week: 'w', used: 120 }, 100)).toBe(0)
  })

  it('connectsPerWeek reads the smart_connect module dailyLimit, default 100', () => {
    expect(connectsPerWeek([{ id: 'smart_connect', enabled: true, available: true, automationLevel: 'manual', dailyLimit: 40 }])).toBe(40)
    expect(connectsPerWeek([])).toBe(DEFAULT_CONNECTS_PER_WEEK)
    expect(connectsPerWeek({ 0: { id: 'smart_connect', dailyLimit: 25 } })).toBe(25) // array-like guard
  })

  it('per-run cap = min(weeklyRemaining, dailyShare) with downward-only jitter', () => {
    // perWeek 100 → dailyShare 14 (round(100/7)). rng=0 → max downward jitter; rng→1 → no jitter.
    expect(connectRunCap(100, 100, rng(1))).toBe(14)
    expect(connectRunCap(100, 100, rng(0))).toBeLessThan(14)
    expect(connectRunCap(100, 100, rng(0))).toBeGreaterThanOrEqual(0)
    // never exceeds the weekly remaining
    expect(connectRunCap(3, 100, rng(1))).toBe(3)
  })
})
