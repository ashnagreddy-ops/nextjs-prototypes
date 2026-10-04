import * as C from "./config"
import { type Cluster, makeCluster } from "./bracts"
import { clamp, rad } from "./ease"
import { type Letter, dOutAt } from "./glyph"
import { isSolid } from "./mask"
import { type Rng, createRng, hashSeed, valueNoise } from "./rng"
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

export type Gesture = "trunk" | "climb" | "arch" | "drape" | "twig" | "hug" | "bridge" | "bunch"
export type Bloom = "none" | "small" | "medium" | "hero"
export type Rule = "reach" | "self" | "parallel" | "front" | "calm" | "skipped"
export type ArchRule = Exclude<Rule, "skipped"> | "climb" | "landing" | "span" | "top" | "fallback"

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
  width: number // at the root...
  tipWidth: number // ...tapering linearly to this at the tip
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

// What the debug view draws for the arch, in word coords.
export type ArchDebug = {
  owner: PlantLetter // the support glyph
  box: [number, number, number, number] // support's ink box x0, y0, x1, y1
  capY: number // crest cap line
  root: { x: number; y: number }
  bunch: { x: number; y: number } // estimated main-bunch centre...
  ink: { x: number; y: number } // ...and the nearest ink it lands against
}

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
  archRejected: Record<ArchRule, number>
  archDebug: ArchDebug | null
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
    archRejected: { reach: 0, self: 0, parallel: 0, front: 0, calm: 0, climb: 0, landing: 0, span: 0, top: 0, fallback: 0 },
    archDebug: null,
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
  ignore?: number[] // stem ids the parallel check skips (a bunch and its parent; the arch and the hug it replaces)
  calm?: boolean // false: exempt from the calm rule (the arch and hero bunch)
  width?: number // root width (default: the tier's), and tip width (default: TAPER_TIP of it)
  tipWidth?: number
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
      if (d.ignore?.includes(o.id)) continue
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

  const width = d.width ?? widthOf(d.tier)
  const flex = C.FLEX[d.gesture]
  return {
    v: {
      ...ch,
      width,
      tipWidth: d.tipWidth ?? width * C.TAPER_TIP,
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
    return commit(p, r.v, owner, clusters, cells)
  }
  p.rejected.skipped++
  return null
}

function commit(p: Plant, b: Built, owner: PlantLetter, clusters: Cluster[], cells = frontCells(b, clusters)): Vine {
  const v: Vine = { ...b, id: p.vines.length, owner, dying: Infinity, dead: false, cells }
  p.vines.push(v)
  p.clusters.push(...clusters)
  refresh(p)
  for (const q of v.samples) p.occ!.add(q)
  for (const k of cells) p.covered!.add(k)
  return v
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

// BUNCH: drooping sub-stem with clusters on fanned stalks, hanging from arc length `s` of a parent.
type BunchSpec = {
  s: number
  stem: readonly [number, number] // sub-stem length range, px
  count: readonly [number, number]
  kind: Cluster["kind"]
  stalk: number // px
  bloom: Bloom
  calm: boolean
  start: number
  maxAcross?: number // px: shrink the clusters so the bunch stays this narrow
}

// The tip bunch of a drape: medium, or the hero when a drape stands in for the arch.
const tipBunch = (p: Plant, parent: Vine, kind: "hero" | "medium"): BunchSpec => {
  const hero = kind === "hero"
  return {
    s: parent.length,
    stem: (hero ? C.HERO_STEM_EM : C.MEDIUM_STEM_EM).map(em) as [number, number],
    count: hero ? p.style.heroBunch : p.style.bunch,
    kind: hero ? "hero" : "normal",
    stalk: em(C.BUNCH_STALK_EM) * (hero ? 1 : C.MEDIUM_STALK),
    bloom: kind,
    calm: !hero,
    start: parent.start + parent.duration * 0.92,
  }
}

function scaleCluster(c: Cluster, f: number) {
  c.len *= f
  for (const br of c.bracts) br.len *= f
  for (const fl of c.flowers) fl.len *= f
}

function growBunch(p: Plant, owner: PlantLetter, parent: Vine, b: BunchSpec, seed: number) {
  return grow(
    p,
    owner,
    seed,
    (rng) => {
      const q = sampleAt(parent, b.s)
      const L = rng.range(b.stem[0], b.stem[1])
      const lean = Math.cos(q.angle) >= 0 ? 1 : -1 // continue slightly the way the parent travels
      const c: Curve = { k0: -lean * 0.25, k1: 0, g: C.DRAPE_GRAVITY }
      return {
        raw: walk(q.x, q.y, DOWN - lean * 0.35, L, c),
        tier: "twig",
        gesture: "bunch",
        front: "auto",
        parent: parent.id,
        parentS: b.s,
        start: b.start,
        bloom: b.bloom,
        ignore: [parent.id],
        calm: b.calm,
      }
    },
    (rng, v, id) => {
      const n = randInt(rng, b.count)
      const out: Cluster[] = []
      let side = rng.sign()
      for (let j = 0; j < n; j++) {
        const u = n === 1 ? 1 : C.BUNCH_FROM + ((1 - C.BUNCH_FROM) * j) / (n - 1)
        const s = u * v.length
        out.push(
          cluster(p, rng, v, id, s, b.kind, tipPasses(v, s) + C.CLUSTER_GAP_MS + j * C.BUNCH_STAGGER_MS, {
            stalk: b.stalk,
            stalkAngle: j === n - 1 ? 0 : (side = -side) * rad(rng.range(C.BUNCH_STALK_DEG_MIN, C.BUNCH_STALK_DEG_MAX)),
          })
        )
      }
      if (b.maxAcross) {
        // widest reach either side: a fanned stalk plus a bract from its centre
        const reach = b.stalk * Math.sin(rad(C.BUNCH_STALK_DEG_MAX))
        const len = Math.max(...out.map((c) => c.len)) * (1 + C.BRACT_BASE_OFFSET)
        if (2 * (reach + len) > b.maxAcross) {
          const f = clamp((b.maxAcross / 2 - reach) / len, 0.5, 1)
          for (const c of out) scaleCluster(c, f)
        }
      }
      return out
    }
  )
}

// DRAPE: leaves a trunk outward and falls under gravity; ends in a medium bunch (two per word)
// or a twig; carries twigs of its own.
function growDrape(p: Plant, owner: PlantLetter, trunk: Vine, seed: number, minStart = -Infinity, hero = false) {
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
      const medium = !hero && alive(p).filter((o) => o.bloom === "medium").length < C.MEDIUM_BUNCHES && canBloom(p)
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
  const tip = hero ? "hero" : v.bloom === "medium" ? "medium" : null
  v.bloom = "none" // the bunch stem carries it
  if (!tip || !growBunch(p, owner, v, tipBunch(p, v, tip), hashSeed(seed, 8))) growTwigAtTip(p, owner, v, hashSeed(seed, 9))
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

// Follow a glyph's outline upward `offset` outside its ink (the iso-line of the outside distance
// field), starting beside the outermost ink near the baseline on `side`. Stops above topY, at
// maxLen, or where the outline turns back down, and keeps the run up to its highest point.
// Mask px; `ink` is the baseline ink pixel it started beside.
function traceOutline(g: Letter, side: number, offset: number, maxLen: number, topY: number) {
  let sx = NaN
  let sy = 0
  let ix = 0
  for (let dy = 0; dy < em(0.15) && isNaN(sx); dy += 2) {
    const y = Math.round(g.oy - em(C.HUG_START_EM) - dy)
    for (let i = 0; i <= g.inkRight - g.inkLeft; i++) {
      const x = side < 0 ? g.inkLeft + i : g.inkRight - i
      if (isSolid(g.ink!, x, y)) {
        ix = x + 0.5
        sx = ix + side * offset
        sy = y + 0.5
        break
      }
    }
  }
  if (isNaN(sx)) return null
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
  if (pts.length < 4) return null
  return { pts, len: (best - 1) * C.HUG_STEP_PX, ink: { x: ix - side * C.ARCH_ROOT_INSET_PX, y: sy } }
}

// Mask px -> word coords, thinned to about WALK_STEPS knots for the spline.
function toWord(L: PlantLetter, pts: number[]) {
  const g = L.letter
  const every = Math.max(1, Math.round(pts.length / 2 / C.WALK_STEPS))
  const out: number[] = []
  for (let i = 0; i < pts.length / 2; i += every) out.push(L.x0 + pts[i * 2] - g.ox, pts[i * 2 + 1] - g.oy)
  return out
}

// A stem following an outline stays clear of the stroke: at most HUG_MAX_STROKE_COVER of its
// width may sit over the ink.
const outlineOffset = (width: number) => Math.max(em(C.HUG_OFFSET_EM), width / 2 - C.HUG_MAX_STROKE_COVER * width)

// HUG: from just above the baseline, follow the glyph's outline upward, in front; ends in a small
// bloom or a leaf pair.
function growHug(p: Plant, L: PlantLetter, start: number, seed: number) {
  const g = L.letter
  if (!g.ink || !g.dOut) return null
  const offset = outlineOffset(widthOf("branch"))
  return grow(
    p,
    L,
    seed,
    (rng) => {
      const tr = traceOutline(g, rng.sign(), offset, em(rng.range(C.HUG_LENGTH_EM[0], C.HUG_LENGTH_EM[1])), g.inkTop + em(C.HUG_TOP_EM))
      if (!tr || tr.len < em(C.HUG_MIN_EM)) return null
      const out = toWord(L, tr.pts)
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

// ---- Arch ------------------------------------------------------------------------------
// One continuous vine in three phases, built as two stems so each phase can sit on its own
// layer: CLIMB (in front) hugs the support glyph's outline up from its baseline ink; the second
// stem continues from its tip (no knot) with the CREST, capped ARCH_CREST_CAP_EM above the
// support's top, and the SPILL down the far side, trimmed so the main bunch rests against ink.

const TAU = Math.PI * 2
const posMod = (a: number, m: number) => ((a % m) + m) % m
const inkMid = (L: PlantLetter) => L.x0 + (L.letter.inkLeft + L.letter.inkRight) / 2 - L.letter.ox

function wordCentre(p: Plant) {
  const first = p.letters[0]
  const last = p.letters[p.letters.length - 1]
  return (first.x0 + first.letter.inkLeft - first.letter.ox + last.x0 + last.letter.inkRight - last.letter.ox) / 2
}

// An ascender nearest the word's centre, else the tallest letter.
function pickSupport(p: Plant) {
  const inked = p.letters.filter((L) => L.letter.ink && L.letter.dOut)
  if (!inked.length) return null
  const centre = wordCentre(p)
  const asc = inked.filter((L) => C.ARCH_ASCENDERS.includes(L.letter.char))
  if (asc.length) return asc.sort((a, b) => Math.abs(inkMid(a) - centre) - Math.abs(inkMid(b) - centre))[0]
  // tallest, ties (within a few px) going to the one nearest the centre
  const top = (L: PlantLetter) => Math.round((L.letter.inkTop - L.letter.oy) / 4)
  return inked.sort((a, b) => top(a) - top(b) || Math.abs(inkMid(a) - centre) - Math.abs(inkMid(b) - centre))[0]
}

// The middle of a letter's topmost ink, word coords.
function topInk(L: PlantLetter) {
  const g = L.letter
  let sum = 0
  let n = 0
  for (let y = g.inkTop; y <= g.inkTop + 3; y++)
    for (let x = g.inkLeft; x <= g.inkRight; x++)
      if (isSolid(g.ink!, x, y)) {
        sum += x
        n++
      }
  return n ? { x: L.x0 + sum / n - g.ox, y: g.inkTop - g.oy } : null
}

// Is any of L's ink within r of word point (x, y)?
function touches(L: PlantLetter, x: number, y: number, r: number) {
  const g = L.letter
  const cx = x - L.x0 + g.ox
  const cy = y + g.oy
  if (cx < g.inkLeft - r || cx > g.inkRight + r || cy < g.inkTop - r || cy > g.inkBottom + r) return false
  for (let dy = -r; dy <= r; dy += 1.5) for (let dx = -r; dx <= r; dx += 1.5) if (dx * dx + dy * dy <= r * r && isSolid(g.ink!, Math.floor(cx + dx), Math.floor(cy + dy))) return true
  return false
}

// Nearest ink to (x, y) within +/-tx, +/-ty, word coords.
function nearestInk(p: Plant, x: number, y: number, tx: number, ty: number) {
  let best: { x: number; y: number } | null = null
  let bd = Infinity
  for (const L of p.letters) {
    const g = L.letter
    if (!g.ink) continue
    const x0 = Math.max(g.inkLeft, Math.floor(x - tx - L.x0 + g.ox))
    const x1 = Math.min(g.inkRight, Math.ceil(x + tx - L.x0 + g.ox))
    const y0 = Math.max(g.inkTop, Math.floor(y - ty + g.oy))
    const y1 = Math.min(g.inkBottom, Math.ceil(y + ty + g.oy))
    for (let my = y0; my <= y1; my += 2)
      for (let mx = x0; mx <= x1; mx += 2) {
        if (!isSolid(g.ink, mx, my)) continue
        const wx = L.x0 + mx - g.ox
        const wy = my - g.oy
        const d = Math.hypot(wx - x, wy - y)
        if (d < bd) {
          bd = d
          best = { x: wx, y: wy }
        }
      }
  }
  return best
}

// Leaves along both phases: from ARCH_LEAF_FROM of the length, alternating sides (outward only
// on the climb, so they don't cover the support), larger near the crest, in pairs near the bunch.
function archLeaves(rng: Rng, p: Plant, climb: Built, crest: Built, side: number, crestAt: number) {
  const total = climb.length + crest.length
  const pairsFrom = total - em(C.ARCH_LEAF_BUNCH_EM)
  let sd = rng.sign()
  for (let s = C.ARCH_LEAF_FROM * total; s < total - em(0.015); ) {
    const onClimb = s < climb.length
    const v = onClimb ? climb : crest
    const ls = onClimb ? s : s - climb.length
    const a = sampleAt(v, ls).angle
    const size = p.style.leafSize * (1 + C.ARCH_LEAF_CREST_BOOST * Math.exp(-(((s - crestAt) / em(C.ARCH_LEAF_CREST_RANGE_EM)) ** 2)))
    const pair = s >= pairsFrom
    sd = -sd
    let sides = pair ? [1, -1] : [sd]
    if (onClimb) sides = [Math.sign(Math.cos(a + 0.8)) === side ? 1 : -1]
    for (const k of sides) v.leaves.push(leafAt(rng, v, ls, a + k * rad(rng.range(C.LEAF_ANGLE_MIN_DEG, C.LEAF_ANGLE_MAX_DEG)), size))
    s += pair ? em(C.ARCH_LEAF_BUNCH_SPACING_EM) : em(C.ARCH_LEAF_SPACING_EM) * (1 + C.ARCH_LEAF_JITTER * rng.range(-1, 1))
  }
}

// A short side twig off the crest/spill, on the outer side of the curve, ending in a small
// cluster or a leaf pair.
function growArchTwig(p: Plant, owner: PlantLetter, parent: Vine, s: number, seed: number) {
  return grow(
    p,
    owner,
    seed,
    (rng) => {
      const { heading, outer } = childHeading(rng, parent, s)
      const q = sampleAt(parent, s)
      const L = em(rng.range(C.ARCH_TWIG_LENGTH_EM[0], C.ARCH_TWIG_LENGTH_EM[1]))
      return {
        raw: walk(q.x, q.y, heading, L, curve(rng, C.TWIG_CURVE, C.TWIG_GRAVITY * p.style.gravity, outer)),
        tier: "twig",
        gesture: "twig",
        front: "auto",
        parent: parent.id,
        parentS: s,
        start: tipPasses(parent, s),
        bloom: canBloom(p) && rng.next() < C.ARCH_TWIG_BLOOM_CHANCE ? "small" : "none",
      }
    },
    (rng, v, id) => {
      if (v.bloom === "small") return [cluster(p, rng, v, id, v.length, "small", tipPasses(v, v.length) + C.CLUSTER_GAP_MS)]
      const a = sampleAt(v, v.length).angle
      for (const sd of [-1, 1]) v.leaves.push(leafAt(rng, v, v.length, a + sd * rad(C.LEAF_TIP_PAIR_DEG), p.style.leafSize))
      return []
    }
  )
}

// topLimit: word y nothing may rise above (ARCH_TOP_MARGIN_VH of the viewport).
function growArch(p: Plant, start: number, seed: number, topLimit: number) {
  const S = pickSupport(p)
  if (!S) return null
  const g = S.letter
  const W = em(C.BASE_WIDTH_EM)
  const sTop = g.inkTop - g.oy
  const capY = Math.max(sTop - em(C.ARCH_CREST_CAP_EM), topLimit)
  const centre = wordCentre(p)
  const left = p.letters[S.j - 1]
  const right = p.letters[S.j + 1]
  // spill toward a neighbour, preferring the word's middle
  const dir0 = left && right ? (inkMid(S) <= centre ? 1 : -1) : right ? 1 : left ? -1 : createRng(seed).sign()
  const offset = outlineOffset(W * C.ARCH_ROOT_WIDTH)
  const rej = (r: ArchRule) => p.archRejected[r]++

  for (let t = 0; t < C.ARCH_TRIES; t++) {
    const rng = createRng(hashSeed(seed, SALT.attempt, t))
    const dir = (t % 2 === 0 ? dir0 : -dir0) as 1 | -1 // flip sides on alternate tries...
    const shorten = 1 - C.ARCH_SHORTEN * Math.floor(t / 2) // ...and shorten the spill on later ones
    const side = -dir // climb the side away from the spill

    // CLIMB: from the baseline ink up the outline, stopping short of the cap
    const climbTop = Math.max(g.inkTop + em(C.ARCH_CLIMB_TOP_EM), capY + g.oy + em(0.04))
    const tr = traceOutline(g, side, offset, em(2), climbTop)
    if (!tr) {
      rej("climb")
      continue
    }
    // the climb may only be in front of its support: stop it just short of a neighbour's ink
    // (tight tracking), and let the crest carry on from there behind the type
    const traced = [S.x0 + tr.ink.x - g.ox, tr.ink.y - g.oy, ...toWord(S, tr.pts)]
    const reach = (W * C.ARCH_ROOT_WIDTH) / 2 + C.ARCH_NEIGHBOUR_CLEAR_PX
    let keep = traced.length / 2
    for (let i = 1; i < traced.length / 2 && keep === traced.length / 2; i++)
      for (const L of p.letters)
        if (L !== S && L.letter.ink && touches(L, traced[i * 2], traced[i * 2 + 1], reach)) {
          keep = i
          break
        }
    const climbXY = traced.slice(0, keep * 2)
    const n = climbXY.length / 2
    if (n < 4 || Math.hypot(climbXY[(n - 1) * 2] - climbXY[0], climbXY[(n - 1) * 2 + 1] - climbXY[1]) < em(C.ARCH_CLIMB_MIN_EM)) {
      rej("climb")
      continue
    }
    const back = Math.max(0, n - 4)
    const tipX = climbXY[(n - 1) * 2]
    const tipY = climbXY[(n - 1) * 2 + 1]
    const h0 = Math.atan2(tipY - climbXY[back * 2 + 1], tipX - climbXY[back * 2])

    // CREST + SPILL: one bend from the climb's heading round to (nearly) straight down on the
    // far side, sharpest early (steep climb side, long spill), with low-frequency noise
    const full = dir > 0 ? posMod(DOWN - h0, TAU) : -posMod(h0 - DOWN, TAU)
    if (Math.abs(full) > Math.PI * 1.25) {
      rej("climb") // the climb ended heading away from the spill
      continue
    }
    const turn = full * rng.range(C.ARCH_TURN[0], C.ARCH_TURN[1])
    const b = (1 - C.ARCH_CREST_PEAK) / C.ARCH_CREST_PEAK // u (1-u)^b peaks at ARCH_CREST_PEAK
    const noise = valueNoise(rng, 16)
    const phase = rng.range(0, 16)
    const prof = (u: number) => u * Math.pow(1 - u, b) * (1 + C.ARCH_CURVE_NOISE * noise(phase + u * C.ARCH_NOISE_CELLS))
    let area = 0
    for (let i = 0; i < C.WALK_STEPS; i++) area += prof((i + 0.5) / C.WALK_STEPS) / C.WALK_STEPS
    // the bend scales with its length: size it so the crest stays under the cap
    const bendUnit = walk(0, 0, h0, 1, { k0: 0, k1: 0, g: 0, k: (u) => (turn * prof(u)) / area }).xy
    let riseU = 0
    for (let i = 1; i < bendUnit.length; i += 2) riseU = Math.max(riseU, -bendUnit[i])
    const room = tipY - capY
    if (room < em(0.01)) {
      rej("top")
      continue
    }
    const Lb = Math.min(em(rng.range(C.ARCH_LENGTH_EM[0], C.ARCH_LENGTH_EM[1])), riseU > 1e-3 ? room / riseU : Infinity)
    // then the spill carries on down the far side (the longer side), to be trimmed where it lands
    const L = Lb + em(rng.range(C.ARCH_SPILL_EXTRA_EM[0], C.ARCH_SPILL_EXTRA_EM[1])) * shorten
    const c: Curve = { k0: 0, k1: 0, g: 0, k: (u) => (u * L < Lb ? ((turn * prof((u * L) / Lb)) / area) * (L / Lb) : 0) }
    const w = walk(tipX, tipY, h0, L, c).xy
    let iCrest = 0
    for (let i = 0; i < w.length / 2; i++) if (w[i * 2 + 1] < w[iCrest * 2 + 1]) iCrest = i

    // SPILL: trim it where the main bunch would rest against ink, nearest the neighbour's top
    const stemLen = em(rng.range(C.ARCH_BUNCH_STEM_EM[0], C.ARCH_BUNCH_STEM_EM[1]))
    const hang = stemLen * 0.7 + em(C.HERO_LENGTH_MAX_EM) * 0.6 // bunch centre below the spill's tip
    const N = p.letters[S.j + dir]
    const target = N?.letter.ink ? topInk(N) : null
    const minI = iCrest + Math.ceil(em(C.ARCH_SPILL_MIN_EM) / (L / C.WALK_STEPS))
    let pick: { i: number; score: number; x: number; y: number; ink: { x: number; y: number } } | null = null
    for (let i = minI; i < w.length / 2; i++) {
      const x = w[i * 2]
      const y = w[i * 2 + 1] + hang
      const ink = nearestInk(p, x, y, em(C.ARCH_LAND_X_EM), em(C.ARCH_LAND_Y_EM))
      if (!ink) continue
      const score = target ? Math.hypot(x - target.x, y - target.y) : Math.hypot(x - ink.x, y - ink.y)
      if (!pick || score < pick.score) pick = { i, score, x, y, ink }
    }
    if (!pick) {
      rej("landing")
      continue
    }
    const crestXY = w.slice(0, (pick.i + 1) * 2)

    // total span, the bunch included
    const xs = [...climbXY, ...crestXY].filter((_, k) => k % 2 === 0)
    const halfBunch = em(C.ARCH_BUNCH_MAX_ACROSS_EM) / 2
    if (Math.max(...xs, pick.x + halfBunch) - Math.min(...xs, pick.x - halfBunch) > em(C.ARCH_SPAN_MAX_EM)) {
      rej("span")
      continue
    }

    const idClimb = p.vines.length
    // the arch takes over any hug on its support
    const hugs = alive(p).filter((v) => v.gesture === "hug" && v.owner === S)
    const ignore = hugs.map((v) => v.id)
    const cj = judge(p, { raw: { xy: climbXY, main: n }, tier: "trunk", gesture: "climb", front: "must", parent: -1, parentS: 0, start, bloom: "none", calm: false, ignore }, idClimb)
    if ("rule" in cj) {
      rej(cj.rule === "skipped" ? "climb" : cj.rule)
      continue
    }
    const climb = cj.v
    const sj = judge(
      p,
      {
        raw: { xy: crestXY, main: crestXY.length / 2 },
        tier: "trunk",
        gesture: "arch",
        front: "never",
        parent: idClimb,
        parentS: climb.length,
        start: climb.start + climb.duration, // the crest follows the climb
        bloom: "none",
        ignore: [idClimb, ...ignore],
        calm: false,
      },
      idClimb + 1
    )
    if ("rule" in sj) {
      rej(sj.rule === "skipped" ? "climb" : sj.rule)
      continue
    }
    const crest = sj.v
    // one taper over both phases: ARCH_ROOT_WIDTH at the root to ARCH_TIP_WIDTH at the bunch
    const total = climb.length + crest.length
    climb.width = W * C.ARCH_ROOT_WIDTH
    climb.tipWidth = crest.width = W * (C.ARCH_ROOT_WIDTH + ((C.ARCH_TIP_WIDTH - C.ARCH_ROOT_WIDTH) * climb.length) / total)
    crest.tipWidth = W * C.ARCH_TIP_WIDTH
    const crestS = (crest.length * iCrest) / Math.max(1, pick.i) // the walk's steps are evenly spaced
    archLeaves(rng, p, climb, crest, side, climb.length + crestS)
    for (const h of hugs) h.dying = start // they wither as the climb comes up
    if (hugs.length) dirty(p)
    commit(p, climb, S, [])
    const sv = commit(p, crest, S, [])

    // main bunch at the tip, opening last; a smaller one partway down the spill
    const spillAt = crestS + C.ARCH_SECOND_AT * (crest.length - crestS)
    growBunch(
      p,
      S,
      sv,
      { s: sv.length, stem: [stemLen, stemLen], count: C.ARCH_BUNCH, kind: "hero", stalk: em(C.BUNCH_STALK_EM), bloom: "hero", calm: false, start: sv.start + sv.duration * 0.92, maxAcross: em(C.ARCH_BUNCH_MAX_ACROSS_EM) },
      hashSeed(seed, SALT.bunch)
    )
    growBunch(
      p,
      S,
      sv,
      {
        s: spillAt,
        stem: C.ARCH_SECOND_STEM_EM.map(em) as [number, number],
        count: C.ARCH_SECOND_BUNCH,
        kind: "normal",
        stalk: em(C.ARCH_SECOND_STALK_EM),
        bloom: "none",
        calm: false,
        start: tipPasses(sv, spillAt),
      },
      hashSeed(seed, SALT.bunch, 2)
    )

    // side twigs: one on the spill, the rest anywhere along the crest
    const twigs = randInt(rng, C.ARCH_TWIGS)
    const spots: number[] = []
    const gap = em(C.ARCH_TWIG_GAP_EM)
    const ok = (s: number) => spots.every((o) => Math.abs(o - s) >= gap) && Math.abs(s - spillAt) >= gap && s < sv.length - em(C.ARCH_LEAF_BUNCH_EM)
    const spillFrom = crestS + 0.2 * (sv.length - crestS)
    const spillTo = crestS + 0.75 * (sv.length - crestS)
    for (let k = 0; k < 20 && !spots.length; k++) {
      const s = rng.range(spillFrom, spillTo)
      if (ok(s)) spots.push(s)
    }
    for (let k = 0; k < 30 && spots.length < twigs; k++) {
      const s = rng.range(0.1 * sv.length, spillTo)
      if (ok(s)) spots.push(s)
    }
    spots.forEach((s, i) => growArchTwig(p, S, sv, s, hashSeed(seed, 40 + i)))

    p.archDebug = {
      owner: S,
      box: [S.x0 + g.inkLeft - g.ox, sTop, S.x0 + g.inkRight - g.ox, g.inkBottom - g.oy],
      capY,
      root: { x: climbXY[0], y: climbXY[1] },
      bunch: { x: pick.x, y: pick.y },
      ink: pick.ink,
    }
    return sv
  }

  // no candidate landed: a drape carries the hero bunch instead
  rej("fallback")
  const trunks = alive(p).filter((v) => v.gesture === "trunk")
  if (!trunks.length) return null
  const tr = trunks[Math.floor(createRng(hashSeed(seed, 98)).next() * trunks.length)]
  return growDrape(p, tr.owner, tr, hashSeed(seed, 99), start, true)
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
  if (p.archDebug?.owner === L) p.archDebug = null
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
// topLimit: word y the arch may not rise above (from the viewport's top margin).
export function settle(p: Plant, now: number, topLimit = -Infinity) {
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
  if (!alive(p).some((v) => v.bloom === "hero")) growArch(p, t, hashSeed(seed, SALT.arch), topLimit)
  return true
}
const dist = (p: Plant, L: PlantLetter) => Math.min(99, ...p.growth.map((g) => Math.abs(g.owner.j - L.j)))
