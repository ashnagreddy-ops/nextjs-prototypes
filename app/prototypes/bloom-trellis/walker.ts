import * as C from "./config"
import { clamp, invEaseOutCubic, wrapAngle } from "./ease"
import type { Rng } from "./rng"

// Curvature-driven stems. A stem is a WALK_STEPS walk over u in [0, 1]: the heading turns by
// k(u) du, where k is linear in u (so it changes sign at most once), plus a pull toward straight
// down of g * u^2 * GRAVITY_K per radian off vertical. No noise, no wiggle, no phase. The walk
// is joined with Catmull-Rom cubics and flattened for drawing.

const DOWN = Math.PI / 2
const TAU = Math.PI * 2

export type Curve = {
  k0: number // curvature at u = 0, as total radians over the stem
  k1: number // at u = 1
  g: number // gravity strength
  gFrom?: number // gravity only acts past this u (ramped in), default 0
}

export type Spiral = { turns: number; r0: number; tighten: number }

// The raw walk. Returns points and the number of points in the main run (before any spiral).
export function walk(x: number, y: number, heading: number, L: number, c: Curve, spiral?: Spiral) {
  const ds = L / C.WALK_STEPS
  const du = 1 / C.WALK_STEPS
  const xy = [x, y]
  let th = heading
  let lastTurn = 0
  for (let i = 0; i < C.WALK_STEPS; i++) {
    const u = (i + 0.5) * du
    const k = c.k0 + (c.k1 - c.k0) * u
    const ramp = c.gFrom ? clamp((u - c.gFrom) / Math.max(0.05, (1 - c.gFrom) / 2), 0, 1) : 1
    const pull = c.g * u * u * ramp * C.GRAVITY_K * wrapAngle(DOWN - th)
    lastTurn = k + pull
    th += lastTurn * du
    x += Math.cos(th) * ds
    y += Math.sin(th) * ds
    xy.push(x, y)
  }
  const main = xy.length / 2
  if (spiral) {
    // keep turning the way the stem already bends, radius shrinking toward the centre
    const sign = Math.sign(lastTurn || 1)
    const total = spiral.turns * TAU
    for (let acc = 0; acc < total; ) {
      const r = spiral.r0 * (1 - spiral.tighten * (acc / total))
      const step = Math.min(ds, r * 0.35)
      th += (sign * step) / r
      acc += step / r
      x += Math.cos(th) * step
      y += Math.sin(th) * step
      xy.push(x, y)
    }
  }
  return { xy, main }
}

// Linear curvature with at most one inflection: same sign at both ends unless INFLECT_CHANCE,
// in which case the sign flips somewhere in the middle third. `bias` picks the overall direction.
export function curve(rng: Rng, [lo, hi]: readonly [number, number], g: number, bias: number = rng.sign()): Curve {
  const total = rng.range(lo, hi) * Math.sign(bias || 1)
  if (rng.next() < C.INFLECT_CHANCE) {
    const at = rng.range(0.35, 0.65) // k crosses zero here
    // k(u) = a (u - at): an S-bend whose stronger end turns by about `total`
    const a = (1.6 * total) / Math.max(at, 1 - at)
    return { k0: -a * at, k1: a * (1 - at), g }
  }
  const skew = rng.range(0.4, 1.6) // how the turn is spread along the stem
  return { k0: total * (2 - skew), k1: total * skew, g }
}

// Catmull-Rom through every walk point, flattened with BEZIER_SAMPLES per segment.
export function smooth(xy: number[], main: number) {
  const n = xy.length / 2
  const P = (i: number) => {
    const j = clamp(i, 0, n - 1) * 2
    return [xy[j], xy[j + 1]]
  }
  const out: number[] = [xy[0], xy[1]]
  let mainOut = 1
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = P(i - 1)
    const [x1, y1] = P(i)
    const [x2, y2] = P(i + 1)
    const [x3, y3] = P(i + 2)
    const b1x = x1 + (x2 - x0) / 6
    const b1y = y1 + (y2 - y0) / 6
    const b2x = x2 - (x3 - x1) / 6
    const b2y = y2 - (y3 - y1) / 6
    for (let k = 1; k <= C.BEZIER_SAMPLES; k++) {
      const t = k / C.BEZIER_SAMPLES
      const u = 1 - t
      out.push(
        u * u * u * x1 + 3 * u * u * t * b1x + 3 * u * t * t * b2x + t * t * t * x2,
        u * u * u * y1 + 3 * u * u * t * b1y + 3 * u * t * t * b2y + t * t * t * y2
      )
    }
    if (i + 1 < main) mainOut = out.length / 2
  }
  const pts = Float32Array.from(out)
  const cum = new Float32Array(pts.length / 2)
  for (let i = 1; i < cum.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1])
  return { pts, cum, length: cum[cum.length - 1], mainLength: cum[mainOut - 1] }
}

function indexAt(cum: Float32Array, s: number) {
  let lo = 0
  let hi = cum.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid] < s) lo = mid
    else hi = mid
  }
  return { lo, hi }
}

// Point and tangent angle at arc length s.
export function sampleAt(v: { pts: Float32Array; cum: Float32Array }, s: number) {
  const { pts, cum } = v
  const { lo, hi } = indexAt(cum, s)
  const seg = cum[hi] - cum[lo] || 1
  const f = clamp((s - cum[lo]) / seg, 0, 1)
  const ax = pts[lo * 2]
  const ay = pts[lo * 2 + 1]
  const bx = pts[hi * 2]
  const by = pts[hi * 2 + 1]
  return { x: ax + (bx - ax) * f, y: ay + (by - ay) * f, angle: Math.atan2(by - ay, bx - ax) }
}

// Signed turning at arc length s (heading change over a short window): > 0 bends clockwise.
export function turnAt(v: { pts: Float32Array; cum: Float32Array; length: number }, s: number) {
  const h = Math.min(v.length * 0.08, 6)
  const a = sampleAt(v, Math.max(0, s - h)).angle
  const b = sampleAt(v, Math.min(v.length, s + h)).angle
  return wrapAngle(b - a)
}

// Time (plant clock) at which an eased-growing stem's tip passes arc length s.
export const tipPasses = (v: { start: number; duration: number; length: number }, s: number) =>
  v.start + invEaseOutCubic(clamp(s / v.length, 0, 1)) * v.duration
