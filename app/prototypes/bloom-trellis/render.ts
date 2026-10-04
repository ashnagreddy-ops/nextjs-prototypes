import * as C from "./config"
import { drawBract, drawLeafShape } from "./bracts"
import { clamp, easeInCubic, easeOutCubic, rad, spring, unit } from "./ease"
import { type Boil, IDENTITY, type Rigid, applyX, applyY, boilFor, boilTurn, boilX, boilY, compose, rotAbout, stepSpring, wind } from "./motion"
import type { Plant, Vine } from "./plant"

// Motion and drawing for a plant, in word coordinates (REF_FONT_PX). The scene sets the
// transform: origin at the word's first pen, scale = layout font size / REF_FONT_PX.

const R = C.REF_FONT_PX

// Per-stem motion state, rebuilt each frame from the springs.
type VineRT = {
  th: number // sway angle about the root
  vel: number
  hist: number[] // recent [time, th] pairs, for the clusters' delayed swing
  base: Rigid // the parent's transform at the branch point
  dp: Float32Array // deformed (swayed + boiled) points, up to the visible tip
  n: number // points in dp
  vis: number // visible length (growing, or retracting while withering)
}

const rts = (p: Plant) => p.rt as VineRT[]
const boils = new WeakMap<Plant, Boil>()
const bend = (v: Vine, s: number) => Math.pow(clamp(s / v.length, 0, 1), C.SWAY_BEND_POWER)

// Transform of a point at arc length s on stem i (sway about its root, then its parent's).
export function xfAt(p: Plant, i: number, s: number): Rigid {
  const v = p.vines[i]
  const rt = rts(p)[i]
  if (!rt) return IDENTITY
  return compose(rt.base, rotAbout(rt.th * bend(v, s), v.pts[0], v.pts[1]))
}

function delayedTh(rt: VineRT, t: number) {
  const h = rt.hist
  for (let i = h.length - 2; i >= 0; i -= 2) if (h[i] <= t) return h[i + 1]
  return h.length ? h[1] : rt.th
}

export const kick = (p: Plant, degPerS: number) => rts(p).forEach((rt) => rt && (rt.vel += rad(degPerS)))

// Step the stem and cluster springs, then rebuild each stem's visible, deformed points.
export function updatePlant(p: Plant, age: number, now: number, dt: number, screenX: number, scale: number) {
  const boil = boilFor(hashPlant(p), now, R)
  boils.set(p, boil)
  const rt = rts(p)
  p.vines.forEach((v, i) => {
    const r = (rt[i] ??= { th: 0, vel: 0, hist: [], base: IDENTITY, dp: new Float32Array(v.pts.length), n: 0, vis: 0 })
    r.n = 0
    if (v.dead) return
    ;[r.th, r.vel] = stepSpring(r.th, r.vel, wind(now, screenX + v.pts[0] * scale) * v.flex, C.STEM_SWAY, dt)
    r.hist.push(now, r.th)
    if (r.hist.length > 24) r.hist.splice(0, 2)
    r.base = v.parent >= 0 ? xfAt(p, v.parent, v.parentS) : IDENTITY

    const wr = age > v.dying ? easeInCubic(unit(age, v.dying + C.WITHER_VINE_DELAY_MS, C.WITHER_VINE_MS)) : 0
    let vis = easeOutCubic(unit(age, v.start, v.duration)) * v.length * (1 - wr)
    if (v.parent >= 0 && (rt[v.parent]?.vis ?? 0) < v.parentS) vis = 0
    r.vis = vis
    if (vis <= 0) return

    const { pts, cum } = v
    const rx = pts[0]
    const ry = pts[1]
    const B = r.base
    let j = 0
    for (; j < cum.length; j++) {
      let x = pts[j * 2]
      let y = pts[j * 2 + 1]
      let s = cum[j]
      const last = s >= vis
      if (last && j > 0) {
        // interpolate the tip
        const f = (vis - cum[j - 1]) / (cum[j] - cum[j - 1] || 1)
        x = pts[j * 2 - 2] + (x - pts[j * 2 - 2]) * f
        y = pts[j * 2 - 1] + (y - pts[j * 2 - 1]) * f
        s = vis
      }
      const a = r.th * bend(v, s)
      const c = Math.cos(a)
      const sn = Math.sin(a)
      const lx = rx + c * (x - rx) - sn * (y - ry)
      const ly = ry + sn * (x - rx) + c * (y - ry)
      r.dp[j * 2] = applyX(B, lx, ly) + boilX(boil, x, y)
      r.dp[j * 2 + 1] = applyY(B, lx, ly) + boilY(boil, x, y)
      if (last) break
    }
    r.n = Math.min(j + 1, cum.length)
  })

  // Clusters: a heavier pendulum that follows its stem's angle a little late, plus the wind.
  const wg = wind(now, screenX)
  for (const c of p.clusters) {
    const r = rt[c.vine]
    if (!r) continue
    const stemA = delayedTh(r, now - C.CLUSTER_SWING_DELAY_MS) * bend(p.vines[c.vine], c.s)
    ;[c.phi, c.phiV] = stepSpring(c.phi, c.phiV, -(C.CLUSTER_FOLLOW * stemA + C.CLUSTER_WIND * wg), C.CLUSTER_SWAY, dt)
  }
}

const hashPlant = (p: Plant) => (p.seed ^ (p.start * 2654435761)) >>> 0

// While withering, things shrink as the retracting tip comes back past them.
const witherScale = (p: Plant, age: number, v: Vine, s: number) =>
  age < v.dying ? 1 : clamp((rts(p)[v.id].vis - s) / (C.WITHER_SHRINK_EM * R), 0, 1)

const halfWidth = (v: Vine, s: number, minHalf: number) => Math.max(minHalf, (v.width + (v.tipWidth - v.width) * clamp(s / v.length, 0, 1)) / 2)

// ---- Layers ---------------------------------------------------------------------------

// Tapered stems as filled outlines, with a knot where each child leaves its parent.
export function drawStems(ctx: CanvasRenderingContext2D, p: Plant, age: number, layer: 0 | 1, scale: number) {
  const rt = rts(p)
  const minHalf = C.STEM_MIN_PX / 2 / scale
  const boil = boils.get(p)
  ctx.fillStyle = C.VINE
  for (const v of p.vines) {
    if (v.dead || v.layer !== layer) continue
    const r = rt[v.id]
    if (!r || r.n < 2) continue
    const d = r.dp
    const n = r.n
    const L: number[] = []
    const Rr: number[] = []
    for (let j = 0; j < n; j++) {
      const a = Math.max(0, j - 1)
      const b = Math.min(n - 1, j + 1)
      let tx = d[b * 2] - d[a * 2]
      let ty = d[b * 2 + 1] - d[a * 2 + 1]
      const tl = Math.hypot(tx, ty) || 1
      tx /= tl
      ty /= tl
      const hw = halfWidth(v, j === n - 1 ? r.vis : v.cum[j], minHalf)
      L.push(d[j * 2] - ty * hw, d[j * 2 + 1] + tx * hw)
      Rr.push(d[j * 2] + ty * hw, d[j * 2 + 1] - tx * hw)
    }
    ctx.beginPath()
    ctx.moveTo(L[0], L[1])
    for (let j = 1; j < n; j++) ctx.lineTo(L[j * 2], L[j * 2 + 1])
    for (let j = n - 1; j >= 0; j--) ctx.lineTo(Rr[j * 2], Rr[j * 2 + 1])
    ctx.closePath()
    ctx.fill()
    // round root and tip
    ctx.beginPath()
    ctx.arc(d[0], d[1], halfWidth(v, 0, minHalf), 0, Math.PI * 2)
    ctx.arc(d[(n - 1) * 2], d[(n - 1) * 2 + 1], halfWidth(v, r.vis, minHalf), 0, Math.PI * 2)
    ctx.fill()

    // knot on the parent where this stem branches off
    if (v.parent >= 0 && boil) {
      const pv = p.vines[v.parent]
      // no knot where the arch's crest carries on from its climb, or under a bunch at a tip
      if (pv.layer !== layer || v.gesture === "arch" || (v.gesture === "bunch" && v.parentS >= pv.length - 1)) continue
      const k = Math.min(1, spring(age - v.start, C.LEAF_SPRING)) * witherScale(p, age, v, 0)
      if (k <= 0.01) continue
      const xf = xfAt(p, v.parent, v.parentS)
      const q = v.pts
      ctx.beginPath()
      ctx.arc(applyX(xf, q[0], q[1]) + boilX(boil, q[0], q[1]), applyY(xf, q[0], q[1]) + boilY(boil, q[0], q[1]), halfWidth(pv, v.parentS, minHalf) * C.KNOT_WIDTH * k, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

// Curved hooks: the forward edge bows out, the back edge curves in, so the point leans back.
export function drawThorns(ctx: CanvasRenderingContext2D, p: Plant, age: number, layer: 0 | 1) {
  const boil = boils.get(p)
  if (!boil) return
  ctx.fillStyle = C.VINE
  for (const v of p.vines) {
    if (v.dead || v.layer !== layer) continue
    for (const t of v.thorns) {
      const sc = spring(age - t.start, C.LEAF_SPRING) * witherScale(p, age, v, t.s)
      if (sc <= 0.001 || t.s > rts(p)[v.id].vis) continue
      const xf = xfAt(p, v.id, t.s)
      const px = applyX(xf, t.x, t.y) + boilX(boil, t.x, t.y)
      const py = applyY(xf, t.x, t.y) + boilY(boil, t.x, t.y)
      const tx = Math.cos(t.tangent + xf.a)
      const ty = Math.sin(t.tangent + xf.a)
      const nx = -ty * t.side
      const ny = tx * t.side
      const half = (t.base * Math.min(1, sc)) / 2
      const reach = t.reach * sc
      const ax = px + Math.cos(t.angle + xf.a) * reach
      const ay = py + Math.sin(t.angle + xf.a) * reach
      ctx.beginPath()
      ctx.moveTo(px + tx * half, py + ty * half)
      ctx.quadraticCurveTo(px + nx * reach * 0.85 + tx * half * 0.7, py + ny * reach * 0.85 + ty * half * 0.7, ax, ay)
      ctx.quadraticCurveTo(px + nx * reach * 0.25 - tx * half * 0.3, py + ny * reach * 0.25 - ty * half * 0.3, px - tx * half, py - ty * half)
      ctx.closePath()
      ctx.fill()
    }
  }
}

export function drawLeaves(ctx: CanvasRenderingContext2D, p: Plant, age: number, layer: 0 | 1) {
  const boil = boils.get(p)
  if (!boil) return
  const base = ctx.getTransform()
  const veinW = C.LEAF_VEIN_WIDTH_PX
  for (const v of p.vines) {
    if (v.dead || v.layer !== layer) continue
    v.leaves.forEach((l, li) => {
      const sc = spring(age - l.start, C.LEAF_SPRING) * witherScale(p, age, v, l.s)
      if (sc <= 0.001) return
      const xf = xfAt(p, v.id, l.s)
      ctx.setTransform(base)
      ctx.translate(applyX(xf, l.x, l.y) + boilX(boil, l.x, l.y), applyY(xf, l.x, l.y) + boilY(boil, l.x, l.y))
      ctx.rotate(l.angle + xf.a + boilTurn(boil, v.id * 64 + li))
      ctx.scale(l.len * sc, l.len * sc)
      drawLeafShape(ctx, l.len * sc, l.color, veinW)
    })
  }
  ctx.setTransform(base)
}

// Stalk, then the bracts springing open one after another, then the cream centre flowers.
// Blooms are always drawn in front.
export function drawClusters(ctx: CanvasRenderingContext2D, p: Plant, age: number) {
  const boil = boils.get(p)
  if (!boil) return
  const base = ctx.getTransform()
  const rt = rts(p)
  ctx.lineCap = "round"
  for (const c of p.clusters) {
    const v = p.vines[c.vine]
    const r = rt[c.vine]
    if (!r || v.dead || age < c.start) continue
    const ws = witherScale(p, age, v, c.s)
    if (c.s > r.vis + 0.5) continue
    const xf = xfAt(p, c.vine, c.s)
    const ax = applyX(xf, c.ax, c.ay) + boilX(boil, c.ax, c.ay)
    const ay = applyY(xf, c.ax, c.ay) + boilY(boil, c.ax, c.ay)
    const open = spring(age - c.start, C.BLOOM_SPRING)
    const hang = Math.PI / 2 + c.stalkAngle + c.phi
    const stalk = c.stalk * Math.min(1, open) * ws
    // bracts boil at half strength: soft paper, not wire
    const k = C.BOIL_BRACT
    const cx = ax + Math.cos(hang) * stalk + k * boilX(boil, c.ax + c.len, c.ay - c.len)
    const cy = ay + Math.sin(hang) * stalk + k * boilY(boil, c.ax + c.len, c.ay - c.len)

    ctx.setTransform(base)
    ctx.strokeStyle = C.VINE
    ctx.lineWidth = Math.min(c.stalkW, v.width)
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(cx, cy)
    ctx.stroke()

    c.bracts.forEach((br, j) => {
      let sc: number
      if (age >= br.dropAt) sc = age >= br.regrowAt ? spring(age - br.regrowAt, C.BLOOM_SPRING) : 0
      else sc = spring(age - c.start - br.delay, C.BLOOM_SPRING)
      if (sc <= 0.001) {
        br.pose = null
        return
      }
      const ang = c.rot + c.phi + br.angle - (1 - sc) * rad(C.BRACT_OPEN_ROTATE_DEG) + k * boilTurn(boil, c.id * 8 + j)
      const off = C.BRACT_BASE_OFFSET * br.len * sc
      const bx = cx + Math.cos(ang) * off
      const by = cy + Math.sin(ang) * off
      br.pose = { x: bx, y: by, angle: ang, scale: sc }
      ctx.setTransform(base)
      ctx.translate(bx, by)
      ctx.rotate(ang)
      ctx.scale(br.len * sc, br.len * sc)
      drawBract(ctx, br, br.len * sc, C.BRACT_VEIN_WIDTH_PX)
    })

    if (!c.flowers.length) continue
    const last = c.bracts[c.bracts.length - 1].delay
    const fsc = spring(age - c.start - last - C.FLOWER_DELAY_MS, C.FLOWER_SPRING) * ws
    if (fsc <= 0.001) continue
    ctx.setTransform(base)
    ctx.strokeStyle = C.FLOWER_CENTER
    ctx.fillStyle = C.FLOWER_CENTER
    ctx.lineWidth = c.flowerW * Math.min(1, fsc)
    for (const f of c.flowers) {
      const a = c.rot + c.phi + f.angle
      const ex = cx + Math.cos(a) * f.len * fsc
      const ey = cy + Math.sin(a) * f.len * fsc
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(ex, ey)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(ex, ey, c.flowerW * C.FLOWER_TIP * Math.min(1, fsc), 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.setTransform(base)
}

// Debug: every stem's skeleton in a flat colour by tier, growth points as dots.
export function drawDebug(ctx: CanvasRenderingContext2D, p: Plant, scale: number) {
  const rt = rts(p)
  ctx.lineWidth = C.DEBUG_LINE_PX / scale
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  for (const v of p.vines) {
    if (v.dead) continue
    const r = rt[v.id]
    if (!r || r.n < 2) continue
    ctx.strokeStyle = C.DEBUG_COLORS[v.tier]
    ctx.beginPath()
    ctx.moveTo(r.dp[0], r.dp[1])
    for (let j = 1; j < r.n; j++) ctx.lineTo(r.dp[j * 2], r.dp[j * 2 + 1])
    ctx.stroke()
  }
  ctx.fillStyle = C.DEBUG_COLORS.trunk
  ctx.strokeStyle = C.LETTER
  const a = p.archDebug
  for (const g of a ? [...p.growth, a.root] : p.growth) {
    ctx.beginPath()
    ctx.arc(g.x, g.y, C.DEBUG_DOT_PX / scale, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  if (!a) return
  // the arch: support glyph's ink box, crest cap line, main bunch to its nearest ink
  const [x0, y0, x1, y1] = a.box
  ctx.strokeStyle = C.DEBUG_ARCH_COLOR
  ctx.setLineDash([4 / scale, 3 / scale])
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)
  ctx.beginPath()
  ctx.moveTo(x0 - R * C.ARCH_SPAN_MAX_EM * 0.5, a.capY)
  ctx.lineTo(x1 + R * C.ARCH_SPAN_MAX_EM * 0.5, a.capY)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(a.bunch.x, a.bunch.y)
  ctx.lineTo(a.ink.x, a.ink.y)
  ctx.stroke()
  ctx.fillStyle = C.DEBUG_ARCH_COLOR
  for (const q of [a.bunch, a.ink]) {
    ctx.beginPath()
    ctx.arc(q.x, q.y, (C.DEBUG_DOT_PX * 0.6) / scale, 0, Math.PI * 2)
    ctx.fill()
  }
}
