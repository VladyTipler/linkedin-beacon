// A pulsing lime border overlay shown while Beacon is acting on the page — the
// "agent is working" cue (like Claude's computer-use window highlight). Pure DOM
// edge: injected once, ref-counted so overlapping activities don't flicker, and
// `pointer-events:none` so it never blocks the user. Lives in the content layer
// (the only layer in the LinkedIn DOM).

const OVERLAY_ID = 'beacon-activity-overlay'
const STYLE_ID = 'beacon-activity-style'
const LIME = '#c4ff4d'

// Module-level ref count: each start increments, each end decrements; the
// overlay is visible while > 0. Overlapping spans (e.g. an engagement run that
// itself triggers actions) therefore can't switch it off prematurely.
let active = 0

function ensureInjected(doc: Document): HTMLElement {
  const existing = doc.getElementById(OVERLAY_ID)
  if (existing) return existing

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
    `
    ;(doc.head ?? doc.documentElement).appendChild(style)
  }

  const el = doc.createElement('div')
  el.id = OVERLAY_ID
  el.setAttribute('aria-hidden', 'true')
  ;(doc.body ?? doc.documentElement).appendChild(el)
  return el
}

/** Begin one activity span — show the pulsing border (idempotent, ref-counted). */
export function showActivity(doc: Document = document): void {
  active += 1
  ensureInjected(doc).setAttribute('data-on', '1')
}

/** End one activity span — hide the border once every span has ended. */
export function hideActivity(doc: Document = document): void {
  active = Math.max(0, active - 1)
  if (active === 0) {
    doc.getElementById(OVERLAY_ID)?.setAttribute('data-on', '0')
  }
}

/** Test seam: reset the module-level ref count between cases. */
export function __resetActivity(): void {
  active = 0
}
