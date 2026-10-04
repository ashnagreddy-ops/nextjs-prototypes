// Background / letter / vine palettes. Flowers and leaves never change with the palette.
// The scene and the picker read one live `active` colour set at draw time, so switching never
// regenerates anything: colours crossfade (linear RGB) over PALETTE_FADE_MS while the garden keeps
// growing and swaying.

export type Palette = { name: string; bg: string; letter: string; vine: string }

export const PALETTES: Palette[] = [
  { name: "Garden Night", bg: "#12281d", letter: "#f6efe0", vine: "#c9a27a" },
  { name: "Midnight", bg: "#0e1633", letter: "#f2efe6", vine: "#c9a27a" },
  { name: "Ink", bg: "#0b0b0b", letter: "#f6efe0", vine: "#c9a27a" },
  { name: "Plum", bg: "#2a1233", letter: "#f4e9dc", vine: "#d4b08a" },
  { name: "Cobalt", bg: "#1d2f6f", letter: "#f6efe0", vine: "#d4b08a" },
  { name: "Stucco", bg: "#efe6d6", letter: "#1f3a2b", vine: "#8a6a45" },
  { name: "Sage", bg: "#c9d4bf", letter: "#1b2e22", vine: "#6f5436" },
  { name: "Paper", bg: "#f7f3ea", letter: "#111111", vine: "#8a6a45" },
]

export const DEFAULT_PALETTE = 0
export const PALETTE_STORAGE_KEY = "bloom-palette" // stores the palette's name
export const PALETTE_FADE_MS = 350
// Derived colours
export const LATTICE_MIX = 0.18 // lattice lines = letter mixed this far toward the bg (drawn opaque)
export const LEAF_VEIN_ALPHA = 0.5 // leaf veins = bg at this alpha
export const PANEL_ALPHA = 0.07 // the full-screen trellis panel = letter at this alpha
export const PICKER_BORDER_ALPHA = 0.3 // picker pill border = letter at this alpha
// Dev-only contrast warnings (WCAG ratio)
export const MIN_LETTER_CONTRAST = 7
export const MIN_VINE_CONTRAST = 2

type RGB = [number, number, number]
const toRgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const css = ([r, g, b]: RGB, a = 1) => (a === 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`)
const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

// The live colours everything draws with. Updated in place each frame while crossfading.
export const active: {
  index: number
  bg: string
  letter: string
  vine: string
  lattice: string
  leafVein: string
  panel: string
  letterAlpha: (a: number) => string
} = {
  index: DEFAULT_PALETTE,
  bg: "",
  letter: "",
  vine: "",
  lattice: "", // letter mixed LATTICE_MIX toward bg
  leafVein: "", // bg at LEAF_VEIN_ALPHA
  panel: "", // letter at PANEL_ALPHA
  letterAlpha: () => "", // letter at any alpha (caret, UI)
}

let from = PALETTES[DEFAULT_PALETTE]
let to = PALETTES[DEFAULT_PALETTE]
let t0 = -Infinity
const listeners = new Set<() => void>()

function apply(t: number) {
  const bg = lerp(toRgb(from.bg), toRgb(to.bg), t)
  const letter = lerp(toRgb(from.letter), toRgb(to.letter), t)
  const vine = lerp(toRgb(from.vine), toRgb(to.vine), t)
  active.bg = css(bg)
  active.letter = css(letter)
  active.vine = css(vine)
  active.lattice = css(lerp(letter, bg, LATTICE_MIX))
  active.leafVein = css(bg, LEAF_VEIN_ALPHA)
  active.panel = css(letter, PANEL_ALPHA)
  active.letterAlpha = (a: number) => css(letter, a)
}
apply(1)

// Advance the crossfade; returns true while colours are still changing.
export function tickPalette(now: number) {
  const t = Math.min(1, Math.max(0, (now - t0) / PALETTE_FADE_MS))
  if (t >= 1 && from === to) return false
  apply(t)
  if (t >= 1) from = to
  return true
}

export function setPalette(index: number, opts: { instant?: boolean } = {}) {
  const i = ((index % PALETTES.length) + PALETTES.length) % PALETTES.length
  if (i === active.index && !opts.instant) return
  from = opts.instant ? PALETTES[i] : PALETTES[active.index]
  to = PALETTES[i]
  t0 = opts.instant ? -Infinity : performance.now()
  active.index = i
  if (opts.instant) apply(1)
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, to.name)
  } catch {}
  if (process.env.NODE_ENV !== "production") checkContrast(to)
  if (typeof document !== "undefined") syncDom()
  listeners.forEach((l) => l())
}

export function savedPaletteIndex() {
  try {
    const name = localStorage.getItem(PALETTE_STORAGE_KEY)
    const i = PALETTES.findIndex((p) => p.name === name)
    return i >= 0 ? i : DEFAULT_PALETTE
  } catch {
    return DEFAULT_PALETTE
  }
}

export const subscribePalette = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
export const paletteIndex = () => active.index

// Runs in the page before the canvas so a saved palette paints from the first frame: sets the
// --bloom-bg / --bloom-letter variables the page and picker use.
export const bootScript = () =>
  `try{var p=${JSON.stringify(PALETTES.map((p) => [p.name, p.bg, p.letter]))},n=localStorage.getItem(${JSON.stringify(
    PALETTE_STORAGE_KEY
  )}),c=p[${DEFAULT_PALETTE}];for(var i=0;i<p.length;i++)if(p[i][0]===n)c=p[i];var s=document.documentElement.style;s.setProperty("--bloom-bg",c[1]);s.setProperty("--bloom-letter",c[2]);}catch(e){}`

// ---- Contrast -----------------------------------------------------------------

const lum = (hex: string) => {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function checkContrast(p: Palette) {
  const lc = contrast(p.letter, p.bg)
  const vc = contrast(p.vine, p.bg)
  if (lc < MIN_LETTER_CONTRAST) console.warn(`[bloom-trellis] ${p.name}: letter/bg contrast ${lc.toFixed(2)} < ${MIN_LETTER_CONTRAST}`)
  if (vc < MIN_VINE_CONTRAST) console.warn(`[bloom-trellis] ${p.name}: vine/bg contrast ${vc.toFixed(2)} < ${MIN_VINE_CONTRAST}`)
}

// Page-level colours outside the canvas: CSS variables for the page and picker, the body
// background, and the theme-color meta tag. Called as colours change.
export function syncDom() {
  const s = document.documentElement.style
  s.setProperty("--bloom-bg", active.bg)
  s.setProperty("--bloom-letter", active.letter)
  document.body.style.background = active.bg
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement("meta")
    meta.name = "theme-color"
    meta.dataset.bloom = "1"
    document.head.appendChild(meta)
  }
  meta.content = active.bg
}

// Leaving the prototype: put the page-level colours back.
export function restoreDom(prevThemeColor: string | null) {
  const s = document.documentElement.style
  s.removeProperty("--bloom-bg")
  s.removeProperty("--bloom-letter")
  document.body.style.background = ""
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta?.dataset.bloom) meta.remove()
  else if (meta && prevThemeColor !== null) meta.content = prevThemeColor
}
