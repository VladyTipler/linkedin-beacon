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
