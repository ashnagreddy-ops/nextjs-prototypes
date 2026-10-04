export function rgba(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

// Flat mix of two hex colours, t = 0 -> a, 1 -> b.
export function mix(a: string, b: string, t: number) {
  const p = parseInt(a.slice(1), 16)
  const q = parseInt(b.slice(1), 16)
  const ch = (sh: number) => Math.round(((p >> sh) & 255) * (1 - t) + ((q >> sh) & 255) * t)
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`
}
