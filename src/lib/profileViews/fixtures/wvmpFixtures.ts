// Real, PII-sanitized WVMP dumps captured live from Vlad's authorized LinkedIn
// session (2026-07-02). Boundary fixtures: the parser is tested against the ACTUAL
// SDUI response / rendered DOM shape. Names, companies, urns and tracking ids are
// stripped; the parse-relevant structure (the count + "Profile viewers in the past
// N days" anchor + distractor numbers) is preserved verbatim.

/** Slice of the real `sduiid=WvmpAnalytics` RSC flight response around the count. */
export const WVMP_RSC_FIXTURE = "_68c42f74 _5e8cf1a7 aed93a4a _1d77b675 _569bb824 _1e09f84a\",\"children\":[[\"$\",\"$L5\",null,{\"maxLineCountExpression\":0,\"textColorExpression\":176,\"textProps\":{\"fontFamily\":\"sans\",\"fontSize\":\"xlarge\",\"fontStyle\":\"normal\",\"fontWeight\":\"bold\",\"lineHeight\":\"default\",\"textAlign\":\"start\",\"children\":[\"45\"],\"offsetTop\":\"1x\",\"linkColorTokens\":\"$undefined\",\"linkHoverDecoration\":\"underline\"}}],[\"$\",\"$L5\",null,{\"maxLineCountExpression\":0,\"textColorExpression\":179,\"textProps\":{\"fontFamily\":\"sans\",\"fontSize\":\"small\",\"fontStyle\":\"normal\",\"fontWeight\":\"normal\",\"lineHeight\":\"open\",\"textAlign\":\"start\",\"children\":[\"Profile viewers in the past 90 days\"],\"linkColorTokens\":\"$undefined\",\"linkHoverDecoration\":\"underline\"}}]]}]]}],[\"$\",\"di"

/** Real rendered-analytics innerText prefix (with a distractor "3" badge). */
export const WVMP_DOM_FIXTURE = "Notifications\n3\nMe\nWho's viewed your profile\nPast 90 days\n45\nProfile viewers in the past 90 days\n"
