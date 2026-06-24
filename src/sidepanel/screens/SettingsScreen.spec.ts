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
})
