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
  sway: { speed: 1.15, amplitudePx: 22, bloomLag: 0.25, stemBlendRows: 4, leafPx: 9, leafPhase: 0.9 },
  petals: {
    interval: [0.35, 3.2], max: 7, terminal: 120, accel: 160,
    pairChance: 0.3, pairGap: [0.08, 0.3], // sometimes a second petal pops out right behind the first
    breeze: { strength: 28, rate: 0.9 }, // smooth per-petal gusts (px/s) on top of the arc
    // thrown softly out to the right from behind the bud, then drag slows the
    // sideways push toward the ambient wind while gravity takes over
    launch: { vx: [60, 130], vy: [-40, -10], drag: 1.0 },
    // a single very slow lean, not a swing: the path reads as a clean arc
    driftAmp: [2, 5], driftPeriod: [4, 7], wind: 9, frameMs: 150, fadeFrac: 0.2,
    tumble: false, // true cycles the sprite frames for a flip; false keeps one soft oval
    source: { bloom: 0, offset: [4, -5] as [number, number], jitter: 2 }, // shed from behind this bloom (cells from its anchor)
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
  // open-flower ramp, dark → light: deeper and more saturated than `pink`,
  // running up to a near-white blush so the petals can carry more steps
  bloom: [
    "#7E1F2B", "#8E2634", "#9E2F3A", "#B0374A", "#C3405A", "#D64B62", "#E45C6C",
    "#EE6F7A", "#F5858C", "#F89BA1", "#FAB3B7", "#FCC8CA", "#FDDADB", "#FBE3E4",
  ],
  green: ["#1F4A22", "#2C5F2B", "#3B7433", "#4E8A3C", "#6A9F48"],
  // centre eye: dark brown out through warm brown and dusty rose, plus a glint
  center: ["#3A1512", "#4A1E1A", "#5C2A22", "#74392E", "#8E4A40", "#A85E58", "#C07A76", "#D9979A", "#F7C6C8", "#B8434F"],
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
  bloom: PALETTE.bloom.map(hexToRgb),
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

// open flower: five radial petals shaded as a cupped BOWL seen from above.
// Each petal has its own gradient (pale near the centre → saturated rose at
// the tip) with a lit ridge on its upper-left curve and a shadow on its
// lower-right edge; the bowl lighting (lower-right interior brighter) and a
// full throat ring are layered on top in bloom space.
const B = PALETTE.bloom
// the same teardrop, sampled as a polygon with a gentle wave (≤ ~0.8 cell)
// along its outer half so the rim isn't a perfect curve
function wavyPetalPath(ctx: Ctx, len: number, w: number, seed: number) {
  const N = 56
  const pts: [number, number][] = []
  for (let k = 0; k < N; k++) {
    const th = (k / N) * Math.PI * 2
    const t = (1 - Math.cos(th)) / 2 // 0 at base, 1 at tip
    const sn = Math.sin(th)
    // the broad rounded lobe from before, with only a slight draw-in near the
    // very tip so each lobe reads as a soft bump (about one cell of lobing)
    const lobe = 1 - 0.16 * Math.pow(t, 4)
    const x = (w / 2) * Math.sign(sn) * Math.pow(Math.abs(sn), 0.72) * (0.3 + 0.7 * Math.sqrt(t)) * lobe
    const y = -len * t
    pts.push([x, y])
  }
  // gentle wave along the outer half
  const waved: [number, number][] = pts.map(([x, y], k) => {
    const [px, py] = pts[(k + N - 1) % N], [nx2, ny2] = pts[(k + 1) % N]
    const tx = nx2 - px, ty = ny2 - py
    const tl = Math.hypot(tx, ty) || 1
    const nx = -ty / tl, ny = tx / tl
    const th = (k / N) * Math.PI * 2
    const t = (1 - Math.cos(th)) / 2
    const wave = 0.7 * Math.sin(th * 4 + seed) * t * t
    return [x + nx * wave, y + ny * wave]
  })
  // one smoothing pass (average with neighbours) so nothing reads as a spike
  const sm: [number, number][] = waved.map(([x, y], k) => {
    const [ax, ay] = waved[(k + N - 1) % N], [bx, by] = waved[(k + 1) % N]
    return [(ax + x + bx) / 3, (ay + y + by) / 3]
  })
  ctx.beginPath()
  sm.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.closePath()
}
const EYE: [number, number] = [1.1, 1.3] // centre sits a little down and to the right
function drawOpen(ctx: Ctx, seed: number) {
  const n = 5, len = 11, w = 11.2, ring = -2 // broad lobes whose bases overlap past the centre → cupped
  const R = len
  // bowl lighting, layered over the per-petal gradients: upper-left interior
  // shaded, lower-right interior lit
  // whole-flower light: a clear falloff from the lit top-left (lifted toward
  // blush) to the shadowed bottom-right (pulled into deep rose)
  // whole-flower light: the shadow sits on the top-left (pulled into deep
  // rose) and the light on the bottom-right (lifted toward blush)
  const bowl = ctx.createLinearGradient(-R * 0.9, -R * 0.9, R * 0.9, R * 0.9)
  bowl.addColorStop(0, "rgba(126,31,43,0.5)")
  bowl.addColorStop(0.45, "rgba(126,31,43,0)")
  bowl.addColorStop(0.6, "rgba(251,227,228,0)")
  bowl.addColorStop(1, "rgba(251,227,228,0.4)")
  // deeper wash on the bottom-left lobe (the target's darkest petal edge)
  const bottomLeft = ctx.createRadialGradient(-R * 0.6, R * 0.5, 0, -R * 0.6, R * 0.5, R * 0.75)
  bottomLeft.addColorStop(0, "rgba(126,31,43,0.45)")
  bottomLeft.addColorStop(1, "rgba(126,31,43,0)")
  // deeper fold on the right side, inside the rim, between the centre and the
  // right petals (the target's darker inner right)
  const rightInner = ctx.createRadialGradient(EYE[0] + 4.6, EYE[1] + 0.4, 0.8, EYE[0] + 4.6, EYE[1] + 0.4, 5)
  rightInner.addColorStop(0, "rgba(126,31,43,0.5)")
  rightInner.addColorStop(0.55, "rgba(126,31,43,0.25)")
  rightInner.addColorStop(1, "rgba(126,31,43,0)")
  // full throat ring hugging the centre: visible all the way round,
  // brightest lower-right
  const throat = ctx.createRadialGradient(EYE[0], EYE[1], 1.3, EYE[0], EYE[1], 3.9)
  throat.addColorStop(0, "rgba(249,210,211,0.95)")
  throat.addColorStop(0.5, "rgba(247,198,200,0.75)")
  throat.addColorStop(1, "rgba(247,198,200,0)")
  const throatLR = ctx.createRadialGradient(EYE[0] + 1.2, EYE[1] + 1.1, 0.8, EYE[0] + 1.2, EYE[1] + 1.1, 2.7)
  throatLR.addColorStop(0, "rgba(253,236,237,0.98)")
  throatLR.addColorStop(0.5, "rgba(251,227,228,0.7)")
  throatLR.addColorStop(1, "rgba(251,227,228,0)")

  type P = { ang: number; sz: number; cy: number; lit: number; seed: number }
  const petals: P[] = []
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * 360 + 90 + (hash2(seed, i, 1) - 0.5) * 28 // ±14° rotation
    const sz = 1 + (hash2(seed, i, 2) - 0.5) * 0.4 // ±20% size
    const dir = [Math.cos(rad(ang)), -Math.sin(rad(ang))]
    petals.push({ ang, sz, cy: dir[1], lit: -dir[0] * 0.707 - dir[1] * 0.707, seed: seed * 7 + i })
  }
  const byAngle = petals.slice()
  petals.sort((a, b) => a.cy - b.cy) // back (upper) petals first, front (lower) last
  const withPetal = (p: P, fn: () => void) => {
    ctx.save()
    ctx.rotate(rad(-p.ang) + Math.PI / 2)
    ctx.translate(0, -ring)
    ctx.scale(p.sz, p.sz)
    fn()
    ctx.restore()
  }
  for (const p of petals) {
    const front = p.cy > 0
    withPetal(p, () => {
      wavyPetalPath(ctx, len, w, p.seed)
      ctx.clip()
      // per-petal gradient: pale at the base (centre) → saturated rose at the tip
      // petals facing the light stay coral to the tip; those facing away go deep rose
      const shift = Math.round(-p.lit * 3.5) // top-left petals deeper, bottom-right lighter
      const g = ctx.createLinearGradient(0, 0, 0, -len)
      g.addColorStop(0, B[clampi(11 + shift, 0, 13)])
      g.addColorStop(0.35, B[clampi(9 + shift, 0, 13)])
      g.addColorStop(0.7, B[clampi(6 + shift, 0, 13)])
      g.addColorStop(1, B[clampi(3 + shift, 0, 13)])
      ctx.fillStyle = g
      ctx.fillRect(-w, -len * 1.2, w * 2, len * 1.4)
      // bloom-space layers: undo the petal transform for them
      ctx.save()
      ctx.scale(1 / p.sz, 1 / p.sz)
      ctx.translate(0, ring)
      ctx.rotate(-(rad(-p.ang) + Math.PI / 2))
      ctx.fillStyle = bowl
      ctx.fillRect(-R * 1.6, -R * 1.6, R * 3.2, R * 3.2)
      ctx.fillStyle = bottomLeft
      ctx.fillRect(-R * 1.6, -R * 1.6, R * 3.2, R * 3.2)
      ctx.fillStyle = rightInner
      ctx.fillRect(-R * 1.6, -R * 1.6, R * 3.2, R * 3.2)
      // a couple of deeper streaks running horizontally inward from the
      // top-left edge (the reference's dark cells reaching into the petal)
      ctx.strokeStyle = "rgba(126,31,43,0.7)"
      ctx.lineCap = "round"
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(-9.5, -6.2)
      ctx.lineTo(-3.4, -5.6)
      ctx.moveTo(-8.6, -3.4)
      ctx.lineTo(-4.6, -3.1)
      ctx.stroke()
      ctx.lineCap = "butt"
      // a few softer, lighter dabs inside the dark top-left patch (dusty mid
      // pinks, 1–2 cells) so the shadow isn't one flat tone
      for (const [x, y, rx, ry, tone, a] of [
        [-6.2, -4.8, 1.3, 0.9, 8, 0.7], [-8.4, -1.6, 1.0, 0.7, 7, 0.65],
        [-3.8, -7.6, 1.1, 0.8, 9, 0.6], [-5.6, -8.6, 0.8, 0.6, 8, 0.6],
      ] as const) {
        ctx.fillStyle = B[tone]
        ctx.globalAlpha = a
        ctx.beginPath()
        ctx.ellipse(x, y, rx, ry, -0.5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      ctx.fillStyle = throat
      ctx.fillRect(-R * 1.6, -R * 1.6, R * 3.2, R * 3.2)
      ctx.fillStyle = throatLR
      ctx.fillRect(-R * 1.6, -R * 1.6, R * 3.2, R * 3.2)
      if (!front) { // back petals one step deeper
        ctx.fillStyle = "rgba(158,47,58,0.1)"
        ctx.fillRect(-R * 1.6, -R * 1.6, R * 3.2, R * 3.2)
      }
      ctx.restore()
      // lit ridge along the upper-left curve of the petal (its left flank,
      // outer half) and a soft shadow along the lower-right edge (right flank)
      ctx.lineWidth = 0.8
      ctx.save()
      ctx.beginPath()
      ctx.rect(-w, -len * 1.2, w, len * 0.9)
      ctx.clip()
      ctx.strokeStyle = p.lit > 0 ? "rgba(253,236,237,0.85)" : "rgba(251,227,228,0.5)"
      wavyPetalPath(ctx, len, w, p.seed)
      ctx.stroke()
      ctx.restore()
      // small highlights inside the shadowed top-left petals: two short pale
      // ridge strokes following the petal's curve, so the dark areas aren't
      // one smooth ramp
      if (p.lit > 0) {
        ctx.strokeStyle = "rgba(250,179,183,0.6)"
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(-w * 0.12, -len * 0.42)
        ctx.quadraticCurveTo(-w * 0.2, -len * 0.6, -w * 0.1, -len * 0.78)
        ctx.moveTo(w * 0.14, -len * 0.5)
        ctx.quadraticCurveTo(w * 0.2, -len * 0.64, w * 0.12, -len * 0.74)
        ctx.stroke()
      }
      // specular catch: a small near-white spot on the raised upper-left ridge
      // of the most lit petals (2–3 of them), distinct from the throat glow
      if (p.lit > 0.25) {
        ctx.fillStyle = "rgba(255,246,246,0.97)"
        ctx.beginPath()
        ctx.ellipse(-w * 0.26, -len * 0.64, 1.0, 0.6, -0.6, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, -len * 1.2, w, len * 1.3)
      ctx.clip()
      ctx.strokeStyle = "rgba(158,47,58,0.4)"
      ctx.lineWidth = 0.9
      wavyPetalPath(ctx, len, w, p.seed)
      ctx.stroke()
      ctx.restore()
    })
  }
  // rim shadow falling into the pit: a couple of deep-rose cells hugging the
  // centre's upper-left, plus a deeper wash on the bottom-left lobe
  ctx.strokeStyle = "rgba(126,31,43,0.75)"
  ctx.lineWidth = 1.1
  ctx.beginPath()
  ctx.arc(EYE[0], EYE[1], 2.3, Math.PI * 0.8, Math.PI * 1.45)
  ctx.stroke()
  // radial seams between petals: one step darker, fading out halfway to the edge
  for (let i = 0; i < n; i++) {
    if (i === 2) continue
    const a = byAngle[i].ang, b = byAngle[(i + 1) % n].ang + (i === n - 1 ? 360 : 0)
    const mid = rad((a + b) / 2)
    const dx = Math.cos(mid), dy = -Math.sin(mid)
    const r0 = 2, r1 = R * 0.5
    const sg = ctx.createLinearGradient(EYE[0] + dx * r0, EYE[1] + dy * r0, EYE[0] + dx * r1, EYE[1] + dy * r1)
    sg.addColorStop(0, "rgba(158,47,58,0.5)")
    sg.addColorStop(1, "rgba(158,47,58,0)")
    ctx.strokeStyle = sg
    ctx.lineWidth = 0.9
    ctx.beginPath()
    ctx.moveTo(EYE[0] + dx * r0, EYE[1] + dy * r0)
    ctx.lineTo(EYE[0] + dx * r1, EYE[1] + dy * r1)
    ctx.stroke()
  }
}
function drawCenter(ctx: Ctx) {
  // small, soft pit (~3×3 cells): #5C2A22 with #3A1512 on the upper-left
  // cell or two, and a muted rather than bright highlight lower-right
  const c = PALETTE.center
  const g = ctx.createLinearGradient(EYE[0] - 1.4, EYE[1] - 1.3, EYE[0] + 1.2, EYE[1] + 1.1)
  g.addColorStop(0, c[0])
  g.addColorStop(0.35, c[2])
  g.addColorStop(1, c[2])
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(EYE[0], EYE[1], 1.5, 1.4, -0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = PALETTE.pink[4] // #B8434F, muted glint
  ctx.fillRect(EYE[0] + 0.15, EYE[1] + 0.15, 0.7, 0.7)
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
    parts.push({ id: `bloom-${i}`, kind: "bloom", family: b.kind === "open" ? "bloom" : "pink", bloom: i, draw: withBloom(b, draw) })
    if (b.kind === "open") parts.push({ id: `center-${i}`, kind: "center", family: "center", bloom: i, draw: withBloom(b, drawCenter) })
  })
  return parts
}

// ---------------------------------------------------------------------------
// falling petals
// ---------------------------------------------------------------------------
type Petal = { x: number; y: number; vx: number; vy: number; x0: number; amp: number; period: number; phase: number; born: number; colors: [string, string, string]; frame: number; cells: [number, number][]; seed: number; dead: boolean }
// rounded petal blobs (corner cells removed): 5×4 and 4×4, chosen per petal;
// each petal is then rotated to its own angle and snapped to the grid at spawn.
// The smaller frames are used only when `petals.tumble` is on.
const PETAL_FRAMES: [number, number][][] = [
  [[1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [1, 3], [2, 3], [3, 3]],
  [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2], [1, 3], [2, 3]],
  [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [3, 1], [1, 2], [2, 2]],
  [[1, 0], [1, 1], [1, 2]],
]
// one oval form at any orientation: rasterise an ellipse (radii in cells)
// rotated by `angle`, sampling cell centres, so a horizontal, vertical or
// diagonal oval all keep the same clean shape
function ovalSprite(angle: number, rx = 2.7, ry = 2.0): [number, number][] {
  const c = Math.cos(angle), sn = Math.sin(angle)
  const out: [number, number][] = []
  const R = Math.ceil(rx)
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      const u = x * c + y * sn, v = -x * sn + y * c // into the ellipse's frame
      if ((u / rx) ** 2 + (v / ry) ** 2 <= 1) out.push([x + R, y + R])
    }
  return out
}
const FRAME_CYCLE = [1, 2, 3, 2]

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
    let cLeaf = new Int8Array(0) // leaf index for group 2 (each leaf gets its own flutter timing)
    let cLag = new Float32Array(0) // 0 = stem phase, 1 = bloom phase
    let cDelay = new Float32Array(0)
    let ox = new Float32Array(0), oy = new Float32Array(0), vx = new Float32Array(0), vy = new Float32Array(0)
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

      // open flower: a 3×3 median over its own cells removes single-cell speckle
      // left by overlapping gradients while keeping the colour bands intact
      {
        const src = idx.slice()
        const buf: number[] = []
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const i = r * cols + c, pi = partOf[i]
          if (pi < 0 || parts[pi].family !== "bloom") continue
          buf.length = 0
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            const q = at(c + dc, r + dr)
            if (q === pi) buf.push(src[(r + dr) * cols + c + dc])
          }
          buf.sort((a, b) => a - b)
          idx[i] = buf[buf.length >> 1]
        }
      }

      // open flower: low-frequency mottle inside its darker tones — small
      // clusters lift one or two steps so the shadowed petals show light
      // catching on their surface instead of a smooth ramp
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c, pi = partOf[i]
        if (pi < 0 || parts[pi].family !== "bloom" || idx[i] > 7) continue
        const nz = valueNoise(c / 2.4, r / 2.4, 4242)
        if (nz > 0.5) idx[i] += 2
        else if (nz > 0.28) idx[i] += 1
      }

      // blooms: optional smooth noise, then darken cells bordering a bloom in front
      const noiseSeed = 77
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c, pi = partOf[i]
        if (pi < 0 || parts[pi].kind !== "bloom" || (parts[pi].family === "pink" && idx[i] === ACCENT)) continue
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
        // background below / to the left (one ramp step is subtle on the 14-tone ramp).
        // The open flower is a bowl lit convexly only at its rims, so it darkens
        // just its bottom-right outer edge.
        if (BOUQUET.blooms[me]?.kind === "open") {
          // at most one step, and only on the bottom-right quadrant's outer edge
          const b = BOUQUET.blooms[me]
          const bc = baseX + b.at[0] * sceneScale, br = baseY + b.at[1] * sceneScale
          const bottomEdge = at(c, r + 1) < 0 && c >= bc - 1, rightEdge = at(c + 1, r) < 0 && r >= br - 1
          if (bottomEdge || rightEdge) k -= 1
          // and a deeper rim on the bottom-left, where the target is darkest
          const lowerLeft = r >= br - 1 && c < bc
          if (lowerLeft && (at(c - 1, r) < 0 || at(c, r + 1) < 0)) k -= 2
        } else {
          if (at(c, r + 1) < 0) k -= 2
          if (at(c - 1, r) < 0) k -= 1
        }
        idx[i] = clampi(k, 0, RGB[parts[pi].family].length - 1)
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
      cLeaf = new Int8Array(nCells)
      cColor = new Array(nCells)
      ox = new Float32Array(nCells); oy = new Float32Array(nCells); vx = new Float32Array(nCells); vy = new Float32Array(nCells)
      list.forEach((i, k) => {
        const c = i % cols, r = (i - c) / cols, pi = partOf[i], part = parts[pi]
        cCol[k] = c; cRow[k] = r; cPart[k] = pi
        const fam = part.family
        cColor[k] = fam === "pink" ? (idx[i] === ACCENT ? PALETTE.accent : PALETTE.pink[idx[i]])
          : fam === "bloom" ? PALETTE.bloom[idx[i]]
          : fam === "green" ? PALETTE.green[idx[i]] : PALETTE.center[idx[i]]
        cGroup[k] = part.kind === "stem" ? 0 : part.kind === "leaf" ? 2 : 1
        if (part.kind === "leaf") {
          // how far along the blade this cell sits, so the tip sways most
          const lf = leafOf.get(pi)
          const sx = (c + 0.5 - baseX) / sceneScale, sy = (r + 0.5 - baseY) / sceneScale
          cLag[k] = lf ? clamp01(Math.hypot(sx - lf.from[0], sy - lf.from[1]) / lf.length) : 0
          cLeaf[k] = Number(part.id.split("-")[1])
        } else {
          cLag[k] = part.kind === "stem" ? 1 - clamp01((r - stemTop[pi]) / CONFIG.sway.stemBlendRows) : 1
        }
        cDelay[k] = hash2(c, r, 13) * CONFIG.intro.cellDelay
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
      // every petal sheds from the same spot, behind the top-right bud; the
      // petal layer is drawn beneath the baked cells so it emerges from behind
      const src = CONFIG.petals.source
      const b = BOUQUET.blooms[src.bloom]
      const j = src.jitter
      const sx = b.at[0] + src.offset[0] + rand(-j, j), sy = b.at[1] + src.offset[1] + rand(-j, j)
      const x = regionX + (baseX + sx * sceneScale) * cell, y = (baseY + sy * sceneScale) * cell
      const k = 7 + Math.floor(Math.random() * 2)
      const L = CONFIG.petals.launch
      const frame = Math.random() < 0.5 ? 0 : 1
      petals.push({
        x, y, x0: x, vx: rand(L.vx[0], L.vx[1]), vy: rand(L.vy[0], L.vy[1]),
        amp: rand(CONFIG.petals.driftAmp[0], CONFIG.petals.driftAmp[1]),
        period: rand(CONFIG.petals.driftPeriod[0], CONFIG.petals.driftPeriod[1]),
        phase: rand(0, Math.PI * 2), born: now, dead: false, frame,
        // the same oval at its own diagonal: 20–70° or 110–160°, never flat or upright
        cells: ovalSprite(rad(Math.random() < 0.5 ? rand(20, 70) : rand(110, 160))),
        seed: Math.floor(Math.random() * 1e6),
        colors: [PALETTE.pink[clampi(k + 2, 0, PMAX)], PALETTE.pink[k], PALETTE.pink[clampi(k - 2, 0, PMAX)]],
      })
    }
    function updatePetals(dt: number, now: number, wind: number) {
      for (const p of petals) {
        const age = (now - p.born) / 1000
        // one slow, small lean so the fall is a smooth arc with no zig-zag
        const swing = Math.sin((age / p.period) * Math.PI * 2 + p.phase)
        p.vy = Math.min(CONFIG.petals.terminal, p.vy + CONFIG.petals.accel * dt)
        p.y += p.vy * dt
        // the launch push decays toward the ambient wind, which always blows
        // rightward and strengthens when the sway leans right
        const windV = (0.6 + 0.4 * wind) * CONFIG.petals.wind
        p.vx += (windV - p.vx) * Math.min(1, CONFIG.petals.launch.drag * dt)
        // breeze: smooth, non-repeating gusts unique to this petal
        const gust = valueNoise(age * CONFIG.petals.breeze.rate, 0.5, p.seed) * CONFIG.petals.breeze.strength
        const lift = valueNoise(0.5, age * CONFIG.petals.breeze.rate * 0.7, p.seed + 1) * CONFIG.petals.breeze.strength * 0.35
        p.x0 += (p.vx + gust) * dt
        p.y += lift * dt
        p.x = p.x0 + swing * p.amp
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
          : p.cells
        const a = p.y > fadeStart ? clamp01(1 - (p.y - fadeStart) / (H - fadeStart)) : 1
        if (a <= 0) continue
        ctx.globalAlpha = a
        for (const [dx, dy] of frame) {
          // light at the upper-left, dark at the lower-right
          const shade = (dx + dy) / 10
          ctx.fillStyle = p.colors[shade < 0.36 ? 0 : shade < 0.66 ? 1 : 2]
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
      // as large as the left half allows, so the vector shading can be judged
      const scale = Math.min((H - 64) / (vec.height / dpr), (Math.max(regionX, W * 0.45) - 48) / (vec.width / dpr))
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
      const Hrows = Math.max(1, baseY - flowerTopRow)
      const introT = clamp01(elapsed / CONFIG.intro.duration)

      ctx.clearRect(0, 0, W, H)
      drawGrid()
      if (!reduced) {
        if (now >= nextPetalAt) {
          spawnPetal(now)
          const P = CONFIG.petals
          if (Math.random() < P.pairChance) {
            nextPetalAt = now + rand(P.pairGap[0], P.pairGap[1]) * 1000 // a second one right behind
          } else {
            // squared random skews toward short gaps with occasional long pauses
            const u = Math.random()
            nextPetalAt = now + lerp(P.interval[0], P.interval[1], u * u) * 1000
          }
        }
        updatePetals(dt, now, swayS)
        drawPetals(now) // beneath the bouquet so petals emerge from behind it
      }

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
        let sway: number, lift = 0
        if (cGroup[k] === 2) {
          // leaves ride the stem sway and flutter up and down, strongest at the
          // tip, each on its own slightly different rhythm
          const li = cLeaf[k]
          const rhythm = t * CONFIG.sway.speed * (0.85 + 0.22 * li) + CONFIG.sway.leafPhase + li * 2.1
          sway = swayS * amp + Math.sin(rhythm * 0.5) * CONFIG.sway.leafPx * 0.35 * lag * lag
          lift = (reduced ? 0 : Math.sin(rhythm)) * CONFIG.sway.leafPx * lag * lag
        } else {
          sway = (lag >= 1 ? swayB : lag <= 0 ? swayS : lerp(swayS, swayB, lag)) * amp
        }

        // cursor repel: small spring displacement, clamped to one cell
        let ax = -spring * ox[k] - damping * vx[k], ay = -spring * oy[k] - damping * vy[k]
        const cx = regionX + col * cell + cell / 2 + sway, cy = row * cell + cell / 2 + lift
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
        // the page text sits above the canvas; hide it while the vector panel is up
        parent.querySelectorAll<HTMLElement>("nav, section").forEach((el) => { el.style.visibility = debug ? "hidden" : "" })
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
