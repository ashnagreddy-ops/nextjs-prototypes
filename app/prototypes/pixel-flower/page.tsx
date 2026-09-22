import { Button } from "@/components/ui/button"
import PixelFlower from "./PixelFlower"

// Page chrome colors come from the brief (off-white editorial hero). They're
// set once here as CSS custom properties rather than sprinkled through the
// markup; the canvas palette lives in CONFIG inside PixelFlower.tsx.
const PAGE = {
  bg: "#F7F5F1",
  ink: "#2B2A26",
  muted: "#6F6B63",
  accent: "#D9767F",
} as const

const NAV = ["Studio", "Work", "Journal", "Contact"]

export default function PixelFlowerPage() {
  return (
    <div
      className="relative h-dvh w-full overflow-hidden bg-[var(--pf-bg)] text-[var(--pf-ink)]"
      style={
        {
          "--pf-bg": PAGE.bg,
          "--pf-ink": PAGE.ink,
          "--pf-muted": PAGE.muted,
          "--pf-accent": PAGE.accent,
        } as React.CSSProperties
      }
    >
      <PixelFlower className="absolute inset-0 block" />

      <nav className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 py-5 font-mono text-[11px] uppercase tracking-[0.18em] sm:px-10">
        <span className="pointer-events-auto">Atelier ◆ 09</span>
        <ul className="pointer-events-auto hidden gap-7 sm:flex">
          {NAV.map((item) => (
            <li key={item}>
              <a href="#" className="opacity-70 transition-opacity hover:opacity-100">
                {item}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <section className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-full flex-col justify-start px-6 pt-24 sm:justify-center sm:px-10 sm:pt-0 lg:px-16">
        <div className="max-w-md">
          <h1
            className="text-[clamp(2.4rem,6vw,5rem)] leading-[0.98] tracking-tight text-balance"
            style={{ fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif" }}
          >
            Visions before they find their shape
          </h1>
          <p className="mt-6 text-sm font-medium tracking-wide">
            A studio for slow, hand-made interfaces.
          </p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-[var(--pf-muted)]">
            We sketch in pixels the way a painter sketches in wash: loosely at first, letting the
            forms bloom before the edges are decided.
          </p>
          <Button
            className="pointer-events-auto relative mt-8 h-11 rounded-none bg-[var(--pf-accent)] px-6 font-mono text-[12px] uppercase tracking-[0.2em] text-white hover:bg-[var(--pf-accent)] hover:brightness-95"
          >
            Enter the studio
            <span
              aria-hidden
              className="absolute top-0 right-0 size-[4px] bg-white"
            />
          </Button>
        </div>
      </section>
    </div>
  )
}
