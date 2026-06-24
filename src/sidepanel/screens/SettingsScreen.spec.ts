import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
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
  })
})
