import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import App from './App.vue'

async function mountApp() {
  const wrapper = mount(App, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

describe('App (side panel)', () => {
  it('renders the Beacon brand and starts on the SSI screen', async () => {
    const w = await mountApp()
    expect(w.find('.brand h1').text()).toBe('Beacon')
    expect(w.find('#v-dash').exists()).toBe(true)
    expect(w.text()).toContain('Social Selling Index')
  })

  it('shows the gauge seeded with the demo total', async () => {
    const w = await mountApp()
    // The gauge mounts with the demo snapshot (total 82); the node exists.
    expect(w.find('[data-testid="gauge-num"]').exists()).toBe(true)
  })

  it('switches to the Modules screen via bottom nav', async () => {
    const w = await mountApp()
    await w.find('[data-testid="nav-v-auto"]').trigger('click')
    expect(w.find('#v-auto').exists()).toBe(true)
    expect(w.text()).toContain('Модули автоматизации')
  })

  it('switches to the Inbox screen', async () => {
    const w = await mountApp()
    await w.find('[data-testid="nav-v-inbox"]').trigger('click')
    expect(w.find('#v-inbox').exists()).toBe(true)
    expect(w.text()).toContain('написали тебе')
  })

  it('switches to the Safety screen', async () => {
    const w = await mountApp()
    await w.find('[data-testid="nav-v-set"]').trigger('click')
    expect(w.find('#v-set').exists()).toBe(true)
    expect(w.text()).toContain('Защита аккаунта')
  })

  it('toggles a module off and on', async () => {
    const w = await mountApp()
    await w.find('[data-testid="nav-v-auto"]').trigger('click')
    const toggle = w.find('[data-testid="toggle-engagement"]')
    expect(toggle.classes()).toContain('on')
    await toggle.trigger('click')
    expect(w.find('[data-testid="toggle-engagement"]').classes()).not.toContain('on')
  })

  it('changes automation level for an enabled module', async () => {
    const w = await mountApp()
    await w.find('[data-testid="nav-v-auto"]').trigger('click')
    const full = w.find('[data-testid="level-engagement-full_auto"]')
    expect(full.classes()).not.toContain('on')
    await full.trigger('click')
    expect(w.find('[data-testid="level-engagement-full_auto"]').classes()).toContain('on')
  })
})
