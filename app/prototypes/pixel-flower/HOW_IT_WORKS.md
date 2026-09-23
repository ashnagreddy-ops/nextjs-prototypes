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
seam; the open flower is five broad radial petals with a slight draw-in near the tip so the silhouette
shows soft lobes rather than a smooth circle (the outline is waved along its outer half and then
smoothed once so nothing reads as a spike; seeded ±20% size and ±14° rotation; bases overlapping past
the centre so it cups) quantised to its own 14-tone `PALETTE.bloom` ramp, deeper and
more saturated than the bud pinks and running up to a near-white blush. Each petal has its own
gradient from pale at the centre to saturated rose at the tip, shifted deeper on the top-left petals and lighter on the bottom-right ones, a soft lit ridge along its upper-left curve and a shadow along its
lower-right edge. Over that, in bloom space, a whole-flower falloff pulls the top-left into deep rose and lifts the
bottom-right toward blush (the shadow sits top-left, the light bottom-right), and a full throat ring (1–2 cells, visible all round, peaking at
near-white on its lower-right) hugs the centre. The shadowed top-left petals carry two short pale ridge strokes each and the two or three most
lit ones a small near-white specular spot, and in cell space a low-frequency mottle lifts small
clusters inside the darker tones by one or two steps, so the dark areas read as light catching on
the surface rather than one smooth ramp. A short deep-rose arc hugs the centre's upper-left (the rim's
shadow falling into the pit), a deeper wash sits on the bottom-left lobe, another deepens the inner fold on the right side between
the centre and the right petals, a few small softer mid-pink dabs and two deep-rose streaks running horizontally inward from the
edge sit inside the dark top-left patch so it isn't one flat tone, and in cell space the bottom-left outer edge darkens two steps. Back (upper) petals draw first one step deeper; front (lower) petals
draw last. Petal separations are four straight spokes from the centre, one step darker, fading out
halfway to the edge. The centre sits a little down and to the right of the bloom's origin and is a small soft pit
(~3×3 cells): `#5C2A22` with `#3A1512` on its
upper-left cell or two and a muted `#B8434F` glint lower-right. In cell space the open flower's quantised
indices get a 3×3 median over its own cells (removing single-cell speckle from the overlapping
gradients while keeping the colour bands), and it darkens one step only along its bottom-right outer
edge (buds keep the below/left rim); the half-open bloom is a lobed cup with two outer petals curling outward. Each bloom
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

The result is packed into struct-of-arrays (`cCol`, `cRow`, `cColor`, `cGroup`, `cLag`). A full-resolution render of the same
parts goes to a second canvas for the debug view.

**Animate.** Every frame draws only the baked cells. Sway is a per-*row* horizontal offset:
`sin(t·speed) · amplitudePx · (heightFromBottom/totalHeight)²` (22px at the top by default), so the base row is fixed and the top leans
most. Bloom cells use the phase `t − 0.25s`; stem cells blend from the bloom phase at their top row
to the stem phase four rows down (`cLag`), so the joint never tears. Leaf cells store how far along the blade
they sit and which leaf they belong to, and flutter *up and down* (`sway.leafPx`, squared toward the
tip) with a smaller sideways component, each leaf on its own rhythm and phase, so the two low leaves
visibly bob out of step even though the row-based sway is near zero at the bottom. Every x/y is rounded to device pixels and each cell is drawn one device pixel wider, which removes hairline
seams between neighbours.

**Falling petals.** Every 1.5–3s a petal sheds from one spot just behind the top-right bud
(`petals.source`: bloom index, offset in cells, jitter; max six on screen), in a mid pink with a
lighter and darker tone two ramp steps either side. The petal layer is drawn *beneath* the baked
cells, so petals emerge from behind the bouquet instead of appearing in front of it. It is one oval form (an ellipse about 5×4 cells, `ovalSprite`) rasterised at a random diagonal
orientation at spawn (20–70° or 110–160°, so none is ever flat or upright), all the same clean shape
and none spinning; shaded light at the upper-left to dark at the lower-right; `petals.tumble` (off by default) cycles through smaller
frames for a flipping look. It is thrown softly out to the right (`petals.launch`: an initial rightward
velocity with a slight upward pop) and drag eases that push toward the ambient wind while gravity
accelerates it quickly toward ~120px/s, so it arcs out from behind the bud and drops. One very
slow, small lean (2–5px over 4–7s) plus a per-petal breeze (smooth value-noise gusts, `petals.breeze`,
sideways with a little lift) roughens the arc without any zig-zag. The wind
always blows rightward and strengthens when the sway leans right, so petals only ever fall on the
bouquet's right; they fade over the bottom 20% of the viewport. Spawn gaps are irregular: a squared random over 0.35–3.2s skews toward short gaps with occasional
long pauses, and `petals.pairChance` sometimes fires a second petal 80–300ms behind the first so two
pop out together. Blooms lose no cells.

**Cursor repel.** Baked cells carry a spring displacement pushed by the pointer and clamped to one
cell (`repel.maxCells`), springing back to rest.

**Debug view.** Press **D** to overlay the full-resolution vector layer beside the baked grid; the
page text hides while it is up so the panel can fill the left side.

**Lifecycle.** `requestAnimationFrame` loop paused on `visibilitychange` and by an
`IntersectionObserver`; resize is debounced 150ms and re-bakes. `prefers-reduced-motion` bakes and
draws one static frame with no sway or petals. `CONFIG.intro.enabled` (off by default) re-enables the
bottom-up build-in.

**Tuning.**
- `BOUQUET` — bloom kind, attach point, tilt, size and seed (draw order = back to front); leaf
  origins, angles, tip angles and lengths; the gather height, stem slots, root pinch and stem width.
- `PALETTE` — the quantised pinks for buds and petals (14 steps dark → light), the open flower's
  own 14-tone `bloom` ramp (deep crimson through rich coral to near-white blush), greens, and the centre eye's brown-to-rose ramp, and `accent`, which lives in the pink family under a reserved index so
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
