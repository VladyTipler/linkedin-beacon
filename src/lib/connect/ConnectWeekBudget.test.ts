import { describe, it, expect } from 'vitest'
import {
  rolloverConnectWeek, recordConnectWeek, remainingConnects,
  connectsPerWeek, connectRunCap, DEFAULT_CONNECTS_PER_WEEK,
  rolloverConnectDay, recordConnectDay, dailyConnectCap, remainingDailyConnects
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

  it('per-run cap = min(weeklyRemaining, dailyRemaining, dailyShare) with downward-only jitter', () => {
    // perWeek 100 → dailyShare 14 (round(100/7)). rng=1 → no jitter; rng=0 → max downward jitter.
    expect(connectRunCap(100, 14, 100, rng(1))).toBe(14)
    expect(connectRunCap(100, 14, 100, rng(0))).toBeLessThan(14)
    expect(connectRunCap(100, 14, 100, rng(0))).toBeGreaterThanOrEqual(0)
    // never exceeds the weekly remaining
    expect(connectRunCap(3, 14, 100, rng(1))).toBe(3)
    // never exceeds the day's remaining allowance (the daily ceiling)
    expect(connectRunCap(100, 5, 100, rng(1))).toBe(5)
  })

  it('daily budget: rollover resets on a new day, records, remaining never negative; cap ≈ perWeek/7', () => {
    expect(rolloverConnectDay({ day: '2026-06-26', used: 4 }, '2026-06-26').used).toBe(4)
    expect(rolloverConnectDay({ day: '2026-06-26', used: 4 }, '2026-06-27')).toEqual({ day: '2026-06-27', used: 0 })
    expect(recordConnectDay({ day: 'd', used: 1 }, 2).used).toBe(3)
    expect(dailyConnectCap(100)).toBe(14)
    expect(remainingDailyConnects({ day: 'd', used: 14 }, dailyConnectCap(100))).toBe(0)
    expect(remainingDailyConnects({ day: 'd', used: 10 }, dailyConnectCap(100))).toBe(4)
  })
})
