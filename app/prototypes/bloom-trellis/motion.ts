import * as C from "./config"
import { createRng, hashSeed, valueNoise } from "./rng"

// ---- Rigid transforms: p' = R(a) p + t --------------------------------------

export type Rigid = { a: number; c: number; s: number; tx: number; ty: number }
export const IDENTITY: Rigid = { a: 0, c: 1, s: 0, tx: 0, ty: 0 }

export function rotAbout(a: number, cx: number, cy: number): Rigid {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { a, c, s, tx: cx - c * cx + s * cy, ty: cy - s * cx - c * cy }
}

// A after B.
export function compose(A: Rigid, B: Rigid): Rigid {
  const c = Math.cos(A.a + B.a)
  const s = Math.sin(A.a + B.a)
  return { a: A.a + B.a, c, s, tx: A.c * B.tx - A.s * B.ty + A.tx, ty: A.s * B.tx + A.c * B.ty + A.ty }
}

export const applyX = (r: Rigid, x: number, y: number) => r.c * x - r.s * y + r.tx
export const applyY = (r: Rigid, x: number, y: number) => r.s * x + r.c * y + r.ty

// ---- Springs ------------------------------------------------------------------

// Semi-implicit Euler step of x'' = w^2 (target - x) - c x'. Returns [x, v].
export function stepSpring(x: number, v: number, target: number, sp: C.Spring, dt: number): [number, number] {
  const n = Math.max(1, Math.ceil(dt / (1 / 240)))
  const h = dt / n
  for (let i = 0; i < n; i++) {
    v += (sp.frequency * sp.frequency * (target - x) - sp.damping * v) * h
    x += v * h
  }
  return [x, v]
}

// ---- Wind (lean + gusts), in radians, positive = toward screen right ---------

const gust = valueNoise(createRng(0x5eed), 256)
export const wind = (now: number, screenX: number) =>
  ((C.LEAN_DEG + C.GUST_DEG * gust((now / 1000) * C.GUST_RATE - screenX * C.GUST_WAVE)) * Math.PI) / 180

// ---- Boil ----------------------------------------------------------------------

// A smooth displacement field re-rolled BOIL_FPS times a second, so lines shimmer like
// redrawn animation frames while shapes stay coherent.
export type Boil = { frame: number; seed: number; amp: number; f: number; p: Float32Array }

export function boilFor(seed: number, now: number, fs: number): Boil {
  const frame = Math.floor((now * C.BOIL_FPS) / 1000)
  const rng = createRng(hashSeed(seed, frame))
  const p = new Float32Array(4)
  for (let i = 0; i < 4; i++) p[i] = rng.range(0, Math.PI * 2)
  return { frame, seed, amp: C.BOIL_PX * (fs / C.REF_FONT_PX), f: (Math.PI * 2) / (C.BOIL_WAVELENGTH_EM * fs), p }
}

export const boilX = (b: Boil, x: number, y: number) => b.amp * Math.sin(y * b.f + x * b.f * 0.6 + b.p[0]) * Math.cos(x * b.f * 0.3 + b.p[1])
export const boilY = (b: Boil, x: number, y: number) => b.amp * Math.sin(x * b.f - y * b.f * 0.4 + b.p[2]) * Math.cos(y * b.f * 0.35 + b.p[3])
// Per-shape rotation jitter in radians, in [-BOIL_ROTATE, BOIL_ROTATE].
export const boilTurn = (b: Boil, id: number) => ((hashSeed(b.seed, b.frame, id) / 4294967296) * 2 - 1) * ((C.BOIL_ROTATE_DEG * Math.PI) / 180)
