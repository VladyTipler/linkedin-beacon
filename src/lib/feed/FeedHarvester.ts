import type { FeedItem } from '../types'

/**
 * Reads posts from the LinkedIn feed DOM (engagement module, read-only in V1).
 * SRP: extraction only — it never likes, comments, or mutates the page.
 * Pure w.r.t. a given root, so it's unit-testable with a fixture.
 */
export class FeedHarvester {
  /** Selector for a feed post container. Confirm against a live capture. */
  private static readonly POST_SELECTOR =
    '[data-beacon-feed-item], div.feed-shared-update-v2, [data-urn*="urn:li:activity"]'

  harvest(root: ParentNode, limit: number): FeedItem[] {
    const nodes = Array.from(root.querySelectorAll(FeedHarvester.POST_SELECTOR))
    const items: FeedItem[] = []
    for (const node of nodes) {
      if (items.length >= limit) break
      const item = this.toItem(node, items.length)
      if (item) items.push(item)
    }
    return items
  }

  private toItem(node: Element, index: number): FeedItem | null {
    const author =
      this.text(node, '[data-beacon-feed-author], .update-components-actor__name') ??
      'Unknown'
    const excerpt = this.text(
      node,
      '[data-beacon-feed-text], .update-components-text, .feed-shared-update-v2__description'
    )
    if (!excerpt) return null
    const id =
      node.getAttribute('data-urn') ??
      node.getAttribute('data-beacon-feed-item') ??
      `feed-${index}`
    return { id, author, excerpt: this.trim(excerpt) }
  }

  private text(node: Element, selector: string): string | null {
    const el = node.querySelector(selector)
    const value = el?.textContent?.trim()
    return value && value.length > 0 ? value : null
  }

  private trim(text: string): string {
    const normalised = text.replace(/\s+/g, ' ').trim()
    return normalised.length > 280 ? `${normalised.slice(0, 277)}…` : normalised
  }
}
