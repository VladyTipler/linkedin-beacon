// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { executeConnect } from './domActions'
import { HumanDelay } from '@lib/engagement/HumanDelay'

const delay = new HumanDelay({ next: () => 0 }) // zero waits in tests

/** Build a search card + a pre-rendered invite modal in the interop shadow root. */
function setup() {
  document.body.innerHTML = ''
  const a = document.createElement('a')
  a.setAttribute('componentkey', 'ConnectButtonstate:invitation:urn:li:member:123_connect')
  a.setAttribute('aria-label', 'Invite Test User to connect')
  document.body.appendChild(a)
  const host = document.createElement('div')
  host.id = 'interop-outlet'
  const sr = host.attachShadow({ mode: 'open' })
  document.body.appendChild(host)
  // Real LinkedIn JS opens the modal on click; jsdom can't, so attach the Send button
  // when the anchor is clicked (simulating the async modal render).
  a.addEventListener('click', () => {
    const send = document.createElement('button')
    send.setAttribute('aria-label', 'Send without a note')
    send.addEventListener('click', () => send.remove()) // sending closes the modal
    sr.appendChild(send)
  })
  return { sr }
}

describe('executeConnect (shadow-DOM boundary)', () => {
  it('clicks Connect, then Send without a note, and confirms the modal closed', async () => {
    setup()
    const res = await executeConnect(document, { memberId: '123', name: 'Test User' }, delay)
    expect(res).toEqual({ ok: true })
  })

  it('fails cleanly when the connect anchor is missing', async () => {
    document.body.innerHTML = ''
    const res = await executeConnect(document, { memberId: '999', name: 'X' }, delay)
    expect(res).toEqual({ ok: false, reason: 'connect_anchor_not_found' })
  })
})

/**
 * Same shadow-modal setup as `setup()`, but the Connect control is a `<button>` — the shape
 * PYMK (`/mynetwork/`) renders, vs. the `<a>` people-search uses. Tracks whether the invite
 * "Send without a note" button was actually clicked, not just that the modal appeared.
 */
function setupButtonControl() {
  document.body.innerHTML = ''
  const button = document.createElement('button')
  button.setAttribute('componentkey', 'ConnectButtonstate:invitation:urn:li:member:42_connect')
  button.setAttribute('aria-label', 'Invite Test User to connect')
  document.body.appendChild(button)
  const host = document.createElement('div')
  host.id = 'interop-outlet'
  const sr = host.attachShadow({ mode: 'open' })
  document.body.appendChild(host)
  let sendClicked = false
  button.addEventListener('click', () => {
    const send = document.createElement('button')
    send.setAttribute('aria-label', 'Send without a note')
    send.addEventListener('click', () => {
      sendClicked = true
      send.remove() // sending closes the modal
    })
    sr.appendChild(send)
  })
  return { wasSendClicked: () => sendClicked }
}

describe('executeConnect (PYMK button control)', () => {
  it('clicks a button Connect control, then Send without a note, and confirms the modal closed', async () => {
    const { wasSendClicked } = setupButtonControl()
    const res = await executeConnect(document, { memberId: '42', name: 'Test User' }, delay)
    expect(res).toEqual({ ok: true })
    expect(wasSendClicked()).toBe(true)
  })
})
