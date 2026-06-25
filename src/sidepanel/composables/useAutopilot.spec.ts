import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAutopilot } from './useAutopilot'
import type { BeaconMessage } from '@lib/types'

// The SW reply driver — each test sets how the fake service worker answers.
let respond: (m: BeaconMessage) => unknown
beforeEach(() => {
  respond = () => null
  ;(globalThis as any).chrome = {
    runtime: {
      id: 'x',
      sendMessage: vi.fn(async (m: BeaconMessage) => respond(m)),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() }
    }
  }
})

describe('useAutopilot start', () => {
  it('surfaces a hint when the SW reports no enabled modules', async () => {
    respond = (m) => (m.type === 'START_AUTOPILOT' ? { started: false, reason: 'no-modules' } : [])
    const ap = useAutopilot()
    await ap.start('tab')
    expect(ap.startHint.value).toMatch(/нет включённых модулей/i)
  })

  it('clears the hint on a successful start', async () => {
    respond = (m) => (m.type === 'START_AUTOPILOT' ? { started: true } : [])
    const ap = useAutopilot()
    ap.startHint.value = 'stale'
    await ap.start('tab')
    expect(ap.startHint.value).toBeNull()
  })
})
