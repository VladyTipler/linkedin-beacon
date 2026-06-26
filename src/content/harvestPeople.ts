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
 * Wait for the current people-search page to render its cards, then harvest it. Results
 * appear a few seconds AFTER the content script is ready, so a single read returns [].
 * Poll until cards appear or the attempts run out. Injectable for unit tests.
 */
export async function harvestPeoplePage(
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

/**
 * Harvest across pagination (the people-search list has NO infinite scroll — you switch
 * pages). Wait+harvest each page, accumulate unique candidates (by memberId), then click
 * to the next page; stop at the target, the page cap, or when there's no next page.
 * `harvestPage`/`nextPage` are injected so the loop is unit-testable without a live DOM.
 */
export async function harvestPeoplePaginated(
  harvestPage: () => Promise<PersonCandidate[]>,
  nextPage: () => Promise<boolean>,
  opts: { target?: number; maxPages?: number } = {}
): Promise<PersonCandidate[]> {
  const { target = 30, maxPages = 5 } = opts
  const acc = new Map<string, PersonCandidate>()
  for (let page = 0; page < maxPages; page++) {
    for (const p of await harvestPage()) if (!acc.has(p.memberId)) acc.set(p.memberId, p)
    if (acc.size >= target) break
    if (!(await nextPage())) break
  }
  return [...acc.values()]
}
