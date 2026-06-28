/**
 * Build the LinkedIn people-search URL for the given keywords.
 *
 * `geoUrns` is ACCEPTED but IGNORED: verified live (2026-06-28) that any geoUrn format
 * (JSON array, single, comma-separated) makes `/search/results/people/` stop returning
 * CONNECTABLE people — 0 "Invite to connect" anchors, the page shows search suggestions /
 * company entities instead. A bare `keywords=…` global search returns connectable people,
 * so regions are dropped here. Region targeting is a TODO once a working multi-region
 * people-search format is found (the URL facet, the API facet, or a Sales Navigator path).
 */
export function peopleSearchUrl(keywords: string, _geoUrns: string[] = []): string {
  const q = encodeURIComponent(keywords.trim())
  return `https://www.linkedin.com/search/results/people/?keywords=${q}`
}
