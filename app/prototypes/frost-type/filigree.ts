import * as C from "./config"
import { type Mask, distAt, gradAt } from "./mask"
import { type Rng, valueNoise } from "./rng"
import { type Stroke, bezier, clamp, invEaseOutCubic, pointAt, polyline } from "./stroke"

// Leaflet length envelope along the leafy section (same shape as the Frost ferns):
// short at the start, peaking at ENVELOPE_PEAK, tapering to nothing at the end.
function envelope(t: number) {
  if (t < C.ENVELOPE_PEAK)
    return C.ENVELOPE_BASE + (1 - C.ENVELOPE_BASE) * Math.sin((Math.PI / 2) * (t / C.ENVELOPE_PEAK))
  return Math.pow((1 - t) / (1 - C.ENVELOPE_PEAK), C.ENVELOPE_TIP_POWER)
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

// Walk a tendril through the mask: noise-steered heading, pushed back toward the
// interior when the look-ahead nears the edge, then a tightening curl at the end.
function walk(rng: Rng, m: Mask, sx: number, sy: number, heading: number, L: number, fs: number, margin: number) {
  const step = Math.max(1, C.STEP_EM * fs)
  const noise = valueNoise(rng)
  const noiseOffset = rng.range(0, 64)
  const curlDir = rng.sign()
  const curlAt = L * (1 - C.CURL_FRACTION)
  const curlLen = L - curlAt
  // curvature at the very tip, chosen so the curl turns CURL_TURNS times in total
  const kEnd = Math.min((C.CURL_TURNS * 2 * Math.PI * (C.CURL_POWER + 1)) / curlLen, 1 / C.CURL_MIN_RADIUS_PX)
  const look = Math.max(3, C.LOOKAHEAD_EM * fs)
  const maxTurn = (C.MAX_TURN_EM / fs) * step

  let x = sx
  let y = sy
  let a = heading
  let outside = 0
  const xy = [x, y]
  const n = Math.ceil(L / step)
  for (let i = 1; i <= n; i++) {
    const d = i * step
    if (d <= curlAt) {
      a += noise(noiseOffset + (d / fs) * C.NOISE_SCALE) * (C.STEER_STRENGTH / fs) * step
      const ax = x + Math.cos(a) * look
      const ay = y + Math.sin(a) * look
      const near = Math.min(distAt(m, ax, ay), distAt(m, x, y))
      const threat = clamp(1 - (near - margin) / look, 0, 1)
      if (threat > 0) {
        const g = gradAt(m, ax, ay) ?? gradAt(m, x, y) ?? normalize(m.cx - x, m.cy - y)
        const tx = Math.cos(a) + g.x * C.AVOID_GAIN * threat
        const ty = Math.sin(a) + g.y * C.AVOID_GAIN * threat
        a += clamp(wrapAngle(Math.atan2(ty, tx) - a), -maxTurn, maxTurn)
      }
    } else {
      const u = (d - curlAt) / curlLen
      a += curlDir * kEnd * Math.pow(u, C.CURL_POWER) * step
    }
    x += Math.cos(a) * step
    y += Math.sin(a) * step
    if (distAt(m, x, y) < 0.5) outside++
    xy.push(x, y)
  }
  return { path: polyline(xy), outside }
}

function normalize(x: number, y: number) {
  const l = Math.hypot(x, y) || 1
  return { x: x / l, y: y / l }
}

// Precompute every tendril and leaflet for one glyph. Start times are on the glyph clock;
// a leaflet starts when its tendril's eased growth passes it, so it appears behind the tip.
export function buildFiligree(rng: Rng, m: Mask, fs: number): Stroke[] {
  if (!m.area) return []
  const areaEm = m.area / (fs * fs)
  const count =
    areaEm < C.SMALL_GLYPH_AREA_EM2
      ? 1 + Math.round(rng.next())
      : clamp(Math.round(areaEm * C.TENDRILS_PER_EM2 + rng.range(-0.5, 0.5)), C.TENDRIL_COUNT_MIN, C.TENDRIL_COUNT_MAX)
  const lenScale = clamp(Math.sqrt(areaEm / C.TENDRIL_REF_AREA_EM2), C.TENDRIL_MIN_LENGTH_SCALE, 1)
  const widthScale = clamp(fs / C.STROKE_REF_FONT_PX, C.STROKE_MIN_SCALE, C.STROKE_MAX_SCALE)
  const margin = Math.min(C.EDGE_MARGIN, m.maxDist * 0.45)
  const startMin = Math.min(Math.max(margin + 1, C.START_MIN_EDGE_EM * fs), m.maxDist * 0.7)

  const candidates: number[] = []
  for (let i = 0; i < m.dist.length; i++) if (m.dist[i] >= startMin) candidates.push(i)
  if (!candidates.length) return []

  const starts: { x: number; y: number }[] = []
  const spacing = C.START_SPACING_EM * fs
  for (let tries = 0; starts.length < count && tries < 60; tries++) {
    const i = candidates[Math.floor(rng.next() * candidates.length)]
    const p = { x: (i % m.w) + 0.5, y: Math.floor(i / m.w) + 0.5 }
    if (tries < 40 && starts.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < spacing)) continue
    starts.push(p)
  }

  const strokes: Stroke[] = []
  for (const s of starts) {
    const L = fs * lenScale * rng.range(C.TENDRIL_LENGTH_MIN_EM, C.TENDRIL_LENGTH_MAX_EM)
    // head along the stroke (perpendicular to the inward gradient), either way
    const g = gradAt(m, s.x, s.y)
    const along = g ? Math.atan2(g.y, g.x) + (Math.PI / 2) * rng.sign() : rng.range(0, Math.PI * 2)
    let best: ReturnType<typeof walk> | null = null
    for (let k = 0; k < C.TENDRIL_ATTEMPTS; k++) {
      const w = walk(rng, m, s.x, s.y, along + rng.range(-0.4, 0.4), L, fs, margin)
      if (!best || w.outside < best.outside) best = w
      if (best.outside === 0) break
    }
    const path = best!.path
    const tendril: Stroke = {
      ...path,
      w0: C.TENDRIL_WIDTH_BASE * widthScale,
      w1: C.TENDRIL_WIDTH_TIP * widthScale,
      start: C.FILIGREE_DELAY + rng.range(0, C.FILIGREE_STAGGER),
      duration: rng.range(C.FILIGREE_DURATION_MIN, C.FILIGREE_DURATION_MAX),
      drawn: 0,
    }
    strokes.push(tendril)

    // paired leaflets on the middle section only
    const [s0, s1] = C.LEAFLET_SECTION
    const gap = C.LEAFLET_SPACING_EM * fs
    const lag = C.LEAFLET_LAG_EM * fs
    for (let d = path.length * s0; d <= path.length * s1; d += gap) {
      const u = (d - path.length * s0) / (path.length * (s1 - s0))
      const len = C.LEAFLET_LENGTH_EM * fs * envelope(u)
      const base = pointAt(path, d)
      const start = tendril.start + tendril.duration * invEaseOutCubic(Math.min(1, (d + lag) / path.length))
      for (const side of [-1, 1]) {
        const angle = base.angle + side * C.LEAFLET_ANGLE
        // shorten leaflets that would poke out of the glyph
        const probe = bezier(base.x, base.y, angle, len, side * C.LEAFLET_CURVE)
        let cut = probe.cum.length - 1
        for (let i = 1; i < probe.cum.length; i++)
          if (distAt(m, probe.pts[i * 2], probe.pts[i * 2 + 1]) < 1) {
            cut = i - 1
            break
          }
        const fit = probe.cum[cut]
        if (fit < C.LEAFLET_MIN_PX) continue
        const leaf = fit < len ? bezier(base.x, base.y, angle, fit, side * C.LEAFLET_CURVE) : probe
        const taper = 1 - u * 0.5
        strokes.push({
          ...leaf,
          w0: C.LEAFLET_WIDTH_BASE * widthScale * taper,
          w1: C.LEAFLET_WIDTH_TIP * widthScale,
          start,
          duration: C.LEAFLET_GROW_MS,
          drawn: 0,
        })
      }
    }
  }
  return strokes
}
