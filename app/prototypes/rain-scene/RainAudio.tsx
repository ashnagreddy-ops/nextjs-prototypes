"use client"

import { useEffect, useRef, useState } from "react"

// Matches the streak/droplet color baked into RainCanvas's canvas fills
// (#C1C4C4) — canvas can't reference CSS tokens, so this control is kept
// literal too, for visual consistency with the rest of the scene.
const WAVE_COLOR = "#C1C4C4"

// Ambient background level — audible under the scene, not dominant.
const AMBIENT_VOLUME = 0.35

export default function RainAudio() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [muted, setMuted] = useState(true)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = AMBIENT_VOLUME
    // The `autoPlay` attribute isn't reliable on its own across browsers —
    // explicitly kick off playback too. Muted autoplay is universally
    // permitted, so this should always resolve; swallow the rare rejection
    // rather than surface an unhandled promise warning.
    void audio.play().catch(() => {})
  }, [])

  const toggleMuted = () => {
    const audio = audioRef.current
    setMuted((prev) => {
      const next = !prev
      // If autoplay never actually got the element playing (it can fail
      // silently even while muted), flipping .muted alone produces no sound.
      // A click is always a valid user gesture, so play() is guaranteed to
      // work here regardless of what happened on mount.
      if (!next && audio?.paused) void audio.play().catch(() => {})
      return next
    })
  }

  const playing = !muted

  return (
    <>
      <audio ref={audioRef} loop autoPlay muted={muted} playsInline>
        <source src="/prototypes/rain-scene/rain-ambience.m4a" type="audio/mp4" />
        <source src="/prototypes/rain-scene/rain-ambience.wav" type="audio/wav" />
      </audio>

      <style>{`
        @keyframes rain-scene-wave-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-30px); }
        }
      `}</style>

      <button
        type="button"
        onClick={toggleMuted}
        aria-label={muted ? "Play sound" : "Mute sound"}
        aria-pressed={playing}
        className="absolute top-4 right-4 z-10 flex items-center gap-2 rounded-sm p-1 opacity-40 outline-none transition-opacity duration-300 hover:opacity-90 focus-visible:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {/* Always present, left of the label, in both states — not gated on
            "playing" — so it reads as the control's icon, not a state flag.
            Fixed window exactly one wave period wide; the inner svg holds two
            periods and scrolls left by exactly one, so the loop is seamless.
            3 peaks per period (short/tall/medium: 4/16/9 units of true
            amplitude off a baseline near the bottom) for a dramatic,
            irregular skyline. Control points are solved, not guessed: a
            symmetric cubic hump's actual peak is 0.25×baseline + 0.75×controlY,
            not controlY itself — an earlier version set controlY to the
            *intended* peak height directly, which damped every peak toward
            the baseline and rendered them all noticeably shorter than meant. */}
        <svg viewBox="0 0 30 24" width="30" height="24">
          <svg
            viewBox="0 0 60 24"
            width="60"
            height="24"
            style={{ animation: "rain-scene-wave-scroll 2.2s linear infinite" }}
          >
            <path
              d="M0,19 C2.5,13.67 7.5,13.67 10,19 C12.5,-2.33 17.5,-2.33 20,19 C22.5,7 27.5,7 30,19
                 C32.5,13.67 37.5,13.67 40,19 C42.5,-2.33 47.5,-2.33 50,19 C52.5,7 57.5,7 60,19"
              fill="none"
              stroke={WAVE_COLOR}
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
        </svg>

        <span
          className="text-base tracking-wide whitespace-nowrap transition-opacity duration-300"
          style={{ color: WAVE_COLOR, opacity: muted ? 1 : 0 }}
        >
          Play sound
        </span>
      </button>
    </>
  )
}
