import { LEAF, LEAF_DARK } from "./config"

// Background / letter / vine palettes. Flowers and leaves never change with the palette.
// The scene and the picker read one live `active` colour set at draw time, so switching never
// regenerates anything: colours crossfade (linear RGB) over PALETTE_FADE_MS while the garden keeps
// growing and swaying.

export type Palette = { name: string; group: "dark" | "light"; bg: string; letter: string; vine: string }

// Dark backgrounds with varied letter colours first; the light palettes are a second group,
// set apart by a small gap in the picker.
export const PALETTES: Palette[] = [
  { name: "Garden Night", group: "dark", bg: "#12281d", letter: "#f6efe0", vine: "#c9a27a" },
  { name: "Midnight Butter", group: "dark", bg: "#0e1633", letter: "#f3dd9a", vine: "#c9a27a" },
  { name: "Plum Gold", group: "dark", bg: "#2a1233", letter: "#e8c872", vine: "#d4b08a" },
  { name: "Cobalt Sand", group: "dark", bg: "#1d2f6f", letter: "#efd9b5", vine: "#d4b08a" },
  { name: "Slate Ice", group: "dark", bg: "#1c2530", letter: "#cfe3f4", vine: "#c9a27a" },
  { name: "Teal Mint", group: "dark", bg: "#0f2a26", letter: "#cfe6d6", vine: "#c9a27a" },
  { name: "Espresso", group: "dark", bg: "#241710", letter: "#f1e3c8", vine: "#e0b98a" },
  { name: "Stucco", group: "light", bg: "#efe6d6", letter: "#1f3a2b", vine: "#8a6a45" },
  { name: "Sage", group: "light", bg: "#c9d4bf", letter: "#1b2e22", vine: "#6f5436" },
  { name: "Paper", group: "light", bg: "#f7f3ea", letter: "#111111", vine: "#8a6a45" },
]

export const DEFAULT_PALETTE = 0
export const PALETTE_STORAGE_KEY = "bloom-palette" // stores the palette's name
export const PALETTE_FADE_MS = 350
// Derived colours
export const LATTICE_MIX = 0.18 // lattice lines = letter mixed this far toward the bg...
export const LATTICE_MAX_CONTRAST = 1.25 // ...pulled back toward the letter so lines never exceed this contrast with it
export const LEAF_VEIN_ALPHA = 0.5 // leaf veins = bg at this alpha
export const PANEL_ALPHA = 0.07 // the full-screen trellis panel = letter at this alpha
export const PICKER_BORDER_ALPHA = 0.3 // picker pill border = letter at this alpha
// Dev-only contrast warnings (WCAG ratio)
export const MIN_LETTER_CONTRAST = 7
export const MIN_VINE_CONTRAST = 2
export const LEAF_CLASH_HUE_DEG = 40 // warn if the letter is within this hue of a leaf green...
export const LEAF_CLASH_LIGHTNESS = 0.25 // ...and within this lightness of it

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
  active.lattice = css(latticeColor(letter, bg))
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

// (function declarations: apply() runs at module load, above these)
function lumRgb(rgb: RGB) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function ratio(a: RGB, b: RGB) {
  const [hi, lo] = [lumRgb(a), lumRgb(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
export const contrast = (a: string, b: string) => ratio(toRgb(a), toRgb(b))

// Lattice lines: the letter mixed LATTICE_MIX toward the bg, or less if that would stand out
// more than LATTICE_MAX_CONTRAST against the letter (same as clamping the line's alpha).
function latticeColor(letter: RGB, bg: RGB): RGB {
  let t = LATTICE_MIX
  if (ratio(lerp(letter, bg, t), letter) > LATTICE_MAX_CONTRAST) {
    let lo = 0
    let hi = t
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2
      if (ratio(lerp(letter, bg, mid), letter) > LATTICE_MAX_CONTRAST) hi = mid
      else lo = mid
    }
    t = lo
  }
  return lerp(letter, bg, t)
}

function hsl([r, g, b]: RGB) {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  const d = max - min
  if (!d) return { h: 0, s: 0, l }
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0)) * 60 : max === G ? ((B - R) / d + 2) * 60 : ((R - G) / d + 4) * 60
  return { h, s: d / (1 - Math.abs(2 * l - 1)), l }
}

function checkContrast(p: Palette) {
  const lc = contrast(p.letter, p.bg)
  const vc = contrast(p.vine, p.bg)
  if (lc < MIN_LETTER_CONTRAST) console.warn(`[bloom-trellis] ${p.name}: letter/bg contrast ${lc.toFixed(2)} < ${MIN_LETTER_CONTRAST}`)
  if (vc < MIN_VINE_CONTRAST) console.warn(`[bloom-trellis] ${p.name}: vine/bg contrast ${vc.toFixed(2)} < ${MIN_VINE_CONTRAST}`)
  // leaves sit on the letters: warn when the letter is a near-match for a leaf green
  const L = hsl(toRgb(p.letter))
  for (const leaf of [LEAF, LEAF_DARK]) {
    const G = hsl(toRgb(leaf))
    const dh = Math.min(Math.abs(L.h - G.h), 360 - Math.abs(L.h - G.h))
    if (dh < LEAF_CLASH_HUE_DEG && Math.abs(L.l - G.l) < LEAF_CLASH_LIGHTNESS)
      console.warn(`[bloom-trellis] ${p.name}: letter ${p.letter} is close to leaf ${leaf} (hue ${dh.toFixed(0)}°, lightness ${(Math.abs(L.l - G.l) * 100).toFixed(0)}%)`)
  }
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
