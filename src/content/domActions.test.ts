import { describe, it, expect, beforeEach } from 'vitest'
import { executeLike } from './domActions'

// Same real anchors as FeedReader: post root [componentkey] + reaction button.
const FIXTURE = `
<div componentkey="POST_AAA">
  <button aria-label="Open control menu for post by Jane">⋯</button>
  <button aria-label="Reaction button state: no reaction">React</button>
  <button aria-label="Comment">Comment</button>
</div>
<div componentkey="POST_BBB">
  <button aria-label="Open control menu for post by Acme">⋯</button>
  <button aria-label="Reaction button state: Like">React</button>
  <button aria-label="Comment">Comment</button>
</div>`

describe('executeLike', () => {
  let root: HTMLElement
  let clicks: string[]

  beforeEach(() => {
    root = document.createElement('div')
    root.innerHTML = FIXTURE
    clicks = []
    root.querySelectorAll('button[aria-label^="Reaction button state"]').forEach((b) =>
      b.addEventListener('click', () => clicks.push(b.getAttribute('aria-label') ?? ''))
    )
  })

  it('clicks the reaction button of a not-yet-liked post', () => {
    const res = executeLike(root, 'POST_AAA')
    expect(res).toEqual({ ok: true })
    expect(clicks).toEqual(['Reaction button state: no reaction'])
  })

  it('skips an already-liked post without clicking (like dedup)', () => {
    const res = executeLike(root, 'POST_BBB')
    expect(res).toEqual({ ok: true, already: true })
    expect(clicks).toEqual([])
  })

  it('reports when the post is not on the page', () => {
    expect(executeLike(root, 'POST_ZZZ')).toEqual({ ok: false, reason: 'post_not_found' })
  })
})
