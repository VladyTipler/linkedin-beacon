import { describe, it, expect } from 'vitest'
import { buildReportModules } from './runOutcomes'

describe('buildReportModules', () => {
  it('emits a row per touched module, in run order, carrying executed + reason', () => {
    const rows = buildReportModules({
      profile_views: { executed: 2, reason: 'done' },
      smart_connect: { executed: 0, reason: 'empty_search' },
      content: { executed: 0, reason: 'not_publish_day' },
      engagement: { executed: 5, reason: 'done' }
    })
    expect(rows).toEqual([
      { id: 'engagement', executed: 5, skipped: 0, failed: 0, reason: 'done' },
      { id: 'smart_connect', executed: 0, skipped: 0, failed: 0, reason: 'empty_search' },
      { id: 'content', executed: 0, skipped: 0, failed: 0, reason: 'not_publish_day' },
      { id: 'profile_views', executed: 2, skipped: 0, failed: 0, reason: 'done' }
    ])
  })

  it('omits modules with no recorded outcome', () => {
    const rows = buildReportModules({ smart_connect: { executed: 1, reason: 'done' } })
    expect(rows).toEqual([{ id: 'smart_connect', executed: 1, skipped: 0, failed: 0, reason: 'done' }])
  })

  it('keeps a zero-executed disabled module visible (the whole point)', () => {
    const rows = buildReportModules({ engagement: { executed: 0, reason: 'disabled' } })
    expect(rows).toEqual([{ id: 'engagement', executed: 0, skipped: 0, failed: 0, reason: 'disabled' }])
  })

  it('returns [] when nothing ran', () => {
    expect(buildReportModules({})).toEqual([])
  })
})
