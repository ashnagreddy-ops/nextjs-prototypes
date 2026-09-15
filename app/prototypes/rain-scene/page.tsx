import Image from "next/image"
import RainAudio from "./RainAudio"
import RainCanvas from "./RainCanvas"

// Tune the background blur radius here.
const BACKGROUND_BLUR = "7px"

export default function RainScenePage() {
  return (
    <div
      className="relative h-dvh w-full overflow-hidden"
      style={{ ["--bg-blur" as string]: BACKGROUND_BLUR }}
    >
      <Image
        src="/prototypes/rain-scene/rain-window.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="scale-105 object-cover blur-[var(--bg-blur)]"
      />
      <RainCanvas />
      <RainAudio />
    </div>
  )
}
