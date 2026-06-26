/** Build the LinkedIn people-search URL for the given keywords. Pure. */
export function peopleSearchUrl(keywords: string): string {
  const q = encodeURIComponent(keywords.trim())
  return `https://www.linkedin.com/search/results/people/?keywords=${q}`
}
