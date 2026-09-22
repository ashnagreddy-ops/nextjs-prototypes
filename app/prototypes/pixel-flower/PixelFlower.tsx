"use client"

import { useEffect, useRef } from "react"

// ---------------------------------------------------------------------------
// CONFIG — global tunables. Colors are literal because the scene is painted
// onto a <canvas>, which can't read CSS tokens (documented exception).
// ---------------------------------------------------------------------------
export const CONFIG = {
  cell: { desktop: 11, min: 8, refWidth: 1440 }, // px; scales with viewport width
  region: { desktopStart: 0.45, mobileBreakpoint: 768, mobileHeightFrac: 0.56, heightFrac: 0.94 },
  grid: { size: 80, color: "#E8E4DE", width: 1 },
  alphaThreshold: 128, // bake: a cell is either fully on or off
  bakeNoise: { enabled: false, scale: 6, threshold: 0.6 }, // smooth ±1 step on blooms, baked once
  intro: { enabled: false, duration: 1800, cellDelay: 120, cellPop: 180 },
  sway: { speed: 1.15, amplitudePx: 10, bloomLag: 0.25, stemBlendRows: 4, leafPx: 7, leafPhase: 0.9 },
  petals: {
    interval: [1.5, 3], max: 6, terminal: 40, accel: 45,
    driftAmp: [15, 25], driftPeriod: [1.5, 2.5], wind: 6, frameMs: 150, fadeFrac: 0.2,
    tumble: false, // true cycles the sprite frames for a flip; false keeps one soft oval
  },
  repel: { radius: 90, strength: 380, spring: 90, damping: 11, maxCells: 1 },
  scene: { width: 48, height: 64 }, // bouquet size in cells; stem base at (0,0), y up = negative
  debugKey: "d",
} as const

export const PALETTE = {
  // dark → light, 14 steps: the base swatches plus interpolated midpoints so
  // quantised bands stay 1–3 cells wide and read as a seamless gradient
  pink: [
    "#7A1F2A", "#8E2733", "#9E2F3A", "#AB3A45", "#B8434F", "#C24F5A", "#CC5A64",
    "#D46670", "#DB737B", "#E68D93", "#EB9BA0", "#F0A9AD", "#F4B8BA", "#F7C6C8",
  ],
  green: ["#1F4A22", "#2C5F2B", "#3B7433", "#4E8A3C", "#6A9F48"],
  // centre eye: dark brown out through warm brown and dusty rose, plus a glint
  center: ["#3A1512", "#4A1E1A", "#5C2A22", "#74392E", "#8E4A40", "#A85E58", "#C07A76", "#D9979A", "#F7C6C8"],
  accent: "#F6727E", // bright coral-red highlight on the lit petal tips
} as const
const PMAX = PALETTE.pink.length - 1
const ACCENT = PALETTE.pink.length // pink-family index reserved for the accent

// ---------------------------------------------------------------------------
// BOUQUET — composition in scene cells. y is negative upward. `rot` is the
// resting tilt in degrees (negative leans left).
// ---------------------------------------------------------------------------
type BloomKind = "open" | "half" | "bud"
// `stemFrom` is how far below `at` (in cells) the stem visibly leaves the bloom
type BloomDef = { kind: BloomKind; at: [number, number]; rot: number; size: number; seed: number; stemFrom: number }
export const BOUQUET = {
  gather: [0, -17] as [number, number], // where the stems are widest apart
  bundleX: [-2.6, -0.9, 0.9, 2.6], // stem centres at the gather height, one per bloom
  rootSpread: 0.42, // × bundleX at the root: the bundle is pinched at the bottom and fans upward
  stemWidth: 1.9,
  // a blade leaves at `angle` and curves so its tip points along `tipAngle`
  leaves: [
    { from: [-2.2, -6] as [number, number], angle: 138, tipAngle: 180, length: 18, width: 2.8 },
    { from: [2.6, -8] as [number, number], angle: 44, tipAngle: 52, length: 16, width: 2.6 },
    { from: [2, -12] as [number, number], angle: 70, tipAngle: 74, length: 11, width: 2.3 },
  ],
  // back to front
  blooms: [
    { kind: "bud", at: [8, -44], rot: 18, size: 1.05, seed: 2, stemFrom: -1 },
    { kind: "bud", at: [-8, -46], rot: -12, size: 1.2, seed: 1, stemFrom: -1 },
    { kind: "half", at: [8, -31], rot: 12, size: 1.1, seed: 3, stemFrom: -1 },
    { kind: "open", at: [-7, -35], rot: -8, size: 1.15, seed: 4, stemFrom: 8 },
  ] as BloomDef[],
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const clampi = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const rad = (deg: number) => (deg * Math.PI) / 180

function cubicBezier(p1x: number, p1y: number, p2x: number, p2y: number) {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const sy = (t: number) => ((ay * t + by) * t + cy) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 6; i++) {
      const d = dx(t)
      if (Math.abs(d) < 1e-6) break
      t -= (sx(t) - x) / d
    }
    return sy(t)
  }
}
const ease = cubicBezier(0.2, 0.8, 0.2, 1)

function hash2(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
function valueNoise(x: number, y: number, seed: number) {
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const fx = x - x0, fy = y - y0
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed)
  const c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed)
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy) * 2 - 1
}
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const RGB = {
  pink: [...PALETTE.pink, PALETTE.accent].map(hexToRgb),
  green: PALETTE.green.map(hexToRgb),
  center: PALETTE.center.map(hexToRgb),
}
type Family = keyof typeof RGB
function nearest(fam: Family, r: number, g: number, b: number) {
  const list = RGB[fam]
  let best = 0, bd = Infinity
  for (let i = 0; i < list.length; i++) {
    const [pr, pg, pb] = list[i]
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2
    if (d < bd) { bd = d; best = i }
  }
  return best
}

// ---------------------------------------------------------------------------
// vector layer — parts drawn in scene units on a pre-transformed context
// ---------------------------------------------------------------------------
type PartKind = "bloom" | "center" | "stem" | "leaf"
type Part = { id: string; kind: PartKind; family: Family; bloom: number; draw: (ctx: CanvasRenderingContext2D) => void }
type Ctx = CanvasRenderingContext2D

// bloom-wide shading: lighter top-left → darker bottom-right, applied in the
// bloom's local frame so it follows the tilt
function bloomGradient(ctx: Ctx, R: number, shift = 0, dir: "diag" | "down" = "diag") {
  // light from the top-right: pale pinks there, through the mid tones to deep
  // rose and crimson toward the bottom-left. Evenly spaced stops over the full
  // ramp so no band is wider than its neighbours.
  const g = dir === "diag"
    ? ctx.createLinearGradient(R * 0.6, -R * 1.05, -R * 0.8, R * 0.85)
    : ctx.createLinearGradient(0, -R * 2.05, 0, R * 0.15)
  // the light end is compact; the mid and deep tones own most of the form
  const stops: [number, number][] = [[0, 13], [0.09, 12], [0.18, 11], [0.28, 9], [0.4, 8], [0.52, 6], [0.64, 4], [0.76, 3], [0.86, 2], [0.94, 1], [1, 0]]
  for (const [t, i] of stops) g.addColorStop(t, PALETTE.pink[clampi(i + shift, 0, PMAX)])
  return g
}
function baseShadow(ctx: Ctx, x: number, y: number, r: number, alpha = 0.45) {
  // soft crimson falloff, eased so it never leaves a hard ring
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, `rgba(122,31,42,${alpha})`)
  g.addColorStop(0.5, `rgba(122,31,42,${alpha * 0.45})`)
  g.addColorStop(1, "rgba(122,31,42,0)")
  return g
}
function highlight(ctx: Ctx, x: number, y: number, rx: number, ry: number) {
  ctx.fillStyle = PALETTE.pink[PMAX]
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, -0.5, 0, Math.PI * 2)
  ctx.fill()
}

// closed bud: smooth U cup, taller than wide, three pointed tips, one seam
function budPath(ctx: Ctx) {
  ctx.beginPath()
  ctx.moveTo(-3.5, -8.4)
  ctx.bezierCurveTo(-4.3, -5.5, -3.6, -1.2, 0, 0)
  ctx.bezierCurveTo(3.6, -1.2, 4.3, -5.5, 3.5, -8.4)
  ctx.quadraticCurveTo(3.2, -9.6, 2.5, -10.6) // right tip
  ctx.quadraticCurveTo(1.9, -9.2, 1.1, -9)
  ctx.quadraticCurveTo(0.5, -10.6, 0, -12) // middle tip (tallest)
  ctx.quadraticCurveTo(-0.5, -10.6, -1.1, -9)
  ctx.quadraticCurveTo(-1.9, -9.2, -2.5, -10.6) // left tip
  ctx.quadraticCurveTo(-3.2, -9.6, -3.5, -8.4)
  ctx.closePath()
}
function drawBud(ctx: Ctx) {
  ctx.fillStyle = bloomGradient(ctx, 6, 0, "down")
  budPath(ctx)
  ctx.fill()
  ctx.fillStyle = baseShadow(ctx, 0, -0.5, 6.5, 0.6)
  budPath(ctx)
  ctx.fill()
  // darker right flank
  ctx.fillStyle = baseShadow(ctx, 4.5, -4, 5, 0.4)
  budPath(ctx)
  ctx.fill()
  // one darker vertical seam
  ctx.save()
  budPath(ctx)
  ctx.clip()
  ctx.strokeStyle = "rgba(122,31,42,0.45)"
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(0.5, -1)
  ctx.quadraticCurveTo(0.9, -6, 0.3, -10.5)
  ctx.stroke()
  ctx.restore()
  highlight(ctx, 1.4, -8, 1, 1.8)
}

// open flower: five rounded radial petals with ±10% variation
function petalPath(ctx: Ctx, len: number, w: number) {
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.bezierCurveTo(w * 0.55, -len * 0.15, w * 0.62, -len * 0.75, w * 0.18, -len)
  ctx.quadraticCurveTo(0, -len * 1.04, -w * 0.18, -len)
  ctx.bezierCurveTo(-w * 0.62, -len * 0.75, -w * 0.55, -len * 0.15, 0, 0)
  ctx.closePath()
}
function drawOpen(ctx: Ctx, seed: number) {
  const n = 5, len = 9.5, w = 8.2, ring = -0.6
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * 360 + 90 + (hash2(seed, i, 1) - 0.5) * 20 // ±10° rotation
    const sz = 1 + (hash2(seed, i, 2) - 0.5) * 0.2 // ±10% size
    // how much this petal faces the top-right light: lit petals shift up the
    // ramp, shaded petals shift down, so each petal reads as its own plane
    const lit = Math.cos(rad(ang)) * 0.7 + Math.sin(rad(ang)) * 0.7 // +1 facing top-right, −1 bottom-left
    const shift = Math.round(lit * 2.5)
    ctx.save()
    ctx.rotate(rad(-ang) + Math.PI / 2)
    ctx.translate(0, -ring)
    ctx.scale(sz, sz)
    ctx.fillStyle = bloomGradient(ctx, 11, shift)
    petalPath(ctx, len, w)
    ctx.fill()
    // deeper base and a soft crimson underside so the petal has a belly
    ctx.fillStyle = baseShadow(ctx, 0, 0.5, len * 0.55, 0.6)
    petalPath(ctx, len, w)
    ctx.fill()
    ctx.save()
    petalPath(ctx, len, w)
    ctx.clip()
    // pale ridge along the petal's midline (a fold catching the light)
    const ridge = ctx.createLinearGradient(-w * 0.2, 0, w * 0.2, 0)
    ridge.addColorStop(0, "rgba(244,184,186,0)")
    ridge.addColorStop(0.5, `rgba(244,184,186,${0.35 + 0.25 * lit})`)
    ridge.addColorStop(1, "rgba(244,184,186,0)")
    ctx.fillStyle = ridge
    ctx.fillRect(-w * 0.2, -len * 0.78, w * 0.4, len * 0.62)
    // bright coral-red crescent near the tip on the lit side
    if (lit > -0.2) {
      ctx.fillStyle = PALETTE.accent
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.ellipse(w * 0.12, -len * 0.7, w * 0.3, len * 0.11, -0.35, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
    ctx.restore()
    // outline: firmer on the shadow side so overlapping petals separate
    ctx.strokeStyle = `rgba(122,31,42,${lit > 0 ? 0.3 : 0.5})`
    ctx.lineWidth = 0.45
    petalPath(ctx, len, w)
    ctx.stroke()
    ctx.restore()
  }
  // pale halo just outside the centre eye
  const halo = ctx.createRadialGradient(-0.4, 0.1, 2, -0.4, 0.1, 4.4)
  halo.addColorStop(0, "rgba(247,198,200,0.8)")
  halo.addColorStop(0.5, "rgba(247,198,200,0.3)")
  halo.addColorStop(1, "rgba(247,198,200,0)")
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(-0.4, 0.1, 4.4, 0, Math.PI * 2)
  ctx.fill()
  highlight(ctx, 3.5, -7.5, 2.2, 1.3)
}
function drawCenter(ctx: Ctx) {
  // graded eye: near-black brown in the middle, warm browns, then dusty rose
  const c = PALETTE.center
  const g = ctx.createRadialGradient(-0.5, 0.1, 0, -0.4, 0.1, 2.15)
  g.addColorStop(0, c[0])
  g.addColorStop(0.3, c[1])
  g.addColorStop(0.48, c[2])
  g.addColorStop(0.62, c[3])
  g.addColorStop(0.74, c[4])
  g.addColorStop(0.85, c[5])
  g.addColorStop(0.94, c[6])
  g.addColorStop(1, c[7])
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(-0.4, 0.1, 2.15, 1.9, -0.3, 0, Math.PI * 2)
  ctx.fill()
  // one glint cell, upper-left of the eye
  ctx.fillStyle = c[8]
  ctx.fillRect(-1.4, -0.9, 0.8, 0.8)
}

// half-open bloom: cup with the two outer petals curling outward
function drawHalf(ctx: Ctx) {
  // one step deeper than the open flower so the two blooms read apart
  const grad = bloomGradient(ctx, 8, -2)
  // left curling petal (behind)
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.moveTo(-2.5, -1)
  ctx.bezierCurveTo(-5.5, -3, -8.5, -6.5, -8.2, -10.5)
  ctx.bezierCurveTo(-6.5, -9.5, -4.5, -7.5, -3.2, -5)
  ctx.closePath()
  ctx.fill()
  // right curling petal (behind)
  ctx.beginPath()
  ctx.moveTo(2.5, -1)
  ctx.bezierCurveTo(5.5, -3, 8.8, -6, 8.6, -10.2)
  ctx.bezierCurveTo(6.8, -9.4, 4.6, -7.6, 3.2, -5)
  ctx.closePath()
  ctx.fill()
  // cup body with three soft lobes on top
  const cup = () => {
    ctx.beginPath()
    ctx.moveTo(-4.6, -6.5)
    ctx.bezierCurveTo(-5.2, -3.5, -3.8, -0.8, 0, 0)
    ctx.bezierCurveTo(3.8, -0.8, 5.2, -3.5, 4.6, -6.5)
    ctx.quadraticCurveTo(4.2, -9.2, 2.6, -9.6)
    ctx.quadraticCurveTo(1.6, -8.4, 0.8, -8.6)
    ctx.quadraticCurveTo(0, -10.4, -0.8, -8.6)
    ctx.quadraticCurveTo(-1.6, -8.4, -2.6, -9.6)
    ctx.quadraticCurveTo(-4.2, -9.2, -4.6, -6.5)
    ctx.closePath()
  }
  ctx.fillStyle = grad
  cup()
  ctx.fill()
  ctx.fillStyle = baseShadow(ctx, 0, -0.5, 5)
  cup()
  ctx.fill()
  ctx.save()
  cup()
  ctx.clip()
  ctx.strokeStyle = "rgba(122,31,42,0.4)"
  ctx.lineWidth = 0.6
  ctx.beginPath()
  ctx.moveTo(-1.6, -1)
  ctx.quadraticCurveTo(-1.9, -5, -1.4, -8.5)
  ctx.moveTo(1.9, -1)
  ctx.quadraticCurveTo(2.3, -5, 1.8, -8.5)
  ctx.stroke()
  ctx.restore()
  highlight(ctx, 1.8, -7, 1.2, 1.5)
}

function withBloom(def: BloomDef, fn: (ctx: Ctx) => void) {
  return (ctx: Ctx) => {
    ctx.save()
    ctx.translate(def.at[0], def.at[1])
    ctx.rotate(rad(def.rot))
    ctx.scale(def.size, def.size)
    fn(ctx)
    ctx.restore()
  }
}

function buildParts(): Part[] {
  const parts: Part[] = []
  const { gather, bundleX, rootSpread, stemWidth, leaves, blooms } = BOUQUET
  // stems: one per bloom, curving from the bloom down into the bundle
  // slots are handed out left to right by bloom x so no stem crosses another
  const order = blooms.map((b, i) => i).sort((a, b) => blooms[a].at[0] - blooms[b].at[0])
  const slotOf = new Map(order.map((bi, rank) => [bi, bundleX[rank % bundleX.length]]))
  blooms.forEach((b, i) => {
    const bx = slotOf.get(i) ?? 0
    parts.push({
      id: `stem-${i}`, kind: "stem", family: "green", bloom: -1,
      draw: (ctx) => {
        // from the bloom's visible bottom edge down to the gather height, then
        // inward to a pinched root so the bundle narrows at the bottom
        ctx.strokeStyle = PALETTE.green[2]
        ctx.lineWidth = stemWidth
        ctx.lineCap = "butt"
        ctx.lineJoin = "round"
        ctx.beginPath()
        ctx.moveTo(b.at[0], b.at[1] + b.stemFrom)
        ctx.lineTo(bx, gather[1])
        ctx.lineTo(bx * rootSpread, 3)
        ctx.stroke()
      },
    })
  })
  leaves.forEach((l, i) => {
    // centreline: quadratic Bézier that leaves along `angle` and arrives along `tipAngle`
    const a0 = rad(l.angle), a1 = rad(l.tipAngle)
    const d0: [number, number] = [Math.cos(a0), -Math.sin(a0)], d1: [number, number] = [Math.cos(a1), -Math.sin(a1)]
    const P0 = l.from
    const P1: [number, number] = [P0[0] + d0[0] * l.length * 0.6, P0[1] + d0[1] * l.length * 0.6]
    const P2: [number, number] = [P1[0] + d1[0] * l.length * 0.4, P1[1] + d1[1] * l.length * 0.4]
    const N = 14
    const left: [number, number][] = [], right: [number, number][] = []
    for (let k = 0; k <= N; k++) {
      const t = k / N, u = 1 - t
      const x = u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0]
      const y = u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1]
      const tx = 2 * u * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0])
      const ty = 2 * u * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1])
      const len = Math.hypot(tx, ty) || 1
      const nx = -ty / len, ny = tx / len
      const hw = (l.width / 2) * Math.pow(1 - t, 0.55) // tapers to a point at the tip
      left.push([x + nx * hw, y + ny * hw])
      right.push([x - nx * hw, y - ny * hw])
    }
    parts.push({
      id: `leaf-${i}`, kind: "leaf", family: "green", bloom: -1,
      draw: (ctx) => {
        ctx.fillStyle = PALETTE.green[2]
        ctx.beginPath()
        ctx.moveTo(left[0][0], left[0][1])
        for (let k = 1; k < left.length; k++) ctx.lineTo(left[k][0], left[k][1])
        for (let k = right.length - 1; k >= 0; k--) ctx.lineTo(right[k][0], right[k][1])
        ctx.closePath()
        ctx.fill()
      },
    })
  })
  blooms.forEach((b, i) => {
    const draw = b.kind === "bud" ? drawBud : b.kind === "half" ? drawHalf : (ctx: Ctx) => drawOpen(ctx, b.seed)
    parts.push({ id: `bloom-${i}`, kind: "bloom", family: "pink", bloom: i, draw: withBloom(b, draw) })
    if (b.kind === "open") parts.push({ id: `center-${i}`, kind: "center", family: "center", bloom: i, draw: withBloom(b, drawCenter) })
  })
  return parts
}

// ---------------------------------------------------------------------------
// falling petals
// ---------------------------------------------------------------------------
type Petal = { x: number; y: number; vy: number; x0: number; amp: number; period: number; phase: number; born: number; colors: [string, string, string]; dead: boolean }
// soft-cornered ovals: wide 4×3, mid 3×3, thin 1×3 (corners removed)
const PETAL_FRAMES: [number, number][][] = [
  [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [3, 1], [1, 2], [2, 2]],
  [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  [[1, 0], [1, 1], [1, 2]],
]
const FRAME_CYCLE = [0, 1, 2, 1]

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------
export default function PixelFlower({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return
    const ctx2d = canvasEl.getContext("2d")
    if (!ctx2d) return
    const canvas: HTMLCanvasElement = canvasEl
    const ctx: CanvasRenderingContext2D = ctx2d
    const parent = canvas.parentElement ?? document.body
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const parts = buildParts()

    // ---- layout ----
    let W = 0, H = 0, dpr = 1, cell = 11
    let regionX = 0, cols = 0, rows = 0
    let sceneScale = 1, baseX = 0, baseY = 0
    let flowerTopRow = 0
    const off = document.createElement("canvas")
    const offCtx = off.getContext("2d", { willReadFrequently: true })!
    const vec = document.createElement("canvas") // full-res vector layer for the debug view
    const vecCtx = vec.getContext("2d")!

    // ---- baked cells (struct of arrays) ----
    let nCells = 0
    let cCol = new Int16Array(0), cRow = new Int16Array(0), cPart = new Int16Array(0)
    let cColor: string[] = []
    let cGroup = new Int8Array(0) // 0 stem, 1 bloom/center, 2 leaf
    let cLag = new Float32Array(0) // 0 = stem phase, 1 = bloom phase
    let cDelay = new Float32Array(0)
    let ox = new Float32Array(0), oy = new Float32Array(0), vx = new Float32Array(0), vy = new Float32Array(0)
    let bloomEdges: { col: number; row: number; color: string }[][] = []
    const petals: Petal[] = []
    let nextPetalAt = 0

    // ---- loop state ----
    let elapsed = CONFIG.intro.enabled && !reduced ? 0 : 1e9
    let last = performance.now()
    let raf = 0, running = false, visible = true, intersecting = true
    let debug = false
    const pointer = { x: -1e6, y: -1e6, active: false }

    function layout() {
      W = parent.clientWidth
      H = parent.clientHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      canvas.style.width = `${W}px`
      canvas.style.height = `${H}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = false

      cell = Math.max(CONFIG.cell.min, Math.round(CONFIG.cell.desktop * Math.min(1, W / CONFIG.cell.refWidth)))
      const mobile = W < CONFIG.region.mobileBreakpoint
      regionX = mobile ? 0 : Math.round(W * CONFIG.region.desktopStart)
      cols = Math.ceil((W - regionX) / cell)
      rows = Math.ceil(H / cell)
      off.width = cols
      off.height = rows
      const usableH = rows * (mobile ? CONFIG.region.mobileHeightFrac : CONFIG.region.heightFrac)
      // fill the available height; cells stay the same size, the bouquet just uses more of them
      sceneScale = Math.min(cols / (CONFIG.scene.width + 2), usableH / (CONFIG.scene.height + 2))
      baseX = Math.floor(cols / 2)
      baseY = rows
      flowerTopRow = baseY - CONFIG.scene.height * sceneScale
    }

    // ---- BAKE: rasterise each part once, quantise, then shade in cell space ----
    function bake() {
      if (cols === 0 || rows === 0) { nCells = 0; return } // parent not laid out yet; render() retries
      bakePass()
      // centre the baked silhouette in the region, then bake again at the shifted origin
      let minC = cols, maxC = -1
      for (let k = 0; k < nCells; k++) { if (cCol[k] < minC) minC = cCol[k]; if (cCol[k] > maxC) maxC = cCol[k] }
      const shift = Math.round(cols / 2 - (minC + maxC + 1) / 2)
      if (maxC >= 0 && shift !== 0) { baseX += shift; bakePass() }
    }
    function bakePass() {
      const n = cols * rows
      const partOf = new Int16Array(n).fill(-1)
      const idx = new Int16Array(n).fill(-1) // palette index within the part's family
      offCtx.setTransform(1, 0, 0, 1, 0, 0)
      for (let pi = 0; pi < parts.length; pi++) {
        const part = parts[pi]
        offCtx.setTransform(1, 0, 0, 1, 0, 0)
        offCtx.clearRect(0, 0, cols, rows)
        offCtx.translate(baseX, baseY)
        offCtx.scale(sceneScale, sceneScale)
        part.draw(offCtx)
        const img = offCtx.getImageData(0, 0, cols, rows).data
        for (let i = 0; i < n; i++) {
          if (img[i * 4 + 3] < CONFIG.alphaThreshold) continue
          partOf[i] = pi
          idx[i] = nearest(part.family, img[i * 4], img[i * 4 + 1], img[i * 4 + 2])
        }
      }
      const famMax = (pi: number) => RGB[parts[pi].family].length - 1
      const at = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? -1 : partOf[r * cols + c])

      // blooms: optional smooth noise, then darken cells bordering a bloom in front
      const noiseSeed = 77
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c, pi = partOf[i]
        if (pi < 0 || parts[pi].kind !== "bloom" || idx[i] === ACCENT) continue
        let k = idx[i]
        if (CONFIG.bakeNoise.enabled) {
          const nz = valueNoise(c / CONFIG.bakeNoise.scale, r / CONFIG.bakeNoise.scale, noiseSeed)
          if (nz > CONFIG.bakeNoise.threshold) k += 1
          else if (nz < -CONFIG.bakeNoise.threshold) k -= 1
        }
        const me = parts[pi].bloom
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const q = at(c + dc, r + dr)
          if (q >= 0 && parts[q].bloom !== me && parts[q].bloom >= 0 && parts[q].bloom > me) { k -= 1; break }
        }
        // shadow-side rim: a couple of ramp steps deeper where the bloom meets
        // background below / to the left (one ramp step is subtle on the 14-tone ramp)
        if (at(c, r + 1) < 0) k -= 2
        if (at(c - 1, r) < 0) k -= 1
        idx[i] = clampi(k, 0, PMAX)
      }

      // stems: shade across each stem's width per row, boundaries, bottom, shadow
      const stemTop = new Int16Array(parts.length).fill(32767)
      const stemBottom = new Int16Array(parts.length).fill(-1)
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const pi = partOf[r * cols + c]
        if (pi >= 0 && parts[pi].kind === "stem") { if (r < stemTop[pi]) stemTop[pi] = r; if (r > stemBottom[pi]) stemBottom[pi] = r }
      }
      for (let r = 0; r < rows; r++) {
        let c = 0
        while (c < cols) {
          const pi = partOf[r * cols + c]
          if (pi < 0 || parts[pi].kind !== "stem") { c++; continue }
          let e = c
          while (e + 1 < cols && partOf[r * cols + e + 1] === pi) e++
          const len = e - c + 1
          for (let x = c; x <= e; x++) {
            const i = r * cols + x
            const u = len === 1 ? 0.5 : (x - c) / (len - 1)
            let k = u < 0.25 ? 4 : u > 0.75 ? 0 : u < 0.5 ? 3 : 2 // light left → dark right
            // boundary with a neighbouring stem
            const L = at(x - 1, r), R = at(x + 1, r)
            if ((L >= 0 && L !== pi && parts[L].kind === "stem") || (R >= 0 && R !== pi && parts[R].kind === "stem")) k -= 1
            // gradual darkening over the lower third
            const top = stemTop[pi], bot = stemBottom[pi]
            const t = (r - (top + (bot - top) * (2 / 3))) / Math.max(1, (bot - top) / 3)
            if (t > 0 && t > hash2(x, r, 5)) k -= 1
            // cast shadow: bloom directly above within 2 cells
            const up1 = at(x, r - 1), up2 = at(x, r - 2)
            if ((up1 >= 0 && parts[up1].kind !== "stem") || (up2 >= 0 && parts[up2].kind !== "stem")) k -= 1
            idx[i] = clampi(k, 0, 4)
          }
          c = e + 1
        }
      }

      // leaves: top edge light, underside dark, centre mid
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c, pi = partOf[i]
        if (pi < 0 || parts[pi].kind !== "leaf") continue
        const upOpen = at(c, r - 1) !== pi, downOpen = at(c, r + 1) !== pi
        idx[i] = upOpen && downOpen ? 3 : upOpen ? 4 : downOpen ? 0 : 2
      }

      const leafOf = new Map(parts.map((pt, pi) => [pi, pt.kind === "leaf" ? BOUQUET.leaves[Number(pt.id.split("-")[1])] : undefined]))
      // pack into struct-of-arrays for the animation loop
      const list: number[] = []
      for (let i = 0; i < n; i++) if (partOf[i] >= 0) list.push(i)
      nCells = list.length
      cCol = new Int16Array(nCells); cRow = new Int16Array(nCells); cPart = new Int16Array(nCells)
      cGroup = new Int8Array(nCells); cLag = new Float32Array(nCells); cDelay = new Float32Array(nCells)
      cColor = new Array(nCells)
      ox = new Float32Array(nCells); oy = new Float32Array(nCells); vx = new Float32Array(nCells); vy = new Float32Array(nCells)
      bloomEdges = BOUQUET.blooms.map(() => [])
      list.forEach((i, k) => {
        const c = i % cols, r = (i - c) / cols, pi = partOf[i], part = parts[pi]
        cCol[k] = c; cRow[k] = r; cPart[k] = pi
        const fam = part.family
        cColor[k] = fam === "pink" ? (idx[i] === ACCENT ? PALETTE.accent : PALETTE.pink[idx[i]]) : fam === "green" ? PALETTE.green[idx[i]] : PALETTE.center[idx[i]]
        cGroup[k] = part.kind === "stem" ? 0 : part.kind === "leaf" ? 2 : 1
        if (part.kind === "leaf") {
          // how far along the blade this cell sits, so the tip sways most
          const lf = leafOf.get(pi)
          const sx = (c + 0.5 - baseX) / sceneScale, sy = (r + 0.5 - baseY) / sceneScale
          cLag[k] = lf ? clamp01(Math.hypot(sx - lf.from[0], sy - lf.from[1]) / lf.length) : 0
        } else {
          cLag[k] = part.kind === "stem" ? 1 - clamp01((r - stemTop[pi]) / CONFIG.sway.stemBlendRows) : 1
        }
        cDelay[k] = hash2(c, r, 13) * CONFIG.intro.cellDelay
        if (part.kind === "bloom") {
          const edge = at(c + 1, r) < 0 || at(c - 1, r) < 0 || at(c, r + 1) < 0 || at(c, r - 1) < 0
          if (edge) bloomEdges[part.bloom].push({ col: c, row: r, color: cColor[k] })
        }
        void famMax
      })

      // full-resolution vector layer for the debug view
      const vw = CONFIG.scene.width + 4, vh = CONFIG.scene.height + 4
      vec.width = Math.round(vw * cell * dpr)
      vec.height = Math.round(vh * cell * dpr)
      vecCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
      vecCtx.clearRect(0, 0, vw * cell, vh * cell)
      vecCtx.translate((vw / 2) * cell, (vh - 2) * cell)
      vecCtx.scale(cell, cell)
      for (const part of parts) part.draw(vecCtx)
    }

    // ---- petals ----
    function spawnPetal(now: number) {
      if (petals.length >= CONFIG.petals.max) return
      // only edge cells on the right-hand side of the bouquet shed petals
      const bi = Math.floor(Math.random() * bloomEdges.length)
      const edges = (bloomEdges[bi] ?? []).filter((e) => e.col > baseX + 1)
      if (edges.length === 0) return
      const e = edges[Math.floor(Math.random() * edges.length)]
      const k = e.color === PALETTE.accent ? 8 : Math.max(0, PALETTE.pink.indexOf(e.color as (typeof PALETTE.pink)[number]))
      const x = regionX + e.col * cell, y = e.row * cell
      petals.push({
        x, y, x0: x, vy: 0,
        amp: rand(CONFIG.petals.driftAmp[0], CONFIG.petals.driftAmp[1]),
        period: rand(CONFIG.petals.driftPeriod[0], CONFIG.petals.driftPeriod[1]),
        phase: rand(0, Math.PI * 2), born: now, dead: false,
        colors: [PALETTE.pink[clampi(k + 2, 0, PMAX)], PALETTE.pink[k], PALETTE.pink[clampi(k - 2, 0, PMAX)]],
      })
    }
    function updatePetals(dt: number, now: number, wind: number) {
      for (const p of petals) {
        p.vy = Math.min(CONFIG.petals.terminal, p.vy + CONFIG.petals.accel * dt)
        p.y += p.vy * dt
        // wind always carries petals rightward, stronger when the sway leans right
        p.x0 += (0.6 + 0.4 * wind) * CONFIG.petals.wind * dt
        p.x = p.x0 + Math.sin(((now - p.born) / 1000 / p.period) * Math.PI * 2 + p.phase) * p.amp
        if (p.y > H + cell * 2) p.dead = true
      }
      for (let i = petals.length - 1; i >= 0; i--) if (petals[i].dead) petals.splice(i, 1)
    }
    function drawPetals(now: number) {
      const fadeStart = H * (1 - CONFIG.petals.fadeFrac)
      const px = 1 / dpr
      for (const p of petals) {
        const frame = CONFIG.petals.tumble
          ? PETAL_FRAMES[FRAME_CYCLE[Math.floor((now - p.born) / CONFIG.petals.frameMs) % FRAME_CYCLE.length]]
          : PETAL_FRAMES[0]
        const a = p.y > fadeStart ? clamp01(1 - (p.y - fadeStart) / (H - fadeStart)) : 1
        if (a <= 0) continue
        ctx.globalAlpha = a
        for (const [dx, dy] of frame) {
          ctx.fillStyle = p.colors[dy]
          const x = Math.round((p.x + dx * cell) * dpr) / dpr, y = Math.round((p.y + dy * cell) * dpr) / dpr
          ctx.fillRect(x, y, cell + px, cell + px)
        }
      }
      ctx.globalAlpha = 1
    }

    function drawGrid() {
      ctx.strokeStyle = CONFIG.grid.color
      ctx.lineWidth = CONFIG.grid.width
      ctx.beginPath()
      const g = CONFIG.grid.size
      for (let x = regionX + 0.5; x <= W; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
      for (let y = 0.5; y <= H; y += g) { ctx.moveTo(regionX, y); ctx.lineTo(W, y) }
      ctx.stroke()
    }

    function drawDebug() {
      const scale = Math.min(0.5, (H - 48) / (vec.height / dpr))
      const w = (vec.width / dpr) * scale, h = (vec.height / dpr) * scale
      const x = 24, y = H - h - 24
      ctx.fillStyle = "rgba(247,245,241,0.94)"
      ctx.fillRect(x - 12, y - 28, w + 24, h + 40)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(vec, x, y, w, h)
      ctx.imageSmoothingEnabled = false
      ctx.fillStyle = "#2B2A26"
      ctx.font = "11px ui-monospace, monospace"
      ctx.fillText("VECTOR LAYER  ·  baked grid to the right  ·  D to hide", x, y - 10)
    }

    // ---- ANIMATE: draw baked cells only ----
    function render(now: number, dt: number) {
      if (cols === 0 || rows === 0) { layout(); bake(); if (cols === 0 || rows === 0) return }
      const t = now / 1000
      const swayS = reduced ? 0 : Math.sin(t * CONFIG.sway.speed)
      const swayB = reduced ? 0 : Math.sin((t - CONFIG.sway.bloomLag) * CONFIG.sway.speed)
      const swayL = reduced ? 0 : Math.sin(t * CONFIG.sway.speed * 1.3 + CONFIG.sway.leafPhase)
      const Hrows = Math.max(1, baseY - flowerTopRow)
      const introT = clamp01(elapsed / CONFIG.intro.duration)

      ctx.clearRect(0, 0, W, H)
      drawGrid()

      const { radius, strength, spring, damping, maxCells } = CONFIG.repel
      const r2 = radius * radius, maxD = maxCells * cell
      const doRepel = !reduced && pointer.active
      const step = Math.min(dt, 1 / 30)
      const px = 1 / dpr

      for (let k = 0; k < nCells; k++) {
        const col = cCol[k], row = cRow[k]
        const hf = clamp01((baseY - row) / Hrows)
        const amp = CONFIG.sway.amplitudePx * hf * hf
        const lag = cLag[k]
        let sway: number
        if (cGroup[k] === 2) {
          // leaves ride the stem sway plus their own flutter, strongest at the tip
          sway = swayS * amp + swayL * CONFIG.sway.leafPx * lag * lag
        } else {
          sway = (lag >= 1 ? swayB : lag <= 0 ? swayS : lerp(swayS, swayB, lag)) * amp
        }

        // cursor repel: small spring displacement, clamped to one cell
        let ax = -spring * ox[k] - damping * vx[k], ay = -spring * oy[k] - damping * vy[k]
        const cx = regionX + col * cell + cell / 2 + sway, cy = row * cell + cell / 2
        if (doRepel) {
          const ddx = cx + ox[k] - pointer.x, ddy = cy + oy[k] - pointer.y
          const d2 = ddx * ddx + ddy * ddy
          if (d2 < r2 && d2 > 0.01) {
            const d = Math.sqrt(d2), f = (1 - d / radius) * strength
            ax += (ddx / d) * f; ay += (ddy / d) * f
          }
        }
        vx[k] += ax * step; vy[k] += ay * step
        ox[k] += vx[k] * step; oy[k] += vy[k] * step
        const dm = Math.hypot(ox[k], oy[k])
        if (dm > maxD) { ox[k] *= maxD / dm; oy[k] *= maxD / dm }

        let pop = 1
        if (introT < 1) {
          pop = ease(clamp01((elapsed - (hf * CONFIG.intro.duration * 0.8 + cDelay[k])) / CONFIG.intro.cellPop))
          if (pop <= 0) continue
        }
        const x = Math.round((cx - cell / 2 + ox[k]) * dpr) / dpr
        const y = Math.round((cy - cell / 2 + oy[k]) * dpr) / dpr
        ctx.fillStyle = cColor[k]
        if (pop < 1) {
          ctx.globalAlpha = pop
          const sz = cell * lerp(0.5, 1, pop)
          ctx.fillRect(x + (cell - sz) / 2, y + (cell - sz) / 2, sz + px, sz + px)
          ctx.globalAlpha = 1
        } else {
          ctx.fillRect(x, y, cell + px, cell + px)
        }
      }

      if (!reduced) {
        if (now >= nextPetalAt) {
          spawnPetal(now)
          nextPetalAt = now + rand(CONFIG.petals.interval[0], CONFIG.petals.interval[1]) * 1000
        }
        updatePetals(dt, now, swayS)
        drawPetals(now)
      }
      if (debug) drawDebug()
    }

    function frame(now: number) {
      raf = 0
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      elapsed += dt * 1000
      render(now, dt)
      if (running) raf = requestAnimationFrame(frame)
    }
    function start() {
      if (running || reduced) return
      running = true
      last = performance.now()
      if (!raf) raf = requestAnimationFrame(frame)
    }
    function stop() {
      running = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }
    function syncRunning() { if (visible && intersecting) start(); else stop() }

    // ---- events ----
    let resizeTimer = 0
    const rebuild = () => { layout(); bake(); petals.length = 0; if (reduced) render(performance.now(), 0) }
    const onResize = () => { window.clearTimeout(resizeTimer); resizeTimer = window.setTimeout(rebuild, 150) }
    const ro = new ResizeObserver(onResize)
    const onVisibility = () => { visible = document.visibilityState === "visible"; syncRunning() }
    const io = new IntersectionObserver((entries) => { intersecting = entries[0]?.isIntersecting ?? true; syncRunning() })
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      pointer.x = e.clientX - rect.left; pointer.y = e.clientY - rect.top; pointer.active = true
    }
    const onPointerLeave = () => { pointer.active = false }
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === CONFIG.debugKey && !e.metaKey && !e.ctrlKey) {
        debug = !debug
        if (reduced) render(performance.now(), 0)
      }
    }

    rebuild()
    nextPetalAt = performance.now() + 600
    if (!reduced) start()

    window.addEventListener("resize", onResize)
    window.addEventListener("keydown", onKey)
    document.addEventListener("visibilitychange", onVisibility)
    io.observe(canvas)
    ro.observe(parent)
    parent.addEventListener("pointermove", onPointerMove)
    parent.addEventListener("pointerleave", onPointerLeave)

    return () => {
      stop()
      window.clearTimeout(resizeTimer)
      window.removeEventListener("resize", onResize)
      window.removeEventListener("keydown", onKey)
      document.removeEventListener("visibilitychange", onVisibility)
      io.disconnect()
      ro.disconnect()
      parent.removeEventListener("pointermove", onPointerMove)
      parent.removeEventListener("pointerleave", onPointerLeave)
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden className={className} />
}
