"use client"

import { useEffect, useRef, useState } from "react"
import { createScene } from "./scene"

export default function FrostTypePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [typed, setTyped] = useState(false)

  useEffect(() => createScene(canvasRef.current!, { onFirstType: () => setTyped(true) }), [])

  // Scoped to `dark`: the ice palette is tuned for a night background.
  return (
    <div className="dark fixed inset-0 overflow-hidden bg-background text-foreground">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      <p
        className={`pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center font-serif text-sm italic text-muted-foreground transition-opacity duration-700 ${
          typed ? "opacity-0" : "opacity-60"
        }`}
      >
        type something
      </p>
    </div>
  )
}
