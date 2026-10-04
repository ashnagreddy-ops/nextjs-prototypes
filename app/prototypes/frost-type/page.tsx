"use client"

import { Abril_Fatface, Playfair_Display } from "next/font/google"
import { useEffect, useRef, useState } from "react"
import { BACKGROUND, FONT_FAMILY, FONT_WEIGHTS } from "./config"
import { setFont } from "./font"
import { createScene } from "./scene"

const abril = Abril_Fatface({ subsets: ["latin"], weight: "400" })
const playfair = Playfair_Display({ subsets: ["latin"], weight: "900" })
const FACES = { "Abril Fatface": abril, "Playfair Display": playfair }

export default function FrostTypePage() {
  const primaryRef = useRef<HTMLCanvasElement>(null)
  const fallbackRef = useRef<HTMLSpanElement>(null)
  const [typed, setTyped] = useState(false)

  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    const fallbackName = FONT_FAMILY === "Abril Fatface" ? "Playfair Display" : "Abril Fatface"
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
  }, [])

  // The ice palette is tuned for a night background, so it ignores the theme.
  return (
    <div className="dark fixed inset-0 overflow-hidden text-muted-foreground" style={{ background: BACKGROUND }}>
      <canvas ref={primaryRef} className={`absolute inset-0 block h-full w-full ${FACES[FONT_FAMILY].className}`} />
      <span
        ref={fallbackRef}
        aria-hidden
        className={`invisible absolute ${FACES[FONT_FAMILY === "Abril Fatface" ? "Playfair Display" : "Abril Fatface"].className}`}
      />
      <p
        className={`pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center font-serif text-sm italic transition-opacity duration-700 ${
          typed ? "opacity-0" : "opacity-60"
        }`}
      >
        type something
      </p>
    </div>
  )
}
