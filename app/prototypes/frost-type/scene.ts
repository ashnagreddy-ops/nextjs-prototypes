import * as C from "./config"
import { type BuiltGlyph, buildGlyph, drawGlyph, updateGlyph } from "./glyph"
import { type Layout, layoutText } from "./text-layout"
import { hashSeed } from "./rng"

// One typed character. Everything visual is rebuilt from (char, seed, index) at any size,
// and animation state is a pure function of age, so a rebuild picks up mid-growth.
type Glyph = {
  char: string
  index: number
  birth: number // its own clock: ms since keypress = now - birth
  ffwd: boolean // fast-forwarded to finished (active element cap)
  built: BuiltGlyph | null
}

const newSeed = () => (Math.random() * 2 ** 32) >>> 0

export function createScene(canvas: HTMLCanvasElement, opts: { onFirstType: () => void }) {
  const ctx = canvas.getContext("2d")!
  let seed = newSeed()
  const glyphs: Glyph[] = []
  let layout: Layout = { fs: 0, pens: [] }
  let vw = 0
  let vh = 0
  let dpr = 1
  let sizeDirty = true
  let layoutDirty = false
  let rebuildAll = false
  let dirty = true
  let raf = 0

  const glyphSeed = (g: Glyph) => hashSeed(seed, g.index)
  const build = (g: Glyph) => {
    g.built = buildGlyph(g.char, glyphSeed(g), layout.fs, dpr)
  }
  const ageOf = (g: Glyph, now: number) => (g.ffwd ? Infinity : now - g.birth)

  const resize = () => {
    dpr = window.devicePixelRatio || 1
    vw = window.innerWidth
    vh = window.innerHeight
    canvas.width = Math.round(vw * dpr)
    canvas.height = Math.round(vh * dpr)
  }

  // Past the cap, finish the oldest animating glyphs instantly so new ones never wait.
  const enforceCap = () => {
    let total = 0
    for (const g of glyphs) if (g.built && !g.built.cache) total += g.built.pending
    for (const g of glyphs) {
      if (total <= C.MAX_ACTIVE_ELEMENTS) break
      if (!g.built || g.built.cache || g.ffwd) continue
      g.ffwd = true
      total -= g.built.pending
    }
  }

  const draw = (now: number) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    glyphs.forEach((g, i) => {
      const b = g.built
      const pen = layout.pens[i]
      if (!b || !pen) return
      const s = layout.fs / b.fs
      // snap the pen to device pixels so unscaled glyph layers stay crisp
      const x = Math.round(pen.x * dpr) / dpr
      const y = Math.round(pen.y * dpr) / dpr
      ctx.setTransform(dpr * s, 0, 0, dpr * s, x * dpr - b.ox * dpr * s, y * dpr - b.oy * dpr * s)
      drawGlyph(ctx, b, ageOf(g, now))
    })
  }

  const frame = (now: number) => {
    if (sizeDirty) {
      resize()
      sizeDirty = false
      layoutDirty = true
      rebuildAll = true
    }
    if (layoutDirty) {
      layout = layoutText(
        glyphs.map((g) => g.char),
        vw,
        vh
      )
      layoutDirty = false
      dirty = true
    }

    // New glyphs and resizes build right away; size drift from typing is spread over frames.
    let budget = C.REBUILDS_PER_FRAME
    for (const g of glyphs) {
      if (!g.built || rebuildAll || g.built.dpr !== dpr) {
        build(g)
        dirty = true
        continue
      }
      const s = layout.fs / g.built.fs
      if (budget > 0 && (s < C.REBUILD_MIN_SCALE || s > C.REBUILD_MAX_SCALE)) {
        build(g)
        budget--
        dirty = true
      }
    }
    rebuildAll = false

    enforceCap()
    for (const g of glyphs) if (g.built && updateGlyph(g.built, ageOf(g, now))) dirty = true
    if (dirty) draw(now)
    dirty = false
    raf = requestAnimationFrame(frame)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
    if (e.key === C.REGENERATE_KEY) {
      e.preventDefault()
      seed = newSeed()
      const now = performance.now()
      // replay the whole line with a light ripple
      glyphs.forEach((g, i) => {
        g.birth = now + i * 40
        g.ffwd = false
        g.built = null
      })
      return
    }
    if (!C.TYPEABLE.test(e.key) || glyphs.length >= C.MAX_GLYPHS) return
    e.preventDefault()
    if (!glyphs.length) opts.onFirstType()
    glyphs.push({ char: C.FORCE_UPPERCASE ? e.key.toUpperCase() : e.key, index: glyphs.length, birth: performance.now(), ffwd: false, built: null })
    layoutDirty = true
  }

  const onResize = () => {
    sizeDirty = true
  }

  raf = requestAnimationFrame(frame)
  window.addEventListener("keydown", onKey)
  window.addEventListener("resize", onResize)
  return () => {
    cancelAnimationFrame(raf)
    window.removeEventListener("keydown", onKey)
    window.removeEventListener("resize", onResize)
  }
}
