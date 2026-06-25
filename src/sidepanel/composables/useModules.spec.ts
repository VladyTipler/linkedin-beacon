import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useModules, defaultModules } from './useModules'
import { flushPromises } from '@vue/test-utils'

const mem = new Map<string, unknown>()
beforeEach(() => {
  mem.clear()
  ;(globalThis as any).chrome = {
    runtime: { id: 'x' },
    storage: {
      local: {
        get: vi.fn(async (k: string) => ({ [k]: mem.get(k) })),
        set: vi.fn(async (o: Record<string, unknown>) => { for (const k in o) mem.set(k, o[k]) })
      }
    }
  }
})

describe('useModules', () => {
  it('defaults carry a dailyLimit and mark unbuilt modules unavailable', () => {
    const d = defaultModules()
    const eng = d.find((m) => m.id === 'engagement')!
    expect(eng.dailyLimit).toBe(35)
    expect(eng.available).toBe(true)
    expect(d.find((m) => m.id === 'smart_connect')!.available).toBe(false)
    expect(d.find((m) => m.id === 'content')!.available).toBe(true)
  })

  it('setLimit updates the module limit and persists a plain array', async () => {
    const m = useModules()
    m.setLimit('engagement', 50)
    expect(m.modules.value.find((x) => x.id === 'engagement')!.dailyLimit).toBe(50)
    // persisted shape is a real array (not a reactive proxy / array-like object)
    expect(Array.isArray(mem.get('modules:state'))).toBe(true)
  })

  it('pins module availability to the current build, ignoring a stale stored value', async () => {
    // Old build had smart_connect available:true; the new build flags it «Скоро».
    mem.set('modules:state', [
      { id: 'smart_connect', enabled: true, automationLevel: 'manual', available: true, dailyLimit: 80 }
    ])
    const m = useModules()
    // onMounted merge runs asynchronously; flush.
    await flushPromises()
    const sc = m.modules.value.find((x) => x.id === 'smart_connect')!
    expect(sc.available).toBe(false)
  })

  it('ships content as a real module with an ideas/day limit', () => {
    const c = defaultModules().find((m) => m.id === 'content')!
    expect(c.available).toBe(true)
    expect(c.enabled).toBe(false)
    expect(c.dailyLimit).toBe(5)
  })
})
