import * as C from "./config"
import { mix } from "./color"
import { rad } from "./ease"
import type { Rng } from "./rng"

// Bougainvillea bract clusters. Shapes are unit-length Path2Ds pointing along +x from the base,
// drawn with ctx.scale(len), so line widths are divided by len.

// Smooth closed blob from ~n points: half-width sin(PI u^p)^q peaks at `widest` (p solves
// widest^p = 0.5), pinches to a soft point at the tip and a narrow base.
export function blob(n: number, widthRatio: number, widest: number, roundness: number, asymL = 0, asymR = 0) {
  const half = Math.max(3, Math.round(n / 2))
  const p = Math.log(0.5) / Math.log(widest)
  const h = (u: number) => (widthRatio / 2) * Math.pow(Math.sin(Math.PI * Math.pow(u, p)), roundness)
  const pts: [number, number][] = []
  for (let i = 0; i <= half; i++) {
    const u = (1 - Math.cos((Math.PI * i) / half)) / 2 // denser at the base and tip
    pts.push([u, -h(u) * (1 + asymR)])
  }
  for (let i = half - 1; i > 0; i--) {
    const u = (1 - Math.cos((Math.PI * i) / half)) / 2
    pts.push([u, h(u) * (1 + asymL)])
  }
  // midpoint quadratics through the samples
  const path = new Path2D()
  const f4 = (v: number) => +v.toFixed(4)
  const mid = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const
  const m0 = mid(pts[pts.length - 1], pts[0])
  path.moveTo(m0[0], m0[1])
  let d = `M${f4(m0[0])} ${f4(m0[1])}`
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const m = mid(a, pts[(i + 1) % pts.length])
    path.quadraticCurveTo(a[0], a[1], m[0], m[1])
    d += `Q${f4(a[0])} ${f4(a[1])} ${f4(m[0])} ${f4(m[1])}`
  }
  path.closePath()
  pathData.set(path, d + "Z")
  return path
}

// SVG path data for each shape, so the SVG export can draw the same Path2Ds.
export const pathData = new WeakMap<Path2D, string>()

let leafPath: Path2D | null = null
export const leafShape = () => (leafPath ??= blob(C.BRACT_POINTS, C.LEAF_WIDTH_RATIO, C.LEAF_WIDEST_AT, 0.9))

export type Bract = {
  angle: number // around the cluster centre, from the cluster's rotation
  len: number
  shape: Path2D
  sideVeins: boolean
  color: string
  vein: string
  delay: number // ms after the cluster starts
  dropAt: number // glyph clock when it fell off (Infinity = attached)
  regrowAt: number // glyph clock when it springs back
  pose: { x: number; y: number; angle: number; scale: number } | null // last drawn base pose, mask coords
}

export type Cluster = {
  vine: number
  s: number // attachment, arc length on the vine
  ax: number // attachment point at rest
  ay: number
  kind: "bud" | "small" | "normal" | "hero"
  stalk: number // length
  stalkAngle: number // off straight down
  stalkW: number
  rot: number // the first bract's direction
  len: number // bract length (for spacing)
  bracts: Bract[]
  flowers: { angle: number; len: number }[]
  flowerW: number
  start: number
  id: number // boil stream
  // pendulum sway (runtime)
  phi: number
  phiV: number
}

const LENGTHS = {
  bud: [C.BUD_LENGTH_MIN_EM, C.BUD_LENGTH_MAX_EM],
  small: [C.SMALL_LENGTH_MIN_EM, C.SMALL_LENGTH_MAX_EM],
  normal: [C.CLUSTER_LENGTH_MIN_EM, C.CLUSTER_LENGTH_MAX_EM],
  hero: [C.HERO_LENGTH_MIN_EM, C.HERO_LENGTH_MAX_EM],
} as const

export const bractColors = (v: C.Variety) => ({ main: v.main, tint: mix(v.main, C.BRACT_TINT_TOWARD, C.BRACT_TINT_MIX), vein: v.vein })

export function makeCluster(
  rng: Rng,
  o: { vine: number; s: number; ax: number; ay: number; kind: Cluster["kind"]; start: number; variety: C.Variety; fs: number; stemW: number; stalk?: number; stalkAngle?: number; id: number }
): Cluster {
  const k = o.fs / C.REF_FONT_PX
  const [lo, hi] = LENGTHS[o.kind]
  const len = rng.range(lo, hi) * o.fs
  const rot = rng.range(0, Math.PI * 2)
  const colors = bractColors(o.variety)
  const n = o.kind === "bud" ? 1 : 3
  const bracts: Bract[] = []
  for (let j = 0; j < n; j++) {
    const bl = len * rng.range(0.9, 1.08)
    bracts.push({
      angle: (j * Math.PI * 2) / 3 + rad(rng.range(-C.BRACT_ANGLE_JITTER_DEG, C.BRACT_ANGLE_JITTER_DEG)),
      len: bl,
      shape: blob(C.BRACT_POINTS, C.BRACT_WIDTH_RATIO * rng.range(0.92, 1.06), C.BRACT_WIDEST_AT, C.BRACT_ROUNDNESS, rng.range(-1, 1) * C.BRACT_ASYMMETRY, rng.range(-1, 1) * C.BRACT_ASYMMETRY),
      sideVeins: bl >= C.BRACT_SIDE_VEIN_MIN_EM * o.fs,
      color: rng.next() < C.BRACT_TINT_CHANCE ? colors.tint : colors.main,
      vein: colors.vein,
      delay: j * C.BRACT_OPEN_STAGGER_MS,
      dropAt: Infinity,
      regrowAt: Infinity,
      pose: null,
    })
  }
  const flowers =
    o.kind === "bud"
      ? []
      : Array.from({ length: C.FLOWER_COUNT }, (_, j) => ({
          angle: Math.PI / 3 + (j * Math.PI * 2) / 3 + rng.range(-0.2, 0.2),
          len: Math.min(C.FLOWER_LENGTH * len, C.FLOWER_LENGTH_MAX_EM * o.fs) * rng.range(0.8, 1.1),
        }))
  return {
    vine: o.vine,
    s: o.s,
    ax: o.ax,
    ay: o.ay,
    kind: o.kind,
    stalk: o.stalk ?? C.STALK_EM * o.fs,
    stalkAngle: o.stalkAngle ?? rng.range(-0.15, 0.15),
    stalkW: Math.max(1, o.stemW * C.STALK_WIDTH),
    rot,
    len,
    bracts,
    flowers,
    flowerW: Math.max(C.FLOWER_WIDTH_MIN_PX, C.FLOWER_WIDTH_PX * k),
    start: o.start,
    id: o.id,
    phi: 0,
    phiV: 0,
  }
}

// One bract at the current transform: origin at its base, pointing along +x, unit = len.
export function drawBract(ctx: CanvasRenderingContext2D, b: Pick<Bract, "shape" | "color" | "vein" | "sideVeins">, len: number, veinPx: number) {
  ctx.fillStyle = b.color
  ctx.fill(b.shape)
  ctx.strokeStyle = b.vein
  ctx.lineWidth = veinPx / len
  ctx.lineCap = "round"
  ctx.beginPath()
  ctx.moveTo(C.BRACT_VEIN_FROM, 0)
  ctx.lineTo(C.BRACT_VEIN_TO, 0)
  if (b.sideVeins) {
    const a = rad(C.BRACT_SIDE_VEIN_DEG)
    const l = C.BRACT_SIDE_VEIN_LENGTH
    for (const sd of [-1, 1]) {
      ctx.moveTo(C.BRACT_SIDE_VEIN_AT, 0)
      ctx.lineTo(C.BRACT_SIDE_VEIN_AT + Math.cos(a) * l, sd * Math.sin(a) * l)
    }
  }
  ctx.stroke()
}

// Leaf at the current transform: origin at the stem, pointing along +x, unit = len.
export function drawLeafShape(ctx: CanvasRenderingContext2D, len: number, color: string, veinPx: number, vein: string) {
  ctx.fillStyle = color
  ctx.fill(leafShape())
  ctx.strokeStyle = vein
  ctx.lineWidth = veinPx / len
  ctx.lineCap = "round"
  ctx.beginPath()
  ctx.moveTo(C.LEAF_VEIN_FROM, 0)
  ctx.lineTo(C.LEAF_VEIN_TO, 0)
  ctx.stroke()
}
