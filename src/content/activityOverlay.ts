// A pulsing lime border overlay shown while Beacon is acting on the page — the
// "agent is working" cue (like Claude's computer-use window highlight), plus a
// small status pill so the user can tell "working slowly (anti-ban pacing /
// human break)" from "stuck". Pure DOM edge: injected once, ref-counted so
// overlapping activities don't flicker, and `pointer-events:none` so it never
// blocks the user. Lives in the content layer (the only layer in the LinkedIn DOM).

const OVERLAY_ID = 'beacon-activity-overlay'
const LABEL_ID = 'beacon-activity-label'
const STYLE_ID = 'beacon-activity-style'
const LIME = '#c4ff4d'

// Module-level ref count: each start increments, each end decrements; the
// overlay is visible while > 0. Overlapping spans (e.g. an engagement run that
// itself triggers actions) therefore can't switch it off prematurely.
let active = 0

function ensureInjected(doc: Document): HTMLElement {
  // Each part is ensured independently and idempotently: a stale overlay from a
  // prior build (the page DOM survives an extension reload) might be missing the
  // label child, so we must (re)add it rather than return early.
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      @keyframes beacon-activity-pulse {
        0%, 100% { box-shadow: inset 0 0 0 2px ${LIME}, inset 0 0 14px 2px rgba(196,255,77,.40); opacity: .9 }
        50%      { box-shadow: inset 0 0 0 3px ${LIME}, inset 0 0 34px 6px rgba(196,255,77,.85); opacity: 1 }
      }
      #${OVERLAY_ID} {
        position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
        border-radius: 6px; display: none;
        animation: beacon-activity-pulse 1.4s ease-in-out infinite;
      }
      #${OVERLAY_ID}[data-on="1"] { display: block }
      #${LABEL_ID} {
        position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
        background: rgba(10,14,23,.92); color: ${LIME}; pointer-events: none;
        font: 600 12px/1.4 'Spline Sans Mono', ui-monospace, monospace;
        padding: 6px 12px; border-radius: 999px; border: 1px solid ${LIME};
        white-space: nowrap; box-shadow: 0 4px 16px rgba(0,0,0,.4);
      }
      #${LABEL_ID}:empty { display: none }
    `
    ;(doc.head ?? doc.documentElement).appendChild(style)
  }

  let el = doc.getElementById(OVERLAY_ID)
  if (!el) {
    el = doc.createElement('div')
    el.id = OVERLAY_ID
    el.setAttribute('aria-hidden', 'true')
    ;(doc.body ?? doc.documentElement).appendChild(el)
  }
  if (!doc.getElementById(LABEL_ID)) {
    const label = doc.createElement('div')
    label.id = LABEL_ID
    el.appendChild(label)
  }
  return el
}

/** Begin one activity span — show the pulsing border (idempotent, ref-counted). */
export function showActivity(doc: Document = document, label = ''): void {
  active += 1
  ensureInjected(doc).setAttribute('data-on', '1')
  setActivityLabel(label, doc)
}

/** Update the status pill text (no-op if the overlay was never injected). */
export function setActivityLabel(text: string, doc: Document = document): void {
  const label = doc.getElementById(LABEL_ID)
  if (label) label.textContent = text
}

/**
 * Count `ms` down on the pill once per second (so an anti-ban pause/break reads as a LIVE
 * timer, not frozen text), then resolve after the full duration — a drop-in for `await sleep(ms)`.
 * A backgrounded tab throttles this interval AND the real pacing identically, so the visible
 * countdown stays in sync with the actual wait; docked next to a foreground tab it ticks at 1 Hz.
 *
 * `shouldAbort` (optional): if it returns true on a tick, resolve immediately. Used by the
 * autopilot loop to break out of an 8–45s pause/break the instant the user presses STOP —
 * without it the overlay stays up counting down while the run is already halted.
 */
export function countdownActivity(
  ms: number,
  label: (remainingMs: number) => string,
  shouldAbort?: () => boolean,
  doc: Document = document
): Promise<void> {
  setActivityLabel(label(ms), doc)
  return new Promise((resolve) => {
    const deadline = Date.now() + ms
    const tick = setInterval(() => {
      if (shouldAbort?.()) {
        clearInterval(tick)
        clearTimeout(timer)
        resolve()
        return
      }
      const remaining = deadline - Date.now()
      if (remaining > 0) setActivityLabel(label(remaining), doc)
    }, 1000)
    const timer = setTimeout(() => {
      clearInterval(tick)
      resolve()
    }, ms)
  })
}

/** End one activity span — hide the border (and clear the label) once every span has ended. */
export function hideActivity(doc: Document = document): void {
  active = Math.max(0, active - 1)
  if (active === 0) {
    doc.getElementById(OVERLAY_ID)?.setAttribute('data-on', '0')
    setActivityLabel('', doc)
  }
}

/** Test seam: reset the module-level ref count between cases. */
export function __resetActivity(): void {
  active = 0
}
