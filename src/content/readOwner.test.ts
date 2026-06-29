import { describe, it, expect, beforeEach } from 'vitest'
import { readOwnerName } from './readOwner'

// Mirrors the LIVE feed chrome (validated 2026-06-29 via CDP on Vlad's account):
// the left-rail self-card is the FIRST `/in/` link on the page; the owner's clean
// display name is the `alt` of the avatar <img> inside `a[href*="/in/<vanity>"]`
// (the self-card text concatenates name+headline, but the avatar alt is clean —
// here LinkedIn even ships double/trailing spaces, so we normalise whitespace).
// Live reality (CDP 2026-06-29): the owner has SEVERAL `/in/<vanity>` anchors and only one
// carries the name — the first avatar's alt is EMPTY (""), the named one comes later. So the
// reader must skip blank alts, not grab the first img blindly.
const SELF_CARD = `
<aside>
  <a href="https://www.linkedin.com/in/v-sandz/"><img alt="" /></a>
  <a href="https://www.linkedin.com/in/v-sandz/"><img alt="Vladislav  Kanev " /></a>
  <a href="https://www.linkedin.com/in/v-sandz/">Vladislav KanevTechLead Frontend | Ex-TeamLead</a>
</aside>`

// A feed author's `/in/` link must NOT win over the self-card: the left rail renders
// ABOVE the feed, so the owner's link is first in DOM order.
const FEED_AUTHOR_AFTER = `
<div><a href="https://www.linkedin.com/in/danil-morozov/"><img alt="Danil Morozov" /></a></div>`

describe('readOwnerName', () => {
  let root: HTMLElement
  beforeEach(() => {
    root = document.createElement('div')
  })

  it('reads the owner display name from the self-card avatar alt (whitespace-normalised)', () => {
    root.innerHTML = SELF_CARD
    expect(readOwnerName(root)).toBe('Vladislav Kanev')
  })

  it('takes the FIRST /in/ link as the owner (self-card renders above the feed)', () => {
    root.innerHTML = SELF_CARD + FEED_AUTHOR_AFTER
    expect(readOwnerName(root)).toBe('Vladislav Kanev') // not "Danil Morozov"
  })

  it('returns null when there is no profile link at all (fail-open upstream)', () => {
    root.innerHTML = '<div>no profile here</div>'
    expect(readOwnerName(root)).toBeNull()
  })

  it('returns null when the self-card avatar has no usable alt', () => {
    root.innerHTML = '<a href="https://www.linkedin.com/in/v-sandz/"><img alt="  " /></a>'
    expect(readOwnerName(root)).toBeNull()
  })
})
