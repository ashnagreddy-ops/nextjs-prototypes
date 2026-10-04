import * as C from "./config"
import { createRng, hashSeed } from "./rng"

// Word-level rolls: a personality and one or two bract varieties per word, keyed by the index of the
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
// A word's bract colours: a main variety, and sometimes a second, different one.
// `avoid` is the previous word's colour: back-to-back words never share one.
export function varietiesFor(seed: number, wordStart: number, avoid?: C.Variety): C.Variety[] {
  const rng = createRng(hashSeed(seed, wordStart, SALT.variety))
  let main = pick<C.Variety>(C.VARIETIES, rng.next())
  const r = rng.next()
  if (main === avoid) main = pick<C.Variety>(Object.fromEntries(Object.entries(C.VARIETIES).filter(([, v]) => v !== avoid)), r)
  if (rng.next() >= C.SECOND_VARIETY_CHANCE) return [main]
  const others = Object.fromEntries(Object.entries(C.VARIETIES).filter(([, v]) => v !== main))
  return [main, pick<C.Variety>(others, rng.next())]
}
