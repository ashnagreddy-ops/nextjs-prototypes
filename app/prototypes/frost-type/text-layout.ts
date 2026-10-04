import * as C from "./config"
import { fontFor } from "./glyph"

export type Layout = {
  fs: number
  pens: { x: number; y: number }[] // pen origin (left, baseline) per glyph, css px
}

const REF = 100
let measureCtx: CanvasRenderingContext2D | null = null
const advances = new Map<string, number>()

// Advance width in em, measured once per character.
function advanceEm(ch: string) {
  let a = advances.get(ch)
  if (a === undefined) {
    measureCtx ??= document.createElement("canvas").getContext("2d")!
    measureCtx.font = fontFor(REF)
    a = measureCtx.measureText(ch).width / REF
    advances.set(ch, a)
  }
  return a
}

function wrap(chars: string[], fs: number, maxRowW: number) {
  const rows: number[][] = [[]]
  let rowW = 0
  chars.forEach((ch, i) => {
    const cell = (advanceEm(ch) + C.LETTER_GAP_EM) * fs
    const row = rows[rows.length - 1]
    if (row.length && (row.length >= C.MAX_LETTERS_PER_ROW || rowW + cell > maxRowW)) {
      rows.push([i])
      rowW = cell
    } else {
      row.push(i)
      rowW += cell
    }
  })
  return rows
}

// Centered rows. The size shrinks as text grows (until ~MAX_LETTERS_PER_ROW fit a
// row), then text wraps, and shrinks again only if the rows overflow vertically.
export function layoutText(chars: string[], vw: number, vh: number): Layout {
  const maxRowW = C.ROW_MAX_VW * vw
  const perRow = Math.max(C.SIZE_FULL_CHARS, Math.min(chars.length, C.MAX_LETTERS_PER_ROW))
  let fs = Math.min(C.FONT_MAX_VH * vh, C.FONT_MAX_VW * vw, maxRowW / (perRow * C.CELL_EM_ESTIMATE))
  fs = Math.max(C.FONT_MIN_PX, Math.floor(fs))
  let rows = wrap(chars, fs, maxRowW)
  while (rows.length * C.LINE_HEIGHT_EM * fs > C.BLOCK_MAX_VH * vh && fs > C.FONT_MIN_PX) {
    fs = Math.max(C.FONT_MIN_PX, Math.floor(fs * 0.92))
    rows = wrap(chars, fs, maxRowW)
  }

  const lineH = C.LINE_HEIGHT_EM * fs
  const blockTop = (vh - rows.length * lineH) / 2
  const pens: Layout["pens"] = new Array(chars.length)
  rows.forEach((row, r) => {
    // the trailing gap isn't part of the visible row width
    const width = row.reduce((s, i) => s + (advanceEm(chars[i]) + C.LETTER_GAP_EM) * fs, 0) - C.LETTER_GAP_EM * fs
    let x = (vw - width) / 2
    const y = blockTop + (r + C.BASELINE_IN_LINE) * lineH
    for (const i of row) {
      pens[i] = { x, y }
      x += (advanceEm(chars[i]) + C.LETTER_GAP_EM) * fs
    }
  })
  return { fs, pens }
}
