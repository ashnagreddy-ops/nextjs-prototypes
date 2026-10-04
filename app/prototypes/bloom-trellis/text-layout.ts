import * as C from "./config"
import { fontFor } from "./font"

export type Layout = {
  fs: number
  pens: { x: number; y: number }[] // pen origin (left, baseline) per glyph, css px
}

const REF = 100
let measureCtx: CanvasRenderingContext2D | null = null
const advances = new Map<string, number>()

// Advance width in em, measured once per character.
export function advanceEm(ch: string) {
  let a = advances.get(ch)
  if (a === undefined) {
    measureCtx ??= document.createElement("canvas").getContext("2d")!
    measureCtx.font = fontFor(REF)
    a = measureCtx.measureText(ch).width / REF
    advances.set(ch, a)
  }
  return a
}

const isSpace = (ch: string) => !ch.trim()

// Pen advance to the next character in em: the glyph's advance plus tracking, and extra room
// after a space so words read apart at the tight tracking.
export const stepEm = (ch: string) => advanceEm(ch) + C.TRACKING_EM + (isSpace(ch) ? C.WORD_SPACE_EM : 0)

// Wrap at spaces so words stay whole; a word too long for any row is split by letters.
// A space that ends a row stays on it (trailing), so rows never start with one.
function wrap(chars: string[], fs: number, maxRowW: number) {
  const cell = (i: number) => stepEm(chars[i]) * fs
  const rows: number[][] = [[]]
  let rowW = 0
  const fits = (w: number) => rowW + w <= maxRowW
  const put = (i: number) => {
    rows[rows.length - 1].push(i)
    rowW += cell(i)
  }
  const newRow = () => {
    rows.push([])
    rowW = 0
  }
  for (let i = 0; i < chars.length; ) {
    if (isSpace(chars[i])) {
      put(i++)
      continue
    }
    let j = i
    while (j < chars.length && !isSpace(chars[j])) j++
    const word = Array.from({ length: j - i }, (_, k) => i + k)
    const w = word.reduce((sum, k) => sum + cell(k), 0)
    if (!fits(w) && rows[rows.length - 1].length) newRow()
    for (const k of word) {
      if (!fits(cell(k)) && rows[rows.length - 1].length) newRow()
      put(k)
    }
    i = j
  }
  return rows
}

// Centered rows. The text stays on one line as long as it can: the font shrinks so the line
// spans LINE_VW of the viewport (capped by FONT_MAX_VH for short text). Once that would take it
// below the one-line minimum, it holds that size and wraps at spaces, each row filling up to
// ROW_MAX_VW; it shrinks again only if the rows overflow vertically.
export function layoutText(chars: string[], vw: number, vh: number): Layout {
  const maxRowW = C.ROW_MAX_VW * vw
  let line = chars
  while (line.length > 1 && isSpace(line[line.length - 1])) line = line.slice(0, -1)
  const lineEm = line.reduce((s, ch) => s + stepEm(ch), 0) - C.TRACKING_EM
  const minFs = Math.max(C.FONT_MIN_PX, C.ONE_LINE_MIN_VW * vw)
  let fs = Math.min(C.FONT_MAX_VH * vh, lineEm > 0 ? (C.LINE_VW * vw) / lineEm : Infinity)
  fs = Math.floor(Math.max(minFs, fs))
  let rows = wrap(chars, fs, maxRowW)
  while (rows.length * C.LINE_HEIGHT_EM * fs > C.BLOCK_MAX_VH * vh && fs > C.FONT_MIN_PX) {
    fs = Math.max(C.FONT_MIN_PX, Math.floor(fs * 0.92))
    rows = wrap(chars, fs, maxRowW)
  }

  const lineH = C.LINE_HEIGHT_EM * fs
  const blockTop = (vh - rows.length * lineH) / 2
  const pens: Layout["pens"] = new Array(chars.length)
  rows.forEach((row, r) => {
    // trailing spaces and the trailing gap aren't part of the visible row width
    let last = row.length
    while (last > 1 && isSpace(chars[row[last - 1]])) last--
    const width = row.slice(0, last).reduce((s, i) => s + stepEm(chars[i]) * fs, 0) - C.TRACKING_EM * fs
    let x = (vw - width) / 2
    const y = blockTop + (r + C.BASELINE_IN_LINE) * lineH
    for (const i of row) {
      pens[i] = { x, y }
      x += stepEm(chars[i]) * fs
    }
  })
  return { fs, pens }
}
