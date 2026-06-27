import type { PersonCandidate, HarvestResult } from '@lib/types'

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
 * Wait for the current people-search page to render, then harvest it. Results appear a
 * few seconds AFTER the content script is ready, so a single read returns []. Poll until
 * EITHER cards render (`ok`) OR the "No results found" empty-state renders (`empty`,
 * early-exit so a genuinely-empty search stays fast). If neither shows within the budget,
 * report `not_ready` — the page never rendered (slow/failed nav), which is a DIFFERENT bug
 * from an empty search and must be reported as such. Injectable for unit tests.
 */
export async function harvestPeoplePage(
  harvest: () => PersonCandidate[],
  sleepMs: (ms: number) => Promise<void>,
  isEmptyState: () => boolean,
  attempts = 24,
  intervalMs = 500
): Promise<HarvestResult> {
  for (let i = 0; i < attempts; i++) {
    const people = harvest()
    if (people.length > 0) return { candidates: people, outcome: 'ok' }
    if (isEmptyState()) return { candidates: [], outcome: 'empty' }
    await sleepMs(intervalMs)
  }
  const people = harvest()
  if (people.length > 0) return { candidates: people, outcome: 'ok' }
  return { candidates: [], outcome: isEmptyState() ? 'empty' : 'not_ready' }
}

/**
 * Harvest across pagination (the people-search list has NO infinite scroll — you switch
 * pages). Wait+harvest each page, accumulate unique candidates (by memberId), then click
 * to the next page; stop at the target, the page cap, or when there's no next page.
 * If the FIRST page is not `ok` (empty search / never rendered) propagate that outcome
 * without paginating — there's nothing to page through, and the reason matters upstream.
 * `harvestPage`/`nextPage` are injected so the loop is unit-testable without a live DOM.
 */
export async function harvestPeoplePaginated(
  harvestPage: () => Promise<HarvestResult>,
  nextPage: () => Promise<boolean>,
  opts: { target?: number; maxPages?: number } = {}
): Promise<HarvestResult> {
  const { target = 30, maxPages = 5 } = opts
  const first = await harvestPage()
  if (first.outcome !== 'ok') return first
  const acc = new Map<string, PersonCandidate>()
  for (const p of first.candidates) acc.set(p.memberId, p)
  for (let page = 1; page < maxPages; page++) {
    if (acc.size >= target) break
    if (!(await nextPage())) break
    for (const p of (await harvestPage()).candidates) if (!acc.has(p.memberId)) acc.set(p.memberId, p)
  }
  return { candidates: [...acc.values()], outcome: 'ok' }
}
