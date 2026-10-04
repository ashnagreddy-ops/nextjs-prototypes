import * as C from "./config"
import { type Mask, isSolid, surfaceRuns } from "./mask"
import type { Rng } from "./rng"
import { rgba } from "./color"

export type Icicle = {
  x: number
  y: number // base, on the glyph's underside
  len: number
  width: number
  lean: number // tip offset in x
  start: number
  duration: number
}

// Icicles hang from downward-facing edges, longest mid-run, never into ink below.
export function buildIcicles(rng: Rng, m: Mask, fs: number): Icicle[] {
  const out: Icicle[] = []
  const runs = surfaceRuns(m, "bottom", C.ICICLE_NORMAL_MIN).filter((r) => r.length >= C.ICICLE_MIN_RUN_EM * fs)
  for (const run of runs) {
    let i = Math.floor(rng.range(0.15, 0.6) * C.ICICLE_SPACING_EM * fs)
    while (i < run.length - 2) {
      const p = run[i]
      const u = i / (run.length - 1)
      if (i >= 2 && rng.next() < C.ICICLE_DENSITY) {
        let len = fs * rng.range(C.ICICLE_LEN_MIN_EM, C.ICICLE_LEN_MAX_EM) * (0.45 + 0.55 * Math.sin(Math.PI * u))
        let free = 0
        while (free < len + 2 && p.y + free + 1 < m.h && !isSolid(m, p.x, p.y + free + 1)) free++
        len = Math.min(len, free - 2)
        if (len >= C.ICICLE_MIN_PX) {
          const width = Math.min(fs * rng.range(C.ICICLE_WIDTH_MIN_EM, C.ICICLE_WIDTH_MAX_EM), len * 0.45)
          out.push({
            x: p.x + 0.5,
            y: p.y + 1,
            len,
            width,
            lean: rng.range(-1, 1) * C.ICICLE_LEAN_EM * fs,
            start: C.ICICLE_DELAY + rng.range(0, C.ICICLE_STAGGER),
            duration: rng.range(C.ICICLE_DURATION_MIN, C.ICICLE_DURATION_MAX),
          })
        }
      }
      i += Math.max(3, Math.round(C.ICICLE_SPACING_EM * fs * rng.range(0.7, 1.4)))
    }
  }
  // keep a random subset if a glyph has lots of underside
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.slice(0, C.ICICLE_MAX)
}

// Draw one icicle grown to eased progress p (0–1).
export function drawIcicle(ctx: CanvasRenderingContext2D, ic: Icicle, p: number) {
  const L = ic.len * p
  if (L < 0.5) return
  const w = ic.width * (0.4 + 0.6 * Math.min(1, p * 1.6))
  const lean = ic.lean * p
  const top = ic.y - 1.5 // tuck the base into the edge
  const tipX = ic.x + lean
  const tipY = ic.y + L

  const grad = ctx.createLinearGradient(0, top, 0, tipY)
  grad.addColorStop(0, rgba(C.ICICLE_COLOR, C.ICICLE_BASE_ALPHA))
  grad.addColorStop(1, rgba(C.ICICLE_COLOR, C.ICICLE_TIP_ALPHA))
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.moveTo(ic.x - w / 2, top)
  ctx.quadraticCurveTo(ic.x - w * 0.3 + lean * 0.3, ic.y + L * 0.5, tipX, tipY)
  ctx.quadraticCurveTo(ic.x + w * 0.3 + lean * 0.3, ic.y + L * 0.45, ic.x + w / 2, top)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = rgba(C.ICICLE_HIGHLIGHT, C.ICICLE_HIGHLIGHT_ALPHA)
  ctx.lineWidth = Math.max(0.5, w * 0.12)
  ctx.lineCap = "round"
  ctx.beginPath()
  ctx.moveTo(ic.x - w * 0.2, ic.y)
  ctx.quadraticCurveTo(ic.x - w * 0.15 + lean * 0.3, ic.y + L * 0.4, ic.x - w * 0.02 + lean * 0.7, ic.y + L * 0.72)
  ctx.stroke()
}
