import { describe, it, expect } from 'vitest'
import { DailyBudget, type DailyBudgetState } from './DailyBudget'

const today = new Date('2026-06-24T10:00:00.000Z')
const laterToday = new Date('2026-06-24T18:30:00.000Z')
const tomorrow = new Date('2026-06-25T08:00:00.000Z')

describe('DailyBudget', () => {
  const budget = new DailyBudget(60)

  it('allows spending and reports full remaining with no prior state', () => {
    expect(budget.canSpend(null, today)).toBe(true)
    expect(budget.remaining(null, today)).toBe(60)
  })

  it('blocks spending once the daily limit is reached', () => {
    const state: DailyBudgetState = { day: '2026-06-24', used: 60 }
    expect(budget.canSpend(state, laterToday)).toBe(false)
    expect(budget.remaining(state, laterToday)).toBe(0)
  })

  it('still allows the last unit just below the limit', () => {
    const state: DailyBudgetState = { day: '2026-06-24', used: 59 }
    expect(budget.canSpend(state, laterToday)).toBe(true)
    expect(budget.remaining(state, laterToday)).toBe(1)
  })

  it('records a spend, incrementing used for the current day', () => {
    expect(budget.spend(null, today)).toEqual({ day: '2026-06-24', used: 1 })
    expect(budget.spend({ day: '2026-06-24', used: 1 }, laterToday)).toEqual({
      day: '2026-06-24',
      used: 2
    })
  })

  it('resets on a new day', () => {
    const yesterdayFull: DailyBudgetState = { day: '2026-06-24', used: 60 }
    expect(budget.canSpend(yesterdayFull, tomorrow)).toBe(true)
    expect(budget.remaining(yesterdayFull, tomorrow)).toBe(60)
    expect(budget.spend(yesterdayFull, tomorrow)).toEqual({ day: '2026-06-25', used: 1 })
  })

  it('never reports negative remaining even if over budget', () => {
    expect(budget.remaining({ day: '2026-06-24', used: 99 }, laterToday)).toBe(0)
  })
})
