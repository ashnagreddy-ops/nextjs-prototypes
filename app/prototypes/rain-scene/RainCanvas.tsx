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
type Gap = { center: number; spread: number; strength: number } // width pinch — a break in the line

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
  gaps: Gap[]
  lensDir: number // which way this rivulet bends the light behind it
  hero: boolean // a few noticeably fatter, brighter channel streaks
  trickle: boolean // reads as a slow chain of separate droplets, not one line
}

function spawn(w: number, h: number, entering: boolean, hero = false): Streak {
  const length = 70 + Math.random() * 320

  // 1-2 spots where the stroke swells (reads as a droplet within the rivulet)
  const swellCount = 1 + (Math.random() < 0.5 ? 1 : 0)
  const swells: Swell[] = Array.from({ length: swellCount }, () => ({
    center: Math.random(),
    amp: 0.8 + Math.random() * 2.4,
    spread: 0.06 + Math.random() * 0.12,
  }))

  // gaps: breaks in the line so it doesn't read as one unbroken ribbon top to
  // bottom, matching the reference — most streaks get one, some get two, a
  // few stay continuous
  const gapRoll = Math.random()
  const gapCount = gapRoll < 0.15 ? 0 : gapRoll < 0.8 ? 1 : 2
  let gaps: Gap[] = Array.from({ length: gapCount }, () => ({
    center: 0.12 + Math.random() * 0.76,
    spread: 0.02 + Math.random() * 0.035,
    strength: 0.85 + Math.random() * 0.13,
  }))

  // ~20% of non-hero streaks read as a slow chain of separate droplets
  // trickling down the glass, rather than a continuous rivulet: more/tighter
  // gaps carving the trail into distinct beads, moving much slower
  const trickle = !hero && Math.random() < 0.2
  if (trickle) {
    const beadCount = 3 + Math.floor(Math.random() * 3) // 3-5 beads
    gaps = Array.from({ length: beadCount - 1 }, (_, i) => ({
      center: (i + 1) / beadCount + (Math.random() - 0.5) * 0.05,
      spread: 0.018 + Math.random() * 0.018,
      strength: 0.9 + Math.random() * 0.09,
    }))
  }

  // a small percentage fall noticeably faster than the rest — distinct from
  // trickle (which is deliberately slow), so it's excluded from that roll
  const fast = !hero && !trickle && Math.random() < 0.06

  return {
    x: Math.random() * (w + 80) - 40,
    y: entering ? Math.random() * (h + length) : -length * Math.random(),
    length,
    speed: trickle
      ? 3 + Math.random() * 7
      : fast
        ? 130 + Math.random() * 110
        : 14 + Math.random() * 70,
    // heroes run a bit brighter, like a channel with more water in it
    opacity: hero ? 0.72 + Math.random() * 0.28 : 0.46 + Math.random() * 0.54,
    // heroes are distinctly wider than the thin streaks' 0.7-3.5 range
    baseWidth: hero ? 11 + Math.random() * 8 : 0.7 + Math.random() * 2.8,
    // almost straight vertical — just a very slight, low-frequency wobble
    bendAmp: 1 + Math.random() * 2.5,
    bendFreq: 0.6 + Math.random() * 0.8,
    phase: Math.random() * Math.PI * 2,
    swells,
    gaps,
    lensDir: Math.random() < 0.5 ? -1 : 1,
    hero,
    trickle,
  }
}

// Static droplets clinging to the glass — don't fall, so they're generated
// and rendered once per resize rather than every animation frame.
type DropletState = "steady" | "fadeOut" | "waiting" | "fadeIn"

type Droplet = {
  x: number
  y: number
  r: number
  lensAngle: number // direction this bead bends the light behind it
  lensMag: number
  highlightAngle: number // which edge is bright vs. dark
  alpha: number // current visibility, 0-1
  state: DropletState
  timer: number // seconds remaining in the current phase
  phaseDur: number // total seconds budgeted for the current phase
}

// three tiers, not a continuous curve: mostly small droplets — widened so
// some read visibly bigger than others within that tier, not one uniform
// size — a smaller share landing as occasional medium ones, and a rare tier
// of significantly bigger ones for variety.
function randomDropletRadius(): number {
  const roll = Math.random()
  if (roll < 0.68) return 1.3 + Math.random() * 2.1 // small, legible: 1.3–3.4
  if (roll < 0.93) return 3.4 + Math.random() * 2.6 // occasional medium: 3.4–6.0
  return 6.0 + Math.random() * 5.0 // rare, significantly bigger: 6.0–11.0
}

// fadeIn=false makes an already-visible droplet (initial population);
// fadeIn=true makes one that's about to fade in after being absorbed and
// respawned elsewhere.
function makeDroplet(x: number, y: number, fadeIn: boolean): Droplet {
  const dur = 0.3 + Math.random() * 0.3 // 0.3–0.6s, per the fade-out/in spec
  return {
    x,
    y,
    r: randomDropletRadius(),
    lensAngle: Math.random() * Math.PI * 2,
    lensMag: 0.5 + Math.random() * 1.5,
    highlightAngle: Math.random() * Math.PI * 2,
    alpha: fadeIn ? 0 : 1,
    state: fadeIn ? "fadeIn" : "steady",
    timer: fadeIn ? dur : 0,
    phaseDur: fadeIn ? dur : 1,
  }
}

function generateDroplets(w: number, h: number): Droplet[] {
  const droplets: Droplet[] = []

  // rough normal-ish distribution via sum of uniforms (Irwin-Hall approximation)
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5

  const area = w * h

  // irregular clumps — this is what makes coverage read as clustered, not
  // gridded. Density trimmed down from the fine-mist version: now that beads
  // are individually bigger and legible, the old counts would overlap into a
  // solid mess rather than reading as distinct clustered droplets.
  const clusterCount = Math.round(area / 55000)
  for (let c = 0; c < clusterCount; c++) {
    const ccx = Math.random() * w
    const ccy = Math.random() * h
    const sigma = 22 + Math.random() * 60
    const count = 6 + Math.floor(Math.random() * 20)
    for (let i = 0; i < count; i++) {
      droplets.push(makeDroplet(ccx + gauss() * sigma, ccy + gauss() * sigma, false))
    }
  }

  // sparser scatter filling the gaps between clusters so coverage is dense
  // everywhere, not just inside clumps
  const scatterCount = Math.round(area / 3600)
  for (let i = 0; i < scatterCount; i++) {
    droplets.push(makeDroplet(Math.random() * w, Math.random() * h, false))
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

    // Droplets don't fall, but they're no longer purely static either: a
    // droplet a passing streak crosses fades out (absorbed into the stream)
    // and, after a random pause, a fresh one fades in elsewhere. No sliding
    // or dripping motion — just this lifecycle, checked/advanced every frame.
    const DROPLET_HIT_MARGIN = 1.5

    const updateDroplets = (dt: number) => {
      for (const d of droplets) {
        switch (d.state) {
          case "steady": {
            for (const s of streaks) {
              const headY = s.y
              const tailY = s.y - s.length
              if (d.y < tailY || d.y > headY) continue
              const halfW = s.baseWidth / 2 // bend/taper ignored — fine for a hit test
              if (Math.abs(d.x - s.x) < halfW + d.r + DROPLET_HIT_MARGIN) {
                d.state = "fadeOut"
                d.phaseDur = 0.3 + Math.random() * 0.3
                d.timer = d.phaseDur
                break
              }
            }
            break
          }
          case "fadeOut": {
            d.timer -= dt
            d.alpha = Math.max(0, d.timer / d.phaseDur)
            if (d.timer <= 0) {
              d.state = "waiting"
              d.phaseDur = 1.5 + Math.random() * 4.5 // random pause before reappearing
              d.timer = d.phaseDur
              d.alpha = 0
            }
            break
          }
          case "waiting": {
            d.timer -= dt
            if (d.timer <= 0) {
              Object.assign(d, makeDroplet(Math.random() * width, Math.random() * height, true))
            }
            break
          }
          case "fadeIn": {
            d.timer -= dt
            d.alpha = Math.min(1, 1 - d.timer / d.phaseDur)
            if (d.timer <= 0) {
              d.state = "steady"
              d.alpha = 1
            }
            break
          }
        }
      }
    }

    const drawDroplets = () => {
      if (!bgLoaded || !width || !height) return
      drctx.clearRect(0, 0, width, height)
      dcctx.clearRect(0, 0, width, height)

      for (const d of droplets) {
        if (d.alpha <= 0.001) continue

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
          drctx.globalAlpha = d.alpha
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
        core.addColorStop(0, `rgba(6,7,7,${0.34 * d.alpha})`)
        core.addColorStop(0.7, `rgba(6,7,7,${0.14 * d.alpha})`)
        core.addColorStop(1, "rgba(6,7,7,0)")
        dcctx.fillStyle = core
        dcctx.fillRect(bx, by, bs, bs)

        // Thin edge rim — just enough to separate the bead from the glass,
        // not a broad vignette.
        const rim = dcctx.createRadialGradient(d.x, d.y, d.r * 0.82, d.x, d.y, d.r)
        rim.addColorStop(0, "rgba(10,11,11,0)")
        rim.addColorStop(1, `rgba(10,11,11,${0.22 * d.alpha})`)
        dcctx.fillStyle = rim
        dcctx.fillRect(bx, by, bs, bs)

        // Small, sharp highlight pinpoint near one edge — a glint, not a
        // broad sheen. Floored radius keeps it visible even on tiny specks.
        // The highlight-to-radius ratio itself grows with size (not just a
        // flat 22%), so the rare big droplets get a proportionally bigger,
        // more prominent glint rather than a pinprick lost in a big bead.
        const hlx = d.x + Math.cos(d.highlightAngle) * d.r * 0.55
        const hly = d.y + Math.sin(d.highlightAngle) * d.r * 0.55
        const hlScale = 0.22 + Math.min(1, d.r / 10) * 0.14
        const hlR = Math.max(0.3, d.r * hlScale)
        const hl = dcctx.createRadialGradient(hlx, hly, 0, hlx, hly, hlR)
        hl.addColorStop(0, `rgba(${STREAK.r + 55},${STREAK.g + 55},${STREAK.b + 55},${0.95 * d.alpha})`)
        hl.addColorStop(0.6, `rgba(${STREAK.r + 55},${STREAK.g + 55},${STREAK.b + 55},${0.4 * d.alpha})`)
        hl.addColorStop(1, `rgba(${STREAK.r},${STREAK.g},${STREAK.b},0)`)
        dcctx.fillStyle = hl
        dcctx.fillRect(hlx - hlR, hly - hlR, hlR * 2, hlR * 2)

        dcctx.restore()
      }
    }

    img.onload = () => {
      bgLoaded = true
      paintBg()
    }
    img.src = BG_SRC

    // horizontal offset of the centerline at parameter t (0 head → 1 tail)
    const bendAt = (s: Streak, t: number) =>
      s.bendAmp * Math.sin(t * s.bendFreq * Math.PI + s.phase)

    // half stroke width at t: tapered toward the tail, with 1-2 droplet swells,
    // then pinched toward zero at each gap so the ribbon reads as broken
    // segments rather than one unbroken line. The tips themselves are NOT
    // tapered to a point here — that's handled by rounding the polygon's end
    // caps in trace() instead, so each end reads as a curved oval bulge
    // rather than either a flat cut or a sharp point.
    const halfWidthAt = (s: Streak, t: number) => {
      let wv = s.baseWidth * (1 - 0.5 * t)
      for (const sw of s.swells) {
        const d = (t - sw.center) / sw.spread
        wv += sw.amp * Math.exp(-0.5 * d * d)
      }
      wv = Math.max(0.25, wv)
      for (const g of s.gaps) {
        const d = (t - g.center) / g.spread
        wv *= 1 - g.strength * Math.exp(-0.5 * d * d)
      }
      return wv / 2
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
      // thin streaks cut by 1/3; a handful of wider "hero" channels added on top
      const count = Math.round(((width * height) / 4500) * (2 / 3))
      const heroCount = 4 + Math.round(Math.random())
      streaks = [
        ...Array.from({ length: count }, () => spawn(width, height, true)),
        ...Array.from({ length: heroCount }, () => spawn(width, height, true, true)),
      ]
      droplets = generateDroplets(width, height)
      paintBg()
    }

    const STEPS = 16
    const cx = new Float64Array(STEPS + 1)
    const cy = new Float64Array(STEPS + 1)
    const hw = new Float64Array(STEPS + 1)

    // unit normal at sample i (rotate the local tangent +90°)
    const normalAt = (i: number) => {
      const p = Math.max(0, i - 1)
      const n = Math.min(STEPS, i + 1)
      const tx = cx[n] - cx[p]
      const ty = cy[n] - cy[p]
      const len = Math.hypot(tx, ty) || 1
      return { nx: -ty / len, ny: tx / len }
    }

    // Rounded end caps: a semicircle at each tip (radius = the local
    // half-width there) bulging outward past the tip, like lineCap="round"
    // — a curved oval bulge, not a flat perpendicular cut and not a sharp
    // point. At both ends, sweeping the angle by -π from wherever the
    // preceding edge loop left off lands exactly on the opposite edge point
    // while passing through the correct outward direction at the midpoint.
    const CAP_STEPS = 6
    const traceCap = (
      ctx2: CanvasRenderingContext2D,
      cxc: number,
      cyc: number,
      r: number,
      startAngle: number,
    ) => {
      for (let k = 1; k <= CAP_STEPS; k++) {
        const theta = startAngle - (Math.PI * k) / CAP_STEPS
        ctx2.lineTo(cxc + r * Math.cos(theta), cyc + r * Math.sin(theta))
      }
    }

    // ribbon polygon from the sampled centerline, offset along each normal,
    // with rounded caps at both ends instead of flat perpendicular cuts
    const trace = (ctx2: CanvasRenderingContext2D) => {
      ctx2.beginPath()
      for (let i = 0; i <= STEPS; i++) {
        const { nx, ny } = normalAt(i)
        const px = cx[i] + nx * hw[i]
        const py = cy[i] + ny * hw[i]
        if (i === 0) ctx2.moveTo(px, py)
        else ctx2.lineTo(px, py)
      }
      {
        const { nx, ny } = normalAt(STEPS)
        traceCap(ctx2, cx[STEPS], cy[STEPS], hw[STEPS], Math.atan2(ny, nx))
      }
      for (let i = STEPS - 1; i >= 0; i--) {
        const { nx, ny } = normalAt(i)
        ctx2.lineTo(cx[i] - nx * hw[i], cy[i] - ny * hw[i])
      }
      {
        const { nx, ny } = normalAt(0)
        traceCap(ctx2, cx[0], cy[0], hw[0], Math.atan2(ny, nx) + Math.PI)
      }
      ctx2.closePath()
    }

    // Opacity fades to 0 over the first/last FADE_FRAC of the streak's length
    // (dissolving tips) instead of one hard-cut end and one whole-length ramp.
    // Shared by the body fill and both edge bands so tips never show a
    // flat cut on any layer.
    const FADE_FRAC = 0.13
    const fadedGradient = (
      ctx2: CanvasRenderingContext2D,
      y0: number,
      y1: number,
      rgb: string,
      peak: number,
    ) => {
      const g = ctx2.createLinearGradient(0, y0, 0, y1)
      g.addColorStop(0, `rgba(${rgb},0)`)
      g.addColorStop(FADE_FRAC, `rgba(${rgb},${peak})`)
      g.addColorStop(1 - FADE_FRAC, `rgba(${rgb},${peak})`)
      g.addColorStop(1, `rgba(${rgb},0)`)
      return g
    }

    // A thin band running along one edge of the ribbon, from the edge inward
    // by `bandFrac` of the local half-width. `side` is the same normal sign
    // trace() uses for its first loop (+1) or second loop (-1) — since every
    // streak's centerline runs top-to-bottom, that normal points the same
    // real-world direction for every streak regardless of its own bend, which
    // is what keeps the highlight on the same side scene-wide for free.
    const traceEdgeBand = (
      ctx2: CanvasRenderingContext2D,
      side: 1 | -1,
      bandFrac: number,
    ) => {
      ctx2.beginPath()
      for (let i = 0; i <= STEPS; i++) {
        const p = Math.max(0, i - 1)
        const n = Math.min(STEPS, i + 1)
        const tx = cx[n] - cx[p]
        const ty = cy[n] - cy[p]
        const len = Math.hypot(tx, ty) || 1
        const nx = (-ty / len) * side
        const ny = (tx / len) * side
        const px = cx[i] + nx * hw[i]
        const py = cy[i] + ny * hw[i]
        if (i === 0) ctx2.moveTo(px, py)
        else ctx2.lineTo(px, py)
      }
      for (let i = STEPS; i >= 0; i--) {
        const p = Math.max(0, i - 1)
        const n = Math.min(STEPS, i + 1)
        const tx = cx[n] - cx[p]
        const ty = cy[n] - cy[p]
        const len = Math.hypot(tx, ty) || 1
        const nx = (-ty / len) * side
        const ny = (tx / len) * side
        const inner = hw[i] * (1 - bandFrac)
        ctx2.lineTo(cx[i] + nx * inner, cy[i] + ny * inner)
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
          Object.assign(s, spawn(width, height, false, s.hero))
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

        // dissolves at both tips instead of one hard cut and one long ramp
        const grad = fadedGradient(cctx, headY, tailY, `${STREAK.r},${STREAK.g},${STREAK.b}`, s.opacity)
        trace(cctx)
        cctx.fillStyle = grad
        cctx.fill()

        // Volume: a thin bright highlight along one edge and a subtle dark
        // line along the other, so the ribbon reads as rounded water instead
        // of a flat band. Both band width and peak intensity scale with this
        // streak's own baseWidth — thin streaks get a whisper, hero streaks
        // read as clearly convex. Side is fixed (+1 highlight / -1 shadow)
        // so the light direction is the same for every streak in the scene.
        const sizeT = Math.min(1, s.baseWidth / 14)
        const bandFrac = 0.25 + sizeT * 0.15
        const hlPeak = (0.1 + sizeT * 0.55) * s.opacity
        const shPeak = (0.08 + sizeT * 0.35) * s.opacity

        const hlGrad = fadedGradient(cctx, headY, tailY, "255,255,255", hlPeak)
        traceEdgeBand(cctx, 1, bandFrac)
        cctx.fillStyle = hlGrad
        cctx.fill()

        const shGrad = fadedGradient(cctx, headY, tailY, "0,0,0", shPeak)
        traceEdgeBand(cctx, -1, bandFrac)
        cctx.fillStyle = shGrad
        cctx.fill()
      }

      // Runs after the streak loop above so hit-testing sees this frame's
      // updated streak positions.
      updateDroplets(dt)
      drawDroplets()

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
