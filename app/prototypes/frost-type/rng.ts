// mulberry32: tiny seeded PRNG. Same seed -> same sequence.
export function createRng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (min: number, max: number) => min + (max - min) * next(),
    sign: () => (next() < 0.5 ? -1 : 1),
  }
}

export type Rng = ReturnType<typeof createRng>

// Mix integers into one seed: glyph seeds are hashSeed(globalSeed, index, salt), so each
// subsystem gets its own stream and changing one never reshuffles the others.
export function hashSeed(...parts: number[]) {
  let h = 0x811c9dc5
  for (const p of parts) {
    h = Math.imul(h ^ (p >>> 0), 0x01000193)
    h ^= h >>> 15
    h = Math.imul(h, 0x2c1b3c6d)
    h ^= h >>> 12
  }
  return h >>> 0
}

// Smooth 1D value noise in [-1, 1], seeded.
export function valueNoise(rng: Rng, cells = 64) {
  const v = new Float32Array(cells + 1)
  for (let i = 0; i < cells; i++) v[i] = rng.next() * 2 - 1
  v[cells] = v[0]
  return (s: number) => {
    s = ((s % cells) + cells) % cells
    const i = Math.floor(s)
    const f = s - i
    const u = f * f * (3 - 2 * f)
    return v[i] + (v[i + 1] - v[i]) * u
  }
}
