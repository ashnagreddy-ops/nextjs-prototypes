"use client"

import { useEffect, useRef } from "react"

// Streak color #C1C4C4
const STREAK = { r: 193, g: 196, b: 196 }

// Background source for the refraction layer. Keep in sync with the <Image>
// in page.tsx — same file, same blur radius, same scale-105.
const BG_SRC = "/prototypes/rain-scene/rain-window.png"
const BG_BLUR_PX = 7
const BG_SCALE = 1.05

type Swell = { center: number; amp: number; spread: number } // width bulge along the trail

type Streak = {
  x: number // base x
  y: number // head (leading, lower) point — trail extends upward from here
  length: number
  speed: number // px/sec, slow — water sliding down glass
  opacity: number
  baseWidth: number
  bendAmp: number
  bendFreq: number
  phase: number
  swells: Swell[]
  lensDir: number // which way this rivulet bends the light behind it
}

function spawn(w: number, h: number, entering: boolean): Streak {
  const length = 70 + Math.random() * 320

  // 1-2 spots where the stroke swells (reads as a droplet within the rivulet)
  const swellCount = 1 + (Math.random() < 0.5 ? 1 : 0)
  const swells: Swell[] = Array.from({ length: swellCount }, () => ({
    center: Math.random(),
    amp: 0.8 + Math.random() * 2.4,
    spread: 0.06 + Math.random() * 0.12,
  }))

  return {
    x: Math.random() * (w + 80) - 40,
    y: entering ? Math.random() * (h + length) : -length * Math.random(),
    length,
    speed: 14 + Math.random() * 70,
    opacity: 0.46 + Math.random() * 0.54,
    baseWidth: 0.7 + Math.random() * 2.8,
    // almost straight vertical — just a very slight, low-frequency wobble
    bendAmp: 1 + Math.random() * 2.5,
    bendFreq: 0.6 + Math.random() * 0.8,
    phase: Math.random() * Math.PI * 2,
    swells,
    lensDir: Math.random() < 0.5 ? -1 : 1,
  }
}

// Static droplets clinging to the glass — don't fall, so they're generated
// and rendered once per resize rather than every animation frame.
type Droplet = {
  x: number
  y: number
  r: number
  lensAngle: number // direction this bead bends the light behind it
  lensMag: number
  highlightAngle: number // which edge is bright vs. dark
}

function generateDroplets(w: number, h: number): Droplet[] {
  const droplets: Droplet[] = []

  // explicit tiers, not a continuous curve, so the mix is easy to reason about:
  // ~80% fine-mist specks, ~16% uncommon medium drops, ~4% rare large ones
  const randomRadius = () => {
    const roll = Math.random()
    if (roll < 0.8) return 0.35 + Math.random() * 0.75 // tiny: 0.35–1.1
    if (roll < 0.96) return 1.1 + Math.random() * 1.6 // medium: 1.1–2.7
    return 2.7 + Math.random() * 4.3 // large: 2.7–7.0
  }

  const push = (x: number, y: number) => {
    droplets.push({
      x,
      y,
      r: randomRadius(),
      lensAngle: Math.random() * Math.PI * 2,
      lensMag: 0.5 + Math.random() * 1.5,
      highlightAngle: Math.random() * Math.PI * 2,
    })
  }

  // rough normal-ish distribution via sum of uniforms (Irwin-Hall approximation)
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5

  const area = w * h

  // irregular clumps — this is what makes coverage read as clustered, not gridded
  const clusterCount = Math.round(area / 42000)
  for (let c = 0; c < clusterCount; c++) {
    const ccx = Math.random() * w
    const ccy = Math.random() * h
    const sigma = 25 + Math.random() * 70
    const count = 8 + Math.floor(Math.random() * 30)
    for (let i = 0; i < count; i++) {
      push(ccx + gauss() * sigma, ccy + gauss() * sigma)
    }
  }

  // sparser scatter filling the gaps between clusters so coverage is dense
  // everywhere, not just inside clumps
  const scatterCount = Math.round(area / 2200)
  for (let i = 0; i < scatterCount; i++) {
    push(Math.random() * w, Math.random() * h)
  }

  return droplets
}

export default function RainCanvas() {
  const dropRefractRef = useRef<HTMLCanvasElement>(null)
  const dropColorRef = useRef<HTMLCanvasElement>(null)
  const refractRef = useRef<HTMLCanvasElement>(null)
  const colorRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const drCanvas = dropRefractRef.current
    const dcCanvas = dropColorRef.current
    const rCanvas = refractRef.current
    const cCanvas = colorRef.current
    if (!drCanvas || !dcCanvas || !rCanvas || !cCanvas) return
    const drctx = drCanvas.getContext("2d")
    const dcctx = dcCanvas.getContext("2d")
    const rctx = rCanvas.getContext("2d")
    const cctx = cCanvas.getContext("2d")
    if (!drctx || !dcctx || !rctx || !cctx) return

    let width = 0
    let height = 0
    let dpr = 1
    let streaks: Streak[] = []
    let droplets: Droplet[] = []
    let raf = 0
    let last = performance.now()

    // Offscreen copy of the background, matching the <Image>'s cover-fit, scale
    // and blur. This is the source both streaks and droplets refract.
    const bg = document.createElement("canvas")
    const bgCtx = bg.getContext("2d")
    const img = new window.Image()
    let bgLoaded = false

    const paintBg = () => {
      if (!bgLoaded || !bgCtx || !width || !height) return
      bg.width = Math.floor(width * dpr)
      bg.height = Math.floor(height * dpr)
      bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
      bgCtx.clearRect(0, 0, width, height)
      const cover =
        Math.max(width / img.naturalWidth, height / img.naturalHeight) * BG_SCALE
      const dw = img.naturalWidth * cover
      const dh = img.naturalHeight * cover
      bgCtx.filter = `blur(${BG_BLUR_PX}px)`
      bgCtx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh)
      bgCtx.filter = "none"
    }

    // Static droplet field: refraction + shading are drawn once (not per
    // frame) since these beads never move.
    const renderDroplets = () => {
      if (!bgLoaded || !width || !height) return
      drctx.clearRect(0, 0, width, height)
      dcctx.clearRect(0, 0, width, height)

      for (const d of droplets) {
        const reach = 0.6 + d.r * 0.3
        const offX = Math.cos(d.lensAngle) * d.lensMag * reach
        const offY = Math.sin(d.lensAngle) * d.lensMag * reach

        let dx0 = Math.floor(d.x - d.r - 1)
        let dy0 = Math.floor(d.y - d.r - 1)
        let dw = Math.ceil(d.r * 2 + 2)
        let dh = dw
        if (dx0 < 0) {
          dw += dx0
          dx0 = 0
        }
        if (dy0 < 0) {
          dh += dy0
          dy0 = 0
        }
        dw = Math.min(dw, width - dx0)
        dh = Math.min(dh, height - dy0)

        if (dw > 0 && dh > 0) {
          const sx = Math.max(0, Math.min(width - dw, dx0 - offX))
          const sy = Math.max(0, Math.min(height - dh, dy0 - offY))
          drctx.save()
          drctx.beginPath()
          drctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
          drctx.clip()
          drctx.drawImage(
            bg,
            sx * dpr,
            sy * dpr,
            dw * dpr,
            dh * dpr,
            dx0,
            dy0,
            dw,
            dh,
          )
          drctx.restore()
        }

        // Bead shading: a bright highlight on one edge, a soft shadow on the
        // other, plus a faint rim — all normal-blend so it stays a fixed
        // property of the droplet, independent of what's behind it.
        dcctx.save()
        dcctx.beginPath()
        dcctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        dcctx.clip()

        const bx = d.x - d.r
        const by = d.y - d.r
        const bs = d.r * 2

        // Darker center — the bead reads as a lens holding the darker
        // refracted background, not a lit sphere. Symmetric (no direction),
        // which is what keeps this from looking like glossy 3D shading.
        const core = dcctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r)
        core.addColorStop(0, "rgba(6,7,7,0.34)")
        core.addColorStop(0.7, "rgba(6,7,7,0.14)")
        core.addColorStop(1, "rgba(6,7,7,0)")
        dcctx.fillStyle = core
        dcctx.fillRect(bx, by, bs, bs)

        // Thin edge rim — just enough to separate the bead from the glass,
        // not a broad vignette.
        const rim = dcctx.createRadialGradient(d.x, d.y, d.r * 0.82, d.x, d.y, d.r)
        rim.addColorStop(0, "rgba(10,11,11,0)")
        rim.addColorStop(1, "rgba(10,11,11,0.22)")
        dcctx.fillStyle = rim
        dcctx.fillRect(bx, by, bs, bs)

        // Small, sharp highlight pinpoint near one edge — a glint, not a
        // broad sheen. Floored radius keeps it visible even on tiny specks.
        const hlx = d.x + Math.cos(d.highlightAngle) * d.r * 0.55
        const hly = d.y + Math.sin(d.highlightAngle) * d.r * 0.55
        const hlR = Math.max(0.3, d.r * 0.22)
        const hl = dcctx.createRadialGradient(hlx, hly, 0, hlx, hly, hlR)
        hl.addColorStop(0, `rgba(${STREAK.r + 55},${STREAK.g + 55},${STREAK.b + 55},0.95)`)
        hl.addColorStop(0.6, `rgba(${STREAK.r + 55},${STREAK.g + 55},${STREAK.b + 55},0.4)`)
        hl.addColorStop(1, `rgba(${STREAK.r},${STREAK.g},${STREAK.b},0)`)
        dcctx.fillStyle = hl
        dcctx.fillRect(hlx - hlR, hly - hlR, hlR * 2, hlR * 2)

        dcctx.restore()
      }
    }

    img.onload = () => {
      bgLoaded = true
      paintBg()
      renderDroplets()
    }
    img.src = BG_SRC

    // horizontal offset of the centerline at parameter t (0 head → 1 tail)
    const bendAt = (s: Streak, t: number) =>
      s.bendAmp * Math.sin(t * s.bendFreq * Math.PI + s.phase)

    // half stroke width at t: tapered toward the tail, with 1-2 droplet swells
    const halfWidthAt = (s: Streak, t: number) => {
      let wv = s.baseWidth * (1 - 0.5 * t)
      for (const sw of s.swells) {
        const d = (t - sw.center) / sw.spread
        wv += sw.amp * Math.exp(-0.5 * d * d)
      }
      return Math.max(0.25, wv) / 2
    }

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = rCanvas.parentElement?.getBoundingClientRect()
      width = Math.round(rect?.width || window.innerWidth)
      height = Math.round(rect?.height || window.innerHeight)
      for (const c of [drCanvas, dcCanvas, rCanvas, cCanvas]) {
        c.width = Math.floor(width * dpr)
        c.height = Math.floor(height * dpr)
        c.style.width = `${width}px`
        c.style.height = `${height}px`
      }
      drctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      dcctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      rctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.round((width * height) / 4500)
      streaks = Array.from({ length: count }, () => spawn(width, height, true))
      droplets = generateDroplets(width, height)
      paintBg()
      renderDroplets()
    }

    const STEPS = 16
    const cx = new Float64Array(STEPS + 1)
    const cy = new Float64Array(STEPS + 1)
    const hw = new Float64Array(STEPS + 1)

    // ribbon polygon from the sampled centerline, offset along each normal
    const trace = (ctx2: CanvasRenderingContext2D) => {
      ctx2.beginPath()
      for (let i = 0; i <= STEPS; i++) {
        const p = Math.max(0, i - 1)
        const n = Math.min(STEPS, i + 1)
        const tx = cx[n] - cx[p]
        const ty = cy[n] - cy[p]
        const len = Math.hypot(tx, ty) || 1
        const px = cx[i] + (-ty / len) * hw[i]
        const py = cy[i] + (tx / len) * hw[i]
        if (i === 0) ctx2.moveTo(px, py)
        else ctx2.lineTo(px, py)
      }
      for (let i = STEPS; i >= 0; i--) {
        const p = Math.max(0, i - 1)
        const n = Math.min(STEPS, i + 1)
        const tx = cx[n] - cx[p]
        const ty = cy[n] - cy[p]
        const len = Math.hypot(tx, ty) || 1
        ctx2.lineTo(cx[i] - (-ty / len) * hw[i], cy[i] - (tx / len) * hw[i])
      }
      ctx2.closePath()
    }

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now

      rctx.clearRect(0, 0, width, height)
      cctx.clearRect(0, 0, width, height)

      for (const s of streaks) {
        s.y += s.speed * dt

        if (s.y - s.length > height + 20) {
          Object.assign(s, spawn(width, height, false))
          continue
        }

        const headY = s.y
        const tailY = s.y - s.length

        let maxHW = 0
        let minX = Infinity
        let maxX = -Infinity
        for (let i = 0; i <= STEPS; i++) {
          const t = i / STEPS
          cy[i] = headY - s.length * t
          cx[i] = s.x + bendAt(s, t)
          hw[i] = halfWidthAt(s, t)
          if (hw[i] > maxHW) maxHW = hw[i]
          if (cx[i] < minX) minX = cx[i]
          if (cx[i] > maxX) maxX = cx[i]
        }

        // Refraction: re-blit the background inside the streak, offset. Thicker
        // rivulets (and the droplet swells) bend the light further.
        if (bgLoaded) {
          const shift = 1 + maxHW * 1.8
          const offX = s.lensDir * shift
          const offY = shift * 0.4
          let dx0 = Math.floor(minX - maxHW - 2)
          let dy0 = Math.floor(tailY - 2)
          let dw = Math.ceil(maxX + maxHW + 2 - dx0)
          let dh = Math.ceil(headY + 2 - dy0)
          if (dx0 < 0) {
            dw += dx0
            dx0 = 0
          }
          if (dy0 < 0) {
            dh += dy0
            dy0 = 0
          }
          dw = Math.min(dw, width - dx0)
          dh = Math.min(dh, height - dy0)

          if (dw > 0 && dh > 0) {
            const sx = Math.max(0, Math.min(width - dw, dx0 - offX))
            const sy = Math.max(0, Math.min(height - dh, dy0 - offY))
            rctx.save()
            trace(rctx)
            rctx.clip()
            rctx.drawImage(
              bg,
              sx * dpr,
              sy * dpr,
              dw * dpr,
              dh * dpr,
              dx0,
              dy0,
              dw,
              dh,
            )
            rctx.restore()
          }
        }

        // fade from the leading edge (bright) up the trail (transparent)
        const grad = cctx.createLinearGradient(0, headY, 0, tailY)
        grad.addColorStop(0, `rgba(${STREAK.r},${STREAK.g},${STREAK.b},${s.opacity})`)
        grad.addColorStop(1, `rgba(${STREAK.r},${STREAK.g},${STREAK.b},0)`)
        trace(cctx)
        cctx.fillStyle = grad
        cctx.fill()
      }

      raf = requestAnimationFrame(frame)
    }

    resize()
    window.addEventListener("resize", resize)
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
      img.onload = null
    }
  }, [])

  return (
    <>
      <canvas
        ref={dropRefractRef}
        aria-hidden
        className="pointer-events-none absolute inset-0"
      />
      <canvas
        ref={dropColorRef}
        aria-hidden
        className="pointer-events-none absolute inset-0"
      />
      <canvas
        ref={refractRef}
        aria-hidden
        className="pointer-events-none absolute inset-0"
      />
      <canvas
        ref={colorRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 mix-blend-overlay"
      />
    </>
  )
}
