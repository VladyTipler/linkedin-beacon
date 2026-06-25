import { describe, it, expect } from 'vitest'
import { CommentTargetSelector } from './CommentTargetSelector'
import type { FeedPost, TargetProfile } from '../types'

const profile: TargetProfile = {
  stack: ['vue'],
  targetRoles: ['recruiter'],
  geos: [],
  watchlistCompanies: []
}

const post = (over: Partial<FeedPost>): FeedPost => ({
  urn: 'u',
  authorName: 'A',
  text: 'a thoughtful post about engineering',
  ...over
})

describe('CommentTargetSelector', () => {
  const sel = new CommentTargetSelector()

  it('keeps only posts at/above the (stricter) threshold', () => {
    const hi = post({ urn: 'hi', authorHeadline: 'Technical recruiter', text: 'hiring vue devs' }) // role+stack = 0.8
    const mid = post({ urn: 'mid', text: 'we use vue at work' }) // stack only = 0.3
    const lo = post({ urn: 'lo', text: 'nice weather today' }) // 0
    const res = sel.select([lo, mid, hi], profile, { threshold: 0.5, max: 5 })
    expect(res.map((p) => p.urn)).toEqual(['hi'])
  })

  it('orders by relevance descending and respects max (narrow)', () => {
    const a = post({ urn: 'a', authorHeadline: 'recruiter', text: 'we ship vue daily' }) // role+stack = 0.8
    const b = post({ urn: 'b', authorHeadline: 'recruiter', text: 'a general hiring update' }) // role = 0.5
    const res = sel.select([b, a], profile, { threshold: 0.3, max: 1 })
    expect(res.map((p) => p.urn)).toEqual(['a'])
  })

  it('excludes junk even when relevant (promo / already-liked)', () => {
    const promo = post({ urn: 'p', authorHeadline: 'recruiter', text: 'vue jobs — dm me now' })
    const liked = post({ urn: 'l', authorHeadline: 'recruiter', text: 'vue role', alreadyLiked: true })
    expect(sel.select([promo, liked], profile, { threshold: 0.3, max: 5 })).toEqual([])
  })

  it('returns [] for empty input or max 0', () => {
    expect(sel.select([], profile, { threshold: 0.3, max: 5 })).toEqual([])
    const a = post({ urn: 'a', authorHeadline: 'recruiter', text: 'vue' })
    expect(sel.select([a], profile, { threshold: 0.3, max: 0 })).toEqual([])
  })
})
