import { pathData } from "./bracts"

// A recording stand-in for CanvasRenderingContext2D that writes SVG instead of pixels, so the
// scene's own drawing code (stems, thorns, leaves, bracts, petals, lattice) exports as vectors.
// It covers the calls the scene uses: transforms are uniform scale + rotation, arcs are full
// circles. Each fill/stroke becomes a <path> in local coordinates with the current transform.

const r = (v: number) => Math.round(v * 100) / 100

// rgb()/rgba()/#hex -> SVG colour + opacity (rgba isn't valid in SVG 1.1 attributes)
function paint(c: string): [string, number] {
  const m = /^rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)$/.exec(c.replace(/\s/g, ""))
  return m ? [`rgb(${m[1]},${m[2]},${m[3]})`, +m[4]] : [c, 1]
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

export class SvgRecorder {
  private out: string[] = []
  private d: string[] = []
  private m = new DOMMatrix()
  fillStyle: string = "#000"
  strokeStyle: string = "#000"
  lineWidth = 1
  lineCap: CanvasLineCap = "butt"
  lineJoin: CanvasLineJoin = "miter"
  globalAlpha = 1
  globalCompositeOperation = "source-over"
  font = ""
  textAlign: CanvasTextAlign = "start"
  textBaseline: CanvasTextBaseline = "alphabetic"

  constructor(
    private width: number, // viewBox (device px)
    private height: number,
    private cssWidth: number,
    private cssHeight: number
  ) {}

  // ---- the canvas subset ----
  setTransform(a: number | DOMMatrix, b = 0, c = 0, d = 1, e = 0, f = 0) {
    this.m = typeof a === "number" ? new DOMMatrix([a, b, c, d, e, f]) : DOMMatrix.fromMatrix(a)
  }
  getTransform() {
    return DOMMatrix.fromMatrix(this.m)
  }
  translate(x: number, y: number) {
    this.m = this.m.translate(x, y)
  }
  rotate(a: number) {
    this.m = this.m.rotate((a * 180) / Math.PI)
  }
  scale(x: number, y: number) {
    this.m = this.m.scale(x, y)
  }
  beginPath() {
    this.d = []
  }
  moveTo(x: number, y: number) {
    this.d.push(`M${r(x)} ${r(y)}`)
  }
  lineTo(x: number, y: number) {
    this.d.push(`L${r(x)} ${r(y)}`)
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    this.d.push(`Q${r(cx)} ${r(cy)} ${r(x)} ${r(y)}`)
  }
  closePath() {
    this.d.push("Z")
  }
  // full circles as two half arcs (the scene only draws full circles)
  arc(x: number, y: number, rad: number) {
    if (rad <= 0) return
    this.d.push(`M${r(x + rad)} ${r(y)}A${r(rad)} ${r(rad)} 0 1 0 ${r(x - rad)} ${r(y)}A${r(rad)} ${r(rad)} 0 1 0 ${r(x + rad)} ${r(y)}`)
  }
  fill(p?: Path2D) {
    const d = p ? pathData.get(p) : this.d.join("")
    if (!d) return
    const [color, a] = paint(this.fillStyle)
    this.emit(d, `fill="${color}"`, a)
  }
  stroke() {
    if (!this.d.length) return
    const [color, a] = paint(this.strokeStyle)
    this.emit(this.d.join(""), `fill="none" stroke="${color}" stroke-width="${r(this.lineWidth)}" stroke-linecap="${this.lineCap}" stroke-linejoin="${this.lineJoin}"`, a)
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const [color, a] = paint(this.fillStyle)
    this.emit(`M${r(x)} ${r(y)}h${r(w)}v${r(h)}h${r(-w)}Z`, `fill="${color}"`, a)
  }
  // not exported: overlays and the on-screen letter layer
  clearRect() {}
  strokeRect() {}
  fillText() {}
  setLineDash() {}
  drawImage() {}

  // ---- SVG extras for the scene ----
  raw(s: string) {
    this.out.push(s)
  }
  group(attrs: string) {
    this.out.push(`<g ${attrs}>`)
  }
  endGroup() {
    this.out.push("</g>")
  }
  text(x: number, y: number, s: string, attrs = "") {
    return `<text x="${r(x)}" y="${r(y)}"${attrs ? ` ${attrs}` : ""}>${esc(s)}</text>`
  }

  private emit(d: string, attrs: string, alpha: number) {
    const m = this.m
    const t = m.isIdentity ? "" : ` transform="matrix(${r(m.a * 1e4) / 1e4} ${r(m.b * 1e4) / 1e4} ${r(m.c * 1e4) / 1e4} ${r(m.d * 1e4) / 1e4} ${r(m.e)} ${r(m.f)})"`
    const o = alpha * this.globalAlpha
    this.out.push(`<path d="${d}" ${attrs}${o < 1 ? ` opacity="${r(o * 1000) / 1000}"` : ""}${t}/>`)
  }

  toString(style = "") {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${this.cssWidth}" height="${this.cssHeight}" viewBox="0 0 ${this.width} ${this.height}">` +
      (style ? `<style>${style}</style>` : "") +
      this.out.join("") +
      "</svg>"
    )
  }
}

// The page's @font-face rules for `family`, with their files inlined as data URLs so the SVG's
// text renders in the same face anywhere. Best effort: an empty string if they can't be read.
export async function embeddedFontCss(family: string) {
  const name = family.split(",")[0].trim().replace(/^["']|["']$/g, "")
  const rules: CSSFontFaceRule[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList
    try {
      list = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(list))
      if (rule instanceof CSSFontFaceRule && rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim() === name) rules.push(rule)
  }
  const css = await Promise.all(
    rules.map(async (rule) => {
      const src = rule.style.getPropertyValue("src")
      const url = /url\(["']?([^"')]+)["']?\)/.exec(src)?.[1]
      if (!url) return ""
      try {
        const blob = await (await fetch(new URL(url, rule.parentStyleSheet?.href ?? location.href))).blob()
        const data = await new Promise<string>((res) => {
          const fr = new FileReader()
          fr.onload = () => res(fr.result as string)
          fr.readAsDataURL(blob)
        })
        const range = rule.style.getPropertyValue("unicode-range")
        return `@font-face{font-family:"${name}";font-weight:${rule.style.getPropertyValue("font-weight") || "normal"};font-style:${rule.style.getPropertyValue("font-style") || "normal"};src:url(${data});${range ? `unicode-range:${range};` : ""}}`
      } catch {
        return ""
      }
    })
  )
  return css.join("")
}
