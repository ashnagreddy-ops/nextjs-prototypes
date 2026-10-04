import * as C from "./config"
import { rgba } from "./color"
import { fontFor } from "./font"
import { buildMask, distanceField } from "./mask"

// A typed character's shape, built once at REF_FONT_PX (independent of the layout size). Plants
// read its ink; the letter itself is drawn as a cached sprite with the lattice cut into it.
export type Letter = {
  char: string
  ox: number // pen origin (baseline) inside the mask box
  oy: number
  w: number
  h: number
  ink: { w: number; h: number; solid: Uint8Array } | null
  dOut: Float32Array | null // distance to the nearest ink pixel, 0 on ink (for hugs)
  inkTop: number // ink bounds in mask px
  inkBottom: number
  inkLeft: number
  inkRight: number
  sprite: { key: string; canvas: HTMLCanvasElement } | null
}

export function buildLetter(char: string): Letter {
  const fs = C.REF_FONT_PX
  const blank = { char, ox: 0, oy: 0, w: 1, h: 1, ink: null, dOut: null, inkTop: 0, inkBottom: 0, inkLeft: 0, inkRight: 0, sprite: null }
  if (!char.trim()) return blank
  const measure = document.createElement("canvas").getContext("2d")!
  measure.font = fontFor(fs)
  const mt = measure.measureText(char)
  const pad = Math.ceil(0.12 * fs)
  const ox = Math.round(pad + mt.actualBoundingBoxLeft)
  const oy = Math.round(pad + mt.actualBoundingBoxAscent)
  const w = Math.ceil(ox + mt.actualBoundingBoxRight + pad)
  const h = Math.ceil(oy + mt.actualBoundingBoxDescent + pad)
  const m = buildMask((ctx) => {
    ctx.font = fontFor(fs)
    ctx.fillStyle = "#fff"
    ctx.fillText(char, ox, oy)
  }, w, h)
  if (!m.area) return { ...blank, ox, oy, w, h }
  const empty = new Uint8Array(m.solid.length)
  for (let i = 0; i < empty.length; i++) empty[i] = m.solid[i] ? 0 : 1
  return {
    char,
    ox,
    oy,
    w,
    h,
    ink: { w: m.w, h: m.h, solid: m.solid },
    dOut: distanceField(empty, w, h, 1e9),
    inkTop: m.top,
    inkBottom: m.bottom,
    inkLeft: m.left,
    inkRight: m.right,
    sprite: null,
  }
}

// Bilinear sample of the outside distance field.
export function dOutAt(L: Letter, x: number, y: number) {
  const d = L.dOut!
  x -= 0.5
  y -= 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const g = (xi: number, yi: number) => (xi < 0 || yi < 0 || xi >= L.w || yi >= L.h ? 1e3 : d[yi * L.w + xi])
  const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * fx
  const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * fx
  return a + (b - a) * fy
}

// ---- Letters with the trellis lattice -----------------------------------------

// Two sets of diagonal lines in screen space (so letters line up with the panel), over a box
// whose top-left is at screen (x0, y0) css px, w x h css px. ctx is in css px for that box.
export function latticeLines(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, spacing: number) {
  ctx.beginPath()
  // x + y = c
  for (let c = Math.ceil((x0 + y0) / spacing) * spacing; c <= x0 + y0 + w + h; c += spacing) {
    const u = c - x0 - y0
    ctx.moveTo(u, 0)
    ctx.lineTo(u - h, h)
  }
  // x - y = d
  for (let d = Math.ceil((x0 - y0 - h) / spacing) * spacing; d <= x0 - y0 + w; d += spacing) {
    const u = d - x0 + y0
    ctx.moveTo(u, 0)
    ctx.lineTo(u + h, h)
  }
  ctx.stroke()
}

// The letter in LETTER with the lattice clipped to it, cached as a sprite per size/position.
// Drawn with an identity (device px) transform.
export function drawLetter(ctx: CanvasRenderingContext2D, b: Letter, pen: { x: number; y: number }, fs: number, dpr: number, alpha: number) {
  if (!b.ink || alpha <= 0) return
  const s = fs / C.REF_FONT_PX
  const x0 = pen.x - b.ox * s
  const y0 = pen.y - b.oy * s
  // snap the sprite to device pixels so it stays crisp
  const dx = Math.round(x0 * dpr)
  const dy = Math.round(y0 * dpr)
  const key = `${fs}|${dx}|${dy}|${dpr}`
  if (b.sprite?.key !== key) {
    const cw = Math.ceil(b.w * s * dpr) + 2
    const ch = Math.ceil(b.h * s * dpr) + 2
    const canvas = b.sprite?.canvas ?? document.createElement("canvas")
    canvas.width = cw
    canvas.height = ch
    const sc = canvas.getContext("2d")!
    sc.setTransform(dpr * s, 0, 0, dpr * s, 0, 0)
    sc.font = fontFor(C.REF_FONT_PX)
    sc.textAlign = "left"
    sc.textBaseline = "alphabetic"
    sc.fillStyle = C.LETTER
    sc.fillText(b.char, b.ox, b.oy)
    sc.globalCompositeOperation = "source-atop"
    sc.setTransform(dpr, 0, 0, dpr, 0, 0)
    sc.strokeStyle = rgba(C.LATTICE_LINE, C.LATTICE_LINE_ALPHA)
    sc.lineWidth = C.LATTICE_WIDTH_PX
    latticeLines(sc, dx / dpr, dy / dpr, cw / dpr, ch / dpr, C.LATTICE_SPACING_EM * fs)
    b.sprite = { key, canvas }
  }
  ctx.globalAlpha = alpha
  ctx.drawImage(b.sprite.canvas, dx, dy)
  ctx.globalAlpha = 1
}
