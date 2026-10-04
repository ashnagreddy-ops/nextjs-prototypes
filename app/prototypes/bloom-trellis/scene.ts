import * as C from "./config"
import type { Bract, Cluster } from "./bracts"
import { rgba } from "./color"
import { clamp } from "./ease"
import { type Faller, clearPetals, drawFallers, spawnFaller } from "./falling"
import { fontFor } from "./font"
import { type Letter, buildLetter, latticeLines } from "./glyph"
import { type Plant, type PlantLetter, addLetter, createPlant, fastForward, finishWither, removeLetter, settle } from "./plant"
import { drawClusters, drawDebug, drawLeaves, drawStems, drawThorns, kick, shrinking, updatePlant } from "./render"
import { type Layout, advanceEm, layoutText, stepEm } from "./text-layout"
import { isSpace, styleFor, varietiesFor } from "./words"

// One typed character. Its letter shape is built once; the word it belongs to owns a plant
// (all stems, leaves and blooms), drawn from the word's first pen. Everything lives in this
// closure and is read by the rAF loop: key events never touch React.
type Glyph = {
  char: string
  birth: number // ms timestamp of the keypress
  built: Letter | null
  pen: { x: number; y: number } | null // current pen origin, css px, easing toward target
  target: { x: number; y: number } | null
  fs: number
  dead: number // timestamp of its backspace (Infinity while live); kept REMOVE_MS for the wither
  pl?: { p: Plant; L: PlantLetter } // its plant letter, once dead (to fast-forward the wither)
}

type Pt = { x: number; y: number }

const newSeed = () => (Math.random() * 2 ** 32) >>> 0
const range = (a: number, b: number) => a + Math.random() * (b - a)

export function createScene(canvas: HTMLCanvasElement, opts: { onFirstType: () => void }) {
  const ctx = canvas.getContext("2d")!
  // letters are drawn onto their own layer so the lattice can be cut into them in one pass
  const lc = document.createElement("canvas")
  const lctx = lc.getContext("2d")!
  let seed = newSeed()
  let glyphs: Glyph[] = [] // live and dead, in typing order
  const plants = new Map<number, Plant>() // by the index of the word's first glyph among live glyphs
  let dyingPlants: Plant[] = [] // whole words deleted, still withering
  const fallers: Faller[] = []
  let layout: Layout = { fs: 0, pens: [] }
  let vw = 0
  let vh = 0
  let dpr = 1
  let sizeDirty = true
  let raf = 0
  let panel = C.LATTICE_PANEL_DEFAULT
  let debug = false
  let lastKey = -Infinity
  let lastNow = 0
  let caret: Pt | null = null
  let caretTarget: Pt = { x: 0, y: 0 }
  let nextFall = performance.now() + range(C.FALL_EVERY_MIN_MS, C.FALL_EVERY_MAX_MS)
  // Backspace diagnostics (BACKSPACE_DEBUG_KEY): keydown -> first frame its plant draws shorter,
  // and any slow frame in the next second split into layout / geometry / render.
  let bsDebug = false
  let bsWatch: { t0: number; p: Plant; owner: unknown; seen: boolean; until: number } | null = null

  const live = () => glyphs.filter((g) => g.dead === Infinity)

  const resize = () => {
    dpr = window.devicePixelRatio || 1
    vw = window.innerWidth
    vh = window.innerHeight
    canvas.width = lc.width = Math.round(vw * dpr)
    canvas.height = lc.height = Math.round(vh * dpr)
  }

  // New targets for the live glyphs and the caret. Called on the keypress itself, so they move
  // that frame; dead glyphs keep where they are.
  const relayout = () => {
    const act = live()
    layout = layoutText(
      act.map((g) => g.char),
      vw,
      vh
    )
    act.forEach((g, i) => {
      g.target = layout.pens[i]
      g.pen ??= { ...g.target }
      g.fs = layout.fs
    })
    const last = act[act.length - 1]
    const fs = layout.fs
    caretTarget = last?.target ? { x: last.target.x + (stepEm(last.char) - C.TRACKING_EM + C.CARET_GAP_EM) * fs, y: last.target.y } : { x: vw / 2, y: vh / 2 + 0.3 * fs }
    caret ??= { ...caretTarget }
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
    for (const g of live()) {
      if (isSpace(g.char) || !g.pen) continue
      const d = Math.abs(g.pen.x + (advanceEm(g.char) * g.fs) / 2 - x)
      if (d < bd) {
        bd = d
        best = g
      }
    }
    return best ?? fallback
  }

  const drop = (p: Plant, br: Bract, now: number, delay = 0, life = Infinity) => {
    const f = frameOf(p)
    if (!br.pose || !f) return
    const x = f.x + br.pose.x * f.s
    const y = f.y + br.pose.y * f.s
    spawnFaller(fallers, { x, y, angle: br.pose.angle, len: br.len * br.pose.scale * f.s }, br, nearestLetter(x, p.host0 as Glyph), layout.fs, now, delay, life)
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

  // A deleted glyph's open clusters shed up to WITHER_BURST_MAX bracts as independent particles,
  // each after its own short delay. The wither never waits for them.
  const burst = (p: Plant, clusters: Cluster[], age: number, now: number) => {
    const pool = clusters
      .filter((c) => age >= c.start + C.BRACT_OPEN_STAGGER_MS * 2 + 300)
      .flatMap((c) => c.bracts.filter((br) => br.pose && (br.dropAt === Infinity || age >= br.regrowAt)))
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    // they fall away and fade rather than coming to rest
    for (const br of pool.slice(0, C.WITHER_BURST_MAX)) drop(p, br, now, Math.random() * C.WITHER_BURST_DELAY_MS, C.WITHER_BURST_LIFE_MS)
  }

  // Index (among live glyphs) of the first glyph of the word containing live index i.
  const wordStart = (act: Glyph[], i: number) => {
    while (i > 0 && !isSpace(act[i - 1].char)) i--
    return i
  }

  // The deletion itself: mark the glyph dead and wither what it owns. Synchronous; nothing waits.
  const kill = (g: Glyph, act: Glyph[], i: number, now: number, keydown: number) => {
    g.dead = now
    if (isSpace(g.char)) return
    // petals lying on it go too
    if (g.pen) clearPetals(fallers, g, g.pen.x, g.pen.x + advanceEm(g.char) * g.fs, layout.fs, now)
    const start = wordStart(act, i)
    const p = plants.get(start)
    if (!p) return
    const age = now - p.host0.birth
    const r = removeLetter(p, age)
    if (r) {
      g.pl = { p, L: r.L }
      burst(p, r.clusters, age, now)
      if (bsDebug) bsWatch = { t0: keydown, p, owner: r.L, seen: false, until: keydown + C.BACKSPACE_WATCH_MS }
    }
    if (!p.letters.length) {
      plants.delete(start)
      dyingPlants.push(p)
    } else kick(p, C.RECOIL_KICK_DEG_S) // the rest of the word flinches
  }

  // At most WITHER_MAX glyphs wither at once; older ones are finished off.
  const capWithering = (now: number) => {
    const dying = glyphs.filter((g) => g.dead !== Infinity && now - g.dead <= C.REMOVE_MS).sort((a, b) => a.dead - b.dead)
    for (const g of dying.slice(0, Math.max(0, dying.length - C.WITHER_MAX))) {
      g.dead = now - C.REMOVE_MS - 1
      if (g.pl) fastForward(g.pl.p, g.pl.L, now - g.pl.p.host0.birth)
    }
  }

  const logRejections = () => {
    const act = live()
    const rows = [...plants.values()].map((p) => ({
      word: act
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

  // Live letters in LETTER on their own layer, the lattice stroked source-atop over their box
  // (screen space, so it lines up with the panel), then composited. Dead letters aren't drawn.
  const drawLetters = () => {
    lctx.setTransform(1, 0, 0, 1, 0, 0)
    lctx.clearRect(0, 0, lc.width, lc.height)
    const act = live().filter((g) => g.built?.ink && g.pen)
    if (!act.length) return
    const fs = layout.fs
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    lctx.font = fontFor(fs)
    lctx.textAlign = "left"
    lctx.textBaseline = "alphabetic"
    lctx.fillStyle = C.LETTER
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const g of act) {
      lctx.fillText(g.char, g.pen!.x, g.pen!.y)
      x0 = Math.min(x0, g.pen!.x - 0.3 * fs)
      x1 = Math.max(x1, g.pen!.x + (advanceEm(g.char) + 0.3) * fs)
      y0 = Math.min(y0, g.pen!.y - 1.1 * fs)
      y1 = Math.max(y1, g.pen!.y + 0.5 * fs)
    }
    lctx.globalCompositeOperation = "source-atop"
    lctx.setTransform(dpr, 0, 0, dpr, x0 * dpr, y0 * dpr)
    lctx.strokeStyle = rgba(C.LATTICE_LINE, C.LATTICE_LINE_ALPHA)
    lctx.lineWidth = C.LATTICE_WIDTH_PX
    latticeLines(lctx, x0, y0, x1 - x0, y1 - y0, C.LATTICE_SPACING_EM * fs)
    lctx.globalCompositeOperation = "source-over"
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(lc, 0, 0)
  }

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
    drawLetters()
    // layer 1: in front, then every bloom
    each((p, age, s) => drawStems(ctx, p, age, 1, s))
    each((p, age) => drawThorns(ctx, p, age, 1))
    each((p, age) => drawLeaves(ctx, p, age, 1))
    each((p, age) => drawClusters(ctx, p, age))
    drawFallers(ctx, fallers, layout.fs, dpr, now)
    if (debug) each((p, _age, s) => drawDebug(ctx, p, s))

    // caret: solid for CARET_SOLID_MS after a key, then blinking
    const sinceKey = now - lastKey
    if (caret && (sinceKey < C.CARET_SOLID_MS || Math.floor((sinceKey - C.CARET_SOLID_MS) / C.CARET_BLINK_MS) % 2 === 1)) {
      const fs = layout.fs
      const w = Math.max(1.5, (C.CARET_WIDTH_PX * fs) / C.REF_FONT_PX)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = rgba(C.LETTER, C.CARET_ALPHA)
      ctx.fillRect(caret.x - w / 2, caret.y - C.CARET_TOP_EM * fs, w, (C.CARET_TOP_EM + C.CARET_BOTTOM_EM) * fs)
    }
  }

  const frame = (now: number) => {
    const dtMs = clamp(now - (lastNow || now), 0, C.EASE_DT_MAX_MS)
    const dt = Math.min(dtMs / 1000, C.SWAY_MAX_DT)
    lastNow = now
    const tA = performance.now()
    if (sizeDirty) {
      resize()
      sizeDirty = false
      relayout()
    }
    // live glyphs and the caret ease toward their targets; dead glyphs stay put
    const k = 1 - Math.exp(-dtMs / C.LAYOUT_EASE_MS)
    const act = live()
    for (const g of act)
      if (g.pen && g.target) {
        g.pen.x += (g.target.x - g.pen.x) * k
        g.pen.y += (g.target.y - g.pen.y) * k
      }
    if (caret) {
      caret.x += (caretTarget.x - caret.x) * k
      caret.y += (caretTarget.y - caret.y) * k
    }
    const tB = performance.now()

    // Words are runs of live non-space glyphs; each grows one plant, letter by letter.
    let prev: Plant | null = null
    for (let i = 0; i < act.length; ) {
      if (isSpace(act[i].char)) {
        i++
        continue
      }
      let end = i
      while (end < act.length && !isSpace(act[end].char)) end++
      let p = plants.get(i)
      if (!p || p.host0 !== act[i]) plants.set(i, (p = createPlant(seed, i, act[i], styleFor(seed, i), varietiesFor(seed, i, prev?.varieties[0]))))
      for (let j = i + p.letters.length; j < end; j++) {
        const g = act[j]
        g.built ??= buildLetter(g.char)
        addLetter(p, g, g.built)
      }
      // settled: followed by a space, or no key (typing or deleting) for a while
      if (end < act.length || now - Math.max(lastKey, act[end - 1].birth) > C.WORD_SETTLE_MS) {
        // the arch keeps ARCH_TOP_MARGIN_VH clear of the viewport's top edge
        const f = frameOf(p)
        const topLimit = f ? (C.ARCH_TOP_MARGIN_VH * vh - f.y) / f.s : -Infinity
        if (settle(p, now, topLimit) && debug) logRejections()
      }
      prev = p
      i = end
    }

    for (const p of allPlants()) {
      const f = frameOf(p)
      const age = now - p.host0.birth
      if (f) updatePlant(p, age, now, dt, f.x, f.s)
      finishWither(p, age)
    }
    dyingPlants = dyingPlants.filter((p) => p.gone.length)
    glyphs = glyphs.filter((g) => now - g.dead <= C.REMOVE_MS)
    idleDrop(now)
    const tC = performance.now()

    draw(now)
    const tD = performance.now()
    if (bsDebug && bsWatch) {
      const w = bsWatch
      if (!w.seen && shrinking(w.p, w.owner)) {
        w.seen = true
        console.log(`[backspace] first shrinking frame ${(tD - w.t0).toFixed(1)}ms after keydown`)
      }
      if (tD - tA > C.BACKSPACE_SLOW_FRAME_MS)
        console.log(`[backspace] slow frame ${(tD - tA).toFixed(1)}ms · layout ${(tB - tA).toFixed(1)} · geometry ${(tC - tB).toFixed(1)} · render ${(tD - tC).toFixed(1)}`)
      if (tD > w.until) {
        if (!w.seen) console.log("[backspace] its plant never drew shorter within the window")
        bsWatch = null
      }
    }
    raf = requestAnimationFrame(frame)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const now = performance.now()
    // toggles ignore auto-repeat; typing and Backspace handle every keydown, repeats included
    if (e.key === C.REGENERATE_KEY || e.key === C.LATTICE_PANEL_KEY || e.key === C.DEBUG_KEY || e.key === C.BACKSPACE_DEBUG_KEY) {
      e.preventDefault()
      if (e.repeat) return
      if (e.key === C.REGENERATE_KEY) {
        seed = newSeed()
        plants.clear()
        dyingPlants = []
        glyphs = live()
        // replay the whole line with a light ripple
        glyphs.forEach((g, i) => (g.birth = now + i * 40))
        relayout()
      } else if (e.key === C.LATTICE_PANEL_KEY) panel = !panel
      else if (e.key === C.DEBUG_KEY) {
        debug = !debug
        if (debug) logRejections()
      } else {
        bsDebug = !bsDebug
        console.log(`[backspace] diagnostics ${bsDebug ? "on" : "off"}`)
      }
      return
    }
    if (e.key === "Backspace" || e.key === "Enter") {
      e.preventDefault()
      const act = live()
      if (!act.length) return
      lastKey = now
      const t = performance.now()
      // Backspace: the last live glyph dies. Enter: every live glyph does, with the same wither.
      const from = e.key === "Enter" ? 0 : act.length - 1
      for (let i = act.length - 1; i >= from; i--) kill(act[i], act, i, now, e.timeStamp)
      capWithering(now)
      relayout()
      if (bsDebug) console.log(`[backspace] handler ${(performance.now() - t).toFixed(2)}ms${e.repeat ? " (repeat)" : ""}`)
      return
    }
    if (!C.TYPEABLE.test(e.key)) return
    const act = live()
    if (act.length >= C.MAX_GLYPHS) return
    e.preventDefault()
    if (!act.length) opts.onFirstType()
    lastKey = now
    glyphs.push({ char: C.FORCE_UPPERCASE ? e.key.toUpperCase() : e.key, birth: now, built: null, pen: null, target: null, fs: layout.fs, dead: Infinity })
    relayout()
    // a small gust through the word being typed
    const p = plants.get(wordStart(act, act.length))
    if (p) kick(p, C.TYPE_KICK_DEG_S)
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
