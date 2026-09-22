# Pixel Flower

An editorial hero: serif headline on the left, and on the right a bouquet (three tulips, one open
flower, stems, leaves) rendered as a mosaic of ~12px squares that reads like a pixelated
watercolor rather than a flat sprite. It builds itself in bottom-up, sways, sheds drifting petal
clusters, and flinches away from the cursor.

## How it works

**Pipeline: vector → offscreen → pixelate.** Every frame `PixelFlower.tsx` draws the bouquet as
ordinary smooth canvas shapes (bezier petals with radial/linear gradients, stems as thick stroked
quadratics, leaves as two-curve fills) onto an *offscreen* canvas whose pixel size equals the cell
grid — e.g. 66×75 for a 792×900 region at 12px cells. `getImageData` reads that tiny bitmap back,
and each non-transparent pixel becomes one crisp `fillRect` square on the visible canvas
(`imageSmoothingEnabled = false`, DPR-scaled). Because the vector layer is drawn at grid resolution,
the rasteriser's antialiasing *is* the dithering: a petal edge that covers 30% of a grid pixel gets
alpha ≈ 0.3, which the cell pass renders at partial opacity (after `pow(a, gamma)` to soften it and
a low-alpha cutoff to drop crumbs). When the scene sways and edges cross pixel boundaries, those
fractional cells flicker on and off — that shimmer is intended, not a bug.

**Seeded color jitter.** Flat-filled cells look like a sprite. To read as painted, every cell gets a
stable offset from `hash2(col, row, seed)` — an integer hash, so the same cell always gets the same
value and nothing sparkles randomly frame to frame. The pixel's RGB is converted to HSL, lightness is
nudged by ±5% and hue by ±4° using two independent hash channels, then converted back. Cells near
the pointer also get a lightness boost (`repel.brighten`).

**Scene coordinates.** The bouquet is described in a 100×140 unit space with the stem base at
`(0,0)` and blooms at negative y. `layout()` fits that into the grid (`sceneScale`), anchored at the
bottom-centre of the right-hand region (`region.desktopStart` = 45% of the viewport, or the full
width below the mobile breakpoint). Sway is a single `rotate()` about the base before drawing; each
bloom head adds its own smaller rotation with a per-bloom phase.

**Intro.** `elapsed` (ms, only advanced while the loop runs) drives two curves. Petals scale
0.6 → 1 about their attach point from `intro.bloomStart`. Independently, each cell has a reveal
time = its height fraction within the flower × 80% of `intro.duration` + a hashed 0–120ms delay;
the cell fades in and grows from half size over `intro.cellPop` ms. Everything uses a Newton-solved
`cubic-bezier(.2,.8,.2,1)`.

**Drifting petals.** `particles.count` clusters, each a random 3–6 cell shape from `CLUSTERS`, with
per-cell pink colours pre-jittered at spawn. They spawn near a random bloom head (converted to
visible-canvas px in `layout()`), move right at `particles.speed` px/s, wobble on a sine, rotate
slowly (offsets rotate, squares stay axis-aligned so they remain crisp), fade in over ~0.9s and fade
out across `particles.fadeZone` px before the right edge, then respawn after a random delay.

**Cursor repel.** Each cell carries a displacement + velocity. A critically-damped-ish spring
(`repel.spring`, `repel.damping`) pulls it home; cells within `repel.radius` of the pointer get a
push proportional to proximity. The integration runs for every cell each frame (≈5k cells, trivial)
so rest positions are exact rather than snapped.

**Lifecycle.** One `requestAnimationFrame` loop. It pauses on `visibilitychange` and via an
`IntersectionObserver` on the canvas; `elapsed` uses a clamped delta so a paused tab doesn't jump.
Resize is debounced 150ms and rebuilds the offscreen canvas, hash arrays and spring arrays.
`prefers-reduced-motion` renders a single static, fully-bloomed frame: no loop, sway, particles or
repel.

**Tuning `CONFIG`** (top of `PixelFlower.tsx`):
- `cell` — desktop cell size, minimum, and the viewport width that maps to full size.
- `palette` — all scene colours; `petalDrift` is the pool for particle cells.
- `jitter` — lightness/hue jitter amplitude and the hash seed (change the seed for a new mosaic).
- `alpha` — edge softness: lower `cutoff` keeps more faint edge cells, lower `gamma` makes them denser.
- `intro`, `sway`, `particles`, `repel` — timing, amplitude, counts, spring constants.
- Colours are literal hex values, a deliberate exception to the design-token rule: canvas 2D can't
  read CSS custom properties, and the brief fixes the page as an off-white hero regardless of theme.
  The page chrome colours live in `PAGE` in `page.tsx` as scoped CSS variables.

## Key files

- `page.tsx` — hero layout, nav, headline, button; scoped page colour variables
- `PixelFlower.tsx` — `CONFIG`, scene geometry, pixelate pipeline, animations, loop lifecycle

## Open questions

- The page ignores the app's dark theme on purpose (brief-specified off-white). If it ever needs to
  live in dark mode, the canvas palette would need a second set in `CONFIG` and `PAGE` would move to
  tokens.
- The headline uses a system serif stack; a loaded webfont (e.g. a Fraunces/Instrument Serif) would
  match the reference more closely.
