"use client"

import { Download, Video } from "lucide-react"
import { Fraunces, Playfair_Display } from "next/font/google"
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { FONT_FAMILY, FONT_WEIGHTS } from "./config"
import { setFont } from "./font"
import { DEFAULT_PALETTE, PALETTES, PICKER_BORDER_ALPHA, paletteIndex, restoreDom, savedPaletteIndex, setPalette, subscribePalette } from "./palettes"
import { type Scene, createScene } from "./scene"

const playfair = Playfair_Display({ subsets: ["latin"], weight: "600" })
const fraunces = Fraunces({ subsets: ["latin"], weight: "600" })
const FACES = { "Playfair Display": playfair, Fraunces: fraunces }

export function BloomTrellis() {
  const primaryRef = useRef<HTMLCanvasElement>(null)
  const fallbackRef = useRef<HTMLSpanElement>(null)
  const [typed, setTyped] = useState(false)
  const fallbackName = FONT_FAMILY === "Fraunces" ? "Playfair Display" : "Fraunces"
  const current = useSyncExternalStore(subscribePalette, paletteIndex, () => DEFAULT_PALETTE)
  const sceneRef = useRef<Scene | null>(null)
  const [videoExt, setVideoExt] = useState<string | null>(null) // "mp4", "webm", or null (no recording support)
  const [recording, setRecording] = useState(false)

  const save = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `bloom-trellis-${PALETTES[paletteIndex()].name.toLowerCase().replace(/\s+/g, "-")}.${ext}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // Export the current frame in the active palette.
  const download = async (kind: "png" | "svg") => {
    const scene = sceneRef.current
    if (!scene) return
    const blob = await (kind === "png" ? scene.exportPNG() : scene.exportSVG())
    if (blob) save(blob, kind)
  }

  // Replay the garden growing and save it as a video; clicking again stops early.
  const video = async () => {
    const scene = sceneRef.current
    if (!scene) return
    if (recording) return scene.stopRecording()
    setRecording(true)
    const out = await scene.recordVideo()
    setRecording(false)
    if (out) save(out.blob, out.ext)
  }

  // The saved palette applies before the first paint (page.tsx's boot script has already set the
  // CSS variables); leaving the page restores the body background and theme-color.
  useLayoutEffect(() => {
    const prevThemeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content ?? null
    setPalette(savedPaletteIndex(), { instant: true })
    return () => restoreDom(prevThemeColor)
  }, [])

  useEffect(() => {
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
          sceneRef.current = createScene(primaryRef.current!, {
            onFirstType: () => setTyped(true),
          })
          setVideoExt(sceneRef.current.videoExt())
          return
        }
      }
    })()
    return () => {
      cancelled = true
      sceneRef.current?.stop()
      sceneRef.current = null
    }
  }, [fallbackName])

  // The garden's own palette (picker below) sets the colours, so it ignores the app theme.
  // Colours are palette data, read through the --bloom-* variables.
  const ring = `color-mix(in srgb, var(--bloom-letter) ${PICKER_BORDER_ALPHA * 100}%, transparent)`
  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{
        background: `var(--bloom-bg, ${PALETTES[DEFAULT_PALETTE].bg})`,
        color: `var(--bloom-letter, ${PALETTES[DEFAULT_PALETTE].letter})`,
      }}
    >
      <canvas ref={primaryRef} className={`absolute inset-0 block h-full w-full ${FACES[FONT_FAMILY].className}`} />
      <span ref={fallbackRef} aria-hidden className={`invisible absolute ${FACES[fallbackName].className}`} />
      <p className={`pointer-events-none absolute inset-x-0 top-[74%] -translate-y-1/2 text-center font-serif text-sm italic transition-opacity duration-700 ${typed ? "opacity-0" : "opacity-60"}`}>
        type something · shift+T trellis
      </p>
      {/* always-on shortcut hints, bottom left: above the palette pill on narrow screens, level with it
          from lg (and clear of Next's dev badge in development) */}
      <p
        className={`pointer-events-none absolute bottom-20 flex h-10 items-center gap-1.5 font-serif text-sm italic opacity-60 lg:bottom-6 ${process.env.NODE_ENV === "development" ? "left-6 lg:left-20" : "left-6"}`}
      >
        {[
          ["esc", "clear"],
          ["tab", "palette"],
          ["shift R", "regrow"],
        ].map(([key, label], i) => (
          <span key={key} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="mx-1">·</span>}
            <kbd className="rounded border px-1.5 py-px font-sans text-xs not-italic" style={{ borderColor: ring }}>
              {key}
            </kbd>
            {label}
          </span>
        ))}
      </p>
      <div
        role="radiogroup"
        aria-label="Palette"
        className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-2 lg:right-6 lg:left-auto lg:translate-x-0"
        style={{ background: "var(--bloom-bg)", borderColor: ring }}
      >
        {PALETTES.map((p, i) => (
          <span key={p.name} className="contents">
            {/* a small gap between the dark and light groups */}
            {i > 0 && p.group !== PALETTES[i - 1].group && <span aria-hidden className="w-2" />}
            <button
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
              style={{
                background: p.bg,
                boxShadow: i === current ? "0 0 0 1.5px var(--bloom-letter)" : `inset 0 0 0 1px ${ring}`,
              }}
            >
              <span className="size-2 rounded-full" style={{ background: p.letter }} />
            </button>
          </span>
        ))}
        <span aria-hidden className="mx-1 h-4 w-px" style={{ background: ring }} />
        {(["png", "svg"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-label={`Download ${kind.toUpperCase()}`}
            title={`Download ${kind.toUpperCase()}`}
            tabIndex={-1}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => download(kind)}
            className="flex items-center gap-1 rounded-full px-1.5 text-xs font-medium tracking-wide uppercase opacity-70 transition-opacity hover:opacity-100"
          >
            <Download className="size-3.5" aria-hidden />
            {kind}
          </button>
        ))}
        {videoExt && (
          <button
            type="button"
            aria-label={recording ? "Stop recording" : `Record the garden growing as ${videoExt.toUpperCase()}`}
            title={recording ? "Stop recording" : `Record the garden growing as ${videoExt.toUpperCase()}`}
            tabIndex={-1}
            onPointerDown={(e) => e.preventDefault()}
            onClick={video}
            className="flex items-center gap-1 rounded-full px-1.5 text-xs font-medium tracking-wide uppercase opacity-70 transition-opacity hover:opacity-100"
          >
            {recording ? <span aria-hidden className="size-2 animate-pulse rounded-full" style={{ background: "var(--bloom-letter)" }} /> : <Video className="size-3.5" aria-hidden />}
            {recording ? "stop" : videoExt}
          </button>
        )}
      </div>
    </div>
  )
}
