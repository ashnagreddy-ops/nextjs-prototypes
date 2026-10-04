import * as C from "./config"
import { type Cluster, makeCluster } from "./bracts"
import { clamp, rad } from "./ease"
import { type Letter, dOutAt } from "./glyph"
import { isSolid } from "./mask"
import { type Rng, createRng, hashSeed } from "./rng"
import { advanceEm } from "./text-layout"
import { type Curve, type Spiral, curve, sampleAt, smooth, tipPasses, turnAt, walk } from "./walker"

// One plant per word. Everything is in word coordinates at REF_FONT_PX: the origin is the
// word's first pen, y = 0 is the baseline. Times are on the plant's clock (0 = the word's
// first keypress). Letters are added and removed at the end as the word is typed.
//
// Hierarchy: 2-3 growth points on ink near the baseline each grow a trunk (a short climber);
// drapes (branches) and twigs leave trunks, twigs leave drapes. The arch also grows from a
// growth point once the word settles. Hugs (outline followers, one per ~2 letters) and bridges
// (sagging ropes between neighbouring glyphs) are the only stems not rooted in a growth point.

const R = C.REF_FONT_PX
const DOWN = Math.PI / 2
const em = (v: number) => v * R

export type Gesture = "trunk" | "arch" | "drape" | "twig" | "hug" | "bridge" | "bunch"
export type Bloom = "none" | "small" | "medium" | "hero"
export type Rule = "reach" | "self" | "parallel" | "front" | "calm" | "skipped"

export type Leaf = { s: number; x: number; y: number; angle: number; len: number; color: string; start: number }
// Curved hook: base along the stem centreline, apex out past the stem edge, pointing back.
export type Thorn = { s: number; x: number; y: number; tangent: number; side: 1 | -1; angle: number; reach: number; base: number; start: number }

export type Host = { birth: number; char: string }

export type PlantLetter = {
  host: Host
  letter: Letter
  j: number // index in the word
  x0: number // pen x in word coords
  dying: number // plant clock at backspace (Infinity while alive)
  cells: number[] // calm-grid cells that hold ink
}

export type Vine = {
  id: number
  pts: Float32Array // flattened Catmull-Rom chain, x/y pairs
  cum: Float32Array // arc length at each point
  length: number
  mainLength: number // before a tendril spiral
  width: number // at the root; tapers to TAPER_TIP at the tip
  tier: C.Tier
  gesture: Gesture
  layer: 0 | 1 // 0 behind the type, 1 in front
  start: number
  duration: number
  parent: number // -1 for stems rooted on ink
  parentS: number
  flex: number
  bloom: Bloom // what this stem's end carries, for the word's bloom budget
  owner: PlantLetter
  leaves: Leaf[]
  thorns: Thorn[]
  samples: Sample[]
  cells: number[] // calm cells it covers in front of the ink (stem if layer 1, leaves, blooms)
  dying: number
  dead: boolean
}

export type GrowthPoint = { x: number; y: number; owner: PlantLetter }

export type Plant = {
  seed: number
  start: number // index of the word's first glyph
  host0: Host // the word's first glyph: its birth is the plant's clock
  style: C.WordStyle
  variety: C.Variety
  letters: PlantLetter[]
  gone: PlantLetter[] // withering
  vines: Vine[]
  clusters: Cluster[]
  growth: GrowthPoint[]
  settledLen: number // letters count at the last settle (-1 = needs one)
  drapeTarget: number
  bloomTarget: number
  hugPhase: number
  growthGaps: number[]
  bridgeEvery: number
  rejected: Record<Rule, number>
  occ: Occupancy | null // rebuilt lazily after removals
  covered: Set<number> | null
  inkCells: Set<number> | null
  rt: unknown[] // motion state, owned by render.ts
}

const SALT = { plant: 21, letter: 22, growth: 23, settle: 24, arch: 25, attempt: 26, bunch: 27 }

const randInt = (rng: Rng, [lo, hi]: readonly [number, number]) => lo + Math.floor(rng.next() * (hi - lo + 1))

export function createPlant(seed: number, start: number, host0: Host, style: C.WordStyle, variety: C.Variety): Plant {
  const rng = createRng(hashSeed(seed, start, SALT.plant))
  return {
    seed,
    start,
    host0,
    style,
    variety,
    letters: [],
    gone: [],
    vines: [],
    clusters: [],
    growth: [],
    settledLen: -1,
    drapeTarget: randInt(rng, C.DRAPES),
    bloomTarget: clamp(randInt(rng, style.blooms), 3, 6),
    hugPhase: Math.floor(rng.next() * C.HUG_EVERY),
    growthGaps: [randInt(rng, C.GROWTH_EVERY), randInt(rng, C.GROWTH_EVERY)],
    bridgeEvery: randInt(rng, C.BRIDGE_EVERY),
    rejected: { reach: 0, self: 0, parallel: 0, front: 0, calm: 0, skipped: 0 },
    occ: null,
    covered: null,
    inkCells: null,
    rt: [],
  }
}

const alive = (p: Plant) => p.vines.filter((v) => !v.dead && v.dying === Infinity)
const count = (p: Plant, g: Gesture) => alive(p).filter((v) => v.gesture === g).length
const tOf = (p: Plant, L: PlantLetter) => L.host.birth - p.host0.birth
const growMs = (len: number) => Math.max(C.GROW_MS_MIN, (len / R) * C.GROW_MS_PER_EM)
const widthOf = (tier: C.Tier) => em(C.BASE_WIDTH_EM) * C.TIER_WIDTH[tier]

// Bloom sites: the hero (reserved until the arch exists), medium bunches, small singles/pairs.
function sites(p: Plant) {
  const a = alive(p)
  const hero = a.some((v) => v.bloom === "hero") ? 0 : 1
  return a.filter((v) => v.bloom !== "none").length + hero
}
const canBloom = (p: Plant) => sites(p) < p.bloomTarget

// ---- Ink and calm grid ---------------------------------------------------------

const cellKey = (x: number, y: number) => {
  const c = em(C.CALM_CELL_EM)
  return (Math.floor(x / c) + 2048) * 4096 + (Math.floor(y / c) + 2048)
}

// The letter whose ink covers word point (x, y), if any.
function inkAt(p: Plant, x: number, y: number): PlantLetter | null {
  for (const L of p.letters) {
    const g = L.letter
    if (!g.ink) continue
    const mx = Math.floor(x - L.x0 + g.ox)
    const my = Math.floor(y + g.oy)
    if (isSolid(g.ink, mx, my)) return L
  }
  return null
}

function letterCells(L: PlantLetter) {
  const g = L.letter
  const out = new Set<number>()
  if (!g.ink) return []
  for (let y = g.inkTop; y <= g.inkBottom; y += 2)
    for (let x = g.inkLeft; x <= g.inkRight; x += 2) if (isSolid(g.ink, x, y)) out.add(cellKey(L.x0 + x - g.ox, y - g.oy))
  return [...out]
}

function refresh(p: Plant) {
  if (!p.inkCells) p.inkCells = new Set(p.letters.flatMap((L) => L.cells))
  if (!p.covered) p.covered = new Set(alive(p).flatMap((v) => v.cells))
  if (!p.occ) {
    p.occ = new Occupancy(em(C.GAP_EM))
    for (const v of alive(p)) for (const s of v.samples) p.occ.add(s)
  }
}
const dirty = (p: Plant) => {
  p.occ = null
  p.covered = null
  p.inkCells = null
}

// Would adding these front cells leave at least CALM_FREE of the word's ink clear?
function calmOk(p: Plant, cells: number[]) {
  refresh(p)
  const ink = p.inkCells!
  if (!ink.size) return true
  let n = 0
  for (const k of ink) if (p.covered!.has(k)) n++
  for (const k of new Set(cells)) if (ink.has(k) && !p.covered!.has(k)) n++
  return n / ink.size <= 1 - C.CALM_FREE
}

// ---- Occupancy: samples of accepted stems on a grid of GAP cells ----------------

type Sample = { x: number; y: number; id: number; s: number; dx: number; dy: number; spiral: boolean }

class Occupancy {
  private cells = new Map<number, Sample[]>()
  constructor(private size: number) {}
  private key = (ix: number, iy: number) => (ix + 4096) * 8192 + (iy + 4096)
  add(p: Sample) {
    const k = this.key(Math.floor(p.x / this.size), Math.floor(p.y / this.size))
    const list = this.cells.get(k)
    if (list) list.push(p)
    else this.cells.set(k, [p])
  }
  *near(x: number, y: number) {
    const ix = Math.floor(x / this.size)
    const iy = Math.floor(y / this.size)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.cells.get(this.key(ix + dx, iy + dy))
        if (list) for (const q of list) if (Math.hypot(q.x - x, q.y - y) < this.size) yield q
      }
  }
}

function samplesOf(ch: { pts: Float32Array; cum: Float32Array; length: number; mainLength: number }, id: number) {
  const step = em(C.GAP_EM) * 0.4
  const out: Sample[] = []
  for (let s = 0; s <= ch.length; s += step) {
    const q = sampleAt(ch, s)
    // the run-in to a tendril wraps close to the spiral by design, so it counts as spiral too
    const spiral = ch.length > ch.mainLength + 1 && s > ch.mainLength - em(C.TENDRIL_LEAD_EM)
    out.push({ x: q.x, y: q.y, id, s, dx: Math.cos(q.angle), dy: Math.sin(q.angle), spiral })
  }
  return out
}

// ---- Candidates and the clearance rules -----------------------------------------

type Draft = {
  raw: { xy: number[]; main: number }
  tier: C.Tier
  gesture: Gesture
  front: "auto" | "must" | "never"
  parent: number
  parentS: number
  start: number
  bloom: Bloom
  ignore?: number // a stem id the parallel check skips (a bunch and its parent)
  calm?: boolean // false: exempt from the calm rule (the hero bunch)
}

type Built = Omit<Vine, "id" | "owner" | "dying" | "dead" | "cells" | "samples"> & { samples: Sample[] }

// Reject on reach, self-crossing, running parallel, or (front stems) too much ink. Returns the
// stem with its layer, or the rule that failed.
function judge(p: Plant, d: Draft, id: number): { v: Built } | { rule: Rule } {
  const ch = smooth(d.raw.xy, d.raw.main)
  const samples = samplesOf(ch, id)
  refresh(p)

  // reach: stay near the word
  const L0 = p.letters[0]
  const Ln = p.letters[p.letters.length - 1]
  const x0 = L0.x0 + L0.letter.inkLeft - L0.letter.ox - em(C.REACH_X_EM)
  const x1 = Ln.x0 + Ln.letter.inkRight - Ln.letter.ox + em(C.REACH_X_EM)
  if (samples.some((q) => q.x < x0 || q.x > x1 || q.y < -em(C.REACH_UP_EM) || q.y > em(C.REACH_DOWN_EM))) return { rule: "reach" }

  // self: comes back within GAP of itself further along (the tendril spiral is exempt)
  const gap = em(C.GAP_EM)
  const self = new Occupancy(gap)
  for (const q of samples) {
    for (const o of self.near(q.x, q.y)) if (q.s - o.s > C.SELF_GAP * gap && !(q.spiral && o.spiral)) return { rule: "self" }
    self.add(q)
  }

  // parallel: alongside another stem (within GAP and PARALLEL_DEG) for too much of its length
  const cosMax = Math.cos(rad(C.PARALLEL_DEG))
  const step = samples.length > 1 ? samples[1].s : 0
  let along = 0
  for (const q of samples) {
    if (q.s < em(C.ROOT_EXEMPT_EM)) continue
    for (const o of p.occ!.near(q.x, q.y)) {
      if (o.id === d.ignore) continue
      if (Math.abs(q.dx * o.dx + q.dy * o.dy) > cosMax) {
        along += step
        break
      }
    }
  }
  if (along > C.PARALLEL_MAX * ch.length) return { rule: "parallel" }

  // front: over ink for at most FRONT_MAX_INK_EM, on at most one glyph; otherwise behind
  let inkLen = 0
  const crossed = new Set<PlantLetter>()
  for (const q of samples) {
    const L = inkAt(p, q.x, q.y)
    if (!L) continue
    inkLen += step
    crossed.add(L)
  }
  const frontOk = inkLen <= em(C.FRONT_MAX_INK_EM) && crossed.size <= 1
  if (d.front === "must" && !frontOk) return { rule: "front" }
  const layer: 0 | 1 = d.front === "never" ? 0 : frontOk ? 1 : 0

  const width = widthOf(d.tier)
  const flex = C.FLEX[d.gesture]
  return {
    v: {
      ...ch,
      width,
      tier: d.tier,
      gesture: d.gesture,
      layer,
      start: d.start,
      duration: growMs(ch.length),
      parent: d.parent,
      parentS: d.parentS,
      flex,
      bloom: d.bloom,
      leaves: [],
      thorns: [],
      samples,
    },
  }
}

// Cells a stem covers in front of the ink: its own line if it's in front, plus its leaves and blooms.
function frontCells(v: Built, clusters: Cluster[]) {
  const out: number[] = []
  if (v.layer === 1) for (const q of v.samples) out.push(cellKey(q.x, q.y))
  if (v.layer === 1)
    for (const l of v.leaves)
      for (let t = 0.2; t <= 1; t += 0.2) out.push(cellKey(l.x + Math.cos(l.angle) * l.len * t, l.y + Math.sin(l.angle) * l.len * t))
  for (const c of clusters) {
    const cx = c.ax + Math.cos(DOWN + c.stalkAngle) * c.stalk
    const cy = c.ay + Math.sin(DOWN + c.stalkAngle) * c.stalk
    const r = c.len * 1.05
    const st = em(C.CALM_CELL_EM) * 0.7
    for (let y = -r; y <= r; y += st) for (let x = -r; x <= r; x += st) if (x * x + y * y <= r * r) out.push(cellKey(cx + x, cy + y))
  }
  return out
}

// Try a stem up to VINE_TRIES times, each with a fresh random stream, judging it against the
// rules and decorating it (decorate may add leaves, thorns and clusters). Commits the first
// that passes, or counts it as skipped.
function grow(
  p: Plant,
  owner: PlantLetter,
  seed: number,
  make: (rng: Rng) => Draft | null,
  decorate?: (rng: Rng, v: Built, id: number) => Cluster[]
): Vine | null {
  const id = p.vines.length
  for (let t = 0; t < C.VINE_TRIES; t++) {
    const rng = createRng(hashSeed(seed, SALT.attempt, t))
    const d = make(rng)
    if (!d) continue
    const r = judge(p, d, id)
    if ("rule" in r) {
      p.rejected[r.rule]++
      continue
    }
    const clusters = decorate?.(rng, r.v, id) ?? []
    const cells = frontCells(r.v, clusters)
    if (d.calm !== false && !calmOk(p, cells)) {
      p.rejected.calm++
      continue
    }
    const v: Vine = { ...r.v, id, owner, dying: Infinity, dead: false, cells }
    p.vines.push(v)
    p.clusters.push(...clusters)
    refresh(p)
    for (const q of v.samples) p.occ!.add(q)
    for (const k of cells) p.covered!.add(k)
    return v
  }
  p.rejected.skipped++
  return null
}

// ---- Decorations ------------------------------------------------------------------

const leafColor = (rng: Rng) => (rng.next() < C.LEAF_DARK_CHANCE ? C.LEAF_DARK : C.LEAF)

function leafAt(rng: Rng, v: Built, s: number, angle: number, sizeK: number): Leaf {
  const q = sampleAt(v, s)
  return { s, x: q.x, y: q.y, angle, len: em(rng.range(C.LEAF_LENGTH_EM[0], C.LEAF_LENGTH_EM[1])) * sizeK, color: leafColor(rng), start: tipPasses(v, s) }
}

// Leaf pairs gathered within LEAF_NEAR_BLOOM_EM behind a bloom at arc length s.
function leavesBehind(rng: Rng, p: Plant, v: Built, s: number) {
  const pairs = randInt(rng, p.style.leafPairs)
  let at = s - em(rng.range(C.LEAF_PAIR_GAP_EM[0], C.LEAF_PAIR_GAP_EM[1])) * 0.6
  for (let i = 0; i < pairs && at > 0 && s - at <= em(C.LEAF_NEAR_BLOOM_EM); i++) {
    const a = sampleAt(v, at).angle
    for (const sd of [-1, 1]) v.leaves.push(leafAt(rng, v, at, a + sd * rad(rng.range(C.LEAF_ANGLE_MIN_DEG, C.LEAF_ANGLE_MAX_DEG)), p.style.leafSize))
    at -= em(rng.range(C.LEAF_PAIR_GAP_EM[0], C.LEAF_PAIR_GAP_EM[1]))
  }
}

function thorns(rng: Rng, p: Plant, v: Built, avoid: number[]) {
  const want = Math.min(C.THORN_MAX_PER_STEM, randInt(rng, p.style.thorns))
  for (let t = 0; t < 16 && v.thorns.length < want; t++) {
    const s = rng.range(C.THORN_FROM, C.THORN_TO) * v.mainLength
    if ([...avoid, ...v.thorns.map((o) => o.s)].some((o) => Math.abs(o - s) < em(C.THORN_GAP_EM))) continue
    const q = sampleAt(v, s)
    const side = rng.sign() as 1 | -1
    v.thorns.push({
      s,
      x: q.x,
      y: q.y,
      tangent: q.angle,
      side,
      angle: q.angle + side * rad(rng.range(C.THORN_ANGLE_MIN_DEG, C.THORN_ANGLE_MAX_DEG)),
      reach: v.width / 2 + em(C.THORN_LENGTH_EM) * (1 + rng.range(-1, 1) * C.THORN_LENGTH_JITTER),
      base: v.width * C.THORN_BASE,
      start: tipPasses(v, s),
    })
  }
}

function cluster(p: Plant, rng: Rng, v: Built, id: number, s: number, kind: Cluster["kind"], start: number, extra?: { stalk?: number; stalkAngle?: number }) {
  const q = sampleAt(v, s)
  return makeCluster(rng, { vine: id, s, ax: q.x, ay: q.y, kind, start, variety: p.variety, fs: R, stemW: v.width, id: p.clusters.length * 8 + Math.floor(rng.next() * 7), ...extra })
}

// Children leave on the outer side of the parent's curve, 30-45 degrees off it.
function childHeading(rng: Rng, parent: { pts: Float32Array; cum: Float32Array; length: number }, s: number) {
  const turn = turnAt(parent, s)
  const outer = turn ? -Math.sign(turn) : rng.sign()
  return { heading: sampleAt(parent, s).angle + outer * rad(rng.range(C.CHILD_ANGLE_MIN_DEG, C.CHILD_ANGLE_MAX_DEG)), outer }
}

// Irregularly spaced branch points in [from, to].
function branchPoints(rng: Rng, from: number, to: number, n: number) {
  const out: number[] = []
  let s = from + rng.next() * em(C.CHILD_GAP_MIN_EM)
  while (out.length < n && s < to) {
    out.push(s)
    s += em(rng.range(C.CHILD_GAP_MIN_EM, C.CHILD_GAP_MAX_EM))
  }
  return out
}

// ---- Gestures ----------------------------------------------------------------------

// TWIG: short end stem with a single/pair bloom (while the budget lasts), buds on its last
// BUD_ZONE, leaf pairs behind the blooms, sometimes a tendril spiral at the end.
function growTwig(p: Plant, owner: PlantLetter, parent: Vine, s: number, seed: number, minStart = -Infinity) {
  return grow(
    p,
    owner,
    seed,
    (rng) => {
      const { heading, outer } = childHeading(rng, parent, s)
      const q = sampleAt(parent, s)
      const L = em(rng.range(C.TWIG_LENGTH_EM[0], C.TWIG_LENGTH_EM[1])) * p.style.lengthMul
      const tendril = tendrils(p) < C.TENDRIL_MAX && rng.next() < p.style.tendrilChance
      const spiral: Spiral | undefined = tendril
        ? { turns: rng.range(C.TENDRIL_TURNS[0], C.TENDRIL_TURNS[1]), r0: em(rng.range(C.TENDRIL_SIZE_EM[0], C.TENDRIL_SIZE_EM[1])), tighten: C.TENDRIL_TIGHTEN }
        : undefined
      const c = curve(rng, C.TWIG_CURVE, C.TWIG_GRAVITY * p.style.gravity, outer)
      return {
        raw: walk(q.x, q.y, heading, L, c, spiral),
        tier: "twig",
        gesture: "twig",
        front: "auto",
        parent: parent.id,
        parentS: s,
        start: Math.max(minStart, tipPasses(parent, s)),
        bloom: !tendril && canBloom(p) ? "small" : "none",
      }
    },
    (rng, v, id) => {
      const out: Cluster[] = []
      const main = v.mainLength
      const done = (at: number) => tipPasses(v, at) + C.CLUSTER_GAP_MS
      const blooms: number[] = []
      if (v.bloom === "small") {
        blooms.push(main)
        out.push(cluster(p, rng, v, id, main, "small", done(main)))
        if (rng.next() < p.style.pairChance) {
          const s2 = main * rng.range(0.7, 0.82)
          blooms.push(s2)
          out.push(cluster(p, rng, v, id, s2, "small", done(s2)))
        }
      }
      // buds on the last BUD_ZONE (a bare tendril twig always gets one before its spiral)
      const buds = Math.max(v.bloom === "none" ? 1 : 0, randInt(rng, C.BUDS_PER_TWIG))
      for (let b = 0; b < buds; b++) {
        const at = v.bloom === "none" && b === 0 && v.length === main ? main : main * rng.range(1 - C.BUD_ZONE, 0.97)
        blooms.push(at)
        out.push(cluster(p, rng, v, id, at, "bud", done(at)))
      }
      leavesBehind(rng, p, v, Math.max(...blooms))
      return out
    }
  )
}

const tendrils = (p: Plant) => alive(p).filter((v) => v.length > v.mainLength + 1).length

// BUNCH: drooping sub-stem at a parent's tip with 4-7 clusters on fanned stalks.
function growBunch(p: Plant, owner: PlantLetter, parent: Vine, kind: "hero" | "medium", seed: number) {
  const hero = kind === "hero"
  return grow(
    p,
    owner,
    seed,
    (rng) => {
      const q = sampleAt(parent, parent.length)
      const L = em(rng.range(...(hero ? C.HERO_STEM_EM : C.MEDIUM_STEM_EM)))
      const lean = Math.cos(q.angle) >= 0 ? 1 : -1 // continue slightly the way the parent travels
      const c: Curve = { k0: -lean * 0.25, k1: 0, g: C.DRAPE_GRAVITY }
      return {
        raw: walk(q.x, q.y, DOWN - lean * 0.35, L, c),
        tier: "twig",
        gesture: "bunch",
        front: "auto",
        parent: parent.id,
        parentS: parent.length,
        start: parent.start + parent.duration * 0.92,
        bloom: kind,
        ignore: parent.id,
        calm: !hero,
      }
    },
    (rng, v, id) => {
      const n = randInt(rng, hero ? p.style.heroBunch : p.style.bunch)
      const out: Cluster[] = []
      let side = rng.sign()
      for (let j = 0; j < n; j++) {
        const u = n === 1 ? 1 : C.BUNCH_FROM + ((1 - C.BUNCH_FROM) * j) / (n - 1)
        const s = u * v.length
        out.push(
          cluster(p, rng, v, id, s, hero ? "hero" : "normal", tipPasses(v, s) + C.CLUSTER_GAP_MS + j * C.BUNCH_STAGGER_MS, {
            stalk: em(C.BUNCH_STALK_EM) * (hero ? 1 : C.MEDIUM_STALK),
            stalkAngle: j === n - 1 ? 0 : (side = -side) * rad(rng.range(C.BUNCH_STALK_DEG_MIN, C.BUNCH_STALK_DEG_MAX)),
          })
        )
      }
      return out
    }
  )
}

// DRAPE: leaves a trunk outward and falls under gravity; ends in a medium bunch (two per word)
// or a twig; carries twigs of its own.
function growDrape(p: Plant, owner: PlantLetter, trunk: Vine, seed: number, minStart = -Infinity) {
  let s = 0
  const v = grow(
    p,
    owner,
    seed,
    (rng) => {
      s = rng.range(C.DRAPE_AT[0], C.DRAPE_AT[1]) * trunk.length
      const { heading, outer } = childHeading(rng, trunk, s)
      const q = sampleAt(trunk, s)
      const L = em(rng.range(C.DRAPE_LENGTH_EM[0], C.DRAPE_LENGTH_EM[1])) * p.style.lengthMul
      const medium = alive(p).filter((o) => o.bloom === "medium").length < C.MEDIUM_BUNCHES && canBloom(p)
      return {
        raw: walk(q.x, q.y, heading, L, curve(rng, C.DRAPE_CURVE, C.DRAPE_GRAVITY * p.style.gravity, outer)),
        tier: "branch",
        gesture: "drape",
        front: "auto",
        parent: trunk.id,
        parentS: s,
        start: Math.max(minStart, tipPasses(trunk, s)),
        bloom: medium ? "medium" : "none",
      }
    },
    (rng, d) => {
      thorns(rng, p, d, [])
      return []
    }
  )
  if (!v) return null
  const rng = createRng(hashSeed(seed, 7))
  const medium = v.bloom === "medium"
  v.bloom = "none" // the bunch stem carries it
  if (!medium || !growBunch(p, owner, v, "medium", hashSeed(seed, 8))) growTwigAtTip(p, owner, v, hashSeed(seed, 9))
  for (const at of branchPoints(rng, C.TWIG_FROM * v.length, 0.85 * v.length, randInt(rng, p.style.twigs))) growTwig(p, owner, v, at, hashSeed(seed, 10, at | 0))
  return v
}

// A drape without a bunch ends in a twig that carries on from its tip.
function growTwigAtTip(p: Plant, owner: PlantLetter, parent: Vine, seed: number) {
  growTwig(p, owner, parent, parent.length - 0.5, seed)
}

// TRUNK: a short climber from a growth point (gravity 0.2), bare for its first TRUNK_BARE.
function growTrunk(p: Plant, gp: GrowthPoint, start: number, seed: number) {
  const owner = gp.owner
  const v = grow(
    p,
    owner,
    seed,
    (rng) => {
      const lean = rng.range(-1, 1) * C.TRUNK_LEAN_MAX_RAD
      const L = em(rng.range(C.TRUNK_LENGTH_EM[0], C.TRUNK_LENGTH_EM[1])) * p.style.lengthMul
      return {
        raw: walk(gp.x, gp.y, -DOWN + lean, L, curve(rng, C.TRUNK_CURVE, C.TRUNK_GRAVITY * p.style.gravity, lean || 1)),
        tier: "trunk",
        gesture: "trunk",
        front: "auto",
        parent: -1,
        parentS: 0,
        start,
        bloom: "none",
      }
    },
    (rng, d) => {
      thorns(rng, p, d, [])
      return []
    }
  )
  if (!v) return null
  const rng = createRng(hashSeed(seed, 3))
  if (count(p, "drape") < p.drapeTarget) growDrape(p, owner, v, hashSeed(seed, 4))
  // a lone trunk in the word takes the second drape too
  if (count(p, "drape") < p.drapeTarget && count(p, "trunk") === 1) growDrape(p, owner, v, hashSeed(seed, 5))
  for (const at of branchPoints(rng, C.TRUNK_BARE * v.length, 0.92 * v.length, randInt(rng, p.style.twigs))) growTwig(p, owner, v, at, hashSeed(seed, 6, at | 0))
  return v
}

// ARCH: from a growth point, heading up, constant gentle curvature toward `dir`; gravity takes
// over in the last third. Sized so its crest sits ARCH_RISE above the word's highest ink. The
// hero bunch hangs from its tip.
function growArch(p: Plant, start: number, seed: number) {
  if (!p.growth.length) return null
  const top = Math.min(...p.letters.filter((L) => L.letter.ink).map((L) => L.letter.inkTop - L.letter.oy))
  const first = p.letters[0]
  const last = p.letters[p.letters.length - 1]
  const centre = (first.x0 + first.letter.inkLeft - first.letter.ox + last.x0 + last.letter.inkRight - last.letter.ox) / 2
  // outermost growth points first, so the arch spans the word and the bunch hangs over it
  const gps = [...p.growth].sort((a, b) => Math.abs(b.x - centre) - Math.abs(a.x - centre))
  for (const gp of gps) {
    const v = grow(p, gp.owner, hashSeed(seed, gp.x | 0), (rng) => {
      const dir = p.letters.length === 1 || Math.abs(gp.x - centre) < em(0.1) ? rng.sign() : gp.x < centre ? 1 : -1
      const heading = -DOWN + dir * rng.range(C.ARCH_LEAN_RAD[0], C.ARCH_LEAN_RAD[1])
      const k = dir * rng.range(C.ARCH_CURVE[0], C.ARCH_CURVE[1])
      const c: Curve = { k0: k, k1: k, g: C.ARCH_GRAVITY * p.style.gravity, gFrom: C.ARCH_GRAVITY_FROM }
      // shapes don't depend on length, so size it from a unit walk
      const unit = walk(0, 0, heading, 1, c).xy
      let minY = 0
      for (let i = 1; i < unit.length; i += 2) minY = Math.min(minY, unit[i])
      const crest = top - em(rng.range(C.ARCH_RISE_EM[0], C.ARCH_RISE_EM[1]))
      const L = clamp((gp.y - crest) / Math.max(0.05, -minY), em(C.ARCH_LENGTH_MIN_EM), em(C.ARCH_LENGTH_MAX_EM))
      return { raw: walk(gp.x, gp.y, heading, L, c), tier: "trunk", gesture: "arch", front: "auto", parent: -1, parentS: 0, start, bloom: "none", calm: false }
    })
    if (!v) continue
    growBunch(p, gp.owner, v, "hero", hashSeed(seed, SALT.bunch))
    return v
  }
  return null
}

// HUG: from just above the baseline, follow the glyph's outline upward HUG_OFFSET outside the
// ink (the iso-line of the outside distance field), in front; ends in a small bloom or a leaf pair.
function growHug(p: Plant, L: PlantLetter, start: number, seed: number) {
  const g = L.letter
  if (!g.ink || !g.dOut) return null
  // stays clear of the stroke: at most HUG_MAX_STROKE_COVER of it may be under the stem
  const half = widthOf("branch") / 2
  const offset = Math.max(em(C.HUG_OFFSET_EM), half - C.HUG_MAX_STROKE_COVER * widthOf("branch"))
  return grow(
    p,
    L,
    seed,
    (rng) => {
      const side = rng.sign()
      // outermost ink near the baseline on that side
      let sx = NaN
      let sy = 0
      for (let dy = 0; dy < em(0.15) && isNaN(sx); dy += 2) {
        const y = Math.round(g.oy - em(C.HUG_START_EM) - dy)
        for (let i = 0; i <= g.inkRight - g.inkLeft; i++) {
          const x = side < 0 ? g.inkLeft + i : g.inkRight - i
          if (isSolid(g.ink!, x, y)) {
            sx = x + 0.5 + side * offset
            sy = y + 0.5
            break
          }
        }
      }
      if (isNaN(sx)) return null
      const maxLen = em(rng.range(C.HUG_LENGTH_EM[0], C.HUG_LENGTH_EM[1]))
      const topY = g.inkTop + em(C.HUG_TOP_EM)
      const xy = [sx, sy]
      let x = sx
      let y = sy
      let tx = 0
      let ty = -1
      let len = 0
      let best = 0
      let minY = y
      while (len < maxLen) {
        const h = 1.5
        const gx = dOutAt(g, x + h, y) - dOutAt(g, x - h, y)
        const gy = dOutAt(g, x, y + h) - dOutAt(g, x, y - h)
        const gl = Math.hypot(gx, gy) || 1
        let nx = -gy / gl
        let ny = gx / gl
        if (nx * tx + ny * ty < 0) {
          nx = -nx
          ny = -ny
        }
        const err = offset - dOutAt(g, x, y)
        x += nx * C.HUG_STEP_PX + (gx / gl) * err * 0.5
        y += ny * C.HUG_STEP_PX + (gy / gl) * err * 0.5
        tx = nx
        ty = ny
        len += C.HUG_STEP_PX
        xy.push(x, y)
        if (y < minY) {
          minY = y
          best = xy.length / 2
        }
        if (y < topY || y > minY + em(0.05)) break
      }
      const pts = xy.slice(0, best * 2)
      if (pts.length < 4 || len < em(C.HUG_MIN_EM)) return null
      // into word coords, thinned to ~WALK_STEPS knots for the spline
      const every = Math.max(1, Math.round(pts.length / 2 / C.WALK_STEPS))
      const out: number[] = []
      for (let i = 0; i < pts.length / 2; i += every) out.push(L.x0 + pts[i * 2] - g.ox, pts[i * 2 + 1] - g.oy)
      return { raw: { xy: out, main: out.length / 2 }, tier: "branch", gesture: "hug", front: "must", parent: -1, parentS: 0, start, bloom: canBloom(p) && rng.next() < 0.5 ? "small" : "none" }
    },
    (rng, v, id) => {
      if (v.bloom === "small") return [cluster(p, rng, v, id, v.length, "small", tipPasses(v, v.length) + C.CLUSTER_GAP_MS)]
      const a = sampleAt(v, v.length).angle
      for (const sd of [-1, 1]) v.leaves.push(leafAt(rng, v, v.length, a + sd * rad(C.LEAF_TIP_PAIR_DEG), p.style.leafSize))
      return []
    }
  )
}

// BRIDGE: a sagging rope from glyph A to glyph B, both ends just inside the ink, behind the type.
function growBridge(p: Plant, A: PlantLetter, B: PlantLetter, start: number, seed: number) {
  const ga = A.letter
  const gb = B.letter
  if (!ga.ink || !gb.ink) return null
  return grow(p, B, seed, (rng) => {
    const y = -em(rng.range(C.BRIDGE_Y_EM[0], C.BRIDGE_Y_EM[1]))
    let xa = NaN
    for (let x = ga.inkRight; x >= ga.inkLeft; x--)
      if (isSolid(ga.ink!, x, Math.round(y + ga.oy))) {
        xa = A.x0 + x - ga.ox
        break
      }
    let xb = NaN
    for (let x = gb.inkLeft; x <= gb.inkRight; x++)
      if (isSolid(gb.ink!, x, Math.round(y + gb.oy))) {
        xb = B.x0 + x - gb.ox
        break
      }
    const gap = xb - xa
    if (!(gap > em(C.BRIDGE_MIN_GAP_EM) && gap < em(C.BRIDGE_MAX_GAP_EM))) return null
    const a = xa - em(C.BRIDGE_INSET_EM)
    const b = xb + em(C.BRIDGE_INSET_EM)
    const xy: number[] = []
    for (let i = 0; i <= C.WALK_STEPS; i++) {
      const t = i / C.WALK_STEPS
      xy.push(a + (b - a) * t, y + em(C.BRIDGE_SAG_EM) * 4 * t * (1 - t))
    }
    return { raw: { xy, main: xy.length / 2 }, tier: "twig", gesture: "bridge", front: "never", parent: -1, parentS: 0, start, bloom: "none" }
  })
}

// ---- Growth points ------------------------------------------------------------------

// An ink pixel within GROWTH_BAND of the baseline, near the middle of a bottom stroke.
function pickGrowthPoint(rng: Rng, L: PlantLetter): GrowthPoint | null {
  const g = L.letter
  if (!g.ink) return null
  const band: { x: number; y: number }[] = []
  for (let y = Math.round(g.oy - em(C.GROWTH_BAND_EM)); y <= g.oy; y += 2)
    for (let x = g.inkLeft; x <= g.inkRight; x += 2) if (isSolid(g.ink, x, y) && isSolid(g.ink, x - 3, y) && isSolid(g.ink, x + 3, y)) band.push({ x, y })
  if (!band.length) return null
  const q = band[Math.floor(rng.next() * band.length)]
  return { x: L.x0 + q.x - g.ox, y: q.y - g.oy, owner: L }
}

function addGrowth(p: Plant, L: PlantLetter, start: number, seed: number) {
  const gp = pickGrowthPoint(createRng(hashSeed(seed, SALT.growth)), L)
  if (!gp) return
  p.growth.push(gp)
  growTrunk(p, gp, start, hashSeed(seed, 1))
}

// ---- Letters in and out ---------------------------------------------------------------

export function addLetter(p: Plant, host: Host, letter: Letter) {
  const prev = p.letters[p.letters.length - 1]
  const j = p.letters.length
  const x0 = prev ? prev.x0 + (advanceEm(prev.letter.char) + C.TRACKING_EM) * R : 0
  const L: PlantLetter = { host, letter, j, x0, dying: Infinity, cells: [] }
  L.cells = letterCells(L)
  p.letters.push(L)
  dirty(p)
  p.settledLen = -1
  const seed = hashSeed(p.seed, p.start, j, SALT.letter)
  const rng = createRng(seed)
  const t = tOf(p, L) + C.VINE_DELAY
  const at = () => t + rng.next() * C.VINE_STAGGER

  const last = p.growth[p.growth.length - 1]
  if (p.growth.length < C.GROWTH_MAX && (!last || j - last.owner.j >= p.growthGaps[(p.growth.length - 1) % p.growthGaps.length])) addGrowth(p, L, at(), hashSeed(seed, 1))
  if (j % C.HUG_EVERY === p.hugPhase) growHug(p, L, at(), hashSeed(seed, 2))
  if (prev) {
    const lastBridge = Math.max(-99, ...alive(p).filter((v) => v.gesture === "bridge").map((v) => v.owner.j))
    if (j - lastBridge >= p.bridgeEvery) growBridge(p, prev, L, at(), hashSeed(seed, 3))
  }
}

// Backspace: the last letter's stems (and everything they carry) start withering. Returns the
// clusters that should drop.
export function removeLetter(p: Plant, age: number) {
  const L = p.letters.pop()
  if (!L) return []
  L.dying = age
  p.gone.push(L)
  p.growth = p.growth.filter((g) => g.owner !== L)
  const ids = new Set<number>()
  for (const v of p.vines)
    if (!v.dead && v.dying === Infinity && (v.owner === L || ids.has(v.parent))) {
      v.dying = age
      ids.add(v.id)
    }
  dirty(p)
  p.settledLen = -1
  return p.clusters.filter((c) => ids.has(c.vine))
}

// Withered letters are gone for good.
export function finishWither(p: Plant, age: number) {
  let changed = false
  for (const v of p.vines)
    if (!v.dead && age - v.dying > C.WITHER_TOTAL_MS) {
      v.dead = true
      changed = true
    }
  p.gone = p.gone.filter((L) => age - L.dying <= C.WITHER_TOTAL_MS)
  if (changed) dirty(p)
}

// Once the word settles: top up growth points and drapes, then the arch and its hero bunch.
export function settle(p: Plant, now: number) {
  if (p.settledLen === p.letters.length || !p.letters.length) return false
  p.settledLen = p.letters.length
  const t = now - p.host0.birth
  const seed = hashSeed(p.seed, p.start, p.letters.length, SALT.settle)
  const rng = createRng(seed)
  if (p.letters.length >= C.GROWTH_MIN_LETTERS && p.growth.length < C.GROWTH_MIN) {
    // the letter farthest from the existing growth points
    const far = [...p.letters].sort((a, b) => dist(p, b) - dist(p, a))[0]
    if (far) addGrowth(p, far, t, hashSeed(seed, 1))
  }
  const trunks = alive(p).filter((v) => v.gesture === "trunk")
  for (let i = 0; i < 4 && count(p, "drape") < p.drapeTarget && trunks.length; i++) {
    const tr = trunks[Math.floor(rng.next() * trunks.length)]
    growDrape(p, tr.owner, tr, hashSeed(seed, 2, i), t)
  }
  if (!alive(p).some((v) => v.gesture === "arch")) growArch(p, t, hashSeed(seed, SALT.arch))
  return true
}
const dist = (p: Plant, L: PlantLetter) => Math.min(99, ...p.growth.map((g) => Math.abs(g.owner.j - L.j)))
