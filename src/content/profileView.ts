import type { HumanDelay } from '../lib/engagement/HumanDelay'
import type { ActionResult } from './domActions'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Human dwell on the already-navigated profile: scroll down a little, pause, scroll further, pause.
 * The actual "view" is registered by the SW navigating to the profile URL; this only adds plausibility.
 * Best-effort — a missing scroll target is not a failure.
 */
export async function executeProfileView(root: Document, delay: HumanDelay): Promise<ActionResult> {
  const scroller = (root.scrollingElement ?? root.documentElement) as HTMLElement | null
  scroller?.scrollTo?.({ top: 600, behavior: 'smooth' })
  await sleep(delay.nextMs(1500, 3500))
  scroller?.scrollTo?.({ top: 1400, behavior: 'smooth' })
  await sleep(delay.nextMs(1500, 3500))
  return { ok: true }
}
