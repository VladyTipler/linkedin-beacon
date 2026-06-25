import { describe, it, expect } from 'vitest'
import { pauseLabel, breakLabel, SCANNING, LIKING } from './statusLabels'

describe('statusLabels', () => {
  it('formats the anti-ban pause in seconds', () => {
    expect(pauseLabel(22000)).toBe('Пауза 22с')
    expect(pauseLabel(8000)).toBe('Пауза 8с')
  })

  it('rounds sub-second pauses up to at least 1с', () => {
    expect(pauseLabel(400)).toBe('Пауза 1с')
  })

  it('formats the human break in minutes', () => {
    expect(breakLabel(120000)).toBe('Перерыв 2 мин ☕')
    expect(breakLabel(60000)).toBe('Перерыв 1 мин ☕')
    expect(breakLabel(150000)).toBe('Перерыв 3 мин ☕') // 2.5 → 3
  })

  it('exposes phase constants', () => {
    expect(SCANNING).toMatch(/Сканирую/)
    expect(LIKING).toMatch(/лайк/i)
  })
})
