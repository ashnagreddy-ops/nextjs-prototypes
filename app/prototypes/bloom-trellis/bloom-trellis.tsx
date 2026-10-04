"use client"

import { Fraunces, Playfair_Display } from "next/font/google"
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { FONT_FAMILY, FONT_WEIGHTS } from "./config"
import { setFont } from "./font"
import { DEFAULT_PALETTE, PALETTES, PICKER_BORDER_ALPHA, paletteIndex, restoreDom, savedPaletteIndex, setPalette, subscribePalette } from "./palettes"
import { createScene } from "./scene"

const playfair = Playfair_Display({ subsets: ["latin"], weight: "600" })
const fraunces = Fraunces({ subsets: ["latin"], weight: "600" })
const FACES = { "Playfair Display": playfair, Fraunces: fraunces }

export function BloomTrellis() {
  const primaryRef = useRef<HTMLCanvasElement>(null)
  const fallbackRef = useRef<HTMLSpanElement>(null)
  const [typed, setTyped] = useState(false)
  const fallbackName = FONT_FAMILY === "Fraunces" ? "Playfair Display" : "Fraunces"
  const current = useSyncExternalStore(subscribePalette, paletteIndex, () => DEFAULT_PALETTE)

  // The saved palette applies before the first paint (page.tsx's boot script has already set the
  // CSS variables); leaving the page restores the body background and theme-color.
  useLayoutEffect(() => {
    const prevThemeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content ?? null
    setPalette(savedPaletteIndex(), { instant: true })
    return () => restoreDom(prevThemeColor)
  }, [])

  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    // Canvas needs the resolved family name, and the face loaded before the first measure.
    const candidates = [
      { name: FONT_FAMILY, el: primaryRef.current! },
      { name: fallbackName, el: fallbackRef.current! },
    ] as const
    ;(async () => {
      for (const { name, el } of candidates) {
        const family = getComputedStyle(el).fontFamily
        const weight = FONT_WEIGHTS[name]
        const loaded = await document.fonts.load(`${weight} 100px ${family}`).catch(() => [])
        if (cancelled) return
        if (loaded.length || name === fallbackName) {
          setFont(family, weight)
          stop = createScene(primaryRef.current!, { onFirstType: () => setTyped(true) })
          return
        }
      }
    })()
    return () => {
      cancelled = true
      stop?.()
    }
  }, [fallbackName])

  // The garden's own palette (picker below) sets the colours, so it ignores the app theme.
  // Colours are palette data, read through the --bloom-* variables.
  const ring = `color-mix(in srgb, var(--bloom-letter) ${PICKER_BORDER_ALPHA * 100}%, transparent)`
  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: `var(--bloom-bg, ${PALETTES[DEFAULT_PALETTE].bg})`, color: `var(--bloom-letter, ${PALETTES[DEFAULT_PALETTE].letter})` }}>
      <canvas ref={primaryRef} className={`absolute inset-0 block h-full w-full ${FACES[FONT_FAMILY].className}`} />
      <span ref={fallbackRef} aria-hidden className={`invisible absolute ${FACES[fallbackName].className}`} />
      <p
        className={`pointer-events-none absolute inset-x-0 top-[62%] -translate-y-1/2 text-center font-serif text-sm italic transition-opacity duration-700 ${
          typed ? "opacity-0" : "opacity-60"
        }`}
      >
        type something · tab palette · shift+R regrow · shift+T trellis
      </p>
      <div
        role="radiogroup"
        aria-label="Palette"
        className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-2"
        style={{ background: "var(--bloom-bg)", borderColor: ring }}
      >
        {PALETTES.map((p, i) => (
          <button
            key={p.name}
            type="button"
            role="radio"
            aria-checked={i === current}
            aria-label={p.name}
            title={p.name}
            tabIndex={-1}
            // never take focus from typing (keys are read on window)
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setPalette(i)}
            className={`grid size-6 place-items-center rounded-full transition-transform duration-150 hover:scale-[1.15] ${i === current ? "scale-110" : ""}`}
            style={{ background: p.bg, boxShadow: i === current ? "0 0 0 1.5px var(--bloom-letter)" : `inset 0 0 0 1px ${ring}` }}
          >
            <span className="size-2 rounded-full" style={{ background: p.letter }} />
          </button>
        ))}
      </div>
    </div>
  )
}
