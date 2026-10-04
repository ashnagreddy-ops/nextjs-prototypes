import * as C from "./config"
import { createRng, hashSeed } from "./rng"

// Word-level rolls: a personality and a bract variety per word, keyed by the index of the
// word's first glyph so letters typed later share them.

const SALT = { style: 11, variety: 16 }

export const isSpace = (ch: string) => !ch.trim()

function pick<T extends { weight: number }>(table: Record<string, T>, r: number): T {
  const items = Object.values(table)
  r *= items.reduce((s, it) => s + it.weight, 0)
  for (const it of items) if ((r -= it.weight) < 0) return it
  return items[items.length - 1]
}

export const styleFor = (seed: number, wordStart: number): C.WordStyle => pick<C.WordStyle>(C.STYLES, createRng(hashSeed(seed, wordStart, SALT.style)).next())
export const varietyFor = (seed: number, wordStart: number): C.Variety => pick<C.Variety>(C.VARIETIES, createRng(hashSeed(seed, wordStart, SALT.variety)).next())
