import * as C from "./config"
import type { Mask } from "./mask"

// Glyph skeleton -> smoothed spine polylines.
// Zhang-Suen thinning leaves the medial axis (the ridge of the distance field) as a 1px
// line; it's traced into edges between endpoints and junctions, short spurs are pruned,
// edges through plain junctions are merged, then each is simplified and Catmull-Rom smoothed.

export type Spine = {
  xy: number[] // smoothed polyline, x,y pairs
  closed: boolean
  freeStart: boolean // start / end are free tips (not junctions), where a terminal spiral goes
  freeEnd: boolean
}

type Edge = { pts: number[]; a: number; b: number } // a/b: node pixel index, -1 for loops

function thin(solid: Uint8Array, w: number, h: number) {
  const img = Uint8Array.from(solid)
  const del: number[] = []
  let changed = true
  while (changed) {
    changed = false
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x
          if (!img[i]) continue
          const p2 = img[i - w]
          const p3 = img[i - w + 1]
          const p4 = img[i + 1]
          const p5 = img[i + w + 1]
          const p6 = img[i + w]
          const p7 = img[i + w - 1]
          const p8 = img[i - 1]
          const p9 = img[i - w - 1]
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (B < 2 || B > 6) continue
          const A =
            (!p2 && p3 ? 1 : 0) + (!p3 && p4 ? 1 : 0) + (!p4 && p5 ? 1 : 0) + (!p5 && p6 ? 1 : 0) +
            (!p6 && p7 ? 1 : 0) + (!p7 && p8 ? 1 : 0) + (!p8 && p9 ? 1 : 0) + (!p9 && p2 ? 1 : 0)
          if (A !== 1) continue
          if (pass === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue
          del.push(i)
        }
      for (const i of del) img[i] = 0
      if (del.length) changed = true
    }
  }
  return img
}

const len = (pts: number[]) => {
  let l = 0
  for (let i = 2; i < pts.length; i += 2) l += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1])
  return l
}

function trace(sk: Uint8Array, w: number, h: number): Edge[] {
  const nb = (i: number) => {
    const out: number[] = []
    const x = i % w
    const y = (i / w) | 0
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && sk[ny * w + nx]) out.push(ny * w + nx)
      }
    return out
  }
  // node = endpoint (1 neighbour) or junction (3+ separate neighbour groups)
  const isNode = new Uint8Array(w * h)
  const nodes: number[] = []
  for (let i = 0; i < sk.length; i++) {
    if (!sk[i]) continue
    const x = i % w
    const y = (i / w) | 0
    const ring = [-w, -w + 1, 1, w + 1, w, w - 1, -1, -w - 1].map((o, k) => {
      const dx = [0, 1, 1, 1, 0, -1, -1, -1][k]
      const dy = [-1, -1, 0, 1, 1, 1, 0, -1][k]
      return x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h ? sk[i + o] : 0
    })
    const B = ring.reduce((s, v) => s + v, 0)
    let A = 0
    for (let k = 0; k < 8; k++) if (!ring[k] && ring[(k + 1) % 8]) A++
    if (B === 1 || A >= 3) {
      isNode[i] = 1
      nodes.push(i)
    }
  }

  // adjacent node pixels are one junction: union them so degrees count correctly
  const parent = new Map<number, number>()
  const find = (i: number): number => {
    let r = i
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  for (const n of nodes) parent.set(n, n)
  for (const n of nodes)
    for (const q of nb(n)) if (isNode[q] && q !== n) parent.set(find(q), find(n))

  const visited = new Uint8Array(w * h)
  const edges: Edge[] = []
  const gap = (a: number, b: number) => Math.hypot((a % w) - (b % w), ((a / w) | 0) - ((b / w) | 0))
  // At a staircase corner a pixel can have two onward neighbours that touch each other. Take
  // the one farthest from where we came from and consume the other, so the walk can't dead-end in it.
  const forward = (cands: number[], cur: number, prev: number) => {
    if (!cands.length) return undefined
    const next = cands.reduce((best, q) => (gap(q, prev) > gap(best, prev) ? q : best))
    for (const q of cands) if (q !== next && gap(q, next) < 1.5 && gap(q, cur) < 1.5) visited[q] = 1
    return next
  }
  const xy = (i: number) => [(i % w) + 0.5, ((i / w) | 0) + 0.5]
  for (const n of nodes) {
    for (const first of nb(n)) {
      if (isNode[first] || visited[first]) continue
      const pts = [...xy(n), ...xy(first)]
      visited[first] = 1
      let prev = n
      let cur = first
      let end = -1
      for (let guard = 0; guard < w * h; guard++) {
        const around = nb(cur).filter((q) => q !== prev)
        let next = around.find((q) => isNode[q] && (q !== n || pts.length > 8))
        if (next === undefined) next = forward(around.filter((q) => !isNode[q] && !visited[q]), cur, prev)
        if (next === undefined) break
        pts.push(...xy(next))
        if (isNode[next]) {
          end = next
          break
        }
        visited[next] = 1
        prev = cur
        cur = next
      }
      if (end >= 0) {
        const a = find(n)
        const b = find(end)
        // a short edge that starts and ends in the same junction cluster is just clutter
        if (a !== b || len(pts) > C.BRANCH_MIN_PX) edges.push({ pts, a, b })
      }
    }
  }
  // closed loops (a ring has no endpoints or junctions)
  for (let s = 0; s < sk.length; s++) {
    if (!sk[s] || isNode[s] || visited[s]) continue
    const pts = [...xy(s)]
    visited[s] = 1
    let cur = s
    for (let guard = 0; guard < w * h; guard++) {
      const next = forward(nb(cur).filter((q) => !isNode[q] && !visited[q]), cur, cur)
      if (next === undefined) break
      visited[next] = 1
      pts.push(...xy(next))
      cur = next
    }
    pts.push(pts[0], pts[1])
    if (len(pts) > C.SPINE_MIN_PX) edges.push({ pts, a: -1, b: -1 })
  }
  return edges
}

function degrees(edges: Edge[]) {
  const deg = new Map<number, number>()
  for (const e of edges)
    if (e.a >= 0) {
      deg.set(e.a, (deg.get(e.a) ?? 0) + 1)
      deg.set(e.b, (deg.get(e.b) ?? 0) + 1)
    }
  return deg
}

function reverse(pts: number[]) {
  const out: number[] = []
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1])
  return out
}

function rdp(xy: number[], eps: number): number[] {
  const n = xy.length / 2
  if (n < 3) return xy
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const ax = xy[a * 2]
    const ay = xy[a * 2 + 1]
    const dx = xy[b * 2] - ax
    const dy = xy[b * 2 + 1] - ay
    const L = Math.hypot(dx, dy) || 1
    let best = -1
    let bi = -1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((xy[i * 2] - ax) * dy - (xy[i * 2 + 1] - ay) * dx) / L
      if (d > best) {
        best = d
        bi = i
      }
    }
    if (best > eps) {
      keep[bi] = 1
      stack.push([a, bi], [bi, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(xy[i * 2], xy[i * 2 + 1])
  return out
}

// Uniform Catmull-Rom through the points, resampled about every SPLINE_STEP_PX.
function smooth(xy: number[], closed: boolean): number[] {
  const n = xy.length / 2
  const pt = (i: number) => {
    if (closed) i = ((i % (n - 1)) + (n - 1)) % (n - 1)
    else i = Math.max(0, Math.min(n - 1, i))
    return [xy[i * 2], xy[i * 2 + 1]]
  }
  const out: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const p0 = pt(i - 1)
    const p1 = pt(i)
    const p2 = pt(i + 1)
    const p3 = pt(i + 2)
    const steps = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / C.SPLINE_STEP_PX))
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      const t2 = t * t
      const t3 = t2 * t
      for (let c = 0; c < 2; c++)
        out.push(0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3))
    }
  }
  out.push(...pt(n - 1))
  return out
}

export function extractSpines(m: Mask): Spine[] {
  const sk = thin(m.solid, m.w, m.h)
  let edges = trace(sk, m.w, m.h)

  // prune spurs: a short edge with a free tip hanging off a junction
  for (let pass = 0; pass < 4; pass++) {
    const deg = degrees(edges)
    const keep = edges.filter((e) => {
      if (e.a < 0) return true
      const spur = (deg.get(e.a) === 1) !== (deg.get(e.b) === 1)
      if (!spur) return true
      // corner diagonals of a thick stem are ~0.7 x thickness long: prune relative to the stroke too
      const junction = deg.get(e.a) === 1 ? e.b : e.a
      const tip = deg.get(e.a) === 1 ? e.a : e.b
      const length = len(e.pts)
      if (length < C.BRANCH_MIN_PX) return false
      // a spur that runs out to the glyph edge (its tip is shallow) is a corner artifact;
      // a real stem end stops about half a stroke inside, so its tip stays deep
      const runsToEdge = m.dist[tip] < C.BRANCH_TIP_DEPTH * m.dist[junction]
      return !(runsToEdge && length < C.BRANCH_THICK_RATIO * 2 * m.dist[junction])
    })
    if (keep.length === edges.length) break
    edges = keep
  }

  // merge through nodes where only two edges meet
  for (let guard = 0; guard < 200; guard++) {
    const deg = degrees(edges)
    const node = [...deg].find(([n, d]) => d === 2 && edges.filter((e) => e.a === n || e.b === n).length === 2)
    if (!node) break
    const [n] = node
    const [e1, e2] = edges.filter((e) => e.a === n || e.b === n)
    const p1 = e1.b === n ? e1 : { pts: reverse(e1.pts), a: e1.b, b: e1.a }
    const p2 = e2.a === n ? e2 : { pts: reverse(e2.pts), a: e2.b, b: e2.a }
    const merged: Edge = { pts: [...p1.pts, ...p2.pts.slice(2)], a: p1.a, b: p2.b }
    edges = edges.filter((e) => e !== e1 && e !== e2)
    edges.push(merged)
  }

  const deg = degrees(edges)
  const spines: Spine[] = []
  for (const e of edges) {
    const closed = e.a < 0 || e.a === e.b
    if (len(e.pts) < C.SPINE_MIN_PX) continue
    let simple: number[]
    if (closed) {
      // a loop starts and ends at the same point, so split it at the farthest point first
      const n = e.pts.length / 2
      let far = 1
      let best = -1
      for (let i = 1; i < n; i++) {
        const d = Math.hypot(e.pts[i * 2] - e.pts[0], e.pts[i * 2 + 1] - e.pts[1])
        if (d > best) {
          best = d
          far = i
        }
      }
      const a = rdp(e.pts.slice(0, far * 2 + 2), C.SIMPLIFY_EPS_PX)
      const b = rdp(e.pts.slice(far * 2), C.SIMPLIFY_EPS_PX)
      simple = [...a, ...b.slice(2)]
    } else simple = rdp(e.pts, C.SIMPLIFY_EPS_PX)
    const xy = smooth(simple, closed)
    spines.push({
      xy,
      closed,
      freeStart: !closed && deg.get(e.a) === 1,
      freeEnd: !closed && deg.get(e.b) === 1,
    })
  }
  return spines
}
