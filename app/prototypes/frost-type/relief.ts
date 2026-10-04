import * as C from "./config"
import { mix, rgba } from "./color"
import { type Phase, clamp, easeInOutCubic, easeOutBack, easeOutCubic, pointAt } from "./stroke"

// Carved-relief rendering. Each element is painted onto four stacked layers (glow, shadow,
// body, highlight) as opaque colour; alpha and the glow blur are applied when compositing,
// so overlapping segment joins never bead brighter.

export type Layer = { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D }
export type Relief = { glow: Layer; shadow: Layer; body: Layer; hi: Layer }

export function makeLayer(w: number, h: number, dpr: number): Layer {
  const c = document.createElement("canvas")
  c.width = Math.round(w * dpr)
  c.height = Math.round(h * dpr)
  const ctx = c.getContext("2d")!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  return { c, ctx }
}

export function makeRelief(w: number, h: number, dpr: number): Relief {
  const r = { glow: makeLayer(w, h, dpr), shadow: makeLayer(w, h, dpr), body: makeLayer(w, h, dpr), hi: makeLayer(w, h, dpr) }
  r.glow.ctx.fillStyle = r.glow.ctx.strokeStyle = C.ICE_HIGHLIGHT
  r.shadow.ctx.fillStyle = r.shadow.ctx.strokeStyle = C.RELIEF_SHADOW
  r.hi.ctx.fillStyle = r.hi.ctx.strokeStyle = C.RELIEF_HIGHLIGHT
  return r
}

export const reliefLayers = (r: Relief) => [r.glow, r.shadow, r.body, r.hi]

export function drawRelief(ctx: CanvasRenderingContext2D, r: Relief, w: number, h: number, dpr: number) {
  ctx.save()
  ctx.globalAlpha = C.RELIEF_GLOW_ALPHA
  if (typeof ctx.filter === "string") ctx.filter = `blur(${C.RELIEF_GLOW_BLUR_PX * dpr}px)`
  ctx.drawImage(r.glow.c, 0, 0, w, h)
  ctx.filter = "none"
  ctx.globalAlpha = C.RELIEF_SHADOW_ALPHA
  ctx.drawImage(r.shadow.c, 0, 0, w, h)
  ctx.globalAlpha = 1
  ctx.drawImage(r.body.c, 0, 0, w, h)
  ctx.globalAlpha = C.RELIEF_HIGHLIGHT_ALPHA
  ctx.drawImage(r.hi.c, 0, 0, w, h)
  ctx.restore()
}

// Keep a relief inside the glyph (clip is the glyph shape dilated by a pixel).
export function clipRelief(r: Relief, clip: HTMLCanvasElement) {
  for (const l of reliefLayers(r)) {
    l.ctx.save()
    l.ctx.setTransform(1, 0, 0, 1, 0, 0)
    l.ctx.globalCompositeOperation = "destination-in"
    l.ctx.drawImage(clip, 0, 0)
    l.ctx.restore()
  }
}

// ---- Elements ---------------------------------------------------------------

export type StrokeEl = {
  kind: "stroke"
  pts: Float32Array
  cum: Float32Array
  length: number
  widths: Float32Array // per point
  start: number // ms on the glyph clock
  phases: Phase[] // successive growth phases, each covering `len` px in `ms`
  drawn: number
  spill: boolean // painted on the unclipped layer
  flat?: boolean // three-stroke relief (no glow), used by snowflakes
}
export type LeafEl = { kind: "leaf"; x: number; y: number; angle: number; len: number; wid: number; start: number; ms: number; drawn: number; spill: boolean }
export type BeadEl = { kind: "bead"; x: number; y: number; r: number; start: number; ms: number; drawn: number; spill: boolean }
export type FiliEl = StrokeEl | LeafEl | BeadEl

// "back" overshoots to ~1.09 before settling; strokes only ever add ink, so the peak sticks.
const ease = (p: Phase["ease"], u: number) =>
  p === "out" ? easeOutCubic(u) : p === "inout" ? easeInOutCubic(u) : Math.min(C.FLAKE_OVERSHOOT, easeOutBack(u)) / C.FLAKE_OVERSHOOT

function strokeTarget(e: StrokeEl, age: number) {
  let t = age - e.start
  if (t <= 0) return 0
  let base = 0
  for (const p of e.phases) {
    if (t >= p.ms) {
      base += p.len
      t -= p.ms
    } else return base + p.len * ease(p.ease, t / p.ms)
  }
  return e.length
}

const widthAt = (e: StrokeEl, d: number) => {
  const p = pointAt(e, d)
  const w0 = e.widths[p.index]
  const w1 = e.widths[Math.min(e.widths.length - 1, p.index + 1)]
  const span = e.cum[Math.min(e.cum.length - 1, p.index + 1)] - e.cum[p.index] || 1
  return w0 + (w1 - w0) * clamp((d - e.cum[p.index]) / span, 0, 1)
}

// Paint stroke[from..to] onto the relief, width following the per-point widths.
function paintStroke(r: Relief, e: StrokeEl, from: number, to: number) {
  const a = pointAt(e, from)
  const b = pointAt(e, to)
  let px = a.x
  let py = a.y
  let pd = from
  let pw = widthAt(e, from)
  const seg = (x: number, y: number, d: number) => {
    const w = widthAt(e, d)
    const lw = Math.max(0.5, (pw + w) / 2)
    const f = clamp((pd + d) / 2 / e.length, 0, 1)
    const line = (l: Layer, width: number, off: number) => {
      l.ctx.lineWidth = width
      l.ctx.beginPath()
      l.ctx.moveTo(px + off, py + off)
      l.ctx.lineTo(x + off, y + off)
      l.ctx.stroke()
    }
    if (!e.flat) line(r.glow, lw + C.RELIEF_GLOW_EXTRA_PX, 0)
    line(r.shadow, lw + C.RELIEF_SHADOW_EXTRA_PX, C.RELIEF_SHADOW_OFFSET_PX)
    r.body.ctx.strokeStyle = mix(C.RELIEF_BODY_FROM, C.RELIEF_BODY_TO, f)
    line(r.body, lw, 0)
    line(r.hi, Math.max(0.5, lw * C.RELIEF_HIGHLIGHT_WIDTH), C.RELIEF_HIGHLIGHT_OFFSET_PX)
    px = x
    py = y
    pd = d
    pw = w
  }
  for (let i = a.index + 1; i <= b.index; i++) seg(e.pts[i * 2], e.pts[i * 2 + 1], e.cum[i])
  seg(b.x, b.y, to)
}

function leafPath(ctx: CanvasRenderingContext2D, L: number, hw: number) {
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.bezierCurveTo(L * 0.1, -hw * 1.9, L * 0.65, -hw * 1.1, L, 0)
  ctx.bezierCurveTo(L * 0.65, hw * 1.1, L * 0.1, hw * 1.9, 0, 0)
  ctx.closePath()
}

// Teardrop: pointed tip, round base, centre vein. Drawn at scale s (growth only adds ink).
function paintLeaf(r: Relief, e: LeafEl, s: number) {
  const L = e.len * s
  const hw = (e.wid * s) / 2
  const place = (l: Layer, off: number) => {
    l.ctx.save()
    l.ctx.translate(e.x + off, e.y + off)
    l.ctx.rotate(e.angle)
  }
  place(r.glow, 0)
  leafPath(r.glow.ctx, L, hw)
  r.glow.ctx.lineWidth = C.RELIEF_GLOW_EXTRA_PX
  r.glow.ctx.fill()
  r.glow.ctx.stroke()
  r.glow.ctx.restore()

  place(r.shadow, C.RELIEF_SHADOW_OFFSET_PX)
  leafPath(r.shadow.ctx, L, hw)
  r.shadow.ctx.lineWidth = C.RELIEF_SHADOW_EXTRA_PX
  r.shadow.ctx.fill()
  r.shadow.ctx.stroke()
  r.shadow.ctx.restore()

  place(r.body, 0)
  const g = r.body.ctx.createLinearGradient(0, 0, L, 0)
  g.addColorStop(0, C.RELIEF_BODY_FROM)
  g.addColorStop(1, C.RELIEF_BODY_TO)
  r.body.ctx.fillStyle = g
  leafPath(r.body.ctx, L, hw)
  r.body.ctx.fill()
  r.body.ctx.restore()

  place(r.hi, C.RELIEF_HIGHLIGHT_OFFSET_PX)
  r.hi.ctx.lineWidth = Math.max(0.6, hw * 0.3)
  r.hi.ctx.beginPath()
  r.hi.ctx.moveTo(L * 0.08, 0)
  r.hi.ctx.lineTo(L * 0.85, 0)
  r.hi.ctx.stroke()
  r.hi.ctx.restore()
}

function paintBead(r: Relief, e: BeadEl, s: number) {
  const R = e.r * s
  const dot = (l: Layer, x: number, y: number, rad: number) => {
    l.ctx.beginPath()
    l.ctx.arc(x, y, rad, 0, Math.PI * 2)
    l.ctx.fill()
  }
  dot(r.glow, e.x, e.y, R + C.RELIEF_GLOW_EXTRA_PX / 2)
  dot(r.shadow, e.x + C.RELIEF_SHADOW_OFFSET_PX, e.y + C.RELIEF_SHADOW_OFFSET_PX, R + C.RELIEF_SHADOW_EXTRA_PX / 2)
  r.body.ctx.fillStyle = rgba(C.RELIEF_BODY_FROM, 1)
  dot(r.body, e.x, e.y, R)
  dot(r.hi, e.x + C.RELIEF_HIGHLIGHT_OFFSET_PX, e.y + C.RELIEF_HIGHLIGHT_OFFSET_PX, Math.max(0.4, R * 0.4))
}

// Advance one element to `age`. Returns what happened so the caller can re-clip and count.
export function advanceEl(e: FiliEl, age: number, clipped: Relief, spill: Relief | null) {
  const r = e.spill && spill ? spill : clipped
  let painted = false
  let done = false
  if (e.kind === "stroke") {
    const target = strokeTarget(e, age)
    if (target > e.drawn + 0.01) {
      paintStroke(r, e, e.drawn, target)
      e.drawn = target
      painted = true
    }
    done = e.drawn >= e.length - 0.02
  } else {
    const u = clamp((age - e.start) / e.ms, 0, 1)
    const s = e.kind === "leaf" ? easeOutCubic(u) : easeOutBack(u)
    if (s > e.drawn + 0.01) {
      if (e.kind === "leaf") paintLeaf(r, e, s)
      else paintBead(r, e, s)
      e.drawn = s // running maximum: growth only ever adds ink
      painted = true
    }
    done = u >= 1
  }
  return { painted, done, spill: e.spill }
}
