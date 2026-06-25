import { describe, it, expect } from 'vitest'
import { weeklyGoal } from './weeklyGoal'
import type { SsiPillar } from '../types'

const pillars = (scores: Partial<Record<SsiPillar['key'], number>>): SsiPillar[] => [
  { key: 'brand', label: 'Профессиональный бренд', score: scores.brand ?? 20 },
  { key: 'people', label: 'Поиск нужных людей', score: scores.people ?? 20 },
  { key: 'insights', label: 'Обмен инсайтами', score: scores.insights ?? 20 },
  { key: 'relationships', label: 'Построение связей', score: scores.relationships ?? 20 }
]

describe('weeklyGoal', () => {
  it('targets the weakest pillar and maps it to the right lever module', () => {
    const g = weeklyGoal(pillars({ relationships: 12 }))!
    expect(g.pillarKey).toBe('relationships')
    expect(g.score).toBe(12)
    expect(g.module).toBe('smart_connect')
  })

  it('maps insights → engagement, brand → content', () => {
    expect(weeklyGoal(pillars({ insights: 9 }))!.module).toBe('engagement')
    expect(weeklyGoal(pillars({ brand: 8 }))!.module).toBe('content')
    expect(weeklyGoal(pillars({ people: 10 }))!.module).toBe('smart_connect')
  })

  it('proposes a reachable next milestone (capped at 25)', () => {
    expect(weeklyGoal(pillars({ insights: 12 }))!.target).toBe(15) // +3
    // all high → weakest is 24 → +3 capped at 25
    expect(weeklyGoal(pillars({ brand: 24, people: 24, insights: 24, relationships: 24 }))!.target).toBe(25)
  })

  it('returns null when there are no pillars', () => {
    expect(weeklyGoal([])).toBeNull()
  })
})
