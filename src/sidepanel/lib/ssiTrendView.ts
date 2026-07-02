/**
 * Build an SVG polyline `points` string for a sparkline. Pure view math so the
 * component stays dumb and this stays unit-tested.
 *
 * Y is inverted (SVG y grows downward): a higher value sits higher on screen.
 * A single value renders as a flat line spanning the width so it's still visible.
 * Values are clamped to [0, max].
 */
export function sparklinePoints(values: number[], w: number, h: number, max = 25): string {
  if (values.length === 0 || w <= 0 || h <= 0 || max <= 0) return ''
  const y = (v: number) => {
    const c = Math.min(max, Math.max(0, v))
    return round2(h - (c / max) * h)
  }
  if (values.length === 1) {
    const yy = y(values[0])
    return `0,${yy} ${round2(w)},${yy}`
  }
  const step = w / (values.length - 1)
  return values.map((v, i) => `${round2(i * step)},${y(v)}`).join(' ')
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Arrow glyph for a delta: ▲ up, ▼ down, ■ flat. */
export function deltaArrow(delta: number): '▲' | '▼' | '■' {
  if (delta > 0) return '▲'
  if (delta < 0) return '▼'
  return '■'
}

/** Signed, 1dp label without trailing ".0" — e.g. 4.8 → "+4.8", -3 → "−3", 0 → "0". */
export function deltaLabel(delta: number): string {
  const r = Math.round(delta * 10) / 10
  if (r === 0) return '0'
  const sign = r > 0 ? '+' : '−'
  const abs = Math.abs(r)
  return `${sign}${Number.isInteger(abs) ? abs : abs.toFixed(1)}`
}
