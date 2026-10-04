import * as C from "./config"
import { mix, rgba } from "./color"
import { fontFor } from "./font"
import { buildFiligree } from "./filigree"
import { buildIcicles, drawIcicle, type Icicle } from "./icicles"
import { buildMask, type Mask } from "./mask"
import { createRng, hashSeed, valueNoise } from "./rng"
import { buildSnow, drawSnow, type SnowCap } from "./snow"
import { advanceEl, clipRelief, drawRelief, makeLayer, makeRelief, type FiliEl, type Layer, type Relief } from "./relief"
import { clamp, easeOutCubic, progress } from "./stroke"

// Salts so each subsystem draws from its own random stream.
const SALT = { freeze: 1, icicles: 2, snow: 3, filigree: 4, body: 5 }

// Layers that only exist while the glyph animates; dropped once it's baked to `cache`.
type Live = {
  body: Layer
  deco: Layer // icicles + snow, redrawn while growing
  relief: Relief // filigree, painted incrementally, kept inside the glyph
  spill: Relief | null // filigree that spills past the silhouette (unclipped), if any
  clip: Layer // glyph shape dilated by RELIEF_CLIP_OVERFLOW_PX
}

export type BuiltGlyph = {
  fs: number // font size this geometry was built at
  dpr: number
  w: number // local box, css px
  h: number
  ox: number // pen origin (baseline) inside the local box
  oy: number
  freeze: { pts: { x: number; y: number }[]; radius: number }
  icicles: Icicle[]
  snow: SnowCap[]
  elems: FiliEl[]
  bodySettled: boolean
  decoDone: boolean
  filiDone: boolean
  pending: number // unfinished animated elements
  live: Live | null
  cache: HTMLCanvasElement | null
}


export function buildGlyph(char: string, seed: number, fs: number, dpr: number): BuiltGlyph {
  const measure = document.createElement("canvas").getContext("2d")!
  measure.font = fontFor(fs)
  const mt = measure.measureText(char)
  const spillPad = Math.max(C.SPILL_DISTANCE_PX, C.BREAK_MAX_PX, C.INCOMING_START_MAX_PX, C.FLAKE_R_MAX_PX * C.FLAKE_OVERSHOOT) + 4 // room for anything that spills past the glyph
  const padX = Math.max(C.GLYPH_PAD_EM * fs, spillPad)
  const ox = Math.round(padX + mt.actualBoundingBoxLeft)
  const oy = Math.round(Math.max(C.SNOW_PAD_EM * fs, spillPad) + mt.actualBoundingBoxAscent)
  const w = Math.ceil(ox + mt.actualBoundingBoxRight + padX)
  const h = Math.ceil(oy + mt.actualBoundingBoxDescent + Math.max(C.ICICLE_PAD_EM * fs, spillPad))

  const text = (ctx: CanvasRenderingContext2D, mode: "fill" | "stroke" = "fill") => {
    ctx.font = fontFor(fs)
    ctx.textAlign = "left"
    ctx.textBaseline = "alphabetic"
    if (mode === "fill") ctx.fillText(char, ox, oy)
    else ctx.strokeText(char, ox, oy)
  }

  const mask = buildMask((ctx) => {
    ctx.fillStyle = "#fff"
    text(ctx)
  }, w, h)

  const { els: elems, facets, bubbles } = buildFiligree(createRng(hashSeed(seed, SALT.filigree)), mask, fs)
  const body = renderBody(mask, fs, w, h, dpr, hashSeed(seed, SALT.body), text, facets, bubbles)
  const deco = makeLayer(w, h, dpr)
  const clip = makeLayer(w, h, dpr)
  clip.ctx.fillStyle = "#fff"
  clip.ctx.strokeStyle = "#fff"
  clip.ctx.lineWidth = C.RELIEF_CLIP_OVERFLOW_PX * 2
  clip.ctx.lineJoin = "round"
  text(clip.ctx)
  text(clip.ctx, "stroke")

  const relief = makeRelief(w, h, dpr)
  const spill = elems.some((e) => e.spill) ? makeRelief(w, h, dpr) : null
  const icicles = buildIcicles(createRng(hashSeed(seed, SALT.icicles)), mask, fs)
  const snow = buildSnow(createRng(hashSeed(seed, SALT.snow)), mask, fs)

  return {
    fs,
    dpr,
    w,
    h,
    ox,
    oy,
    freeze: freezeInfo(createRng(hashSeed(seed, SALT.freeze)), mask),
    icicles,
    snow,
    elems,
    bodySettled: false,
    decoDone: false,
    filiDone: false,
    pending: elems.length + icicles.length + snow.length,
    live: { body, deco, relief, spill, clip },
    cache: null,
  }
}

// Ice body: a vertical ICE_LIGHT -> ICE_MID -> ICE_DEEP gradient, a blurred ICE_DEEP outline
// shaded inward (thick, glassy edges), thin ICE_HIGHLIGHT / OUTLINE rims on the upper-left /
// lower-right edges, and soft white streaks. Shading is drawn source-atop so it stays inside.
function renderBody(
  m: Mask,
  fs: number,
  w: number,
  h: number,
  dpr: number,
  seed: number,
  text: (ctx: CanvasRenderingContext2D, mode?: "fill" | "stroke") => void,
  facets: { xy: number[]; alpha: number }[],
  bubbles: { x: number; y: number; r: number }[]
): Layer {
  const body = makeLayer(w, h, dpr)
  const ctx = body.ctx
  const top = m.top
  const bottom = m.bottom + 1
  const blur = (em: number) => (typeof ctx.filter === "string" ? `blur(${em * fs * dpr}px)` : "none")

  const grad = ctx.createLinearGradient(0, top, 0, bottom)
  grad.addColorStop(0, C.ICE_LIGHT)
  grad.addColorStop(0.5, C.ICE_MID)
  grad.addColorStop(1, mix(C.ICE_DEEP, C.ICE_MID, C.BODY_BOTTOM_LIGHTEN))
  ctx.globalAlpha = C.BODY_ALPHA
  ctx.fillStyle = grad
  text(ctx)
  ctx.globalAlpha = 1

  ctx.globalCompositeOperation = "source-atop"
  ctx.filter = blur(C.INNER_SHADE_BLUR_EM)
  ctx.strokeStyle = rgba(C.ICE_DEEP, C.INNER_SHADE_ALPHA)
  ctx.lineWidth = C.INNER_SHADE_WIDTH_EM * fs
  ctx.lineJoin = "round"
  text(ctx, "stroke")
  ctx.filter = "none"

  // inner glow: the letter looks lit from within, centred a little above the centroid
  const glowR = Math.sqrt(m.area) * C.INNER_GLOW_RADIUS_RATIO
  const glow = ctx.createRadialGradient(m.cx, m.cy + C.INNER_GLOW_OFFSET_EM * fs, 0, m.cx, m.cy + C.INNER_GLOW_OFFSET_EM * fs, glowR)
  glow.addColorStop(0, rgba(C.ICE_LIGHT, C.INNER_GLOW_ALPHA))
  glow.addColorStop(1, rgba(C.ICE_LIGHT, 0))
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)

  // long, soft, curved streaks warped by seeded noise
  const rng = createRng(seed)
  const noise = valueNoise(rng)
  const H = bottom - top
  ctx.filter = blur(C.STREAK_BLUR_EM)
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  for (let k = 0; k < C.STREAK_COUNT; k++) {
    const x0 = rng.range(0, w)
    const lean = rng.range(-1, 1) * C.STREAK_LEAN * H
    const t0 = rng.range(0, 1 - C.STREAK_LENGTH_MIN)
    const t1 = Math.min(1, t0 + rng.range(C.STREAK_LENGTH_MIN, C.STREAK_LENGTH_MAX))
    const warpOff = rng.range(0, 64)
    ctx.strokeStyle = rgba("#ffffff", rng.range(C.STREAK_ALPHA_MIN, C.STREAK_ALPHA_MAX))
    ctx.lineWidth = rng.range(C.STREAK_WIDTH_MIN_EM, C.STREAK_WIDTH_MAX_EM) * fs
    ctx.beginPath()
    for (let i = 0; i <= 14; i++) {
      const t = t0 + ((t1 - t0) * i) / 14
      const x = x0 + lean * t + noise(warpOff + t * 3) * C.STREAK_WARP_EM * fs
      if (i === 0) ctx.moveTo(x, top + t * H)
      else ctx.lineTo(x, top + t * H)
    }
    ctx.stroke()
  }
  ctx.filter = "none"

  // inner structure: faint facet lines along the strokes, tiny trapped bubbles
  ctx.lineWidth = C.FACET_WIDTH_PX
  for (const f of facets) {
    ctx.strokeStyle = rgba("#ffffff", f.alpha)
    ctx.beginPath()
    ctx.moveTo(f.xy[0], f.xy[1])
    for (let i = 2; i < f.xy.length; i += 2) ctx.lineTo(f.xy[i], f.xy[i + 1])
    ctx.stroke()
  }
  ctx.fillStyle = rgba("#ffffff", C.BUBBLE_ALPHA)
  for (const b of bubbles) {
    ctx.beginPath()
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = "source-over"

  // glyph minus itself shifted by (d, d) leaves only its upper-left edges (and vice versa)
  const d = Math.max(C.RIM_MIN_PX, C.RIM_EM * fs)
  const rim = (color: string, dx: number, alpha: number) => {
    const t = makeLayer(w, h, dpr)
    t.ctx.fillStyle = "#fff"
    text(t.ctx)
    t.ctx.globalCompositeOperation = "destination-out"
    t.ctx.save()
    t.ctx.translate(dx, dx)
    text(t.ctx)
    t.ctx.restore()
    t.ctx.globalCompositeOperation = "source-in"
    t.ctx.fillStyle = color
    t.ctx.fillRect(0, 0, w, h)
    ctx.globalAlpha = alpha
    ctx.drawImage(t.c, 0, 0, w, h)
    ctx.globalAlpha = 1
  }
  rim(C.ICE_HIGHLIGHT, d, C.RIM_HIGHLIGHT_ALPHA)
  rim(C.OUTLINE, -d, C.RIM_OUTLINE_ALPHA)
  return body
}

// The freeze-in reveal expands from a couple of deep interior points until it covers the glyph.
function freezeInfo(rng: ReturnType<typeof createRng>, m: Mask) {
  const deep: number[] = []
  for (let i = 0; i < m.dist.length; i++) if (m.dist[i] >= m.maxDist * 0.6 && m.dist[i] > 0) deep.push(i)
  const toPt = (i: number) => ({ x: (i % m.w) + 0.5, y: Math.floor(i / m.w) + 0.5 })
  const pts: { x: number; y: number }[] = []
  if (!deep.length) return { pts: [{ x: m.cx, y: m.cy }], radius: Math.hypot(m.w, m.h) }
  pts.push(toPt(deep[Math.floor(rng.next() * deep.length)]))
  while (pts.length < C.FREEZE_POINTS) {
    // spread the points: best of a few candidates by distance from the others
    let best = toPt(deep[Math.floor(rng.next() * deep.length)])
    let bestD = -1
    for (let k = 0; k < 8; k++) {
      const p = toPt(deep[Math.floor(rng.next() * deep.length)])
      const d = Math.min(...pts.map((q) => Math.hypot(q.x - p.x, q.y - p.y)))
      if (d > bestD) {
        bestD = d
        best = p
      }
    }
    pts.push(best)
  }
  let radius = 0
  for (let i = 0; i < m.cov.length; i++) {
    if (!m.cov[i]) continue
    const x = (i % m.w) + 0.5
    const y = Math.floor(i / m.w) + 0.5
    let near = Infinity
    for (const q of pts) near = Math.min(near, (q.x - x) ** 2 + (q.y - y) ** 2)
    radius = Math.max(radius, near)
  }
  radius = Math.sqrt(radius)
  return { pts, radius: radius + 2 }
}

const decoStart = Math.min(C.ICICLE_DELAY, C.SNOW_DELAY)
const freezeEnd = C.BODY_DELAY + C.BODY_FREEZE_MS

// Advance a glyph to `age` ms (Infinity = finish now). Returns true if anything visible changed.
export function updateGlyph(b: BuiltGlyph, age: number): boolean {
  if (b.cache || !b.live) return false
  const live = b.live
  let changed = false
  let pending = 0

  if (!b.bodySettled) {
    changed = true
    if (age >= freezeEnd) b.bodySettled = true
  }

  if (!b.decoDone && age >= decoStart) {
    const ctx = live.deco.ctx
    ctx.clearRect(0, 0, b.w, b.h)
    for (const cap of b.snow) {
      drawSnow(ctx, cap, progress(age, cap.start, cap.duration))
      if (age < cap.start + cap.duration) pending++
    }
    for (const ic of b.icicles) {
      drawIcicle(ctx, ic, progress(age, ic.start, ic.duration))
      if (age < ic.start + ic.duration) pending++
    }
    b.decoDone = pending === 0
    changed = true
  } else if (!b.decoDone) pending += b.snow.length + b.icicles.length

  if (!b.filiDone && age >= C.FILIGREE_DELAY) {
    let paintedClipped = false
    let paintedSpill = false
    let left = 0
    for (const e of b.elems) {
      const r = advanceEl(e, age, live.relief, live.spill)
      if (r.painted) {
        if (r.spill) paintedSpill = true
        else paintedClipped = true
      }
      if (!r.done) left++
    }
    // only the new slice can poke out, but re-clipping the layers is cheap
    if (paintedClipped) clipRelief(live.relief, live.clip.c)
    if (paintedClipped || paintedSpill) changed = true
    b.filiDone = left === 0
    pending += left
  } else if (!b.filiDone) pending += b.elems.length

  b.pending = pending
  if (b.bodySettled && b.decoDone && b.filiDone) {
    bake(b)
    changed = true
  }
  return changed
}

// Draw in glyph-local css px (the caller sets the transform).
export function drawGlyph(ctx: CanvasRenderingContext2D, b: BuiltGlyph, age: number) {
  if (b.cache) {
    ctx.drawImage(b.cache, 0, 0, b.w, b.h)
    return
  }
  const live = b.live!
  if (age < freezeEnd) {
    const p = easeOutCubic(clamp((age - C.BODY_DELAY) / C.BODY_FREEZE_MS, 0, 1))
    if (p > 0) {
      const r = b.freeze.radius * p
      ctx.save()
      ctx.beginPath()
      for (const q of b.freeze.pts) {
        ctx.moveTo(q.x + r, q.y)
        ctx.arc(q.x, q.y, r, 0, Math.PI * 2)
      }
      ctx.clip()
      ctx.globalAlpha = 0.5 + 0.5 * p
      ctx.drawImage(live.body.c, 0, 0, b.w, b.h)
      ctx.restore()
    }
  } else ctx.drawImage(live.body.c, 0, 0, b.w, b.h)
  if (age >= decoStart) ctx.drawImage(live.deco.c, 0, 0, b.w, b.h)
  if (age >= C.FILIGREE_DELAY) {
    drawRelief(ctx, live.relief, b.w, b.h, b.dpr)
    if (live.spill) drawRelief(ctx, live.spill, b.w, b.h, b.dpr)
  }
}

// Flatten the finished layers into one canvas so a done glyph costs one drawImage.
function bake(b: BuiltGlyph) {
  const out = makeLayer(b.w, b.h, b.dpr)
  drawGlyph(out.ctx, b, Infinity)
  b.cache = out.c
  b.live = null
  b.elems = []
  b.icicles = []
  b.snow = []
}
