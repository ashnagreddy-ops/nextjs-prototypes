import * as C from "./config"
import { type Mask, distAt, isSolid, surfaceRuns } from "./mask"
import type { Rng } from "./rng"
import { type BeadEl, type FiliEl, type LeafEl, type StrokeEl } from "./relief"
import { extractSpines } from "./skeleton"
import { clamp, invEaseOutCubic, pointAt, polyline } from "./stroke"

// Ornamental scrollwork (a rinceau): bold spines along the glyph skeleton, alternating
// spiral scrolls off both sides, terminal spirals at free tips, pocket-filling scrolls, then
// C-curls, teardrop leaves and beads; plus tendrils and snowflakes that break the silhouette.
// All geometry is computed once here; relief.ts only paints it.

type Path = { pts: Float32Array; cum: Float32Array; length: number }
type Spine = {
  path: Path
  widths: Float32Array
  start: number
  ms: number
  freeStart: boolean
  freeEnd: boolean
  meanThick: number
  scrolls: PlacedScroll[]
}
type PlacedScroll = { d: number; side: number; at: number; rhythm: number; pass: number }
type Scroll = { path: Path; widths: number[]; stemLen: number; end: { x: number; y: number } }
type Stem = { el: StrokeEl; sc: Scroll; side: number; rhythm: number }

export type FiligreeResult = {
  els: FiliEl[]
  facets: { xy: number[]; alpha: number }[] // faint facet lines for the ice body
  bubbles: { x: number; y: number; r: number }[]
}

// ---- Diagnostics (C.DEBUG_FILIGREE) -------------------------------------------
type Diag = { candidates: number; accepted: number; rejected: Record<string, number>; reason: string; extra: Record<string, number> }
let diag: Diag = { candidates: 0, accepted: 0, rejected: {}, reason: "", extra: {} }
const bump = (k: string) => (diag.rejected[k] = (diag.rejected[k] ?? 0) + 1)
const count = (k: string) => (diag.extra[k] = (diag.extra[k] ?? 0) + 1)

// ---- Occupancy grid (1px cells) -----------------------------------------------
class Occupancy {
  w: number
  h: number
  grid: Uint8Array
  dead: Uint8Array // empty pockets nothing fit in
  time: Float32Array // start time of the stroke that first claimed each cell
  inGlyph: Uint8Array
  total: number
  covered = 0
  constructor(m: Mask) {
    this.w = m.w
    this.h = m.h
    this.grid = new Uint8Array(m.w * m.h)
    this.dead = new Uint8Array(m.w * m.h)
    this.time = new Float32Array(m.w * m.h)
    this.inGlyph = m.solid
    this.total = m.area
  }
  // Mark the drawn width + OCC_MARK_PAD_PX (r is the half width).
  mark(x: number, y: number, r: number, t: number) {
    const R = r + C.OCC_MARK_PAD_PX
    for (let j = Math.max(0, Math.floor(y - R)); j <= Math.min(this.h - 1, Math.ceil(y + R)); j++)
      for (let i = Math.max(0, Math.floor(x - R)); i <= Math.min(this.w - 1, Math.ceil(x + R)); i++)
        if (Math.hypot(i + 0.5 - x, j + 0.5 - y) <= R) {
          const k = j * this.w + i
          if (!this.grid[k]) {
            this.grid[k] = 1
            this.time[k] = t
            if (this.inGlyph[k]) this.covered++
          }
        }
  }
  free(x: number, y: number, r: number) {
    for (let j = Math.max(0, Math.floor(y - r)); j <= Math.min(this.h - 1, Math.ceil(y + r)); j++)
      for (let i = Math.max(0, Math.floor(x - r)); i <= Math.min(this.w - 1, Math.ceil(x + r)); i++)
        if (this.grid[j * this.w + i] && Math.hypot(i + 0.5 - x, j + 0.5 - y) <= r) return false
    return true
  }
  get coverage() {
    return this.total ? this.covered / this.total : 1
  }
}

// ---- Geometry helpers -----------------------------------------------------------
const SAMPLE_PX = 1.4

function spiralPts(sx: number, sy: number, heading: number, dir: number, R: number, turns: number) {
  const a0 = heading - (dir * Math.PI) / 2 // so the spiral's tangent at its start equals `heading`
  const cx = sx - R * Math.cos(a0)
  const cy = sy - R * Math.sin(a0)
  const total = turns * Math.PI * 2
  const n = Math.max(12, Math.ceil((total * R * 0.55) / SAMPLE_PX))
  const out: number[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const r = R * (1 - (1 - C.SPIRAL_END_RATIO) * t) // Archimedean: radius shrinks linearly with angle
    const a = a0 + dir * total * t
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a))
  }
  return out
}

const taper = (path: Path, w0: number) =>
  Array.from(path.cum, (c) => Math.max(1, w0 * (1 - (1 - C.SCROLL_END_WIDTH) * (c / path.length))))

// The stem of a scroll: leaves the spine at STEM_ANGLE, curving further outward.
function stemPts(px: number, py: number, theta: number, s: number, R: number) {
  const xy = [px, py]
  const Ls = R * C.STEM_LENGTH_RATIO
  const h0 = theta + s * C.STEM_ANGLE
  const h1 = h0 + s * C.STEM_BEND
  const kx = px + Math.cos(h0) * Ls * 0.5
  const ky = py + Math.sin(h0) * Ls * 0.5
  const sx = kx + Math.cos(h1) * Ls * 0.5
  const sy = ky + Math.sin(h1) * Ls * 0.5
  const n = Math.max(2, Math.ceil(Ls / SAMPLE_PX))
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    xy.push(u * u * px + 2 * u * t * kx + t * t * sx, u * u * py + 2 * u * t * ky + t * t * sy)
  }
  return { xy, sx, sy, h1 }
}

// A scroll: stem + Archimedean spiral on side `s`, width tapering to SCROLL_END_WIDTH at the centre.
function makeScroll(px: number, py: number, theta: number, s: number, R: number, turns: number, withStem: boolean, w0: number): Scroll {
  let xy = [px, py]
  let sx = px
  let sy = py
  let h1 = theta
  if (withStem) {
    const st = stemPts(px, py, theta, s, R)
    xy = st.xy
    sx = st.sx
    sy = st.sy
    h1 = st.h1
  }
  const stemCount = xy.length / 2
  xy.push(...spiralPts(sx, sy, h1, s, R, turns))
  const path = polyline(xy)
  return { path, widths: taper(path, w0), stemLen: path.cum[stemCount - 1], end: { x: xy[xy.length - 2], y: xy[xy.length - 1] } }
}

// Distance from an outside point to the nearest glyph pixel: a chamfer field per mask, built once.
const outsideFields = new WeakMap<Mask, Float32Array>()
function outsideField(m: Mask) {
  let F = outsideFields.get(m)
  if (F) return F
  const { w, h } = m
  F = new Float32Array(w * h)
  for (let i = 0; i < F.length; i++) F[i] = m.solid[i] ? 0 : 1e4
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let v = F[i]
      if (x > 0) v = Math.min(v, F[i - 1] + 1)
      if (y > 0) {
        v = Math.min(v, F[i - w] + 1)
        if (x > 0) v = Math.min(v, F[i - w - 1] + 1.41)
        if (x < w - 1) v = Math.min(v, F[i - w + 1] + 1.41)
      }
      F[i] = v
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      let v = F[i]
      if (x < w - 1) v = Math.min(v, F[i + 1] + 1)
      if (y < h - 1) {
        v = Math.min(v, F[i + w] + 1)
        if (x < w - 1) v = Math.min(v, F[i + w + 1] + 1.41)
        if (x > 0) v = Math.min(v, F[i + w - 1] + 1.41)
      }
      F[i] = v
    }
  outsideFields.set(m, F)
  return F
}
function outsideDist(m: Mask, x: number, y: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  if (xi < 0 || yi < 0 || xi >= m.w || yi >= m.h) return 1e4
  return outsideField(m)[yi * m.w + xi]
}

// A run-on tendril: continue from (sx, sy) along `heading` until it is `over` px past the glyph
// edge, then curl back toward the glyph.
function makeBreak(m: Mask, head: number[], sx: number, sy: number, heading: number, over: number, w0: number): Scroll | null {
  const xy = [...head]
  const stemCount = xy.length / 2
  let x = sx
  let y = sy
  let exited = false
  let reached = false
  const steps = Math.ceil(C.BREAK_MARCH_MAX_PX / SAMPLE_PX)
  for (let i = 0; i < steps && !reached; i++) {
    x += Math.cos(heading) * SAMPLE_PX
    y += Math.sin(heading) * SAMPLE_PX
    xy.push(x, y)
    if (distAt(m, x, y) < 0.5) {
      exited = true
      reached = outsideDist(m, x, y) >= over
    }
  }
  if (!exited || !reached) return null
  const R = Math.max(2.5, over * C.BREAK_CURL_RADIUS_RATIO)
  // curl toward whichever side keeps the spiral's centre nearer the glyph
  let best = 1
  let bestD = Infinity
  for (const dir of [1, -1]) {
    const a0 = heading - (dir * Math.PI) / 2
    const d = outsideDist(m, x - R * Math.cos(a0), y - R * Math.sin(a0))
    if (d < bestD) {
      bestD = d
      best = dir
    }
  }
  xy.push(...spiralPts(x, y, heading, best, R, C.BREAK_CURL_TURNS))
  const path = polyline(xy)
  return { path, widths: taper(path, w0), stemLen: path.cum[stemCount - 1], end: { x: xy[xy.length - 2], y: xy[xy.length - 1] } }
}

function fits(m: Mask, occ: Occupancy, path: Path, widths: number[], skip: number, margin: number, spillMax?: number) {
  for (let i = 0; i < path.cum.length; i++) {
    const x = path.pts[i * 2]
    const y = path.pts[i * 2 + 1]
    const w = widths[i]
    const d = distAt(m, x, y)
    if (spillMax === undefined) {
      if (d < margin + w / 2) {
        diag.reason = d < 0.5 ? "outside mask" : "edge margin"
        return false
      }
    } else if (d < 0.5 && outsideDist(m, x, y) > spillMax) {
      diag.reason = "spills too far"
      return false
    }
    if (path.cum[i] > skip && !occ.free(x, y, w / 2)) {
      diag.reason = "crosses occupied cells"
      return false
    }
  }
  return true
}

function markPath(occ: Occupancy, path: Path, widths: ArrayLike<number>, t: number) {
  for (let i = 0; i < path.cum.length; i++) occ.mark(path.pts[i * 2], path.pts[i * 2 + 1], widths[i] / 2, t)
}

// Try a scroll, shrinking by FIT_SHRINK up to FIT_RETRIES times (to ~40%).
function fit<T>(R0: number, make: (R: number) => T | null, ok: (t: T) => boolean): T | null {
  let R = R0
  let first = ""
  diag.reason = ""
  for (let k = 0; k <= C.FIT_RETRIES; k++) {
    if (R < C.SCROLL_MIN_RADIUS_PX) {
      diag.reason = (first || "start") + (k === 0 ? " (base R already below min)" : " then shrank below min radius")
      return null
    }
    const t = make(R)
    if (t && ok(t)) return t
    if (k === 0) first = diag.reason
    R *= C.FIT_SHRINK
  }
  diag.reason = first + " (all retries)"
  return null
}

const stroke = (path: Path, widths: ArrayLike<number>, start: number, phases: StrokeEl["phases"], spill = false, flat = false): StrokeEl => ({
  kind: "stroke",
  pts: path.pts,
  cum: path.cum,
  length: path.length,
  widths: Float32Array.from(widths),
  start,
  phases,
  drawn: 0,
  spill,
  flat,
})

// ---- Spines ---------------------------------------------------------------------
function prepareSpine(rng: Rng, m: Mask, xy: number[], freeStart: boolean, freeEnd: boolean): Spine {
  if (freeStart && !freeEnd) {
    const r: number[] = []
    for (let i = xy.length - 2; i >= 0; i -= 2) r.push(xy[i], xy[i + 1])
    xy = r
    ;[freeStart, freeEnd] = [false, true] // grow from the junction toward the free tip
  }
  const path = polyline(xy)
  const n = path.cum.length
  const raw = new Float32Array(n)
  let thickSum = 0
  for (let i = 0; i < n; i++) {
    const thick = 2 * distAt(m, path.pts[i * 2], path.pts[i * 2 + 1])
    thickSum += thick
    raw[i] = clamp(thick * C.SPINE_WIDTH_RATIO, C.SPINE_WIDTH_MIN_PX, C.SPINE_WIDTH_MAX_PX)
  }
  const widths = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    let c = 0
    for (let k = -2; k <= 2; k++) {
      const j = i + k
      if (j >= 0 && j < n) {
        s += raw[j]
        c++
      }
    }
    widths[i] = s / c
    const T = Math.min(C.SPINE_TAPER_LEN_PX, path.length * 0.4)
    if (freeStart && path.cum[i] < T) widths[i] *= C.SPINE_TAPER_END + (1 - C.SPINE_TAPER_END) * (path.cum[i] / T)
    if (freeEnd && path.length - path.cum[i] < T)
      widths[i] *= C.SPINE_TAPER_END + (1 - C.SPINE_TAPER_END) * ((path.length - path.cum[i]) / T)
  }
  return {
    path,
    widths,
    start: C.FILIGREE_DELAY + rng.range(0, C.FILIGREE_STAGGER),
    ms: rng.range(C.FILIGREE_DURATION_MIN, C.FILIGREE_DURATION_MAX),
    freeStart,
    freeEnd,
    meanThick: thickSum / n,
    scrolls: [],
  }
}

const spineTime = (sp: Spine, d: number) => sp.start + sp.ms * invEaseOutCubic(clamp(d / sp.path.length, 0, 1))

// ---- Body depth: facet lines along the spines, trapped bubbles -------------------
function bodyDepth(rng: Rng, m: Mask, spines: Spine[]) {
  const facets: FiligreeResult["facets"] = []
  const want = Math.round(rng.range(C.FACET_MIN, C.FACET_MAX))
  for (let tries = 0; spines.length && facets.length < want && tries < want * 4; tries++) {
    const sp = spines[Math.floor(rng.next() * spines.length)]
    const len = Math.min(sp.path.length, rng.range(C.FACET_LENGTH_MIN_PX, C.FACET_LENGTH_MAX_PX))
    if (len < 12) continue
    const d0 = rng.range(0, sp.path.length - len)
    const side = rng.sign()
    const off = rng.range(C.FACET_OFFSET_MIN, C.FACET_OFFSET_MAX)
    const xy: number[] = []
    for (let d = d0; d <= d0 + len; d += 3) {
      const p = pointAt(sp.path, d)
      const k = side * off * distAt(m, p.x, p.y)
      xy.push(p.x - Math.sin(p.angle) * k, p.y + Math.cos(p.angle) * k)
    }
    facets.push({ xy, alpha: rng.range(C.FACET_ALPHA_MIN, C.FACET_ALPHA_MAX) })
  }
  const bubbles: FiligreeResult["bubbles"] = []
  const nb = Math.round(rng.range(C.BUBBLE_MIN, C.BUBBLE_MAX))
  for (let tries = 0; tries < nb * 12 && bubbles.length < nb; tries++) {
    const x = rng.range(0, m.w)
    const y = rng.range(m.top, m.bottom)
    if (distAt(m, x, y) >= C.BUBBLE_EDGE_PX) bubbles.push({ x, y, r: rng.range(C.BUBBLE_R_MIN_PX, C.BUBBLE_R_MAX_PX) })
  }
  return { facets, bubbles }
}

// ---- Main -----------------------------------------------------------------------
export function buildFiligree(rng: Rng, m: Mask, fs: number): FiligreeResult {
  const els: FiliEl[] = []
  if (!m.area) return { els, facets: [], bubbles: [] }
  const occ = new Occupancy(m)
  const spines = extractSpines(m).map((s) => prepareSpine(rng, m, s.xy, s.freeStart, s.freeEnd))
  diag = { candidates: 0, accepted: 0, rejected: {}, reason: "", extra: {} }
  const depth = bodyDepth(rng, m, spines)
  const marginAt = (thick: number) => Math.min(C.EDGE_MARGIN, thick * C.EDGE_MARGIN_RATIO)

  const bead = (x: number, y: number, start: number, spill = false) => {
    const el: BeadEl = { kind: "bead", x, y, r: rng.range(C.BEAD_RADIUS_MIN_PX, C.BEAD_RADIUS_MAX_PX), start, ms: C.BEAD_POP_MS, drawn: 0, spill }
    els.push(el)
  }

  // Spines claim their space first.
  for (const sp of spines) {
    els.push(stroke(sp.path, sp.widths, sp.start, [{ len: sp.path.length, ms: sp.ms, ease: "out" }]))
    markPath(occ, sp.path, sp.widths, sp.start)
  }

  // No skeleton (a dot, a very small glyph): a single spiral at the deepest point.
  if (!spines.length) {
    let best = 0
    for (let i = 0; i < m.dist.length; i++) if (m.dist[i] > m.dist[best]) best = i
    const px = (best % m.w) + 0.5
    const py = Math.floor(best / m.w) + 0.5
    const s = rng.sign()
    const sc = fit(
      m.dist[best] * 0.8,
      (R) => makeScroll(px, py, rng.range(0, Math.PI * 2), s, R, C.TERMINAL_TURNS, false, Math.max(2, m.dist[best] * 0.3)),
      (t) => fits(m, occ, t.path, t.widths, 0, marginAt(m.dist[best] * 2))
    )
    if (sc) {
      const start = C.FILIGREE_DELAY + rng.range(0, C.FILIGREE_STAGGER)
      els.push(stroke(sc.path, sc.widths, start, [{ len: sc.path.length, ms: C.TERMINAL_SPIRAL_MS, ease: "inout" }]))
      markPath(occ, sc.path, sc.widths, start)
      if (rng.next() < C.BEAD_CENTER_CHANCE) bead(sc.end.x, sc.end.y, start + C.TERMINAL_SPIRAL_MS)
    }
    silhouette(rng, m, els, occ, fs)
    return { els, ...depth }
  }

  // Terminal spirals at free tips: some spill past the silhouette as a spiral, and some run on
  // past the edge and curl back.
  for (const sp of spines) {
    const ends = [
      sp.freeStart && { at: 0, t: sp.start },
      sp.freeEnd && { at: sp.path.length, t: sp.start + sp.ms },
    ]
    for (const end of ends) {
      if (!end) continue
      const a = pointAt(sp.path, end.at)
      // outward heading: the direction of travel at the end, reversed at the start
      const theta = end.at === 0 ? pointAt(sp.path, Math.min(2, sp.path.length)).angle + Math.PI : a.angle
      const wTip = sp.widths[end.at === 0 ? 0 : sp.widths.length - 1]
      const skip = sp.widths[0] * 1.5 + 3

      if (rng.next() < C.BREAK_CHANCE) {
        const over = rng.range(C.BREAK_MIN_PX, C.BREAK_MAX_PX)
        const br = makeBreak(m, [a.x, a.y], a.x, a.y, theta, over, wTip)
        if (br && fits(m, occ, br.path, br.widths, skip, 0, C.BREAK_MAX_PX + 2)) {
          count("break (tip)")
          els.push(stroke(br.path, br.widths, end.t, [{ len: br.path.length, ms: Math.max(C.TERMINAL_SPIRAL_MS, br.path.length * 8), ease: "inout" }], true))
          markPath(occ, br.path, br.widths, end.t)
          continue
        }
      }
      const edgeAdjacent = distAt(m, a.x, a.y) <= C.SPILL_EDGE_EM * fs
      const spill = edgeAdjacent && rng.next() < C.SPILL_CHANCE
      const spillMax = spill ? rng.range(C.SPILL_DISTANCE_PX * 0.45, C.SPILL_DISTANCE_PX) : undefined
      const s = rng.sign()
      const sc = fit(
        sp.meanThick * C.TERMINAL_RADIUS_RATIO,
        (R) => makeScroll(a.x, a.y, theta, s, R, C.TERMINAL_TURNS, false, wTip),
        (t) => fits(m, occ, t.path, t.widths, skip, marginAt(sp.meanThick), spillMax)
      )
      if (!sc) continue
      els.push(stroke(sc.path, sc.widths, end.t, [{ len: sc.path.length, ms: C.TERMINAL_SPIRAL_MS, ease: "inout" }], spill))
      markPath(occ, sc.path, sc.widths, end.t)
      if (rng.next() < C.BEAD_CENTER_CHANCE) bead(sc.end.x, sc.end.y, end.t + C.TERMINAL_SPIRAL_MS, spill)
    }
  }

  // Scrolls along the full length of every spine: strictly alternating sides, size rhythm
  // large-small-medium-small. A second pass tucks smaller scrolls between the first.
  const stems: Stem[] = []
  C.FILL_PASSES.forEach((pass, passIdx) => {
    for (const sp of spines) {
      if (occ.coverage >= C.TARGET_COVERAGE) return
      let side = rng.sign()
      let idx = rng.range(0, 4) | 0
      const t0 = pointAt(sp.path, 0)
      let d = 2 * distAt(m, t0.x, t0.y) * C.SCROLL_START_RATIO + pass.offset * 2 * sp.meanThick * C.SCROLL_SPACING_RATIO
      const reserve = sp.meanThick * 0.3
      while (d < sp.path.length - reserve) {
        const p = pointAt(sp.path, d)
        const thick = 2 * distAt(m, p.x, p.y)
        const step = Math.max(6, thick * C.SCROLL_SPACING_RATIO)
        const s = side
        side = -side // strict alternation, even when a scroll is skipped
        const rhythm = C.SCROLL_RHYTHM[idx++ % C.SCROLL_RHYTHM.length]
        const R0 = thick * C.SCROLL_SIZE_RATIO * rhythm * pass.size * (1 + rng.range(-C.SCROLL_JITTER, C.SCROLL_JITTER))
        const turns = rng.range(C.SCROLL_TURNS_MIN, C.SCROLL_TURNS_MAX)
        const wSpine = sp.widths[Math.min(sp.widths.length - 1, p.index)]
        const w0 = Math.max(C.SCROLL_WIDTH_MIN_PX, wSpine * C.SCROLL_WIDTH_RATIO)
        // attachment zone: ignore occupancy until the stem has cleared its own spine
        const skip = (wSpine / 2 + C.OCC_MARK_PAD_PX + w0 / 2 + C.ATTACH_EXCLUDE_PX) / Math.sin(C.STEM_ANGLE)
        const margin = marginAt(thick)
        d += step
        diag.candidates++

        let sc: Scroll | null = null
        let spill = false
        if (rng.next() < C.BREAK_CHANCE) {
          // the stem runs on past the glyph edge and curls back
          const over = rng.range(C.BREAK_MIN_PX, C.BREAK_MAX_PX)
          sc = fit(
            R0,
            (R) => {
              const st = stemPts(p.x, p.y, p.angle, s, R)
              return makeBreak(m, st.xy, st.sx, st.sy, st.h1, over, w0)
            },
            (t) => fits(m, occ, t.path, t.widths, skip, margin, C.BREAK_MAX_PX + 2)
          )
          if (sc) {
            spill = true
            count("break (stem)")
          }
        }
        if (!sc)
          sc = fit(
            R0,
            (R) => makeScroll(p.x, p.y, p.angle, s, R, turns, true, w0),
            (t) => fits(m, occ, t.path, t.widths, skip, margin)
          )
        if (!sc) {
          bump(diag.reason)
          continue
        }
        diag.accepted++
        const start = spineTime(sp, d - step)
        markPath(occ, sc.path, sc.widths, start)
        const rest = sc.path.length - sc.stemLen
        const el = stroke(
          sc.path,
          sc.widths,
          start,
          [
            { len: sc.stemLen, ms: C.SCROLL_STEM_MS, ease: "out" },
            { len: rest, ms: spill ? Math.max(C.SCROLL_SPIRAL_MS, rest * 8) : C.SCROLL_SPIRAL_MS, ease: "inout" },
          ],
          spill
        )
        els.push(el)
        stems.push({ el, sc, side: s, rhythm: rhythm * pass.size })
        sp.scrolls.push({ d: d - step, side: s, at: start, rhythm, pass: passIdx })
      }
    }
  })
  const afterScrolls = occ.coverage

  // Pocket pass: a smaller scroll in the largest empty circle left over, until coverage or nothing fits.
  diag.extra.pockets = fillPockets(rng, m, occ, els, bead, marginAt)

  secondaryDetail(rng, m, els, occ, stems, spines, marginAt)
  silhouette(rng, m, els, occ, fs)

  if (C.DEBUG_FILIGREE && typeof window !== "undefined") {
    console.info(
      "FILIGREE " +
        JSON.stringify({
          spines: spines.length,
          spineLen: spines.map((q) => Math.round(q.path.length)),
          meanThick: spines.map((q) => Math.round(q.meanThick)),
          candidates: diag.candidates,
          accepted: diag.accepted,
          rejected: diag.rejected,
          extra: diag.extra,
          coverageAfterScrolls: +afterScrolls.toFixed(2),
          coverage: +occ.coverage.toFixed(2),
          target: C.TARGET_COVERAGE,
        })
    )
  }
  return { els, ...depth }
}

// ---- Pockets ----------------------------------------------------------------------
function fillPockets(
  rng: Rng,
  m: Mask,
  occ: Occupancy,
  els: FiliEl[],
  bead: (x: number, y: number, start: number, spill?: boolean) => void,
  marginAt: (thick: number) => number
) {
  const { w, h } = occ
  const F = new Float32Array(w * h)
  // only the ink's bounding box needs scanning
  let x0 = w
  let x1 = 0
  for (let i = 0; i < occ.inGlyph.length; i++)
    if (occ.inGlyph[i]) {
      const x = i % w
      if (x < x0) x0 = x
      if (x > x1) x1 = x
    }
  const y0 = Math.max(0, m.top - 1)
  const y1 = Math.min(h - 1, m.bottom + 1)
  x0 = Math.max(0, x0 - 1)
  x1 = Math.min(w - 1, x1 + 1)
  let placed = 0
  for (let round = 0; round < C.POCKET_MAX && placed < C.POCKET_MAX && occ.coverage < C.TARGET_COVERAGE; round++) {
    // clearance of every free cell to the nearest obstacle (glyph edge, stroke, dead pocket)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x
        F[i] = !occ.inGlyph[i] || occ.grid[i] || occ.dead[i] || m.dist[i] < C.EDGE_MARGIN ? 0 : 1e6
      }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x
        if (!F[i]) continue
        let v = Math.min(F[i], x > x0 ? F[i - 1] + 1 : 1, y > y0 ? F[i - w] + 1 : 1)
        if (x > x0 && y > y0) v = Math.min(v, F[i - w - 1] + 1.41)
        if (x < x1 && y > y0) v = Math.min(v, F[i - w + 1] + 1.41)
        F[i] = v
      }
    for (let y = y1; y >= y0; y--)
      for (let x = x1; x >= x0; x--) {
        const i = y * w + x
        if (!F[i]) continue
        let v = Math.min(F[i], x < x1 ? F[i + 1] + 1 : 1, y < y1 ? F[i + w] + 1 : 1)
        if (x < x1 && y < y1) v = Math.min(v, F[i + w + 1] + 1.41)
        if (x > x0 && y < y1) v = Math.min(v, F[i + w - 1] + 1.41)
        F[i] = v
      }
    // take several of the biggest non-overlapping empty circles from this one field
    let progressed = false
    for (let k = 0; k < C.POCKET_BATCH && placed < C.POCKET_MAX && occ.coverage < C.TARGET_COVERAGE; k++) {
      let bi = -1
      let br = 0
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = y * w + x
          if (F[i] > br && F[i] < 1e5) {
            br = F[i]
            bi = i
          }
        }
      if (bi < 0 || br < C.POCKET_MIN_RADIUS_PX) break
      const cx = (bi % w) + 0.5
      const cy = Math.floor(bi / w) + 0.5
      // used up: later picks from this field must not overlap this circle
      const sup = Math.ceil(br * 2)
      for (let y = Math.max(y0, Math.floor(cy - sup)); y <= Math.min(y1, Math.ceil(cy + sup)); y++)
        for (let x = Math.max(x0, Math.floor(cx - sup)); x <= Math.min(x1, Math.ceil(cx + sup)); x++)
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= br * 2) F[y * w + x] = 0
      progressed = true
      if (tryPocket(rng, m, occ, els, bead, marginAt, cx, cy, br)) placed++
    }
    if (!progressed) break
  }
  return placed
}

function tryPocket(
  rng: Rng,
  m: Mask,
  occ: Occupancy,
  els: FiliEl[],
  bead: (x: number, y: number, start: number, spill?: boolean) => void,
  marginAt: (thick: number) => number,
  cx: number,
  cy: number,
  br: number
) {
  const { w, h } = occ
  {
    // anchor: the nearest stroke, so the pocket scroll grows out of something already there
    let nd = Infinity
    let at = C.FILIGREE_DELAY
    const reach = Math.ceil(br + 8)
    let ax = cx
    let ay = cy
    for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(h - 1, Math.ceil(cy + reach)); y++)
      for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(w - 1, Math.ceil(cx + reach)); x++) {
        const k = y * w + x
        if (!occ.grid[k]) continue
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        if (d < nd) {
          nd = d
          ax = x + 0.5
          ay = y + 0.5
          at = occ.time[k]
        }
      }
    const toAnchor = nd < Infinity ? Math.atan2(ay - cy, ax - cx) : rng.range(0, Math.PI * 2)
    const dir = rng.sign()
    const turns = rng.range(C.SCROLL_TURNS_MIN, C.SCROLL_TURNS_MAX)
    const thick = 2 * distAt(m, cx, cy)
    const sc = fit(
      br * C.POCKET_RADIUS_RATIO,
      (R) => {
        // the spiral starts on the circle's edge nearest the anchor and winds in around the centre
        const sx = cx + R * Math.cos(toAnchor)
        const sy = cy + R * Math.sin(toAnchor)
        return makeScroll(sx, sy, toAnchor + (dir * Math.PI) / 2, dir, R, turns, false, C.POCKET_STROKE_WIDTH_PX)
      },
      (t) => fits(m, occ, t.path, t.widths, 2, marginAt(thick))
    )
    if (!sc) {
      for (let y = Math.max(0, Math.floor(cy - 2)); y <= Math.min(h - 1, Math.ceil(cy + 2)); y++)
        for (let x = Math.max(0, Math.floor(cx - 2)); x <= Math.min(w - 1, Math.ceil(cx + 2)); x++) occ.dead[y * w + x] = 1
      return false
    }
    const start = at + C.POCKET_DELAY_MS
    markPath(occ, sc.path, sc.widths, start)
    els.push(stroke(sc.path, sc.widths, start, [{ len: sc.path.length, ms: C.SCROLL_SPIRAL_MS, ease: "inout" }]))
    if (rng.next() < C.BEAD_CENTER_CHANCE) bead(sc.end.x, sc.end.y, start + C.SCROLL_SPIRAL_MS)
    return true
  }
}

// ---- Secondary detail: junction/centre beads, C-curls, teardrop leaves -------------
function secondaryDetail(
  rng: Rng,
  m: Mask,
  els: FiliEl[],
  occ: Occupancy,
  stems: Stem[],
  spines: Spine[],
  marginAt: (thick: number) => number
) {
  const bead = (x: number, y: number, start: number) => {
    els.push({ kind: "bead", x, y, r: rng.range(C.BEAD_RADIUS_MIN_PX, C.BEAD_RADIUS_MAX_PX), start, ms: C.BEAD_POP_MS, drawn: 0, spill: false })
  }
  for (const { el, sc, side, rhythm } of stems) {
    if (el.spill) continue
    bead(el.pts[0], el.pts[1], el.start)
    if (rng.next() < C.BEAD_CENTER_CHANCE) bead(sc.end.x, sc.end.y, el.start + C.SCROLL_STEM_MS + C.SCROLL_SPIRAL_MS)
    if (rhythm < C.CURL_MIN_RHYTHM) continue
    const q = pointAt(el, sc.stemLen * 0.6)
    const R = Math.max(C.SCROLL_MIN_RADIUS_PX, (sc.stemLen / C.STEM_LENGTH_RATIO) * C.CURL_RADIUS_RATIO)
    const w0 = Math.max(1.2, el.widths[Math.min(el.widths.length - 1, q.index)] * C.CURL_WIDTH_RATIO)
    for (const dir of [-side, side]) {
      const curl = fit(
        R,
        (r) => {
          const path = polyline([q.x, q.y, ...spiralPts(q.x, q.y, q.angle - side * C.CURL_ANGLE, dir, r, C.CURL_TURNS)])
          return { path, widths: taper(path, w0) }
        },
        (t) => fits(m, occ, t.path, t.widths, 4, 2)
      )
      if (!curl) continue
      markPath(occ, curl.path, curl.widths, el.start)
      els.push(stroke(curl.path, curl.widths, el.start + C.SCROLL_STEM_MS * 0.6, [{ len: curl.path.length, ms: C.SCROLL_STEM_MS * 1.2, ease: "inout" }]))
      break
    }
  }

  for (const sp of spines) {
    const list = sp.scrolls.filter((s) => s.pass === 0).sort((a, b) => a.d - b.d)
    for (let k = 0; k + 1 < list.length; k++) {
      if (rng.next() >= C.LEAF_GAP_CHANCE) continue
      const a = list[k]
      const b = list[k + 1]
      const p = pointAt(sp.path, (a.d + b.d) / 2)
      const thick = 2 * distAt(m, p.x, p.y)
      const angle = p.angle + a.side * C.LEAF_ANGLE // the free corner ahead of scroll k
      const L0 = clamp(thick * C.LEAF_LENGTH_RATIO, C.LEAF_LENGTH_MIN_PX, C.LEAF_LENGTH_MAX_PX)
      const leaf = fit(
        L0,
        (L) => {
          const wid = L * C.LEAF_WIDTH_RATIO
          const xy: number[] = []
          for (let i = 0; i <= 6; i++) xy.push(p.x + Math.cos(angle) * L * (i / 6), p.y + Math.sin(angle) * L * (i / 6))
          return { L, wid, path: polyline(xy) }
        },
        (t) => fits(m, occ, t.path, new Array(7).fill(t.wid * 0.8), sp.widths[p.index] * 1.5 + 3, marginAt(thick))
      )
      if (!leaf) continue
      markPath(occ, leaf.path, new Array(7).fill(leaf.wid * 0.8), a.at)
      const el: LeafEl = {
        kind: "leaf",
        x: p.x,
        y: p.y,
        angle,
        len: leaf.L,
        wid: leaf.wid,
        start: Math.max(a.at, b.at) + C.SCROLL_STEM_MS + C.SCROLL_SPIRAL_MS,
        ms: C.LEAF_GROW_MS,
        drawn: 0,
        spill: false,
      }
      els.push(el)
    }
  }
}

// ---- Breaking the silhouette: incoming tendrils and snowflakes ----------------------
function silhouette(rng: Rng, m: Mask, els: FiliEl[], occ: Occupancy, fs: number) {
  incomingTendrils(rng, m, els, occ)
  snowflakes(rng, m, els, fs)
}

// 2-3 tendrils that start outside the glyph and curve in over a serif or shoulder, ending in a curl.
function incomingTendrils(rng: Rng, m: Mask, els: FiliEl[], occ: Occupancy) {
  const runs = surfaceRuns(m, "top", 0.5).filter((r) => r.length >= 10)
  if (!runs.length) return
  const want = Math.round(rng.range(C.INCOMING_MIN, C.INCOMING_MAX))
  let made = 0
  for (let tries = 0; tries < want * 12 && made < want; tries++) {
    const run = runs[Math.floor(rng.next() * runs.length)]
    const e = run[Math.floor(rng.range(0.15, 0.85) * (run.length - 1))]
    const nAng = Math.atan2(e.ny, e.nx)
    const far = rng.range(C.INCOMING_START_MIN_PX, C.INCOMING_START_MAX_PX)
    const entry = nAng + rng.range(-C.INCOMING_ANGLE, C.INCOMING_ANGLE)
    const sx = e.x + 0.5 + Math.cos(entry) * far
    const sy = e.y + 0.5 + Math.sin(entry) * far
    const sweep = rng.sign()
    const turns = rng.range(1.25, 1.75)
    const tendril = fit(
      C.INCOMING_CURL_RADIUS_PX,
      (R) => {
        // curved approach from outside to just inside the edge, then a small curl
        const ix = e.x + 0.5 - Math.cos(nAng) * (R + 3)
        const iy = e.y + 0.5 - Math.sin(nAng) * (R + 3)
        const mx = (sx + ix) / 2 - Math.sin(nAng) * far * 0.5 * sweep
        const my = (sy + iy) / 2 + Math.cos(nAng) * far * 0.5 * sweep
        const xy: number[] = []
        const n = Math.max(6, Math.ceil((far + R + 3) / SAMPLE_PX))
        for (let i = 0; i <= n; i++) {
          const t = i / n
          const u = 1 - t
          xy.push(u * u * sx + 2 * u * t * mx + t * t * ix, u * u * sy + 2 * u * t * my + t * t * iy)
        }
        const heading = Math.atan2(iy - my, ix - mx)
        const approach = xy.length / 2
        xy.push(...spiralPts(ix, iy, heading, -sweep, R, turns))
        const path = polyline(xy)
        return { path, widths: taper(path, C.INCOMING_WIDTH_PX), approachLen: path.cum[approach - 1] }
      },
      (t) => fits(m, occ, t.path, t.widths, t.approachLen, 1, C.INCOMING_START_MAX_PX + 6)
    )
    if (!tendril) continue
    const start = C.FILIGREE_DELAY + C.INCOMING_DELAY_MS + rng.range(0, C.INCOMING_STAGGER_MS)
    markPath(occ, tendril.path, tendril.widths, start)
    els.push(
      stroke(
        tendril.path,
        tendril.widths,
        start,
        [
          { len: tendril.approachLen, ms: 650, ease: "out" },
          { len: tendril.path.length - tendril.approachLen, ms: C.SCROLL_SPIRAL_MS, ease: "inout" },
        ],
        true
      )
    )
    count("incoming")
    made++
  }
}

// 2-4 snowflakes centred on sharp convex corners, overlapping the silhouette edge.
function snowflakes(rng: Rng, m: Mask, els: FiliEl[], fs: number) {
  const R = C.FLAKE_CORNER_RADIUS_PX
  const corners: { x: number; y: number; frac: number }[] = []
  for (let y = R; y < m.h - R; y++)
    for (let x = R; x < m.w - R; x++) {
      if (!isSolid(m, x, y) || (isSolid(m, x - 1, y) && isSolid(m, x + 1, y) && isSolid(m, x, y - 1) && isSolid(m, x, y + 1))) continue
      let solid = 0
      let all = 0
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++)
          if (dx * dx + dy * dy <= R * R) {
            all++
            if (isSolid(m, x + dx, y + dy)) solid++
          }
      if (solid / all < C.FLAKE_CORNER_FRACTION) corners.push({ x, y, frac: solid / all })
    }
  corners.sort((a, b) => a.frac - b.frac)
  const want = Math.round(rng.range(C.FLAKE_MIN, C.FLAKE_MAX))
  const chosen: { x: number; y: number }[] = []
  for (const c of corners) {
    if (chosen.length >= want) break
    if (chosen.every((o) => Math.hypot(o.x - c.x, o.y - c.y) >= C.FLAKE_SPACING_PX)) chosen.push(c)
  }
  for (const c of chosen) {
    // 12-28px, but never bigger than a fraction of the glyph so small text doesn't drown in flakes
    const radius = Math.min(rng.range(C.FLAKE_R_MIN_PX, C.FLAKE_R_MAX_PX), Math.max(C.FLAKE_R_FLOOR_PX, fs * C.FLAKE_MAX_EM))
    const rot = rng.range(0, Math.PI / 3)
    const start = C.FILIGREE_DELAY + C.FLAKE_DELAY_MS + rng.range(0, C.FLAKE_STAGGER_MS)
    const armW = Math.max(C.FLAKE_ARM_WIDTH_MIN_PX, radius * C.FLAKE_ARM_WIDTH_RATIO)
    const reach = radius * C.FLAKE_OVERSHOOT // arms keep the overshoot: ink is never erased
    const cx = c.x + 0.5
    const cy = c.y + 0.5
    const arm = (x0: number, y0: number, ang: number, len: number, w: number, delay: number) => {
      const n = Math.max(3, Math.ceil(len / 2))
      const xy: number[] = []
      for (let i = 0; i <= n; i++) xy.push(x0 + Math.cos(ang) * len * (i / n), y0 + Math.sin(ang) * len * (i / n))
      const path = polyline(xy)
      const widths = Array.from(path.cum, (d) => w * (1 - 0.45 * (d / path.length)))
      els.push(stroke(path, widths, start + delay, [{ len: path.length, ms: C.FLAKE_BLOOM_MS, ease: "back" }], true, true))
    }
    for (let k = 0; k < 6; k++) {
      const ang = rot + (k * Math.PI) / 3
      arm(cx, cy, ang, reach, armW, 0)
      for (const br of C.FLAKE_BRANCHES) {
        const bx = cx + Math.cos(ang) * reach * br.at
        const by = cy + Math.sin(ang) * reach * br.at
        for (const side of [-1, 1]) arm(bx, by, ang + side * C.FLAKE_BRANCH_ANGLE, reach * br.length, armW * 0.7, C.FLAKE_BLOOM_MS * 0.25 * br.at)
      }
    }
    els.push({ kind: "bead", x: cx, y: cy, r: Math.max(1.4, armW * 0.9), start, ms: C.BEAD_POP_MS, drawn: 0, spill: true })
    count("flake")
  }
}
