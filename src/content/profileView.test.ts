import { describe, it, expect, vi } from 'vitest'
import { executeProfileView } from './profileView'

const fastDelay = { nextMs: () => 0 } as unknown as import('../lib/engagement/HumanDelay').HumanDelay

describe('executeProfileView', () => {
  it('dwells (scrolls) and resolves ok', async () => {
    const scrollTo = vi.fn()
    // jsdom: stub scrollingElement.scrollTo
    Object.defineProperty(document.documentElement, 'scrollTo', { value: scrollTo, configurable: true })
    const res = await executeProfileView(document, fastDelay)
    expect(res).toEqual({ ok: true })
    expect(scrollTo).toHaveBeenCalled()
  })
})
