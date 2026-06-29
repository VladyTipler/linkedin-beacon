/**
 * The logged-in user's display name, read from the feed chrome — so the engagement
 * loop never likes or comments the OWNER's own posts (the 2026-06-29 self-engagement
 * bug: an auto-published post sat atop the feed and got self-liked + commented ×3).
 *
 * Two hash-/locale-independent anchors, both validated live on Vlad's account:
 *  1. The left-rail self-card is the FIRST `/in/<vanity>` link on the page (it renders
 *     above the feed), so the first profile link gives the owner's vanity.
 *  2. The owner's clean name is the `alt` of an avatar <img> inside an
 *     `a[href*="/in/<vanity>"]`. The owner has SEVERAL such anchors (self-card, nav avatar,
 *     …) and only one carries the name — the others ship an EMPTY alt (verified live), so we
 *     take the first NON-EMPTY alt (whitespace-normalised; LinkedIn adds stray spaces).
 *
 * Returns null when no usable name is found — callers fail OPEN (keep liking, log a
 * warning) rather than block the whole engagement run on a single selector miss.
 */
export function readOwnerName(root: ParentNode): string | null {
  const firstProfile = root.querySelector<HTMLAnchorElement>('a[href*="/in/"]')
  const vanity = firstProfile?.getAttribute('href')?.match(/\/in\/([^/?]+)/)?.[1]
  if (!vanity) return null
  for (const img of root.querySelectorAll<HTMLImageElement>(`a[href*="/in/${vanity}"] img[alt]`)) {
    const name = (img.getAttribute('alt') ?? '').replace(/\s+/g, ' ').trim()
    if (name) return name
  }
  return null
}
