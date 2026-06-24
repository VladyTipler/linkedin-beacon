import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ContentScreen from './ContentScreen.vue'

beforeEach(() => {
  ;(globalThis as any).chrome = {
    runtime: { id: 'x', sendMessage: vi.fn().mockResolvedValue({ ideas: [] }) },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } }
  }
})

describe('ContentScreen', () => {
  it('renders the Ideas / Drafts sub-tabs', () => {
    const wrapper = mount(ContentScreen)
    expect(wrapper.find('[data-testid="subtab-ideas"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="subtab-drafts"]').exists()).toBe(true)
  })
})
