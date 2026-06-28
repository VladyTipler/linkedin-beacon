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

// The comment submit lives in the same block as the tiptap editor, BUT NOT inside the
// [componentkey] post node — and it has NO aria-label (only textContent "Comment"). The
// opener, by contrast, is button[aria-label="Comment"] with textContent = the comment
// COUNT. So findSubmit scopes from the open editor, walks up to the comment-box block,
// and matches by textContent — preferring the button WITHOUT aria-label (the submit) over
// the opener (which would re-toggle the editor instead of posting).
describe('findSubmit', () => {
  // editor + its sibling submit, inside a shared comment-box block (real LinkedIn shape).
  function editorBlock(opts: { submit?: string; opener?: string; editor?: string }): {
    editor: HTMLElement
    block: HTMLElement
  } {
    const root = document.createElement('div')
    root.innerHTML = `<div class="comment-box">
      <div class="tiptap ProseMirror" contenteditable="true" data-editor="1">${opts.editor ?? ''}</div>
      <div class="actions">
        ${opts.opener ?? ''}
        ${opts.submit ?? ''}
      </div>
    </div>`
    return {
      editor: root.querySelector('[data-editor="1"]')!,
      block: root.querySelector('.comment-box')!,
    }
  }

  it('returns null while the submit is still disabled (ProseMirror has not committed the text)', () => {
    const { editor } = editorBlock({ submit: `<button disabled>Comment</button>` })
    expect(findSubmit(editor)).toBeNull()
  })

  it('finds the enabled submit by textContent, walking up from the editor to its block', () => {
    const { editor } = editorBlock({ submit: `<button>Comment</button>` })
    const submit = findSubmit(editor)
    expect(submit).not.toBeNull()
    expect(submit!.textContent!.trim()).toBe('Comment')
  })

  it('prefers the submit (no aria-label) over the opener (aria-label="Comment" + count), never clicks the opener', () => {
    // opener = aria-label="Comment", textContent = the count "5"; submit = no aria-label, text "Comment"
    const { editor, block } = editorBlock({
      opener: `<button aria-label="Comment">5</button>`,
      submit: `<button>Comment</button>`,
    })
    const submit = findSubmit(editor)
    expect(submit).not.toBeNull()
    expect(submit!.getAttribute('aria-label')).toBeNull() // the submit, not the opener
    expect(block.contains(submit!)).toBe(true)
  })
})
