import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import SettingsScreen from './SettingsScreen.vue'

beforeEach(() => {
  ;(globalThis as any).chrome = {
    runtime: { id: 'x', sendMessage: vi.fn().mockResolvedValue([]) },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } }
  }
})

describe('SettingsScreen', () => {
  it('renders the provider select and a password key input', () => {
    const wrapper = mount(SettingsScreen)
    expect(wrapper.find('[data-testid="llm-provider"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="llm-key"]').attributes('type')).toBe('password')
    expect(wrapper.find('[data-testid="llm-save"]').exists()).toBe(true)
  })

  it('shows a save error when a save fails', async () => {
    ;(globalThis as any).chrome.storage.local.set = vi.fn().mockRejectedValue(new Error('quota'))
    const wrapper = mount(SettingsScreen)
    await flushPromises()
    await wrapper.find('[data-testid="llm-save"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="save-error"]').exists()).toBe(true)
  })

  it('renders 7 publish-day checkboxes defaulting to Mon/Wed/Fri', async () => {
    const w = mount(SettingsScreen)
    await flushPromises()
    expect(w.find('[data-testid="pubday-1"]').exists()).toBe(true)
    expect(w.find('[data-testid="pubday-0"]').exists()).toBe(true)
    expect((w.find('[data-testid="pubday-1"]').element as HTMLInputElement).checked).toBe(true)  // Mon
    expect((w.find('[data-testid="pubday-2"]').element as HTMLInputElement).checked).toBe(false) // Tue
  })

  it('toggles a publish weekday and persists publishDays without it', async () => {
    const setMock = vi.fn(async (_obj: Record<string, any>) => {})
    ;(globalThis as any).chrome.storage.local.set = setMock
    const w = mount(SettingsScreen)
    await flushPromises()
    await w.find('[data-testid="pubday-1"]').setValue(false) // un-check Monday (default [1,3,5])
    await w.find('[data-testid="llm-save"]').trigger('click')
    await flushPromises()
    const call = setMock.mock.calls.find((c) => c[0] && c[0]['content:settings'])
    expect(call?.[0]['content:settings'].publishDays).toEqual([3, 5])
  })
})
