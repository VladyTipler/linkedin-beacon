/**
 * LinkedIn geoUrn location IDs by region, captured + VERIFIED live (2026-06-26):
 * each id was confirmed to return that country's people-search results. Region values
 * are OR'd into one search, so selecting several yields a mixed global result set
 * (no rotation needed). Expandable — add only geoUrns verified the same way.
 */
export const REGION_GEO: Record<string, string[]> = {
  US: ['103644278'],
  Canada: ['101174742'],
  UAE: ['104305776'],
  Europe: ['101282230', '101165590'], // Germany, United Kingdom
  Asia: ['102713980', '102454443'] // India, Singapore
}

export const REGION_KEYS = Object.keys(REGION_GEO)

/** Flattened, deduped geoUrns for the selected region keys (unknown keys ignored). */
export function geoUrnsForRegions(regions: string[]): string[] {
  const out = new Set<string>()
  for (const r of regions) for (const g of REGION_GEO[r] ?? []) out.add(g)
  return [...out]
}
