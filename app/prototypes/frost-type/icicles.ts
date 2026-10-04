import * as C from "./config"
import { rgba } from "./color"
import { type Mask, isSolid, surfaceRuns } from "./mask"
import { type Rng, valueNoise } from "./rng"
import { clamp } from "./stroke"

export type Icicle = {
  x: number
  y: number // base, on the glyph's underside
  len: number
  width: number
  lean: number // tip offset in x
  bend: number // sideways bow of the spike
  bead: boolean // ends in a small round droplet
  start: number
  duration: number
}

const smooth = (t: number) => t * t * (3 - 2 * t)

// Icicles hang from every downward-facing edge (arch undersides, counter ceilings, serifs).
// Density is gated by low-frequency noise; lengths are skewed short.
export function buildIcicles(rng: Rng, m: Mask, fs: number): Icicle[] {
  const out: Icicle[] = []
  const noise = valueNoise(rng)
  const off = rng.range(0, 64)
  const inkH = m.bottom - m.top
  const maxLen = Math.max(C.ICICLE_MIN_LEN_PX + 1, C.ICICLE_MAX_LEN_RATIO * inkH)
  const runs = surfaceRuns(m, "bottom", C.ICICLE_NORMAL_MIN).filter((r) => r.length >= C.ICICLE_MIN_RUN_PX)
  for (const run of runs) {
    let i = Math.floor(rng.range(0, C.ICICLE_SPACING_MAX_PX))
    while (i < run.length) {
      const p = run[i]
      i += Math.round(rng.range(C.ICICLE_SPACING_MIN_PX, C.ICICLE_SPACING_MAX_PX))
      const gate = 0.5 + 0.5 * noise(off + (p.x + p.y * 0.6) / (C.ICICLE_NOISE_WAVELEN_EM * fs))
      const keep = smooth(clamp((gate - C.ICICLE_GATE_LOW) / (C.ICICLE_GATE_HIGH - C.ICICLE_GATE_LOW), 0, 1))
      if (rng.next() >= keep) continue

      let len = C.ICICLE_MIN_LEN_PX + (maxLen - C.ICICLE_MIN_LEN_PX) * Math.pow(rng.next(), C.ICICLE_LEN_POWER)
      let free = 0
      while (free < len + C.ICICLE_CLEARANCE_PX && p.y + free + 1 < m.h && !isSolid(m, p.x, p.y + free + 1)) free++
      len = Math.min(len, free - C.ICICLE_CLEARANCE_PX)
      if (len < C.ICICLE_MIN_FIT_PX) continue

      const width = clamp(len * rng.range(C.ICICLE_WIDTH_RATIO_MIN, C.ICICLE_WIDTH_RATIO_MAX), C.ICICLE_WIDTH_MIN_PX, C.ICICLE_WIDTH_MAX_EM * fs)
      const size = (len - C.ICICLE_MIN_LEN_PX) / (maxLen - C.ICICLE_MIN_LEN_PX)
      out.push({
        x: p.x + 0.5,
        y: p.y + 1,
        len,
        width,
        lean: rng.range(-1, 1) * Math.min(len * C.ICICLE_LEAN_RATIO, C.ICICLE_LEAN_MAX_EM * fs),
        bend: rng.range(-1, 1) * len * C.ICICLE_BEND_RATIO,
        bead: len >= C.ICICLE_BEAD_MIN_LEN_PX && rng.next() < C.ICICLE_BEAD_CHANCE,
        start: C.ICICLE_DELAY + rng.range(0, C.ICICLE_STAGGER),
        // short ones grow fast, long ones slower
        duration: C.ICICLE_DURATION_FAST + (C.ICICLE_DURATION_SLOW - C.ICICLE_DURATION_FAST) * clamp(size, 0, 1),
      })
    }
  }
  // cap the count, keeping a random subset
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.slice(0, C.ICICLE_MAX)
}

// Draw one icicle grown to eased progress p (0-1).
export function drawIcicle(ctx: CanvasRenderingContext2D, ic: Icicle, p: number) {
  const L = ic.len * p
  if (L < 0.5) return
  const w = ic.width * (0.5 + 0.5 * Math.min(1, p * 1.5))
  const top = ic.y - 1.5 // tuck the base into the edge
  const tipX = ic.x + ic.lean * p
  const tipY = ic.y + L
  const cx = ic.x + (ic.lean * 0.4 + ic.bend) * p
  const cy = ic.y + L * 0.5

  const grad = ctx.createLinearGradient(0, top, 0, tipY)
  grad.addColorStop(0, rgba(C.ICE_LIGHT, C.ICICLE_BASE_ALPHA))
  grad.addColorStop(1, rgba(C.ICE_LIGHT, C.ICICLE_TIP_ALPHA))
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.moveTo(ic.x - w / 2, top)
  ctx.quadraticCurveTo(cx - w * 0.28, cy, tipX, tipY)
  ctx.quadraticCurveTo(cx + w * 0.28, cy, ic.x + w / 2, top)
  ctx.closePath()
  ctx.fill()

  ctx.lineCap = "round"
  ctx.lineWidth = Math.max(0.5, w * 0.12)
  ctx.strokeStyle = rgba(C.ICE_HIGHLIGHT, C.ICICLE_HIGHLIGHT_ALPHA)
  ctx.beginPath()
  ctx.moveTo(ic.x - w * 0.32, ic.y)
  ctx.quadraticCurveTo(cx - w * 0.22, cy, tipX - w * 0.04, ic.y + L * 0.82)
  ctx.stroke()
  ctx.lineWidth = Math.max(0.5, w * 0.1)
  ctx.strokeStyle = rgba(C.OUTLINE, C.ICICLE_OUTLINE_ALPHA)
  ctx.beginPath()
  ctx.moveTo(ic.x + w / 2, top)
  ctx.quadraticCurveTo(cx + w * 0.28, cy, tipX, tipY)
  ctx.stroke()

  if (ic.bead && p > 0.7) {
    const r = Math.max(1.2, ic.width * C.ICICLE_BEAD_RADIUS_RATIO) * clamp((p - 0.7) / 0.3, 0, 1)
    ctx.fillStyle = rgba(C.ICE_LIGHT, C.ICICLE_BASE_ALPHA)
    ctx.beginPath()
    ctx.arc(tipX, tipY + r * 0.2, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = rgba(C.OUTLINE, C.ICICLE_OUTLINE_ALPHA)
    ctx.lineWidth = 0.6
    ctx.stroke()
    ctx.fillStyle = rgba(C.ICE_HIGHLIGHT, C.ICICLE_HIGHLIGHT_ALPHA)
    ctx.beginPath()
    ctx.arc(tipX - r * 0.3, tipY + r * 0.2 - r * 0.3, r * 0.3, 0, Math.PI * 2)
    ctx.fill()
  }
}
