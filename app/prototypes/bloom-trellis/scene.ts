import * as C from "./config"
import { type Bract, type Cluster, blob, drawBract, drawLeafShape } from "./bracts"
import { rgba } from "./color"
import { clamp } from "./ease"
import { type Faller, clearPetals, drawFallers, spawnFaller } from "./falling"
import { fontFamily, fontFor, fontWeight } from "./font"
import { type Letter, buildLetter, latticeLines } from "./glyph"
import { LEAF_VEIN_ALPHA, PALETTES, active, setPalette, syncDom, tickPalette } from "./palettes"
import { type Plant, type PlantLetter, addLetter, createPlant, fastForward, finishWither, removeLetter, settle } from "./plant"
import { drawClusters, drawDebug, drawLeaves, drawStems, drawThorns, kick, shrinking, updatePlant } from "./render"
import { type Layout, advanceEm, layoutText, stepEm } from "./text-layout"
import { SvgRecorder, embeddedFontCss } from "./svg-export"
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
  let paletteDebug = false
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
    // with nothing typed, the caret waits where the first letter will go
    caretTarget = last?.target ? { x: last.target.x + (stepEm(last.char) - C.TRACKING_EM + C.CARET_GAP_EM) * fs, y: last.target.y } : { x: vw / 2, y: layoutText(["x"], vw, vh).pens[0].y }
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
    const pool = clusters.filter((c) => age >= c.start + C.BRACT_OPEN_STAGGER_MS * 2 + 300).flatMap((c) => c.bracts.filter((br) => br.pose && (br.dropAt === Infinity || age >= br.regrowAt)))
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
          ` · arch candidates rejected: ${
            Object.entries(r.arch)
              .filter(([, n]) => n)
              .map(([k, n]) => `${k} ${n}`)
              .join(", ") || "none"
          }`
      )
  }

  const allPlants = () => [...plants.values(), ...dyingPlants]

  // Live letters in LETTER on their own layer, the lattice stroked source-atop over their box
  // (screen space, so it lines up with the panel), then composited. Dead letters aren't drawn.
  // The live letters and the box the lattice is stroked over (screen space).
  const letterBox = () => {
    const act = live().filter((g) => g.built?.ink && g.pen)
    const fs = layout.fs
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const g of act) {
      x0 = Math.min(x0, g.pen!.x - 0.3 * fs)
      x1 = Math.max(x1, g.pen!.x + (advanceEm(g.char) + 0.3) * fs)
      y0 = Math.min(y0, g.pen!.y - 1.1 * fs)
      y1 = Math.max(y1, g.pen!.y + 0.5 * fs)
    }
    return { act, fs, x0, y0, x1, y1 }
  }

  const drawLetters = (c: CanvasRenderingContext2D) => {
    lctx.setTransform(1, 0, 0, 1, 0, 0)
    lctx.clearRect(0, 0, lc.width, lc.height)
    const { act, fs, x0, y0, x1, y1 } = letterBox()
    if (!act.length) return
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    lctx.font = fontFor(fs)
    lctx.textAlign = "left"
    lctx.textBaseline = "alphabetic"
    lctx.fillStyle = active.letter
    for (const g of act) lctx.fillText(g.char, g.pen!.x, g.pen!.y)
    if (C.LETTER_LATTICE) {
      lctx.globalCompositeOperation = "source-atop"
      lctx.setTransform(dpr, 0, 0, dpr, x0 * dpr, y0 * dpr)
      lctx.strokeStyle = active.lattice
      lctx.lineWidth = C.LATTICE_WIDTH_PX
      latticeLines(lctx, x0, y0, x1 - x0, y1 - y0, C.LATTICE_SPACING_EM * fs)
      lctx.globalCompositeOperation = "source-over"
    }
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.drawImage(lc, 0, 0)
  }

  // SVG: the letters as text in the page's face, and the lattice clipped to them.
  const svgLetters = (rec: SvgRecorder) => {
    const { act, fs, x0, y0, x1, y1 } = letterBox()
    if (!act.length) return
    // clipPath may only hold shapes and text (no <g>), so each <text> carries the font itself
    const font = `font-family='${fontFamily().replace(/"/g, "")}' font-weight="${fontWeight()}" font-size="${fs * dpr}"`
    const texts = act.map((g) => rec.text(g.pen!.x * dpr, g.pen!.y * dpr, g.char, font)).join("")
    rec.raw(`<defs><clipPath id="bloom-ink">${texts}</clipPath></defs>`)
    rec.raw(`<g fill="${active.letter}">${texts}</g>`)
    if (!C.LETTER_LATTICE) return
    rec.group(`clip-path="url(#bloom-ink)"`)
    rec.setTransform(dpr, 0, 0, dpr, x0 * dpr, y0 * dpr)
    rec.strokeStyle = active.lattice
    rec.lineWidth = C.LATTICE_WIDTH_PX
    rec.lineCap = "butt"
    latticeLines(rec as unknown as CanvasRenderingContext2D, x0, y0, x1 - x0, y1 - y0, C.LATTICE_SPACING_EM * fs)
    rec.endGroup()
  }

  // Shift+P: each palette's letter, vine, leaf and every bract colour over its own bg.
  let sampleBract: Path2D | null = null
  const drawPaletteSamples = () => {
    sampleBract ??= blob(C.BRACT_POINTS, C.BRACT_WIDTH_RATIO, C.BRACT_WIDEST_AT, C.BRACT_ROUNDNESS)
    const w = 150
    const h = 120
    const cols = Math.max(1, Math.floor((vw - 16) / (w + 8)))
    PALETTES.forEach((p, i) => {
      const x = 16 + (i % cols) * (w + 8)
      const y = 16 + Math.floor(i / cols) * (h + 8)
      ctx.setTransform(dpr, 0, 0, dpr, x * dpr, y * dpr)
      ctx.fillStyle = p.bg
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = p.letter
      ctx.font = fontFor(44)
      ctx.textBaseline = "alphabetic"
      ctx.fillText("Aa", 10, 52)
      ctx.font = "11px sans-serif"
      ctx.fillText(p.name, 10, h - 10)
      ctx.strokeStyle = p.vine
      ctx.lineWidth = 3
      ctx.lineCap = "round"
      ctx.beginPath()
      ctx.moveTo(78, 60)
      ctx.quadraticCurveTo(100, 10, 140, 30)
      ctx.stroke()
      const vein = rgba(p.bg, LEAF_VEIN_ALPHA)
      ctx.setTransform(dpr * 30, 0, 0, dpr * 30, (x + 78) * dpr, (y + 78) * dpr)
      ctx.rotate(-0.5)
      drawLeafShape(ctx, 30, C.LEAF, C.LEAF_VEIN_WIDTH_PX, vein)
      Object.values(C.VARIETIES).forEach((v, j) => {
        ctx.setTransform(dpr * 18, 0, 0, dpr * 18, (x + 14 + j * 22) * dpr, (y + 92) * dpr)
        ctx.rotate(-Math.PI / 2)
        drawBract(ctx, { shape: sampleBract!, color: v.main, vein: v.vein, sideVeins: true }, 18, C.BRACT_VEIN_WIDTH_PX)
      })
    })
  }

  // mode "screen" draws everything; "png" and "svg" leave out the caret and debug overlays.
  // An SVG export passes an SvgRecorder as the context, so the same drawing code writes vectors.
  const draw = (now: number, c: CanvasRenderingContext2D = ctx, mode: "screen" | "png" | "svg" = "screen") => {
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.fillStyle = active.bg
    c.fillRect(0, 0, canvas.width, canvas.height)
    if (panel) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.strokeStyle = active.panel
      c.lineWidth = C.LATTICE_WIDTH_PX
      latticeLines(c, 0, 0, vw, vh, C.LATTICE_SPACING_EM * layout.fs)
    }
    const ps = allPlants()
    const each = (fn: (p: Plant, age: number, s: number) => void) => {
      for (const p of ps) {
        const f = frameOf(p)
        if (!f) continue
        c.setTransform(dpr * f.s, 0, 0, dpr * f.s, f.x * dpr, f.y * dpr)
        fn(p, now - p.host0.birth, f.s)
      }
    }
    // layer 0: behind the type
    each((p, age, s) => drawStems(c, p, age, 0, s))
    each((p, age) => drawThorns(c, p, age, 0))
    each((p, age) => drawLeaves(c, p, age, 0))
    if (mode === "svg") svgLetters(c as unknown as SvgRecorder)
    else drawLetters(c)
    // layer 1: in front, then every bloom
    each((p, age, s) => drawStems(c, p, age, 1, s))
    each((p, age) => drawThorns(c, p, age, 1))
    each((p, age) => drawLeaves(c, p, age, 1))
    each((p, age) => drawClusters(c, p, age))
    drawFallers(c, fallers, layout.fs, dpr, now)
    if (mode !== "screen") return
    if (debug) each((p, _age, s) => drawDebug(c, p, s))
    if (paletteDebug) drawPaletteSamples()

    // caret: solid for CARET_SOLID_MS after a key, then blinking
    // (before any key it just blinks, from page load)
    const sinceKey = now - (Number.isFinite(lastKey) ? lastKey : 0)
    if (caret && (sinceKey < C.CARET_SOLID_MS || Math.floor((sinceKey - C.CARET_SOLID_MS) / C.CARET_BLINK_MS) % 2 === 1)) {
      const fs = layout.fs
      const w = Math.max(1.5, (C.CARET_WIDTH_PX * fs) / C.REF_FONT_PX)
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.fillStyle = active.letterAlpha(C.CARET_ALPHA)
      c.fillRect(caret.x - w / 2, caret.y - C.CARET_TOP_EM * fs, w, (C.CARET_TOP_EM + C.CARET_BOTTOM_EM) * fs)
    }
  }

  // Replay the whole line's growth from scratch with a light ripple: a new garden (R), or the same
  // one again (for recording).
  const regrow = (now: number, fresh: boolean) => {
    if (fresh) seed = newSeed()
    plants.clear()
    dyingPlants = []
    fallers.length = 0
    glyphs = live()
    glyphs.forEach((g, i) => (g.birth = now + i * C.REGROW_RIPPLE_MS))
    relayout()
  }

  // ---- Export -----------------------------------------------------------------
  // The current frame with the active palette, without the caret or debug overlays.
  const exportPNG = () =>
    new Promise<Blob | null>((res) => {
      draw(performance.now(), ctx, "png")
      canvas.toBlob(res, "image/png") // snapshots now; the next frame redraws the caret
    })

  // Video: replay the current garden growing (same seed) and record the canvas, without the caret
  // or overlays. MP4 (H.264) where the browser can record it, otherwise WebM.
  let recorder: MediaRecorder | null = null
  const videoType = () => (typeof MediaRecorder === "undefined" ? null : (C.RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null))

  const recordVideo = () =>
    new Promise<{ blob: Blob; ext: string } | null>((res) => {
      const type = videoType()
      if (!type || recorder) return res(null)
      regrow(performance.now(), false)
      const stream = canvas.captureStream(C.RECORD_FPS)
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: C.RECORD_BITRATE })
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      rec.onstop = () => {
        recorder = null
        stream.getTracks().forEach((t) => t.stop())
        res({ blob: new Blob(chunks, { type: type.split(";")[0] }), ext: type.startsWith("video/mp4") ? "mp4" : "webm" })
      }
      recorder = rec
      rec.start(250)
      setTimeout(() => rec.state !== "inactive" && rec.stop(), C.RECORD_MS)
    })

  const stopRecording = () => {
    if (recorder?.state === "recording") recorder.stop()
  }

  const exportSVG = async () => {
    const rec = new SvgRecorder(canvas.width, canvas.height, vw, vh)
    draw(performance.now(), rec as unknown as CanvasRenderingContext2D, "svg")
    const fontCss = await embeddedFontCss(fontFamily())
    return new Blob([rec.toString(fontCss)], { type: "image/svg+xml" })
  }

  const frame = (now: number) => {
    const dtMs = clamp(now - (lastNow || now), 0, C.EASE_DT_MAX_MS)
    const dt = Math.min(dtMs / 1000, C.SWAY_MAX_DT)
    lastNow = now
    const tA = performance.now()
    // palette crossfade: colours are read at draw time, so nothing regrows
    if (tickPalette(now)) syncDom()
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
    for (let i = 0; i < act.length;) {
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

    draw(now, ctx, recorder ? "png" : "screen") // recording: no caret or overlays
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
    // Esc, Enter or Cmd/Ctrl+Backspace clear everything
    const clearAll = e.key === "Escape" || e.key === "Enter" || (e.key === "Backspace" && (e.metaKey || e.ctrlKey))
    if (!clearAll && (e.ctrlKey || e.metaKey || e.altKey)) return
    const now = performance.now()
    // toggles ignore auto-repeat; typing and Backspace handle every keydown, repeats included
    if (e.key === "Tab") {
      // Tab / Shift+Tab: next / previous palette
      e.preventDefault()
      setPalette(active.index + (e.shiftKey ? -1 : 1))
      return
    }
    if (e.key === C.REGENERATE_KEY || e.key === C.LATTICE_PANEL_KEY || e.key === C.DEBUG_KEY || e.key === C.BACKSPACE_DEBUG_KEY || e.key === C.PALETTE_DEBUG_KEY) {
      e.preventDefault()
      if (e.repeat) return
      if (e.key === C.REGENERATE_KEY) regrow(now, true)
      else if (e.key === C.LATTICE_PANEL_KEY) panel = !panel
      else if (e.key === C.PALETTE_DEBUG_KEY) paletteDebug = !paletteDebug
      else if (e.key === C.DEBUG_KEY) {
        debug = !debug
        if (debug) logRejections()
      } else {
        bsDebug = !bsDebug
        console.log(`[backspace] diagnostics ${bsDebug ? "on" : "off"}`)
      }
      return
    }
    if (e.key === "Backspace" || clearAll) {
      e.preventDefault()
      const act = live()
      if (!act.length) return
      lastKey = now
      const t = performance.now()
      // Backspace: the last live glyph dies. Clear: every live glyph does, with the same wither.
      const from = clearAll ? 0 : act.length - 1
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
  return {
    stop: () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", onResize)
    },
    exportPNG,
    exportSVG,
    recordVideo,
    stopRecording,
    videoExt: () => (videoType()?.startsWith("video/mp4") ? "mp4" : videoType() ? "webm" : null),
  }
}

export type Scene = ReturnType<typeof createScene>
