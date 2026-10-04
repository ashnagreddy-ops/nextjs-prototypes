// Polylines with cumulative distances, and an incremental tapered painter.

export type Stroke = {
  pts: Float32Array // x,y pairs
  cum: Float32Array // cumulative distance at each point
  length: number
  w0: number // width at base
  w1: number // width at tip
  start: number // ms on the glyph clock
  duration: number
  drawn: number // px already painted
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
export const invEaseOutCubic = (p: number) => 1 - Math.cbrt(1 - p)
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// Eased progress 0–1 of something that starts at `start` and lasts `duration`.
export const progress = (age: number, start: number, duration: number) =>
  easeOutCubic(clamp((age - start) / duration, 0, 1))

export function polyline(xy: ArrayLike<number>) {
  const n = xy.length / 2
  const pts = Float32Array.from(xy)
  const cum = new Float32Array(n)
  for (let i = 1; i < n; i++)
    cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1])
  return { pts, cum, length: cum[n - 1] }
}

// Sampled quadratic bezier from (x, y) heading `angle` for `length`, bowed sideways by `bend`.
export function bezier(x: number, y: number, angle: number, length: number, bend: number, step = 1) {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const x2 = x + dx * length
  const y2 = y + dy * length
  const x1 = (x + x2) / 2 - dy * bend * length
  const y1 = (y + y2) / 2 + dx * bend * length
  const n = Math.max(3, Math.ceil(length / step))
  const xy: number[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    xy.push(u * u * x + 2 * u * t * x1 + t * t * x2, u * u * y + 2 * u * t * y1 + t * t * y2)
  }
  return polyline(xy)
}

export function pointAt(s: { pts: Float32Array; cum: Float32Array }, d: number) {
  let lo = 0
  let hi = s.cum.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (s.cum[mid] <= d) lo = mid
    else hi = mid
  }
  const seg = s.cum[hi] - s.cum[lo] || 1
  const t = clamp((d - s.cum[lo]) / seg, 0, 1)
  const ax = s.pts[lo * 2]
  const ay = s.pts[lo * 2 + 1]
  const bx = s.pts[hi * 2]
  const by = s.pts[hi * 2 + 1]
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, angle: Math.atan2(by - ay, bx - ax), index: lo }
}

// Paint only stroke[from..to] onto the layers, width tapering along the full length.
// Each target is a context plus an offset (the shadow layer is drawn shifted).
export function paintSlice(
  targets: { ctx: CanvasRenderingContext2D; off: number }[],
  s: Stroke,
  from: number,
  to: number
) {
  const a = pointAt(s, from)
  const b = pointAt(s, to)
  let px = a.x
  let py = a.y
  let pd = from
  const seg = (x: number, y: number, d: number) => {
    const w = s.w0 + (s.w1 - s.w0) * ((pd + d) / 2 / s.length)
    for (const { ctx, off } of targets) {
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.moveTo(px + off, py + off)
      ctx.lineTo(x + off, y + off)
      ctx.stroke()
    }
    px = x
    py = y
    pd = d
  }
  for (let i = a.index + 1; i <= b.index; i++) seg(s.pts[i * 2], s.pts[i * 2 + 1], s.cum[i])
  seg(b.x, b.y, to)
}
