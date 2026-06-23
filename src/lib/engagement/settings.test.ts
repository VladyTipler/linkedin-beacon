import { describe, it, expect } from 'vitest'
import { loadSettings, DEFAULT_SETTINGS } from './settings'
import type { KeyValueStore } from '../ports'
import type { ModuleState } from '../types'

function memStore(seed: Record<string, unknown> = {}): KeyValueStore {
  const m = new Map<string, unknown>(Object.entries(seed))
  return {
    async get<T>(k: string) {
      return m.has(k) ? (m.get(k) as T) : null
    },
    async set<T>(k: string, v: T) {
      m.set(k, v)
    }
  }
}

const modules: ModuleState[] = [
  { id: 'engagement', enabled: true, automationLevel: 'full_auto', available: true }
]

describe('loadSettings', () => {
  it('defaults to manual when nothing is stored', async () => {
    const s = await loadSettings(memStore())
    expect(s.config.level).toBe('manual')
  })

  it("drives config.level from the engagement module's automationLevel (SSOT)", async () => {
    const s = await loadSettings(memStore({ 'modules:state': modules }))
    expect(s.config.level).toBe('full_auto')
  })

  it('keeps the rest of the stored settings while overriding the level', async () => {
    const stored = { ...DEFAULT_SETTINGS, relevanceThreshold: 0.5 }
    const s = await loadSettings(
      memStore({ 'engagement:settings': stored, 'modules:state': modules })
    )
    expect(s.relevanceThreshold).toBe(0.5)
    expect(s.config.level).toBe('full_auto')
  })
})
