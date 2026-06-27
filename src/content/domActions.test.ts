import { describe, it, expect, beforeEach } from 'vitest'
import { executeLike, findComposer, findSubmit } from './domActions'

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

// Build the real composer shape: an OPEN shadow root on #interop-outlet holding the
// sharebox modal, Quill editor and Post button — plus a DECOY .ql-editor in the light
// DOM (the /preload copy) that the adapter must ignore. (Live recon 2026-06-26.)
function mountComposer(): Document {
  document.body.innerHTML = `
    <div id="decoy"><div class="ql-editor" data-test-ql-editor-contenteditable="true">decoy</div></div>
    <div id="interop-outlet" data-testid="interop-shadowdom"></div>`
  const host = document.querySelector('#interop-outlet') as HTMLElement
  const sr = host.attachShadow({ mode: 'open' })
  sr.innerHTML = `
    <div data-test-modal-id="sharebox" role="dialog">
      <div class="ql-editor ql-blank" role="textbox"
           data-test-ql-editor-contenteditable="true"
           aria-label="Text editor for creating content"></div>
      <button class="share-actions__primary-action artdeco-button" disabled>Post</button>
      <button aria-label="Dismiss">x</button>
    </div>`
  return document
}

describe('findComposer', () => {
  it('locates the editor + Post button inside the #interop-outlet shadow root', () => {
    const handle = findComposer(mountComposer())
    expect(handle).not.toBeNull()
    expect(handle!.editor.getAttribute('aria-label')).toBe('Text editor for creating content')
    expect(handle!.post.textContent).toBe('Post')
  })

  it('ignores the decoy .ql-editor outside the shadow host', () => {
    const handle = findComposer(mountComposer())
    expect(handle!.editor.classList.contains('ql-blank')).toBe(true)
    expect(handle!.editor.textContent).toBe('')
  })

  it('returns null when the sharebox modal is not open', () => {
    document.body.innerHTML = `<div id="interop-outlet"></div>`
    ;(document.querySelector('#interop-outlet') as HTMLElement).attachShadow({ mode: 'open' })
    expect(findComposer(document)).toBeNull()
  })
})

// The comment submit button is Quill/ProseMirror-backed: it stays `disabled` until the
// editor commits the typed text into its model ASYNCHRONOUSLY (via MutationObserver).
// findSubmit must filter disabled — executeComment polls it until it returns a button.
describe('findSubmit', () => {
  // A post with ONLY the comment-submit button (the editor opener is exercised live via
  // CDP — its DOM relationship to the submit is not stable enough to fixture here).
  function postWith(submit: string): Element {
    const root = document.createElement('div')
    root.innerHTML = `<div componentkey="POST_X">${submit}</div>`
    return root.querySelector('[componentkey="POST_X"]')!
  }

  it('returns null while the submit button is still disabled (text not committed yet)', () => {
    const post = postWith(`<button aria-label="Comment" disabled>Comment</button>`)
    expect(findSubmit(post)).toBeNull()
  })

  it('returns the enabled Comment submit once the editor commits the model', () => {
    const post = postWith(`<button aria-label="Comment">Comment</button>`)
    const submit = findSubmit(post)
    expect(submit).not.toBeNull()
    expect(submit!.textContent).toBe('Comment')
  })

  it('also matches the Post label (LinkedIn A/B variant of the comment submit)', () => {
    const post = postWith(`<button aria-label="Post">Post</button>`)
    expect(findSubmit(post)?.getAttribute('aria-label')).toBe('Post')
  })
})
