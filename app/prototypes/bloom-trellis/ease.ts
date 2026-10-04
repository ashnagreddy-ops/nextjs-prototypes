import type { Spring } from "./config"

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
export const easeInCubic = (t: number) => t * t * t
export const invEaseOutCubic = (p: number) => 1 - Math.cbrt(1 - p)
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
export const unit = (age: number, start: number, duration: number) => clamp((age - start) / duration, 0, 1)
export const rad = (deg: number) => (deg * Math.PI) / 180
// Wrap an angle to (-PI, PI].
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

// Step response of an underdamped spring released from 0 toward 1, ms since release.
// Overshoots past 1 and settles; 0 before release.
export function spring(ms: number, { frequency: w, damping: c }: Spring) {
  if (ms <= 0) return 0
  const t = ms / 1000
  const z = c / 2
  const wd = Math.sqrt(Math.max(1e-6, w * w - z * z))
  return 1 - Math.exp(-z * t) * (Math.cos(wd * t) + (z / wd) * Math.sin(wd * t))
}
