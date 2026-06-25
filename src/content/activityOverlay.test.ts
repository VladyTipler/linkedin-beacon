import { describe, it, expect, beforeEach } from 'vitest'
import { showActivity, hideActivity, __resetActivity } from './activityOverlay'

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  __resetActivity()
})

describe('activityOverlay', () => {
  it('injects the overlay and turns it on when shown', () => {
    showActivity(document)
    const el = document.getElementById('beacon-activity-overlay')
    expect(el).not.toBeNull()
    expect(el!.getAttribute('data-on')).toBe('1')
  })

  it('turns off only when every activity span has ended (ref-counted)', () => {
    showActivity(document)
    showActivity(document)
    hideActivity(document)
    expect(document.getElementById('beacon-activity-overlay')!.getAttribute('data-on')).toBe('1')
    hideActivity(document)
    expect(document.getElementById('beacon-activity-overlay')!.getAttribute('data-on')).toBe('0')
  })

  it('injects a single overlay + style node and declares pointer-events:none (never blocks the user)', () => {
    showActivity(document)
    showActivity(document)
    expect(document.querySelectorAll('#beacon-activity-overlay')).toHaveLength(1)
    expect(document.querySelectorAll('#beacon-activity-style')).toHaveLength(1)
    expect(document.getElementById('beacon-activity-style')!.textContent).toContain('pointer-events: none')
  })

  it('does not underflow the ref count below zero on an extra hide', () => {
    hideActivity(document)
    showActivity(document)
    expect(document.getElementById('beacon-activity-overlay')!.getAttribute('data-on')).toBe('1')
  })
})
