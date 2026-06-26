import { describe, it, expect } from 'vitest'
import { REGION_GEO, REGION_KEYS, geoUrnsForRegions } from './regions'

describe('connect regions', () => {
  it('exposes the verified region keys', () => {
    expect(REGION_KEYS).toEqual(['US', 'Canada', 'UAE', 'Europe', 'Asia'])
    expect(REGION_GEO.US).toEqual(['103644278'])
    expect(REGION_GEO.Europe).toEqual(['101282230', '101165590'])
  })

  it('flattens + dedups geoUrns for the selected regions; ignores unknown keys', () => {
    expect(geoUrnsForRegions(['US', 'Canada'])).toEqual(['103644278', '101174742'])
    expect(geoUrnsForRegions(['Europe'])).toEqual(['101282230', '101165590'])
    expect(geoUrnsForRegions(['US', 'bogus'])).toEqual(['103644278'])
    expect(geoUrnsForRegions([])).toEqual([])
  })
})
