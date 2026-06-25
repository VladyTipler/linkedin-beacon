import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the panel bus so publishDraft round-trips through a controllable fake.
const request = vi.fn()
vi.mock('../lib/panelBus', () => ({
  panelBus: { request: (...a: unknown[]) => request(...a), available: () => true }
}))

// Minimal in-memory chrome.storage.local so ChromeStorageStore works in jsdom.
const mem = new Map<string, unknown>()
;(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (k: string) => ({ [k]: mem.get(k) }),
      set: async (o: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(o)) mem.set(k, v)
      }
    }
  }
}

import { useContent } from './useContent'

beforeEach(() => {
  request.mockReset()
  mem.clear()
})

describe('publishDraft', () => {
  it('on success clears error, drops the publishing flag, and reloads drafts', async () => {
    request.mockResolvedValueOnce({ ok: true })
    const c = useContent()
    await c.publishDraft('d1')
    expect(request).toHaveBeenCalledWith({ type: 'PUBLISH_POST', draftId: 'd1' })
    expect(c.error.value).toBeNull()
    expect(c.publishing.value).toBeNull()
  })

  it('on failure surfaces the reason and stops the publishing flag', async () => {
    request.mockResolvedValueOnce({ ok: false, reason: 'budget' })
    const c = useContent()
    await c.publishDraft('d1')
    expect(c.error.value).toBe('budget')
    expect(c.publishing.value).toBeNull()
  })

  it('loadPostBudget computes remaining against the default weekly cap (3)', async () => {
    const c = useContent()
    await c.loadPostBudget()
    expect(c.postsLeft.value).toBe(3)
  })
})
