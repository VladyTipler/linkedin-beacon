// Content-script DOM action executors — the ONLY code that mutates LinkedIn.
// Thin edge over FeedReader (locate) + validated techniques (see
// docs/linkedin-dom-anchors.md). Real like-toggle / comment-submit acceptance is
// confirmed in field tests; the locate + skip-if-liked logic is unit-tested.

import { FeedReader } from '@lib/feed/FeedReader'
import type { HumanDelay } from '@lib/engagement/HumanDelay'

const REACTION = 'button[aria-label^="Reaction button state"]'
const NOT_LIKED = 'Reaction button state: no reaction'
const COMMENT_BTN = 'button[aria-label="Comment"]'
const EDITOR = '[data-testid="ui-core-tiptap-text-editor-wrapper"] [contenteditable="true"]'

// ── Post composer (share box). Lives in a SHADOW DOM; editor is Quill, which
// commits its model ASYNCHRONOUSLY. See docs/linkedin-dom-anchors.md "Post composer". ──
const POST_TRIGGER = '[aria-label="Start a post"]'
const SHADOW_HOST = '#interop-outlet'
const QL_EDITOR = '[data-test-ql-editor-contenteditable="true"]'
const POST_SUBMIT = 'button.share-actions__primary-action'
const DISMISS = 'button[aria-label="Dismiss"]'

export type ActionResult = { ok: true; already?: boolean } | { ok: false; reason: string }

const reader = new FeedReader()

/**
 * The comment editor SCOPED to the post matching `urn`. The editor renders INSIDE the post's
 * (visible/expanded) [componentkey] node — verified live 2026-06-29 — so we re-find the post
 * and query within it. A global `document.querySelector(EDITOR)` returns the FIRST open editor
 * on the page, so once one post's composer was open every later comment piled onto it (the
 * "all 5 comments under one post" bug). Re-finds the post each call → robust to re-render.
 */
export function findPostEditor(root: ParentNode, urn: string): HTMLElement | null {
  return reader.findByUrn(root, urn)?.querySelector<HTMLElement>(EDITOR) ?? null
}

/** Like a post by urn. No-op (success) if already liked — like dedup. */
export function executeLike(root: ParentNode, urn: string): ActionResult {
  const post = reader.findByUrn(root, urn)
  if (!post) return { ok: false, reason: 'post_not_found' }
  const button = post.querySelector<HTMLElement>(REACTION)
  if (!button) return { ok: false, reason: 'like_button_not_found' }
  if (button.getAttribute('aria-label') !== NOT_LIKED) return { ok: true, already: true }
  button.click()
  return { ok: true }
}

/**
 * Comment on a post: open the editor, type the text char-by-char (ProseMirror
 * accepts execCommand insertText — validated live), then submit. Human-paced via
 * the injected HumanDelay. Edge — exercised in field tests, not jsdom.
 */
export async function executeComment(
  root: ParentNode,
  urn: string,
  text: string,
  delay: HumanDelay
): Promise<ActionResult> {
  const post = reader.findByUrn(root, urn)
  if (!post) return { ok: false, reason: 'post_not_found' }
  const open = post.querySelector<HTMLElement>(COMMENT_BTN)
  if (!open) return { ok: false, reason: 'comment_button_not_found' }
  open.click()

  // Scope the editor to THIS post (re-found each poll) — never a global query, which would
  // grab the first open composer on the page and pile every comment onto one post.
  const editor = await waitForValue<HTMLElement>(() => findPostEditor(root, urn), 5000)
  if (!editor) return { ok: false, reason: 'editor_not_found' }
  editor.focus()
  placeCaretAtEnd(editor)

  // Paste the whole comment at once (same fix as the post composer): faster + no newline bug.
  document.execCommand('insertText', false, text)
  await sleep(delay.nextMs(300, 900))

  // ProseMirror commits the pasted text into its model ASYNCHRONOUSLY (MutationObserver), so
  // the Comment button stays disabled for a few ticks. Poll findSubmit (re-query each poll —
  // artdeco may REPLACE the button node on the disabled→enabled re-render, so a captured
  // reference would read stale `disabled=true` forever) until it enables, like executeComposerPost.
  // Scope from the editor: the submit lives in the editor's comment-box block, NOT in the post node.
  const submit = await waitForValue(() => findSubmit(editor), 4000)
  if (!submit) return { ok: false, reason: 'submit_not_found' }
  submit.click()
  return { ok: true }
}

/**
 * Find the comment submit button, scoped from the open tiptap editor.
 *
 * LinkedIn renders the submit OUTSIDE the [componentkey] post node, in the comment-box
 * block that also holds the editor — so a `post.querySelector` never sees it (the comment
 * "was typed but never sent" bug). The submit has NO aria-label, only `textContent`
 * "Comment"; the OPENER is `button[aria-label="Comment"]` whose textContent is the comment
 * COUNT. We walk up from the editor to the block, match by textContent, and prefer the
 * button WITHOUT aria-label — otherwise we'd grab the opener and re-toggle the editor
 * instead of posting. Filters `disabled` (ProseMirror commits the pasted text async).
 */
export function findSubmit(editor: Element): HTMLElement | null {
  let node: Element | null = editor
  for (let i = 0; i < 8 && node; i++) {
    // ALL submit-text buttons in this ancestor (enabled OR disabled). The FIRST ancestor that
    // holds one is THIS editor's own comment-box — STOP there. Don't keep walking up past a
    // disabled submit, or on a shared feed ancestor we'd grab a SIBLING post's still-open enabled
    // submit and post this comment under the wrong post (the "N comments piled on one post" bug).
    const submits = Array.from(node.querySelectorAll<HTMLButtonElement>('button')).filter((b) =>
      /^(comment|post|reply)$/i.test((b.textContent ?? '').trim())
    )
    if (submits.length) {
      // While THIS box's submit is still disabled (ProseMirror commit pending), return null so the
      // caller polls THIS box until it enables — never a sibling's. Submit has no aria-label; the
      // opener does — prefer the unlabeled one.
      const enabled = submits.filter((b) => !b.disabled)
      return enabled.find((b) => !b.getAttribute('aria-label')) ?? enabled[0] ?? null
    }
    node = node.parentElement
  }
  return null
}

export interface ComposerHandle {
  editor: HTMLElement
  post: HTMLButtonElement
  shadow: ShadowRoot
}

/**
 * Locate the composer editor + Post button STRICTLY inside #interop-outlet's open
 * shadow root. A plain document query would grab the decoy `.ql-editor` in the hidden
 * `/preload` iframe — so we never query globally. Returns null if the modal isn't open.
 */
export function findComposer(root: ParentNode): ComposerHandle | null {
  const host = root.querySelector(SHADOW_HOST) as HTMLElement | null
  const shadow = host?.shadowRoot ?? null
  if (!shadow) return null
  const editor = shadow.querySelector<HTMLElement>(QL_EDITOR)
  const post = shadow.querySelector<HTMLButtonElement>(POST_SUBMIT)
  if (!editor || !post) return null
  return { editor, post, shadow }
}

/**
 * Publish a post: open the composer, type the text char-by-char (Quill accepts
 * execCommand insertText, but commits its model ASYNCHRONOUSLY — so we POLL the Post
 * button until it enables before clicking), submit, confirm the modal closed. On any
 * failure → Dismiss → Discard (never leave a half-draft). Edge — the typing path is
 * exercised live, not in jsdom.
 */
export async function executeComposerPost(
  root: Document,
  text: string,
  delay: HumanDelay
): Promise<ActionResult> {
  if (!text.trim()) return { ok: false, reason: 'empty_text' }
  const trigger = root.querySelector<HTMLElement>(POST_TRIGGER)
  if (!trigger) return { ok: false, reason: 'composer_trigger_not_found' }
  trigger.click()

  const handle = await waitForValue(() => findComposer(root), 6000)
  if (!handle) return { ok: false, reason: 'composer_not_found' }
  const { editor, shadow } = handle

  editor.focus()
  placeCaretAtEnd(editor, shadow)
  // Paste the whole text at once (like pasting from a draft), NOT char-by-char. Faster, and
  // avoids the newline bug where per-char insertText pushed a new paragraph ABOVE the old one.
  // Quill/ProseMirror accept execCommand('insertText') with multi-line text in one shot.
  root.execCommand('insertText', false, text)
  await sleep(delay.nextMs(300, 900)) // brief human pause before the Post button enables

  // Quill registers via MutationObserver → the Post button enables on a later tick.
  // Re-query the button each poll/click via findComposer: artdeco/Ember may REPLACE
  // the button node on the disabled→enabled re-render, so a captured reference would
  // read a stale `disabled=true` forever (a false post_button_disabled failure).
  const ready = await waitForCond(() => findComposer(root)?.post.disabled === false, 4000)
  if (!ready) {
    await dismissComposer(shadow)
    return { ok: false, reason: 'post_button_disabled' }
  }
  findComposer(root)?.post.click()

  // Generous close-detection: a slow network can delay the modal teardown; too short a
  // window yields a false-negative (post landed, we report failure → draft kept → re-post).
  const closed = await waitForCond(() => findComposer(root) === null, 12000)
  if (!closed) {
    await dismissComposer(shadow)
    return { ok: false, reason: 'modal_did_not_close' }
  }
  return { ok: true }
}

/** Abandon the composer cleanly: Dismiss → confirm Discard (NOT "Save as draft"). */
async function dismissComposer(shadow: ShadowRoot): Promise<void> {
  shadow.querySelector<HTMLElement>(DISMISS)?.click()
  const discard = await waitForValue(
    () =>
      [...shadow.querySelectorAll<HTMLElement>('button')].find(
        (b) => (b.textContent ?? '').trim().toLowerCase() === 'discard'
      ) ?? null,
    2000
  )
  discard?.click()
}

/** Caret at the end of `el`; selection scoped to `shadow` when the editor lives in one. */
function placeCaretAtEnd(el: HTMLElement, shadow?: ShadowRoot): void {
  const selection =
    (shadow as unknown as { getSelection?: () => Selection | null } | undefined)?.getSelection?.() ??
    window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Poll a predicate until true or timeout. Returns whether it became true. */
async function waitForCond(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) return true
    await sleep(100)
  }
  return false
}

/** Poll a factory until it returns non-null or timeout. */
async function waitForValue<T>(find: () => T | null, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const v = find()
    if (v) return v
    await sleep(100)
  }
  return null
}

// ── Smart Connect: people-search invite. Connect control is an <a>; the invite
// modal renders ASYNC in the #interop-outlet shadow root (same host as composer).
// See docs/linkedin-dom-anchors.md "Smart Connect". ──
const SEND_NO_NOTE = 'button[aria-label="Send without a note"]'
const INVITE_DISMISS = 'button[aria-label="Dismiss"]'

/** The live invite-modal's "Send without a note" button (re-queried each poll). */
function findSendNoNote(root: ParentNode): HTMLButtonElement | null {
  const shadow = (root.querySelector(SHADOW_HOST) as HTMLElement | null)?.shadowRoot ?? null
  return shadow?.querySelector<HTMLButtonElement>(SEND_NO_NOTE) ?? null
}

/**
 * Send a bare connection request to a harvested candidate: click the Connect `<a>`
 * (located by member id), wait for the shadow invite modal, click "Send without a
 * note", confirm it closed. On failure → Dismiss. Edge — the real send is exercised
 * live, not in jsdom.
 */
export async function executeConnect(
  root: Document,
  candidate: { memberId: string; name: string },
  delay: HumanDelay
): Promise<ActionResult> {
  const anchor = root.querySelector<HTMLElement>(
    `[componentkey*="member:${candidate.memberId}_connect"]`
  )
  if (!anchor) return { ok: false, reason: 'connect_anchor_not_found' }
  anchor.click()

  const send = await waitForValue(() => findSendNoNote(root), 6000)
  if (!send) {
    ;(root.querySelector(SHADOW_HOST) as HTMLElement | null)?.shadowRoot
      ?.querySelector<HTMLElement>(INVITE_DISMISS)
      ?.click()
    return { ok: false, reason: 'send_button_not_found' }
  }
  await sleep(delay.nextMs(300, 900)) // brief human pause before sending
  send.click()

  const closed = await waitForCond(() => findSendNoNote(root) === null, 6000)
  if (!closed) return { ok: false, reason: 'modal_did_not_close' }
  return { ok: true }
}
