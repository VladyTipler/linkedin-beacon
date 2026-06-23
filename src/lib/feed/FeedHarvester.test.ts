import { describe, it, expect } from 'vitest'
import { FeedHarvester } from './FeedHarvester'

function dom(html: string): ParentNode {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

const FEED = `
  <div data-beacon-feed-item="a" data-urn="urn:li:activity:1">
    <span data-beacon-feed-author>Jane Dev</span>
    <div data-beacon-feed-text>Shipping Vue 3 islands at scale — lessons learned.</div>
  </div>
  <div data-beacon-feed-item="b" data-urn="urn:li:activity:2">
    <span data-beacon-feed-author>Recruiter Bob</span>
    <div data-beacon-feed-text>We are hiring senior frontend engineers.</div>
  </div>
  <div data-beacon-feed-item="c">
    <span data-beacon-feed-author>No Text Person</span>
  </div>
`

describe('FeedHarvester', () => {
  const harvester = new FeedHarvester()

  it('extracts author + excerpt for posts with text', () => {
    const items = harvester.harvest(dom(FEED), 10)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: 'urn:li:activity:1',
      author: 'Jane Dev'
    })
    expect(items[0].excerpt).toContain('Vue 3')
  })

  it('respects the limit', () => {
    expect(harvester.harvest(dom(FEED), 1)).toHaveLength(1)
  })

  it('skips posts without text content', () => {
    const items = harvester.harvest(dom(FEED), 10)
    expect(items.find((i) => i.author === 'No Text Person')).toBeUndefined()
  })

  it('truncates very long excerpts', () => {
    const long = 'x'.repeat(400)
    const items = harvester.harvest(
      dom(`<div data-beacon-feed-item="z"><span data-beacon-feed-author>A</span><div data-beacon-feed-text>${long}</div></div>`),
      10
    )
    expect(items[0].excerpt.length).toBeLessThanOrEqual(280)
    expect(items[0].excerpt.endsWith('…')).toBe(true)
  })

  it('returns empty array on an empty page', () => {
    expect(harvester.harvest(dom('<main></main>'), 10)).toEqual([])
  })
})
