import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import ProfileAuditScreen from './ProfileAuditScreen.vue'

describe('ProfileAuditScreen', () => {
  it('renders the completeness % and both tiers, labeling best-practice honestly', async () => {
    const wrapper = mount(ProfileAuditScreen)
    await new Promise((r) => setTimeout(r)) // let useProfileAudit resolve the demo
    expect(wrapper.text()).toMatch(/%/)
    expect(wrapper.find('[data-testid="audit-official"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="audit-boost"]').exists()).toBe(true)
    expect(wrapper.text()).toMatch(/best-practice|не официальн|усиление/i)
  })
})
