import * as C from "./config"
import { type Bract, drawBract } from "./bracts"
import { unit } from "./ease"

// Bracts that let go: they flutter down (sine sway, slow spin), rest at the baseline of the
// nearest letter, then fade. Positions are in em relative to that letter's pen, so they ride
// along when the layout shifts or the window resizes.

export type FallAnchor = { pen: { x: number; y: number } | null }

export type Faller = {
  anchor: FallAnchor
  x0: number // em, bract centre relative to the anchor's pen
  y0: number
  land: number // em
  born: number
  lenEm: number
  rot0: number
  spin: number // rad/s
  phase: number
  bract: Pick<Bract, "shape" | "color" | "vein" | "sideVeins">
  lastPen: { x: number; y: number }
}

// pose: the bract's base in screen css px; len in css px.
export function spawnFaller(
  fallers: Faller[],
  pose: { x: number; y: number; angle: number; len: number },
  bract: Faller["bract"],
  anchor: FallAnchor,
  fs: number,
  now: number
) {
  if (fallers.length >= C.FALL_MAX) {
    // make room by retiring the oldest, which has landed or is about to
    fallers.splice(0, fallers.length - C.FALL_MAX + 1)
  }
  const pen = anchor.pen
  if (!pen) return
  const lenEm = pose.len / fs
  const mx = pose.x + (Math.cos(pose.angle) * pose.len) / 2
  const my = pose.y + (Math.sin(pose.angle) * pose.len) / 2
  const y0 = (my - pen.y) / fs
  fallers.push({
    anchor,
    x0: (mx - pen.x) / fs,
    y0,
    land: Math.max(-C.FALL_LAND_ABOVE * lenEm, y0 + 0.05),
    born: now,
    lenEm,
    rot0: pose.angle,
    spin: ((Math.random() < 0.5 ? -1 : 1) * C.FALL_SPIN_DEG_S * (0.6 + 0.8 * Math.random()) * Math.PI) / 180,
    phase: Math.random() * Math.PI * 2,
    bract,
    lastPen: { ...pen },
  })
}

// Steps, draws and retires fallers. ctx is in device px; draws in css px with dpr.
export function drawFallers(ctx: CanvasRenderingContext2D, fallers: Faller[], fs: number, dpr: number, now: number) {
  const speed = C.FALL_SPEED_EM
  const veinPx = Math.max(0.5, (C.BRACT_VEIN_WIDTH_PX * fs) / C.REF_FONT_PX)
  for (let i = fallers.length - 1; i >= 0; i--) {
    const f = fallers[i]
    const t = (now - f.born) / 1000
    const tLand = (f.land - f.y0) / speed
    const life = (t - tLand) * 1000
    if (life > C.FALL_REST_MS + C.FALL_FADE_MS) {
      fallers.splice(i, 1)
      continue
    }
    if (f.anchor.pen) f.lastPen = f.anchor.pen
    const tt = Math.min(t, tLand)
    const w = (Math.PI * 2 * tt * 1000) / C.FALL_FLUTTER_MS + f.phase
    const x = f.x0 + C.FALL_SWAY_EM * (Math.sin(w) - Math.sin(f.phase))
    const y = f.y0 + speed * tt
    const rot = f.rot0 + f.spin * tt + ((C.FALL_WOBBLE_DEG * Math.PI) / 180) * (Math.sin(w) - Math.sin(f.phase))
    const L = f.lenEm * fs
    ctx.globalAlpha = 1 - unit(life, C.FALL_REST_MS, C.FALL_FADE_MS)
    ctx.setTransform(dpr, 0, 0, dpr, (f.lastPen.x + x * fs) * dpr, (f.lastPen.y + y * fs) * dpr)
    ctx.rotate(rot)
    ctx.scale(L, L)
    ctx.translate(-0.5, 0)
    drawBract(ctx, f.bract, L, veinPx)
  }
  ctx.globalAlpha = 1
}
