import * as C from "./config"
import { hexToRgb, rgba } from "./color"
import { buildFiligree } from "./filigree"
import { buildIcicles, drawIcicle, type Icicle } from "./icicles"
import { buildMask, type Mask } from "./mask"
import { createRng, hashSeed } from "./rng"
import { buildSnow, drawSnow, type SnowCap } from "./snow"
import { type Stroke, clamp, easeOutCubic, paintSlice, progress } from "./stroke"

// Salts so each subsystem draws from its own random stream.
const SALT = { freeze: 1, icicles: 2, snow: 3, filigree: 4, grain: 5 }

type Layer = { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D }

// Layers that only exist while the glyph animates; dropped once it's baked to `cache`.
type Live = {
  body: Layer
  deco: Layer // icicles + snow, redrawn while growing
  light: Layer // filigree, painted incrementally
  shadow: Layer
  clip: Layer // glyph shape dilated by FILIGREE_OVERFLOW_PX
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
  strokes: Stroke[]
  bodySettled: boolean
  decoDone: boolean
  filiDone: boolean
  pending: number // unfinished animated elements
  live: Live | null
  cache: HTMLCanvasElement | null
}

export const fontFor = (fs: number) => `${C.FONT_WEIGHT} ${fs}px ${C.FONT_FAMILY}`

function makeLayer(w: number, h: number, dpr: number): Layer {
  const c = document.createElement("canvas")
  c.width = Math.round(w * dpr)
  c.height = Math.round(h * dpr)
  const ctx = c.getContext("2d")!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { c, ctx }
}

export function buildGlyph(char: string, seed: number, fs: number, dpr: number): BuiltGlyph {
  const measure = document.createElement("canvas").getContext("2d")!
  measure.font = fontFor(fs)
  const mt = measure.measureText(char)
  const padX = C.GLYPH_PAD_EM * fs
  const ox = Math.round(padX + mt.actualBoundingBoxLeft)
  const oy = Math.round(C.SNOW_PAD_EM * fs + mt.actualBoundingBoxAscent)
  const w = Math.ceil(ox + mt.actualBoundingBoxRight + padX)
  const h = Math.ceil(oy + mt.actualBoundingBoxDescent + C.ICICLE_PAD_EM * fs)

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

  const body = renderBody(mask, fs, w, h, dpr, hashSeed(seed, SALT.grain), text)
  const deco = makeLayer(w, h, dpr)
  const light = makeLayer(w, h, dpr)
  const shadow = makeLayer(w, h, dpr)
  for (const [l, color] of [
    [light, C.FILIGREE_COLOR],
    [shadow, C.FILIGREE_SHADOW],
  ] as const) {
    l.ctx.lineCap = "round"
    l.ctx.lineJoin = "round"
    l.ctx.strokeStyle = color // opaque: the layer's alpha is applied when compositing
  }
  const clip = makeLayer(w, h, dpr)
  clip.ctx.fillStyle = "#fff"
  clip.ctx.strokeStyle = "#fff"
  clip.ctx.lineWidth = C.FILIGREE_OVERFLOW_PX * 2
  clip.ctx.lineJoin = "round"
  text(clip.ctx)
  text(clip.ctx, "stroke")

  const strokes = buildFiligree(createRng(hashSeed(seed, SALT.filigree)), mask, fs)
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
    strokes,
    bodySettled: false,
    decoDone: false,
    filiDone: false,
    pending: strokes.length + icicles.length + snow.length,
    live: { body, deco, light, shadow, clip },
    cache: null,
  }
}

// Ice body: translucent fill, bright rim inside the edge (whiter where it faces the
// light), vertical tint and a fine frost grain. Shaded per pixel at mask resolution,
// then upscaled and trimmed to the crisp glyph shape with a thin edge line on top.
function renderBody(
  m: Mask,
  fs: number,
  w: number,
  h: number,
  dpr: number,
  grainSeed: number,
  text: (ctx: CanvasRenderingContext2D, mode?: "fill" | "stroke") => void
): Layer {
  const small = document.createElement("canvas")
  small.width = m.w
  small.height = m.h
  const sctx = small.getContext("2d")!
  const img = sctx.createImageData(m.w, m.h)
  const px = img.data
  const top = hexToRgb(C.BODY_TOP)
  const bot = hexToRgb(C.BODY_BOTTOM)
  const ll = Math.hypot(C.LIGHT_DIR.x, C.LIGHT_DIR.y)
  const lx = C.LIGHT_DIR.x / ll
  const ly = C.LIGHT_DIR.y / ll
  const rimW = Math.max(1, C.BODY_RIM_EM * fs)
  const D = (x: number, y: number) => (x < 0 || y < 0 || x >= m.w || y >= m.h ? 0 : m.dist[y * m.w + x])
  for (let y = 0; y < m.h; y++) {
    const t = clamp((y - m.top) / (m.bottom - m.top || 1), 0, 1)
    for (let x = 0; x < m.w; x++) {
      const i = y * m.w + x
      const cov = m.cov[i]
      if (!cov) continue
      const gx = D(x + 1, y) - D(x - 1, y)
      const gy = D(x, y + 1) - D(x, y - 1)
      const gl = Math.hypot(gx, gy)
      // gradient points inward, so the outward normal is its negative
      const lit = gl ? Math.max(0, -(gx * lx + gy * ly) / gl) : 0
      const rim = Math.exp(-m.dist[i] / rimW)
      const k = lit * rim * C.BODY_HIGHLIGHT
      const grain = 1 + C.BODY_GRAIN * (hash2(x, y, grainSeed) - 0.5)
      const a = (C.BODY_CORE_ALPHA + (C.BODY_RIM_ALPHA - C.BODY_CORE_ALPHA) * rim + 0.25 * k) * grain * (cov / 255)
      for (let c = 0; c < 3; c++) {
        const base = top[c] + (bot[c] - top[c]) * t
        px[i * 4 + c] = base + (255 - base) * k
      }
      px[i * 4 + 3] = clamp(a, 0, 1) * 255
    }
  }
  sctx.putImageData(img, 0, 0)

  const body = makeLayer(w, h, dpr)
  const ctx = body.ctx
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(small, 0, 0, m.w, m.h)
  ctx.globalCompositeOperation = "destination-in"
  ctx.fillStyle = "#fff"
  text(ctx)
  ctx.globalCompositeOperation = "source-over"
  ctx.strokeStyle = rgba(C.EDGE_COLOR, C.EDGE_ALPHA)
  ctx.lineWidth = C.EDGE_WIDTH_PX
  ctx.lineJoin = "round"
  text(ctx, "stroke")
  return body
}

function hash2(x: number, y: number, s: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + s) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
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
    const targets = [
      { ctx: live.light.ctx, off: 0 },
      { ctx: live.shadow.ctx, off: C.FILIGREE_SHADOW_OFFSET },
    ]
    let painted = false
    let left = 0
    for (const s of b.strokes) {
      if (s.drawn >= s.length) continue
      const target = s.length * progress(age, s.start, s.duration)
      if (target > s.drawn + 0.01) {
        paintSlice(targets, s, s.drawn, target)
        s.drawn = target
        painted = true
      }
      if (s.drawn < s.length) left++
    }
    if (painted) {
      // keep filigree inside the glyph: only the new slice can poke out, but this is cheap
      for (const l of [live.light, live.shadow]) {
        l.ctx.save()
        l.ctx.setTransform(1, 0, 0, 1, 0, 0)
        l.ctx.globalCompositeOperation = "destination-in"
        l.ctx.drawImage(live.clip.c, 0, 0)
        l.ctx.restore()
      }
      changed = true
    }
    b.filiDone = left === 0
    pending += left
  } else if (!b.filiDone) pending += b.strokes.length

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
    ctx.globalAlpha = C.FILIGREE_SHADOW_ALPHA
    ctx.drawImage(live.shadow.c, 0, 0, b.w, b.h)
    ctx.globalAlpha = C.FILIGREE_ALPHA
    ctx.drawImage(live.light.c, 0, 0, b.w, b.h)
    ctx.globalAlpha = 1
  }
}

// Flatten the finished layers into one canvas so a done glyph costs one drawImage.
function bake(b: BuiltGlyph) {
  const out = makeLayer(b.w, b.h, b.dpr)
  drawGlyph(out.ctx, b, Infinity)
  b.cache = out.c
  b.live = null
  b.strokes = []
  b.icicles = []
  b.snow = []
}
