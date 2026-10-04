// A glyph's shape at 1 css px per cell: coverage, solid test, and an inside distance
// field (distance to the nearest empty pixel), plus edge points, normals and surface runs.

export type Mask = {
  w: number
  h: number
  cov: Uint8ClampedArray // antialiased coverage 0–255
  solid: Uint8Array
  dist: Float32Array // px to the nearest empty pixel; 0 outside
  maxDist: number
  area: number // solid pixel count
  cx: number // centroid
  cy: number
  top: number // ink bounds
  bottom: number
  left: number
  right: number
}

export type SurfacePoint = { x: number; y: number; nx: number; ny: number }

export function buildMask(draw: (ctx: CanvasRenderingContext2D) => void, w: number, h: number): Mask {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const ctx = c.getContext("2d", { willReadFrequently: true })!
  draw(ctx)
  const data = ctx.getImageData(0, 0, w, h).data
  const n = w * h
  const cov = new Uint8ClampedArray(n)
  const solid = new Uint8Array(n)
  let area = 0
  let sx = 0
  let sy = 0
  let top = h
  let bottom = 0
  let left = w
  let right = 0
  for (let i = 0; i < n; i++) {
    cov[i] = data[i * 4 + 3]
    if (cov[i] > 127) {
      solid[i] = 1
      area++
      const y = (i / w) | 0
      const x = i - y * w
      sx += x
      sy += y
      if (y < top) top = y
      if (y > bottom) bottom = y
      if (x < left) left = x
      if (x > right) right = x
    }
  }
  const dist = distanceField(solid, w, h)
  let maxDist = 0
  for (let i = 0; i < n; i++) if (dist[i] > maxDist) maxDist = dist[i]
  return {
    w,
    h,
    cov,
    solid,
    dist,
    maxDist,
    area,
    cx: area ? sx / area : w / 2,
    cy: area ? sy / area : h / 2,
    top,
    bottom,
    left,
    right,
  }
}

// Two-pass 3-4 chamfer transform. Pixels beyond the canvas count as `beyond` (0 = empty; pass a large value to treat them as far).
export function distanceField(solid: Uint8Array, w: number, h: number, beyond = 0) {
  const d = new Float32Array(w * h)
  const INF = 1e9
  for (let i = 0; i < d.length; i++) d[i] = solid[i] ? INF : 0
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? beyond : d[y * w + x])
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!d[i]) continue
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4)
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!d[i]) continue
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4)
    }
  for (let i = 0; i < d.length; i++) d[i] /= 3
  return d
}

export const isSolid = (m: Pick<Mask, "w" | "h" | "solid">, x: number, y: number) =>
  x >= 0 && y >= 0 && x < m.w && y < m.h && m.solid[y * m.w + x] === 1

// Bilinear distance sample at a fractional position.
export function distAt(m: Mask, x: number, y: number) {
  x -= 0.5
  y -= 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const g = (xi: number, yi: number) =>
    xi < 0 || yi < 0 || xi >= m.w || yi >= m.h ? 0 : m.dist[yi * m.w + xi]
  const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * fx
  const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * fx
  return a + (b - a) * fy
}

// Unit vector pointing deeper into the glyph, or null where the field is flat.
export function gradAt(m: Mask, x: number, y: number, h = 1.5) {
  const gx = distAt(m, x + h, y) - distAt(m, x - h, y)
  const gy = distAt(m, x, y + h) - distAt(m, x, y - h)
  const len = Math.hypot(gx, gy)
  return len < 1e-3 ? null : { x: gx / len, y: gy / len }
}

// Outward normal at an edge pixel: average offset toward empty pixels nearby.
export function normalAt(m: Mask, x: number, y: number, r = 4) {
  let nx = 0
  let ny = 0
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (!isSolid(m, x + dx, y + dy)) {
        nx += dx
        ny += dy
      }
  const len = Math.hypot(nx, ny)
  return len ? { x: nx / len, y: ny / len } : { x: 0, y: 0 }
}

// Top or bottom surfaces as runs of one point per column, linked across columns when
// they step by ≤1px. Only points whose normal faces up (top) / down (bottom) count.
export function surfaceRuns(m: Mask, side: "top" | "bottom", minNormal: number) {
  const dir = side === "top" ? -1 : 1
  const runs: SurfacePoint[][] = []
  let open: SurfacePoint[][] = []
  for (let x = 0; x < m.w; x++) {
    const next: SurfacePoint[][] = []
    for (let y = 0; y < m.h; y++) {
      if (!isSolid(m, x, y) || isSolid(m, x, y + dir)) continue
      const n = normalAt(m, x, y)
      if (n.y * dir < minNormal) continue
      const p = { x, y, nx: n.x, ny: n.y }
      let best = -1
      for (let k = 0; k < open.length; k++) {
        const last = open[k][open[k].length - 1]
        if (Math.abs(last.y - y) <= 1 && (best < 0 || Math.abs(last.y - y) < Math.abs(open[best][open[best].length - 1].y - y)))
          best = k
      }
      if (best >= 0) {
        const run = open.splice(best, 1)[0]
        run.push(p)
        next.push(run)
      } else next.push([p])
    }
    runs.push(...open)
    open = next
  }
  runs.push(...open)
  return runs
}

// Every solid pixel with an empty 4-neighbour, with its outward normal.
export function edgePoints(m: Mask): SurfacePoint[] {
  const out: SurfacePoint[] = []
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      if (!isSolid(m, x, y)) continue
      if (isSolid(m, x - 1, y) && isSolid(m, x + 1, y) && isSolid(m, x, y - 1) && isSolid(m, x, y + 1)) continue
      const n = normalAt(m, x, y)
      if (n.x || n.y) out.push({ x, y, nx: n.x, ny: n.y })
    }
  return out
}
