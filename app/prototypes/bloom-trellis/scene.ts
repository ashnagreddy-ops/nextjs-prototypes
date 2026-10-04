import * as C from "./config"
import type { Bract } from "./bracts"
import { rgba } from "./color"
import { clamp, unit } from "./ease"
import { type Faller, drawFallers, spawnFaller } from "./falling"
import { type Letter, buildLetter, drawLetter, latticeLines } from "./glyph"
import { type Plant, addLetter, createPlant, finishWither, removeLetter, settle } from "./plant"
import { drawClusters, drawDebug, drawLeaves, drawStems, drawThorns, kick, updatePlant } from "./render"
import { type Layout, advanceEm, layoutText, stepEm } from "./text-layout"
import { isSpace, styleFor, varietyFor } from "./words"

// One typed character. Its letter shape is built once; the word it belongs to owns a plant
// (all stems, leaves and blooms), drawn from the word's first pen.
type Glyph = {
  char: string
  index: number
  birth: number // ms timestamp of the keypress
  built: Letter | null
  pen: { x: number; y: number } | null // current pen origin, css px (frozen while withering)
  fs: number // font size it's drawn at (frozen while withering)
  dyingAt?: number // timestamp of the backspace
  holdSlot?: boolean // withering, and still keeping its place in the layout
}

const newSeed = () => (Math.random() * 2 ** 32) >>> 0
const range = (a: number, b: number) => a + Math.random() * (b - a)

export function createScene(canvas: HTMLCanvasElement, opts: { onFirstType: () => void }) {
  const ctx = canvas.getContext("2d")!
  let seed = newSeed()
  const glyphs: Glyph[] = []
  const dying: Glyph[] = []
  const plants = new Map<number, Plant>() // by the index of the word's first glyph
  let dyingPlants: Plant[] = [] // whole words deleted, still withering
  const fallers: Faller[] = []
  let layout: Layout = { fs: 0, pens: [] }
  let vw = 0
  let vh = 0
  let dpr = 1
  let sizeDirty = true
  let layoutDirty = true
  let raf = 0
  let panel = C.LATTICE_PANEL_DEFAULT
  let debug = false
  let lastKey = -Infinity
  let lastNow = 0
  let nextFall = performance.now() + range(C.FALL_EVERY_MIN_MS, C.FALL_EVERY_MAX_MS)

  const resize = () => {
    dpr = window.devicePixelRatio || 1
    vw = window.innerWidth
    vh = window.innerHeight
    canvas.width = Math.round(vw * dpr)
    canvas.height = Math.round(vh * dpr)
  }

  // A plant is drawn from its first glyph's pen, at that glyph's size.
  const frameOf = (p: Plant) => {
    const g = p.host0 as Glyph
    return g.pen ? { x: g.pen.x, y: g.pen.y, s: g.fs / C.REF_FONT_PX } : null
  }

  // The live letter nearest to screen x, for a falling bract to land by.
  const nearestLetter = (x: number, fallback: Glyph) => {
    let best: Glyph | null = null
    let bd = Infinity
    for (const g of glyphs) {
      if (isSpace(g.char) || !g.pen) continue
      const d = Math.abs(g.pen.x + (advanceEm(g.char) * g.fs) / 2 - x)
      if (d < bd) {
        bd = d
        best = g
      }
    }
    return best ?? fallback
  }

  const drop = (p: Plant, br: Bract, now: number) => {
    const f = frameOf(p)
    if (!br.pose || !f) return
    const x = f.x + br.pose.x * f.s
    const y = f.y + br.pose.y * f.s
    spawnFaller(fallers, { x, y, angle: br.pose.angle, len: br.len * br.pose.scale * f.s }, br, nearestLetter(x, p.host0 as Glyph), layout.fs, now)
  }

  // Every so often one bract lets go of a fully open cluster, and regrows later.
  const idleDrop = (now: number) => {
    if (now < nextFall) return
    nextFall = now + range(C.FALL_EVERY_MIN_MS, C.FALL_EVERY_MAX_MS)
    const pool: { p: Plant; br: Bract }[] = []
    for (const p of plants.values()) {
      const age = now - p.host0.birth
      for (const c of p.clusters) {
        const v = p.vines[c.vine]
        if (v.dead || v.dying !== Infinity || age < c.start + C.BRACT_OPEN_STAGGER_MS * 2 + 1000) continue
        for (const br of c.bracts) if (br.dropAt === Infinity && br.pose) pool.push({ p, br })
      }
    }
    if (!pool.length) return
    const { p, br } = pool[Math.floor(Math.random() * pool.length)]
    const age = now - p.host0.birth
    drop(p, br, now)
    br.dropAt = age
    br.regrowAt = age + C.BRACT_REGROW_MS
  }

  const wordStartOf = (i: number) => {
    while (i > 0 && !isSpace(glyphs[i - 1].char)) i--
    return i
  }

  const logRejections = () => {
    const rows = [...plants.values()].map((p) => ({
      word: glyphs
        .slice(p.start, p.start + p.letters.length)
        .map((g) => g.char)
        .join(""),
      stems: p.vines.filter((v) => !v.dead).length,
      ...p.rejected,
      arch: p.archRejected,
    }))
    for (const r of rows)
      console.log(
        `[bloom-trellis] "${r.word}" stems ${r.stems} · rejected: reach ${r.reach}, self ${r.self}, parallel ${r.parallel}, front ${r.front}, calm ${r.calm} · skipped ${r.skipped}` +
          ` · arch candidates rejected: ${Object.entries(r.arch)
            .filter(([, n]) => n)
            .map(([k, n]) => `${k} ${n}`)
            .join(", ") || "none"}`
      )
  }

  const allPlants = () => [...plants.values(), ...dyingPlants]

  const draw = (now: number) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (panel) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.strokeStyle = rgba(C.LATTICE_PANEL_COLOR, C.LATTICE_PANEL_ALPHA)
      ctx.lineWidth = C.LATTICE_WIDTH_PX
      latticeLines(ctx, 0, 0, vw, vh, C.LATTICE_SPACING_EM * layout.fs)
    }
    const ps = allPlants()
    const each = (fn: (p: Plant, age: number, s: number) => void) => {
      for (const p of ps) {
        const f = frameOf(p)
        if (!f) continue
        ctx.setTransform(dpr * f.s, 0, 0, dpr * f.s, f.x * dpr, f.y * dpr)
        fn(p, now - p.host0.birth, f.s)
      }
    }
    // layer 0: behind the type
    each((p, age, s) => drawStems(ctx, p, age, 0, s))
    each((p, age) => drawThorns(ctx, p, age, 0))
    each((p, age) => drawLeaves(ctx, p, age, 0))
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    for (const g of [...glyphs, ...dying]) {
      if (!g.built || !g.pen) continue
      const alpha = g.dyingAt === undefined ? 1 : 1 - unit(now - g.dyingAt, C.WITHER_LETTER_DELAY_MS, C.WITHER_LETTER_MS)
      drawLetter(ctx, g.built, g.pen, g.fs, dpr, alpha)
    }
    // layer 1: in front, then every bloom
    each((p, age, s) => drawStems(ctx, p, age, 1, s))
    each((p, age) => drawThorns(ctx, p, age, 1))
    each((p, age) => drawLeaves(ctx, p, age, 1))
    each((p, age) => drawClusters(ctx, p, age))
    drawFallers(ctx, fallers, layout.fs, dpr, now)
    if (debug) each((p, _age, s) => drawDebug(ctx, p, s))

    // caret after the last glyph
    const sinceKey = now - lastKey
    if (sinceKey < C.CARET_SOLID_MS || Math.floor((sinceKey - C.CARET_SOLID_MS) / C.CARET_BLINK_MS) % 2 === 1) {
      const fs = layout.fs
      const last = glyphs[glyphs.length - 1]
      const x = last?.pen ? last.pen.x + (stepEm(last.char) - C.TRACKING_EM + C.CARET_GAP_EM) * fs : vw / 2
      const y = last?.pen ? last.pen.y : vh / 2 + 0.3 * fs
      const w = Math.max(1.5, (C.CARET_WIDTH_PX * fs) / C.REF_FONT_PX)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = rgba(C.LETTER, C.CARET_ALPHA)
      ctx.fillRect(x - w / 2, y - C.CARET_TOP_EM * fs, w, (C.CARET_TOP_EM + C.CARET_BOTTOM_EM) * fs)
    }
  }

  const frame = (now: number) => {
    const dt = clamp((now - (lastNow || now)) / 1000, 0, C.SWAY_MAX_DT)
    lastNow = now
    if (sizeDirty) {
      resize()
      sizeDirty = false
      layoutDirty = true
    }
    // withering glyphs at the end of the line keep their slot until they're gone, so the line
    // doesn't re-centre under them (most recently removed first in reading order)
    const placed = [...glyphs, ...dying.filter((g) => g.holdSlot).reverse()]
    if (layoutDirty) {
      layout = layoutText(
        placed.map((g) => g.char),
        vw,
        vh
      )
      layoutDirty = false
    }
    placed.forEach((g, i) => {
      g.pen = layout.pens[i] ?? null
      g.fs = layout.fs
    })

    // Words are runs of non-space glyphs; each grows one plant, letter by letter.
    for (let i = 0; i < glyphs.length; ) {
      if (isSpace(glyphs[i].char)) {
        i++
        continue
      }
      let end = i
      while (end < glyphs.length && !isSpace(glyphs[end].char)) end++
      let p = plants.get(i)
      if (!p) plants.set(i, (p = createPlant(seed, i, glyphs[i], styleFor(seed, i), varietyFor(seed, i))))
      for (let k = i + p.letters.length; k < end; k++) {
        const g = glyphs[k]
        g.built ??= buildLetter(g.char)
        addLetter(p, g, g.built)
      }
      // settled: followed by a space, or no new letter for a while
      if (end < glyphs.length || now - glyphs[end - 1].birth > C.WORD_SETTLE_MS) {
        // the arch keeps ARCH_TOP_MARGIN_VH clear of the viewport's top edge
        const f = frameOf(p)
        const topLimit = f ? (C.ARCH_TOP_MARGIN_VH * vh - f.y) / f.s : -Infinity
        if (settle(p, now, topLimit) && debug) logRejections()
      }
      i = end
    }

    for (const p of allPlants()) {
      const f = frameOf(p)
      const age = now - p.host0.birth
      if (f) updatePlant(p, age, now, dt, f.x, f.s)
      // withering stems release their bracts on schedule
      for (const c of p.clusters)
        for (const br of c.bracts)
          if (br.pending && age >= br.dropAt) {
            br.pending = false
            drop(p, br, now)
          }
      finishWither(p, age)
    }
    dyingPlants = dyingPlants.filter((p) => p.gone.length)
    for (let i = dying.length - 1; i >= 0; i--) {
      const g = dying[i]
      if (now - g.dyingAt! > C.WITHER_TOTAL_MS) {
        dying.splice(i, 1)
        if (g.holdSlot) layoutDirty = true
      }
    }
    idleDrop(now)

    draw(now)
    raf = requestAnimationFrame(frame)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
    const now = performance.now()
    if (e.key === C.REGENERATE_KEY) {
      e.preventDefault()
      seed = newSeed()
      dying.length = 0
      plants.clear()
      dyingPlants = []
      // replay the whole line with a light ripple
      glyphs.forEach((g, i) => (g.birth = now + i * 40))
      layoutDirty = true
      return
    }
    if (e.key === C.LATTICE_PANEL_KEY) {
      e.preventDefault()
      panel = !panel
      return
    }
    if (e.key === C.DEBUG_KEY) {
      e.preventDefault()
      debug = !debug
      if (debug) logRejections()
      return
    }
    if (e.key === "Backspace") {
      e.preventDefault()
      const g = glyphs.pop()
      if (!g) return
      lastKey = now
      if (isSpace(g.char) || !g.pen) {
        layoutDirty = true
        return
      }
      // wither: the letter keeps its slot and fades; its stems drop every bract in a staggered
      // burst and pull back
      g.dyingAt = now
      g.holdSlot = true
      dying.push(g)
      const start = wordStartOf(glyphs.length)
      const p = plants.get(start)
      if (!p) return
      const age = now - p.host0.birth
      for (const c of removeLetter(p, age))
        for (const br of c.bracts)
          if (age < br.dropAt || age >= br.regrowAt) {
            br.dropAt = age + Math.random() * C.WITHER_BURST_MS
            br.regrowAt = Infinity
            br.pending = true
          }
      if (!p.letters.length) {
        plants.delete(start)
        dyingPlants.push(p)
      } else kick(p, C.RECOIL_KICK_DEG_S) // the rest of the word flinches
      return
    }
    if (!C.TYPEABLE.test(e.key) || glyphs.length >= C.MAX_GLYPHS) return
    e.preventDefault()
    if (!glyphs.length) opts.onFirstType()
    lastKey = now
    // typing on: withering glyphs give up their slots and finish where they are
    for (const g of dying) g.holdSlot = false
    glyphs.push({ char: C.FORCE_UPPERCASE ? e.key.toUpperCase() : e.key, index: glyphs.length, birth: now, built: null, pen: null, fs: layout.fs })
    // a small gust through the word being typed
    const p = plants.get(wordStartOf(glyphs.length - 1))
    if (p) kick(p, C.TYPE_KICK_DEG_S)
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
