# Pixel Flower

An editorial hero: serif headline on the left, and on the right a bouquet (two buds, an open
flower, a half-open bloom, four stems gathered into one bundle, three leaves) baked once into ~11px
palette-quantised pixel art, then swayed row by row with tumbling petals falling from the blooms. It builds itself in bottom-up, sways, sheds drifting petal
clusters, and flinches away from the cursor.

## How it works

**Architecture: draw → bake → animate.** The vector bouquet is drawn once, rasterised once into a
cell grid, and from then on only the baked cells are drawn. Nothing re-rasterises during animation,
so the cell pattern never changes and edges never shimmer.

**Draw.** `buildParts()` returns an ordered list of parts, each with a `draw(ctx)` in scene units
(1 unit = 1 cell, stem base at `(0,0)`, y negative upward, bouquet ≈ 48×64 cells): four stems, three
leaves, four blooms and the open flower's centre. Bloom shapes are smooth paths, no edge noise:
a closed bud is a U cup taller than wide with three pointed tips (middle tallest) and one darker
seam; the open flower is five rounded radial petals with seeded ±10% size/rotation variation, each
shifted up or down the ramp by how much it faces the top-right light, with a deeper base shadow, a
pale ridge along its midline, a firmer outline on the shadow side, and a bright coral-red
(`PALETTE.accent`, `#F6727E`) crescent near the tip of the lit petals; the centre is a small graded
brown eye about two cells across; the half-open bloom is a lobed cup with two outer petals curling outward. Each bloom
is shaded as one form by a linear gradient in its local frame with evenly spaced stops over the
whole 14-tone pink ramp, lit from the top-right (white-pink there, through the mids to deep rose and
crimson toward the bottom-left; buds run top to bottom instead, with an extra darkening on the right
flank) plus an eased crimson falloff at each petal's base and a pale halo just outside the open
flower's centre. The centre itself is a radial gradient over its own nine-tone family: near-black
brown in the middle, warm browns, then dusty rose at the edge, with one glint cell, a faint outline so neighbouring petals separate
after quantising, and one small highlight ellipse. The half-open bloom uses the same gradient one
step deeper so it reads apart from the open flower it overlaps.

**Bake** (`bake()`, once per layout). Each part is drawn alone onto an offscreen canvas whose pixel
size equals the cell grid. Any pixel with alpha ≥ 0.5 claims its cell for that part and its colour is
quantised to the nearest swatch *within the part's family* (pinks, greens, or centre tones), so a
petal edge never turns green and a stem never turns pink. Then the cell-space passes run:

- **Blooms** — optional smooth value noise at a ~6-cell scale (off by default; it breaks the
  seamless banding). Any bloom cell 4-adjacent to a bloom drawn in front of it darkens one step, so
  overlaps separate. Bloom cells with background directly below or to the left darken one step each
  (two ramp steps below, one to the left: a deep-rose rim on the shadow side).
- **Stems** — each row is scanned for runs of the same stem; a cell's position across that run picks
  its tone: left edge `#6A9F48`, centre `#3B7433`/`#4E8A3C`, right edge `#1F4A22`. Cells touching a
  different stem darken a step so the bundle stays four stems. The lower third darkens a step with a
  hashed gradual transition, and cells with a bloom 1–2 rows directly above darken a step as cast
  shadow.
- **Leaves** — cell with nothing of the leaf above it is the top edge (light); nothing below is the
  underside (dark); otherwise mid.

`bake()` runs the pass twice: the first pass measures the silhouette's column extent, the origin is
shifted so the bouquet is centred in its region, and the second pass bakes at the shifted origin.
The bouquet scales to `region.heightFrac` of the viewport height on desktop (cells stay the same size;
the bouquet just spans more of them).

The result is packed into struct-of-arrays (`cCol`, `cRow`, `cColor`, `cGroup`, `cLag`) plus, per
bloom, a list of its edge cells and colours for spawning petals. A full-resolution render of the same
parts goes to a second canvas for the debug view.

**Animate.** Every frame draws only the baked cells. Sway is a per-*row* horizontal offset:
`sin(t·0.8) · 10px · (heightFromBottom/totalHeight)²`, so the base row is fixed and the top leans
most. Bloom cells use the phase `t − 0.25s`; stem cells blend from the bloom phase at their top row
to the stem phase four rows down (`cLag`), so the joint never tears. Leaf cells store how far along the blade
they sit and add their own flutter (`sway.leafPx`, squared toward the tip, on a slightly faster
offset sine) on top of the stem sway, so the two low leaves visibly move even though the row-based
sway is near zero at the bottom. Every x/y is rounded to device pixels and each cell is drawn one device pixel wider, which removes hairline
seams between neighbours.

**Falling petals.** Every 1.5–3s a petal spawns on a random edge cell on the *right-hand side* of
a random bloom (max six on screen), coloured from that cell's palette index ±1 so the sprite has a
light top row, mid middle and darker bottom. It is a soft-cornered 4×3 oval with the corners removed; `petals.tumble` (off by default) cycles
through 3×3 and 1×3 frames for a flipping look. It accelerates
to a terminal speed of ~40px/s, drifts on a horizontal sine (15–25px amplitude, 1.5–2.5s period)
with a wind that always blows rightward and strengthens when the sway leans right, so petals only ever
fall on the bouquet's right, and fades over the bottom 20% of the viewport. Blooms lose no cells.

**Cursor repel.** Baked cells carry a spring displacement pushed by the pointer and clamped to one
cell (`repel.maxCells`), springing back to rest.

**Debug view.** Press **D** to overlay the full-resolution vector layer beside the baked grid.

**Lifecycle.** `requestAnimationFrame` loop paused on `visibilitychange` and by an
`IntersectionObserver`; resize is debounced 150ms and re-bakes. `prefers-reduced-motion` bakes and
draws one static frame with no sway or petals. `CONFIG.intro.enabled` (off by default) re-enables the
bottom-up build-in.

**Tuning.**
- `BOUQUET` — bloom kind, attach point, tilt, size and seed (draw order = back to front); leaf
  origins, angles, tip angles and lengths; the gather height, stem slots, root pinch and stem width.
- `PALETTE` — the quantised pinks (14 steps dark → light: the base swatches plus interpolated
  midpoints, so bands stay 1–3 cells wide and the gradient reads as seamless), greens, and the centre
  eye's brown-to-rose ramp, and `accent`, which lives in the pink family under a reserved index so
  the bake can quantise to it but the shading passes leave it untouched.
- `CONFIG` — cell size, alpha threshold, bake noise, intro, sway (speed, amplitude, bloom lag, stem
  blend rows, leaf flutter), petal timing/motion/tumble, repel constants, debug key. Colours are literal hex, a deliberate
  exception to the design-token rule: canvas 2D can't read CSS custom properties and the brief fixes
  an off-white hero regardless of theme. Page chrome colours live in `PAGE` in `page.tsx`.

## Key files

- `page.tsx` — hero layout, nav, headline, button; scoped page colour variables
- `PixelFlower.tsx` — `CONFIG`, `PALETTE`, `BOUQUET`, vector parts, bake passes, sway/petals/repel, debug view, loop lifecycle

## Open questions

- The page ignores the app's dark theme on purpose (brief-specified off-white). If it ever needs to
  live in dark mode, the canvas palette would need a second set in `CONFIG` and `PAGE` would move to
  tokens.
- The headline uses a system serif stack; a loaded webfont (e.g. a Fraunces/Instrument Serif) would
  match the reference more closely.
