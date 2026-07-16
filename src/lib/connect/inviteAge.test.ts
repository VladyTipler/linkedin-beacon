import { describe, it, expect } from 'vitest'
import { parseInviteAgeDays, isStaleInvite } from './inviteAge'

describe('parseInviteAgeDays', () => {
  it('maps LinkedIn "Sent X ago" buckets to approx days', () => {
    expect(parseInviteAgeDays('Sent 59 minutes ago')).toBe(0)
    expect(parseInviteAgeDays('Sent 1 hour ago')).toBe(0)
    expect(parseInviteAgeDays('Sent 3 days ago')).toBe(3)
    expect(parseInviteAgeDays('Sent 1 week ago')).toBe(7)
    expect(parseInviteAgeDays('Sent 2 weeks ago')).toBe(14)
    expect(parseInviteAgeDays('Sent 1 month ago')).toBe(30)
    expect(parseInviteAgeDays('Sent 3 months ago')).toBe(90)
    expect(parseInviteAgeDays('Sent 1 year ago')).toBe(365)
  })
  it('returns 0 for unrecognized text (safe — never withdraw on doubt)', () => {
    expect(parseInviteAgeDays('')).toBe(0)
    expect(parseInviteAgeDays('Pending')).toBe(0)
  })
})

describe('isStaleInvite (default threshold 14 days)', () => {
  it('keeps < 14 days, withdraws >= 14', () => {
    expect(isStaleInvite('Sent 3 days ago', 14)).toBe(false)
    expect(isStaleInvite('Sent 1 week ago', 14)).toBe(false)   // 7 < 14
    expect(isStaleInvite('Sent 2 weeks ago', 14)).toBe(true)   // 14 >= 14
    expect(isStaleInvite('Sent 1 month ago', 14)).toBe(true)
    expect(isStaleInvite('Sent 59 minutes ago', 14)).toBe(false)
  })
})
