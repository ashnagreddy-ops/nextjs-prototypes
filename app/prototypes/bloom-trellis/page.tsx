import { BloomTrellis } from "./bloom-trellis"
import { bootScript } from "./palettes"

export default function BloomTrellisPage() {
  return (
    <>
      {/* applies the saved palette's colours before the first paint, so there's no flash */}
      <script dangerouslySetInnerHTML={{ __html: bootScript() }} />
      <BloomTrellis />
    </>
  )
}
