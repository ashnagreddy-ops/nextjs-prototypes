"use client"

import { useEffect, useRef } from "react"

// ---------------------------------------------------------------------------
// CONFIG — every tunable lives here. Colors are literal because the whole
// scene is painted onto a <canvas>, which can't read CSS tokens (same
// documented exception as rain-scene's RainCanvas).
// ---------------------------------------------------------------------------
export const CONFIG = {
  cell: { desktop: 12, min: 8, refWidth: 1440 }, // px; scales with viewport width
  region: { desktopStart: 0.45, mobileBreakpoint: 768, mobileHeightFrac: 0.56 },
  grid: { size: 80, color: "#E8E4DE", width: 1 },
  palette: {
    rose: "#C8505A",
    coral: "#E07A7F",
    blush: "#F4B6BA",
    stemDark: "#2F5E2A",
    stemLight: "#5E8F3A",
    center: "#4A1E1A",
    centerHighlight: "#8A4A44",
    petalDrift: ["#E07A7F", "#F4B6BA", "#D9767F", "#EFA0A6"],
  },
  jitter: { lightness: 0.05, hue: 4, seed: 1337 }, // ±5% L, ±4° H, keyed to cell position
  alpha: { cutoff: 0.06, gamma: 0.75 }, // soft/dithered silhouettes
  intro: { duration: 1800, cellDelay: 120, cellPop: 180, bloomStart: 900, bloomDuration: 900 },
  sway: { degrees: 1.5, period: 6000, bloomDegrees: 0.7 },
  particles: { count: 5, speed: [18, 34], wobble: [6, 14], rotSpeed: [-0.4, 0.4], fadeZone: 140 },
  repel: { radius: 90, strength: 380, spring: 90, damping: 11, brighten: 0.1 },
  scene: { width: 100, height: 140 }, // vector scene units; base of stems at (0,0), y up = negative
} as const

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const rand = (a: number, b: number) => a + Math.random() * (b - a)

// cubic-bezier(.2,.8,.2,1) easing via Newton iteration on the x-curve
function cubicBezier(p1x: number, p1y: number, p2x: number, p2y: number) {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const sy = (t: number) => ((ay * t + by) * t + cy) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 6; i++) {
      const d = dx(t)
      if (Math.abs(d) < 1e-6) break
      t -= (sx(t) - x) / d
    }
    return sy(t)
  }
}
const ease = cubicBezier(0.2, 0.8, 0.2, 1)

// stable 2D hash → [0,1). Same (x, y, seed) always gives the same value.
function hash2(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// rgb (0-255) → hsl (h 0-360, s/l 0-1)
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}
function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hh = ((h % 360) + 360) / 360 % 1
  return [hue2rgb(p, q, hh + 1 / 3) * 255, hue2rgb(p, q, hh) * 255, hue2rgb(p, q, hh - 1 / 3) * 255]
}
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// ---------------------------------------------------------------------------
// scene description (vector layer). Units: CONFIG.scene, base of bouquet at
// (0,0), y grows downward so the blooms are at negative y.
// ---------------------------------------------------------------------------
type Bloom = {
  kind: "tulip" | "open"
  head: [number, number]
  ctrl: [number, number]
  size: number
  tilt: number // radians, resting tilt of the bloom head
  phase: number // per-bloom sway offset
}
const BLOOMS: Bloom[] = [
  { kind: "open", head: [12, -88], ctrl: [8, -40], size: 1, tilt: 0.05, phase: 0.0 },
  { kind: "tulip", head: [-24, -76], ctrl: [-8, -36], size: 1.05, tilt: -0.28, phase: 1.7 },
  { kind: "tulip", head: [-6, -114], ctrl: [-4, -60], size: 1.0, tilt: -0.06, phase: 3.1 },
  { kind: "tulip", head: [36, -80], ctrl: [14, -40], size: 1.1, tilt: 0.3, phase: 4.6 },
]
type Leaf = { at: [number, number]; angle: number; len: number; width: number }
const LEAVES: Leaf[] = [
  { at: [-2, -22], angle: -2.3, len: 24, width: 6.5 },
  { at: [3, -38], angle: -0.6, len: 20, width: 5.5 },
  { at: [-6, -52], angle: -2.6, len: 18, width: 5 },
  { at: [10, -58], angle: -0.9, len: 16, width: 4.5 },
]

// Cup-shaped tulip silhouette with three tips, unit-ish size (≈ 16 tall)
function tulipPath(ctx: CanvasRenderingContext2D) {
  ctx.beginPath()
  ctx.moveTo(-5.5, 5)
  ctx.bezierCurveTo(-8.5, -1, -7.5, -8, -4.8, -10.5)
  ctx.bezierCurveTo(-3.2, -6.5, -2.2, -5.2, -1.3, -4.6)
  ctx.bezierCurveTo(-1, -7.5, -0.5, -10.5, 0, -11.5)
  ctx.bezierCurveTo(0.5, -10.5, 1, -7.5, 1.3, -4.6)
  ctx.bezierCurveTo(2.2, -5.2, 3.2, -6.5, 4.8, -10.5)
  ctx.bezierCurveTo(7.5, -8, 8.5, -1, 5.5, 5)
  ctx.bezierCurveTo(3, 8, -3, 8, -5.5, 5)
  ctx.closePath()
}

function petalPath(ctx: CanvasRenderingContext2D, len: number, width: number) {
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.bezierCurveTo(width * 0.9, -len * 0.25, width * 0.85, -len * 0.8, 0, -len)
  ctx.bezierCurveTo(-width * 0.85, -len * 0.8, -width * 0.9, -len * 0.25, 0, 0)
  ctx.closePath()
}

function leafPath(ctx: CanvasRenderingContext2D, len: number, width: number) {
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.quadraticCurveTo(len * 0.45, -width, len, -width * 0.15)
  ctx.quadraticCurveTo(len * 0.5, width * 0.9, 0, 0)
  ctx.closePath()
}

type SceneParams = { bloomScale: number; t: number }

function drawScene(ctx: CanvasRenderingContext2D, p: SceneParams) {
  const { palette } = CONFIG

  // stems — thick curved strokes, dark at the base, lighter near the head
  for (const b of BLOOMS) {
    const g = ctx.createLinearGradient(0, 0, 0, b.head[1])
    g.addColorStop(0, palette.stemDark)
    g.addColorStop(1, palette.stemLight)
    ctx.strokeStyle = g
    ctx.lineWidth = 2.6
    ctx.lineCap = "round"
    ctx.beginPath()
    ctx.moveTo(0, 2)
    ctx.quadraticCurveTo(b.ctrl[0], b.ctrl[1], b.head[0], b.head[1] + 4)
    ctx.stroke()
  }

  // leaves
  for (const l of LEAVES) {
    ctx.save()
    ctx.translate(l.at[0], l.at[1])
    ctx.rotate(l.angle + Math.sin(p.t * 0.0007 + l.at[1]) * 0.03)
    const g = ctx.createLinearGradient(0, 0, l.len, 0)
    g.addColorStop(0, palette.stemDark)
    g.addColorStop(1, palette.stemLight)
    ctx.fillStyle = g
    leafPath(ctx, l.len, l.width)
    ctx.fill()
    ctx.restore()
  }

  // blooms
  for (const b of BLOOMS) {
    ctx.save()
    ctx.translate(b.head[0], b.head[1])
    const bloomSway = (CONFIG.sway.bloomDegrees * Math.PI) / 180
    ctx.rotate(b.tilt + Math.sin((p.t / CONFIG.sway.period) * Math.PI * 2 + b.phase) * bloomSway)
    // petals scale from the attach point (bottom of the head)
    ctx.translate(0, 6)
    ctx.scale(b.size * p.bloomScale, b.size * p.bloomScale)
    ctx.translate(0, -6)

    if (b.kind === "tulip") {
      const g = ctx.createLinearGradient(0, 7, 0, -11)
      g.addColorStop(0, palette.rose)
      g.addColorStop(0.55, palette.coral)
      g.addColorStop(1, palette.blush)
      ctx.fillStyle = g
      tulipPath(ctx)
      ctx.fill()
      // painterly highlight on the left lobe
      const hl = ctx.createRadialGradient(-3, -4, 0, -3, -4, 6)
      hl.addColorStop(0, "rgba(255,240,240,0.55)")
      hl.addColorStop(1, "rgba(255,240,240,0)")
      ctx.fillStyle = hl
      tulipPath(ctx)
      ctx.fill()
    } else {
      const petals = 9
      const len = 15, width = 6.5
      for (let i = 0; i < petals; i++) {
        ctx.save()
        ctx.rotate((i / petals) * Math.PI * 2 + 0.2)
        const g = ctx.createRadialGradient(0, -len * 0.62, 0, 0, -len * 0.45, len * 0.8)
        g.addColorStop(0, palette.blush)
        g.addColorStop(0.45, palette.coral)
        g.addColorStop(1, palette.rose)
        ctx.fillStyle = g
        petalPath(ctx, len, width)
        ctx.fill()
        ctx.restore()
      }
      // dark center with a small highlight
      ctx.fillStyle = palette.center
      ctx.beginPath()
      ctx.arc(0, 0, 4.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = palette.centerHighlight
      ctx.beginPath()
      ctx.arc(-1.4, -1.4, 1.3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
}

// ---------------------------------------------------------------------------
// drifting petal particles (in visible-canvas px)
// ---------------------------------------------------------------------------
type Particle = {
  x: number; y: number; baseY: number; vx: number
  wobAmp: number; wobFreq: number; phase: number
  rot: number; rotSpeed: number
  cells: [number, number][]; colors: string[]
  delay: number; alive: boolean; born: number
}
const CLUSTERS: [number, number][][] = [
  [[0, 0], [1, 0], [0, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1]],
  [[0, 0], [1, 0], [2, 0], [1, 1], [1, -1]],
  [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [2, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1], [3, 1]],
]

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------
export default function PixelFlower({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return
    const ctx2d = canvasEl.getContext("2d")
    if (!ctx2d) return
    const canvas: HTMLCanvasElement = canvasEl
    const ctx: CanvasRenderingContext2D = ctx2d
    const parent = canvas.parentElement ?? document.body
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    // ---- layout state (recomputed on resize) ----
    let W = 0, H = 0, dpr = 1, cell = 12
    let regionX = 0, regionW = 0, cols = 0, rows = 0
    let sceneScale = 1, baseX = 0, baseY = 0 // offscreen px of the bouquet base
    let flowerTopRow = 0
    const off = document.createElement("canvas")
    const offCtx = off.getContext("2d", { willReadFrequently: true })!
    // per-cell arrays
    let jitterL = new Float32Array(0), jitterH = new Float32Array(0), delay = new Float32Array(0)
    let ox = new Float32Array(0), oy = new Float32Array(0), vx = new Float32Array(0), vy = new Float32Array(0)
    let bloomPx: [number, number][] = []
    const particles: Particle[] = []

    // ---- time / loop state ----
    let elapsed = reduced ? CONFIG.intro.duration + CONFIG.intro.bloomStart + CONFIG.intro.bloomDuration : 0
    let last = performance.now()
    let raf = 0
    let running = false
    let visible = true, intersecting = true
    const pointer = { x: -1e6, y: -1e6, active: false }

    function layout() {
      W = parent.clientWidth
      H = parent.clientHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      canvas.style.width = `${W}px`
      canvas.style.height = `${H}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = false

      cell = Math.max(CONFIG.cell.min, Math.round(CONFIG.cell.desktop * Math.min(1, W / CONFIG.cell.refWidth)))
      const mobile = W < CONFIG.region.mobileBreakpoint
      regionX = mobile ? 0 : Math.round(W * CONFIG.region.desktopStart)
      regionW = W - regionX
      cols = Math.ceil(regionW / cell)
      rows = Math.ceil(H / cell)
      off.width = cols
      off.height = rows

      const usableH = rows * (mobile ? CONFIG.region.mobileHeightFrac : 0.9)
      sceneScale = Math.min(cols / CONFIG.scene.width, usableH / CONFIG.scene.height)
      baseX = cols / 2
      baseY = rows + 1
      flowerTopRow = baseY - CONFIG.scene.height * sceneScale

      const n = cols * rows
      jitterL = new Float32Array(n); jitterH = new Float32Array(n); delay = new Float32Array(n)
      ox = new Float32Array(n); oy = new Float32Array(n); vx = new Float32Array(n); vy = new Float32Array(n)
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c
          jitterL[i] = hash2(c, r, CONFIG.jitter.seed) * 2 - 1
          jitterH[i] = hash2(c, r, CONFIG.jitter.seed + 7) * 2 - 1
          delay[i] = hash2(c, r, CONFIG.jitter.seed + 13) * CONFIG.intro.cellDelay
        }
      }
      bloomPx = BLOOMS.map((b) => [
        regionX + (baseX + b.head[0] * sceneScale) * cell,
        (baseY + b.head[1] * sceneScale) * cell,
      ])
    }

    function spawnParticle(p: Particle, initial: boolean) {
      const src = bloomPx[Math.floor(Math.random() * bloomPx.length)] ?? [regionX, H / 2]
      const shape = CLUSTERS[Math.floor(Math.random() * CLUSTERS.length)]
      p.cells = shape
      p.colors = shape.map(() => {
        const base = CONFIG.palette.petalDrift[Math.floor(Math.random() * CONFIG.palette.petalDrift.length)]
        const [h, s, l] = rgbToHsl(...hexToRgb(base))
        const [r, g, b] = hslToRgb(h + rand(-4, 4), s, clamp01(l + rand(-0.04, 0.04)))
        return `rgb(${r | 0},${g | 0},${b | 0})`
      })
      p.x = src[0] + rand(-cell * 2, cell * 2) + (initial ? rand(0, (W - src[0]) * 0.8) : 0)
      p.baseY = src[1] + rand(-cell * 3, cell * 3)
      p.y = p.baseY
      p.vx = rand(CONFIG.particles.speed[0], CONFIG.particles.speed[1])
      p.wobAmp = rand(CONFIG.particles.wobble[0], CONFIG.particles.wobble[1])
      p.wobFreq = rand(0.4, 0.9)
      p.phase = rand(0, Math.PI * 2)
      p.rot = rand(0, Math.PI * 2)
      p.rotSpeed = rand(CONFIG.particles.rotSpeed[0], CONFIG.particles.rotSpeed[1])
      p.delay = initial ? rand(0, 1200) + CONFIG.intro.duration : rand(400, 2200)
      p.alive = false
      p.born = 0
    }
    function initParticles() {
      particles.length = 0
      if (reduced) return
      for (let i = 0; i < CONFIG.particles.count; i++) {
        const p = {} as Particle
        spawnParticle(p, true)
        particles.push(p)
      }
    }

    function updateParticles(dt: number, now: number) {
      for (const p of particles) {
        if (!p.alive) {
          p.delay -= dt * 1000
          if (p.delay <= 0) { p.alive = true; p.born = now }
          continue
        }
        p.x += p.vx * dt
        p.y = p.baseY + Math.sin((now / 1000) * p.wobFreq * Math.PI * 2 + p.phase) * p.wobAmp
        p.rot += p.rotSpeed * dt
        if (p.x > W + cell * 2) spawnParticle(p, false)
      }
    }

    function drawGrid() {
      ctx.strokeStyle = CONFIG.grid.color
      ctx.lineWidth = CONFIG.grid.width
      ctx.beginPath()
      const g = CONFIG.grid.size
      for (let x = regionX + 0.5; x <= W; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
      for (let y = 0.5; y <= H; y += g) { ctx.moveTo(regionX, y); ctx.lineTo(W, y) }
      ctx.stroke()
    }

    function drawParticles(now: number) {
      const fz = CONFIG.particles.fadeZone
      for (const p of particles) {
        if (!p.alive) continue
        const fadeIn = clamp01((now - p.born) / 900)
        const fadeOut = clamp01((W - p.x) / fz)
        const a = fadeIn * fadeOut * 0.95
        if (a <= 0) continue
        const cs = Math.cos(p.rot), sn = Math.sin(p.rot)
        ctx.globalAlpha = a
        const sz = cell * 0.92
        for (let i = 0; i < p.cells.length; i++) {
          const [dx, dy] = p.cells[i]
          const rx = dx * cs - dy * sn, ry = dx * sn + dy * cs
          ctx.fillStyle = p.colors[i]
          ctx.fillRect(p.x + rx * cell, p.y + ry * cell, sz, sz)
        }
      }
      ctx.globalAlpha = 1
    }

    function render(now: number, dt: number) {
      if (cols === 0 || rows === 0) {
        layout()
        initParticles()
        if (cols === 0 || rows === 0) return
      }
      // 1. vector layer at grid resolution -------------------------------
      const introT = clamp01(elapsed / CONFIG.intro.duration)
      const bloomScale = 0.6 + 0.4 * ease(clamp01((elapsed - CONFIG.intro.bloomStart) / CONFIG.intro.bloomDuration))
      const sway = reduced ? 0 : Math.sin((now / CONFIG.sway.period) * Math.PI * 2) * (CONFIG.sway.degrees * Math.PI) / 180
      offCtx.setTransform(1, 0, 0, 1, 0, 0)
      offCtx.clearRect(0, 0, cols, rows)
      offCtx.translate(baseX, baseY)
      offCtx.rotate(sway)
      offCtx.scale(sceneScale, sceneScale)
      drawScene(offCtx, { bloomScale, t: reduced ? 0 : now })

      // 2. read back and re-draw as crisp cells -----------------------------
      const img = offCtx.getImageData(0, 0, cols, rows).data
      ctx.clearRect(0, 0, W, H)
      drawGrid()

      const { radius, strength, spring, damping, brighten } = CONFIG.repel
      const r2 = radius * radius
      const introH = Math.max(1, baseY - flowerTopRow)
      const px = pointer.x, py = pointer.y
      const doRepel = !reduced && pointer.active
      const step = Math.min(dt, 1 / 30)

      for (let r = 0; r < rows; r++) {
        const hf = clamp01((baseY - r) / introH) // 0 at base, 1 at top of flower
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c
          // spring integration (cheap, do it for every cell so rest is exact)
          let ax = -spring * ox[i] - damping * vx[i]
          let ay = -spring * oy[i] - damping * vy[i]
          let glow = 0
          const cx = regionX + c * cell + cell / 2 + ox[i]
          const cy = r * cell + cell / 2 + oy[i]
          if (doRepel) {
            const ddx = cx - px, ddy = cy - py
            const d2 = ddx * ddx + ddy * ddy
            if (d2 < r2 && d2 > 0.01) {
              const d = Math.sqrt(d2)
              const f = (1 - d / radius) * strength
              ax += (ddx / d) * f
              ay += (ddy / d) * f
              glow = 1 - d / radius
            }
          }
          vx[i] += ax * step; vy[i] += ay * step
          ox[i] += vx[i] * step; oy[i] += vy[i] * step

          const a8 = img[i * 4 + 3]
          if (a8 === 0) continue
          let a = a8 / 255
          if (a < CONFIG.alpha.cutoff) continue
          a = Math.pow(a, CONFIG.alpha.gamma)

          // intro reveal: bottom-up front plus per-cell random delay
          let pop = 1
          if (introT < 1) {
            const tReveal = hf * CONFIG.intro.duration * 0.8 + delay[i]
            pop = ease(clamp01((elapsed - tReveal) / CONFIG.intro.cellPop))
            if (pop <= 0) continue
          }

          // seeded per-cell color jitter → painted, not flat
          const [h, s, l] = rgbToHsl(img[i * 4], img[i * 4 + 1], img[i * 4 + 2])
          const l2 = clamp01(l + jitterL[i] * CONFIG.jitter.lightness + glow * brighten)
          const [rr, gg, bb] = hslToRgb(h + jitterH[i] * CONFIG.jitter.hue, s, l2)
          ctx.fillStyle = `rgba(${rr | 0},${gg | 0},${bb | 0},${(a * pop).toFixed(3)})`
          const sz = cell * lerp(0.5, 1, pop)
          ctx.fillRect(cx - sz / 2, cy - sz / 2, sz, sz)
        }
      }

      // 3. drifting petals ---------------------------------------------------
      if (!reduced) {
        updateParticles(dt, now)
        drawParticles(now)
      }
    }

    function frame(now: number) {
      raf = 0
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      elapsed += dt * 1000
      render(now, dt)
      if (running) raf = requestAnimationFrame(frame)
    }
    function start() {
      if (running || reduced) return
      running = true
      last = performance.now()
      if (!raf) raf = requestAnimationFrame(frame)
    }
    function stop() {
      running = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }
    function syncRunning() {
      if (visible && intersecting) start()
      else stop()
    }

    // ---- events ----
    let resizeTimer = 0
    const onResize = () => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        layout()
        initParticles()
        if (reduced) render(performance.now(), 0)
      }, 150)
    }
    const ro = new ResizeObserver(onResize)
    const onVisibility = () => { visible = document.visibilityState === "visible"; syncRunning() }
    const io = new IntersectionObserver((entries) => {
      intersecting = entries[0]?.isIntersecting ?? true
      syncRunning()
    })
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      pointer.x = e.clientX - rect.left
      pointer.y = e.clientY - rect.top
      pointer.active = true
    }
    const onPointerLeave = () => { pointer.active = false }

    layout()
    initParticles()
    if (reduced) render(performance.now(), 0)
    else start()

    window.addEventListener("resize", onResize)
    document.addEventListener("visibilitychange", onVisibility)
    io.observe(canvas)
    ro.observe(parent)
    parent.addEventListener("pointermove", onPointerMove)
    parent.addEventListener("pointerleave", onPointerLeave)

    return () => {
      stop()
      window.clearTimeout(resizeTimer)
      window.removeEventListener("resize", onResize)
      document.removeEventListener("visibilitychange", onVisibility)
      io.disconnect()
      ro.disconnect()
      parent.removeEventListener("pointermove", onPointerMove)
      parent.removeEventListener("pointerleave", onPointerLeave)
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden className={className} />
}
