import type { PersonCandidate } from '@lib/types'

const CONNECT_ANCHOR = 'a[aria-label^="Invite "][aria-label$=" to connect"]'

/**
 * Parse connectable people from a LinkedIn people-search results DOM.
 * Anchors off the Connect `<a>` (NOT a button), reads memberId from its componentkey,
 * walks up to the card to read the headline (the 2nd <p>). Structural, jsdom-safe.
 */
export function harvestPeople(root: ParentNode): PersonCandidate[] {
  const out: PersonCandidate[] = []
  const seen = new Set<string>()
  for (const a of root.querySelectorAll<HTMLAnchorElement>(CONNECT_ANCHOR)) {
    const member = (a.getAttribute('componentkey') ?? '').match(/urn:li:member:(\d+)/)?.[1]
    if (!member || seen.has(member)) continue
    let card: Element | null = a.parentElement
    while (card && !card.querySelector('a[href*="/in/"]')) card = card.parentElement
    if (!card) continue
    const profile = card.querySelector<HTMLAnchorElement>('a[href*="/in/"]')
    const ps = card.querySelectorAll('p')
    seen.add(member)
    out.push({
      memberId: member,
      name: (a.getAttribute('aria-label') ?? '').replace(/^Invite /, '').replace(/ to connect$/, ''),
      headline: (ps[1]?.textContent ?? '').trim(),
      profileUrl: (profile?.getAttribute('href') ?? '').split('?')[0]
    })
  }
  return out
}

/**
 * Harvest, retrying until the results render. LinkedIn renders people-search results
 * a few seconds AFTER the content script is ready, so a single immediate harvest (right
 * after the SW navigates the tab) returns [] — which silently yields zero connects.
 * Poll until candidates appear or the attempts run out. `harvest`/`sleepMs` are injected
 * so the loop is unit-testable without a live DOM.
 */
export async function harvestUntilReady(
  harvest: () => PersonCandidate[],
  sleepMs: (ms: number) => Promise<void>,
  attempts = 16,
  intervalMs = 500
): Promise<PersonCandidate[]> {
  for (let i = 0; i < attempts; i++) {
    const people = harvest()
    if (people.length > 0) return people
    await sleepMs(intervalMs)
  }
  return harvest()
}
