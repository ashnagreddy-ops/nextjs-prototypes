import * as C from "./config"
import { rgba } from "./color"
import { type Mask, isSolid, surfaceRuns } from "./mask"
import { type Rng, valueNoise } from "./rng"
import { clamp } from "./stroke"

export type SnowCap = {
  xs: Float32Array // one sample per ~2px along an upward-facing edge
  ys: Float32Array
  hs: Float32Array // target drift height at each sample
  sparkles: { k: number; lift: number; r: number }[] // sample index, height above the drift top
  start: number
  duration: number
}

// A white drift on each upward-facing run: thickness varies 3-10px with seeded noise,
// thin at the ends, never taller than the free space above it.
export function buildSnow(rng: Rng, m: Mask, fs: number): SnowCap[] {
  const caps: SnowCap[] = []
  const noise = valueNoise(rng)
  const sc = clamp(fs / C.STROKE_REF_FONT_PX, 0.6, 1.6)
  const runs = surfaceRuns(m, "top", C.SNOW_NORMAL_MIN).filter((r) => r.length >= C.SNOW_MIN_RUN_EM * fs)
  for (const run of runs) {
    const off = rng.range(0, 64)
    const step = 2
    const n = Math.max(2, Math.floor((run.length - 1) / step) + 1)
    const xs = new Float32Array(n)
    const ys = new Float32Array(n)
    const hs = new Float32Array(n)
    for (let k = 0; k < n; k++) {
      const p = run[Math.min(run.length - 1, k * step)]
      const u = k / (n - 1)
      const nz = 0.5 + 0.5 * noise(off + (k * step) / (C.SNOW_NOISE_WAVELEN_EM * fs))
      const thick = (C.SNOW_MIN_PX + (C.SNOW_MAX_PX - C.SNOW_MIN_PX) * nz) * sc
      let h = Math.min(thick, run.length * C.SNOW_MAX_ASPECT) * Math.pow(Math.sin(Math.PI * u), C.SNOW_PROFILE_POWER)
      let free = 0
      while (free < h + 2 && p.y - free - 1 >= 0 && !isSolid(m, p.x, p.y - free - 1)) free++
      h = Math.max(0, Math.min(h, free - 1))
      xs[k] = p.x + 0.5
      ys[k] = p.y
      hs[k] = h
    }
    const sparkles: SnowCap["sparkles"] = []
    const count = Math.min(C.SNOW_SPARKLE_MAX, Math.round(run.length * C.SNOW_SPARKLES_PER_PX + rng.next()))
    for (let i = 0; i < count; i++) {
      const k = 1 + Math.floor(rng.next() * (n - 2))
      if (hs[k] > 2) sparkles.push({ k, lift: rng.range(-1, 5), r: rng.range(0.5, 1) })
    }
    caps.push({
      xs,
      ys,
      hs,
      sparkles,
      start: C.SNOW_DELAY + rng.range(0, C.SNOW_STAGGER),
      duration: rng.range(C.SNOW_DURATION_MIN, C.SNOW_DURATION_MAX),
    })
  }
  return caps
}

// Smooth drift outline through the sample tops, shifted down by `dy`.
function drift(ctx: CanvasRenderingContext2D, cap: SnowCap, p: number, dy: number) {
  const { xs, ys, hs } = cap
  const n = xs.length
  const top = (k: number) => ys[k] - hs[k] * p + dy
  ctx.beginPath()
  ctx.moveTo(xs[0], top(0))
  for (let k = 1; k < n - 1; k++) ctx.quadraticCurveTo(xs[k], top(k), (xs[k] + xs[k + 1]) / 2, (top(k) + top(k + 1)) / 2)
  ctx.lineTo(xs[n - 1], top(n - 1))
  for (let k = n - 1; k >= 0; k--) ctx.lineTo(xs[k], ys[k] + C.SNOW_OVERLAP_PX + dy)
  ctx.closePath()
  ctx.fill()
}

export function drawSnow(ctx: CanvasRenderingContext2D, cap: SnowCap, p: number) {
  if (p <= 0) return
  ctx.fillStyle = C.SNOW_SHADOW
  drift(ctx, cap, p, C.SNOW_SHADOW_OFFSET_PX)
  ctx.fillStyle = C.SNOW
  drift(ctx, cap, p, 0)
  if (p > 0.6) {
    ctx.fillStyle = rgba(C.SNOW, clamp((p - 0.6) / 0.4, 0, 1))
    for (const s of cap.sparkles) {
      ctx.beginPath()
      ctx.arc(cap.xs[s.k], cap.ys[s.k] - cap.hs[s.k] - s.lift, s.r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
