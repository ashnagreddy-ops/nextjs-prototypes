import * as C from "./config"
import { type Mask, isSolid, surfaceRuns } from "./mask"
import type { Rng } from "./rng"
import { rgba } from "./color"

export type SnowCap = {
  xs: Float32Array // one sample per ~2px along an upward-facing edge
  ys: Float32Array
  hs: Float32Array // target mound height at each sample
  top: number // bounds for the shading gradient
  bottom: number
  start: number
  duration: number
}

// A soft mound on each upward-facing run: full in the middle, thin at the ends,
// a little lumpy, and never taller than the free space above it.
export function buildSnow(rng: Rng, m: Mask, fs: number): SnowCap[] {
  const caps: SnowCap[] = []
  const runs = surfaceRuns(m, "top", C.SNOW_NORMAL_MIN).filter((r) => r.length >= C.SNOW_MIN_RUN_EM * fs)
  for (const run of runs) {
    const H = Math.min(fs * rng.range(C.SNOW_HEIGHT_MIN_EM, C.SNOW_HEIGHT_MAX_EM), run.length * C.SNOW_MAX_ASPECT)
    const f1 = rng.range(6, 12)
    const f2 = rng.range(14, 24)
    const ph1 = rng.range(0, Math.PI * 2)
    const ph2 = rng.range(0, Math.PI * 2)
    const step = 2
    const n = Math.max(2, Math.floor((run.length - 1) / step) + 1)
    const xs = new Float32Array(n)
    const ys = new Float32Array(n)
    const hs = new Float32Array(n)
    let top = Infinity
    let bottom = -Infinity
    for (let k = 0; k < n; k++) {
      const p = run[Math.min(run.length - 1, k * step)]
      const u = k / (n - 1)
      const bump = 1 + C.SNOW_BUMPINESS * (0.6 * Math.sin(u * f1 + ph1) + 0.4 * Math.sin(u * f2 + ph2))
      let h = H * Math.pow(Math.sin(Math.PI * u), C.SNOW_PROFILE_POWER) * bump
      let free = 0
      while (free < h + 2 && p.y - free - 1 >= 0 && !isSolid(m, p.x, p.y - free - 1)) free++
      h = Math.max(0, Math.min(h, free - 1))
      xs[k] = p.x + 0.5
      ys[k] = p.y
      hs[k] = h
      top = Math.min(top, p.y - h)
      bottom = Math.max(bottom, p.y)
    }
    caps.push({
      xs,
      ys,
      hs,
      top,
      bottom: bottom + C.SNOW_OVERLAP_PX,
      start: C.SNOW_DELAY + rng.range(0, C.SNOW_STAGGER),
      duration: rng.range(C.SNOW_DURATION_MIN, C.SNOW_DURATION_MAX),
    })
  }
  return caps
}

export function drawSnow(ctx: CanvasRenderingContext2D, cap: SnowCap, p: number) {
  if (p <= 0) return
  const { xs, ys, hs } = cap
  const n = xs.length
  const grad = ctx.createLinearGradient(0, cap.top, 0, cap.bottom)
  grad.addColorStop(0, rgba(C.SNOW_COLOR, C.SNOW_ALPHA))
  grad.addColorStop(1, rgba(C.SNOW_SHADE, C.SNOW_ALPHA))
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.moveTo(xs[0], ys[0] - hs[0] * p)
  // smooth top through sample midpoints
  for (let k = 1; k < n - 1; k++) {
    const mx = (xs[k] + xs[k + 1]) / 2
    const my = (ys[k] - hs[k] * p + ys[k + 1] - hs[k + 1] * p) / 2
    ctx.quadraticCurveTo(xs[k], ys[k] - hs[k] * p, mx, my)
  }
  ctx.lineTo(xs[n - 1], ys[n - 1] - hs[n - 1] * p)
  for (let k = n - 1; k >= 0; k--) ctx.lineTo(xs[k], ys[k] + C.SNOW_OVERLAP_PX)
  ctx.closePath()
  ctx.fill()
}
