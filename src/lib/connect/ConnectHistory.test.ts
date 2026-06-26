import { describe, it, expect } from 'vitest'
import { appendConnectHistory, type ConnectRecord } from './ConnectHistory'

const r = (id: string): ConnectRecord => ({
  memberId: id, name: `N${id}`, headline: 'Recruiter', profileUrl: `/in/${id}`, sentAt: '2026-06-26T00:00:00.000Z'
})

describe('appendConnectHistory', () => {
  it('prepends newest records, newest-first', () => {
    expect(appendConnectHistory([r('1')], [r('2'), r('3')]).map((x) => x.memberId)).toEqual(['2', '3', '1'])
  })

  it('tolerates a missing or array-like stored value', () => {
    expect(appendConnectHistory(null, [r('1')]).map((x) => x.memberId)).toEqual(['1'])
    expect(appendConnectHistory({ 0: r('1') }, [r('2')]).map((x) => x.memberId)).toEqual(['2', '1'])
  })

  it('caps to the most recent N', () => {
    const existing = Array.from({ length: 600 }, (_, i) => r(`old${i}`))
    const out = appendConnectHistory(existing, [r('new')], 500)
    expect(out).toHaveLength(500)
    expect(out[0].memberId).toBe('new')
  })
})
