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

// Wrap at spaces so words stay whole; a word too long for any row is split by letters.
// A space that ends a row stays on it (trailing), so rows never start with one.
function wrap(chars: string[], fs: number, maxRowW: number) {
  const cell = (i: number) => (advanceEm(chars[i]) + C.TRACKING_EM) * fs
  const rows: number[][] = [[]]
  let rowW = 0
  const fits = (n: number, w: number) => rows[rows.length - 1].length + n <= C.MAX_LETTERS_PER_ROW && rowW + w <= maxRowW
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
    if (!fits(word.length, w) && rows[rows.length - 1].length) newRow()
    for (const k of word) {
      if (!fits(1, cell(k)) && rows[rows.length - 1].length) newRow()
      put(k)
    }
    i = j
  }
  return rows
}

// Centered rows. The font is sized so the first row (up to MAX_LETTERS_PER_ROW characters)
// spans LINE_VW of the viewport, capped by FONT_MAX_VH; longer text wraps at spaces, and the
// size shrinks again only if the rows overflow vertically.
export function layoutText(chars: string[], vw: number, vh: number): Layout {
  const maxRowW = C.ROW_MAX_VW * vw
  let first = chars.slice(0, C.MAX_LETTERS_PER_ROW)
  while (first.length > 1 && isSpace(first[first.length - 1])) first = first.slice(0, -1)
  const rowEm = first.reduce((s, ch) => s + advanceEm(ch) + C.TRACKING_EM, 0) - C.TRACKING_EM
  let fs = Math.min(C.FONT_MAX_VH * vh, rowEm > 0 ? (C.LINE_VW * vw) / rowEm : Infinity)
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
    // trailing spaces and the trailing gap aren't part of the visible row width
    let last = row.length
    while (last > 1 && isSpace(chars[row[last - 1]])) last--
    const width = row.slice(0, last).reduce((s, i) => s + (advanceEm(chars[i]) + C.TRACKING_EM) * fs, 0) - C.TRACKING_EM * fs
    let x = (vw - width) / 2
    const y = blockTop + (r + C.BASELINE_IN_LINE) * lineH
    for (const i of row) {
      pens[i] = { x, y }
      x += (advanceEm(chars[i]) + C.TRACKING_EM) * fs
    }
  })
  return { fs, pens }
}
