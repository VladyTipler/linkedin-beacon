import { describe, it, expect, beforeEach, vi } from 'vitest'
import { showActivity, hideActivity, setActivityLabel, countdownActivity, __resetActivity } from './activityOverlay'
import { pauseLabel } from '@lib/autopilot/statusLabels'

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

  it('shows the status label passed to showActivity', () => {
    showActivity(document, 'Сканирую ленту…')
    expect(document.getElementById('beacon-activity-label')!.textContent).toBe('Сканирую ленту…')
  })

  it('updates the label via setActivityLabel while active', () => {
    showActivity(document)
    setActivityLabel('Пауза 22с')
    expect(document.getElementById('beacon-activity-label')!.textContent).toBe('Пауза 22с')
  })

  it('clears the label when the overlay hides', () => {
    showActivity(document, 'Ставлю лайк…')
    hideActivity(document)
    expect(document.getElementById('beacon-activity-label')!.textContent).toBe('')
  })

  it('adds the label child to a stale overlay left over from a prior build', () => {
    // Simulate a label-less overlay persisted in the page DOM across an extension reload.
    const stale = document.createElement('div')
    stale.id = 'beacon-activity-overlay'
    document.body.appendChild(stale)
    showActivity(document, 'Сканирую ленту…')
    expect(document.getElementById('beacon-activity-label')!.textContent).toBe('Сканирую ленту…')
  })

  it('countdownActivity ticks the pill down each second and resolves after the full duration', async () => {
    vi.useFakeTimers()
    try {
      showActivity(document)
      const label = () => document.getElementById('beacon-activity-label')!.textContent
      const done = countdownActivity(3000, pauseLabel)
      expect(label()).toBe('Пауза 3с') // set immediately, not frozen on the initial value only
      await vi.advanceTimersByTimeAsync(1000)
      expect(label()).toBe('Пауза 2с')
      await vi.advanceTimersByTimeAsync(1000)
      expect(label()).toBe('Пауза 1с')
      let resolved = false
      void done.then(() => { resolved = true })
      await vi.advanceTimersByTimeAsync(1000)
      await done
      expect(resolved).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
