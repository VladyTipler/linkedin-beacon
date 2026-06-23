import { describe, it, expect } from 'vitest'
import { DomSelectorStrategy } from './DomSelectorStrategy'
import { TextScanStrategy } from './TextScanStrategy'

function dom(html: string): ParentNode {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

describe('DomSelectorStrategy', () => {
  const strategy = new DomSelectorStrategy()

  it('reads total, four pillars and ranks from tagged nodes', () => {
    const root = dom(`
      <div data-beacon-ssi="total">71</div>
      <div data-beacon-pillar="brand">18</div>
      <div data-beacon-pillar="people">20</div>
      <div data-beacon-pillar="insights">15</div>
      <div data-beacon-pillar="relationships">18</div>
      <span data-beacon-rank="industry">Top 4%</span>
      <span data-beacon-rank="network">Top 1%</span>
    `)
    const r = strategy.parse(root)
    expect(r?.total).toBe(71)
    expect(r?.pillars.map((p) => p.score)).toEqual([18, 20, 15, 18])
    expect(r?.industryRank).toBe('Top 4%')
    expect(r?.networkRank).toBe('Top 1%')
  })

  it('derives total from pillars when total node is absent', () => {
    const root = dom(`
      <div class="ssi-pillar-brand">18</div>
      <div class="ssi-pillar-people">20</div>
      <div class="ssi-pillar-insights">15</div>
      <div class="ssi-pillar-relationships">18</div>
    `)
    expect(strategy.parse(root)?.total).toBe(71)
  })

  it('returns null when no pillar nodes exist', () => {
    expect(strategy.parse(dom('<div>nothing here</div>'))).toBeNull()
  })

  it('clamps an out-of-range pillar score', () => {
    const root = dom('<div data-beacon-pillar="brand">99</div>')
    expect(strategy.parse(root)?.pillars[0].score).toBe(25)
  })
})

describe('TextScanStrategy', () => {
  const strategy = new TextScanStrategy()

  it('extracts pillar scores from loose English text', () => {
    const root = dom(`
      <h1>Your Social Selling Index</h1>
      <p>Establish your professional brand 18</p>
      <p>Find the right people 20</p>
      <p>Engage with insights 15</p>
      <p>Build relationships 18</p>
    `)
    const r = strategy.parse(root)
    expect(r?.total).toBe(71)
    expect(r?.pillars).toHaveLength(4)
  })

  it('does not apply when the page is not an SSI page', () => {
    expect(strategy.parse(dom('<p>Find the right people 20</p>'))).toBeNull()
  })
})
