# Bloom Trellis

A bougainvillea take on Frost Flat. Typed letters sit tightly tracked in cream with a diamond trellis lattice cut into them. Each word grows one plant: woody stems rooted on the type, ovate leaves, hooked thorns, and hanging three-bract clusters. The plant also has an arching branch that drapes a hero bunch, and loose bracts flutter down to the baseline. Everything is flat: no gradients, glows or shadows. This prototype is a copy of `frost-flat`, which is untouched.

## How it works

- **Layout.** The text stays on one line as long as possible. The font shrinks so the line spans `LINE_VW` (85%) of the viewport, capped by `FONT_MAX_VH` for short text. Only when that would drop below `ONE_LINE_MIN_VW` (8.4% of the viewport width) does it hold that size and wrap at spaces, each row filling up to `ROW_MAX_VW`. Tracking is `TRACKING_EM` (-0.01), and spaces get `WORD_SPACE_EM` extra so words read apart. Each word rolls a personality (`STYLES`: LUSH, CLIMBING or SPILLING) and a bract variety. Shift+R regrows, Shift+T toggles the lattice panel, Shift+V toggles the debug view, Shift+K toggles the backspace diagnostics, and Enter clears everything. Live glyphs and the caret ease toward their layout targets with `k = 1 - exp(-dt / LAYOUT_EASE_MS)`.
- **Letters (`glyph.ts`).** Each character is rasterised once at `REF_FONT_PX`. It keeps its ink mask, ink bounds and an outside distance field, which hugs use. Each frame the live letters are filled in `LETTER` on one layer canvas, the ±45° lattice is stroked `source-atop` over their box in screen space, and the layer is composited. Nothing is cached per position, so a keypress costs no re-render.
- **One plant per word (`plant.ts`).** All geometry is in word coordinates at `REF_FONT_PX`: the origin is the word's first pen and the baseline is y = 0. The scene draws a plant from that pen, scaled to the layout size. Letters are added and removed at the end of the word as it is typed, and every stem is owned by a letter.
- **Stems (`walker.ts`).** Every stem is a 60-step walk over u in [0, 1]. Its heading turns by `k(u) du`, where k is linear in u, so it changes sign at most once (`INFLECT_CHANCE`). Gravity adds a pull toward straight down of `g · u² · GRAVITY_K` per radian off vertical. Curvatures are total turns, so a shape doesn't depend on its length. The walk is joined with Catmull-Rom cubics. There is no noise or wiggle.
- **Density.** Budgets grow with the word's length: growth points (one per `GROWTH_LETTERS_PER` letters, at least 3), drapes and bloom sites. A letter without a growth point of its own tries a hug. At settle, any letter with no visible leaf, bloom or front stem over it gets a hug. Failing that, it gets a blooming twig off a stem passing over it, and failing that, a trunk of its own.
- **Sprinkles and colours.** At settle, stretches of stem with no bloom within `SPRINKLE_GAP_EM` get small clusters (`SPRINKLE_LENGTH_EM`, up to 3 per stem). These are extras outside the bloom budget, but they respect the calm rule. Each word is one colour, never the same as the word before it. `SECOND_VARIETY_CHANCE` (currently 0) can give a word a second variety, used by `SECOND_VARIETY_SHARE` of its clusters, with each bunch staying a single colour.
- **Hierarchy.**
  - Each word places 2–3 **growth points** on ink near the baseline, spread across it (`GROWTH_EVERY`, topped up at settle). Each grows a **trunk**: a short climber with g 0.2, bare for its first 35%.
  - **Drapes** are branches (2–3 per word) that leave a trunk at 30–45° on the outer side of its curve and fall with g 0.8. The first two end in a medium bunch; the rest end in a twig.
  - **Twigs** leave trunks and drapes. They carry a single or pair of small blooms, buds on their last 15%, and leaf pairs just behind the blooms. A twig sometimes ends in a **tendril** spiral, at most 2 per word.
  - Children start when the parent's tip passes the branch point, and each gets a 1.3× **knot** on its parent.
  - Widths are trunk 1.0, branch 0.65 and twig 0.4 × `0.022 · fs`, tapering to 60% at the tip.
- **Arch (`growArch`).** One per word, grown when the word settles. It is one continuous vine in three phases, built as two stems so each phase can sit on its own layer.
  - **Support.** The ascender (`ARCH_ASCENDERS`) nearest the word's centre, otherwise the tallest letter (ties go to the most central).
  - **Climb** (in front). Starts on the support's baseline ink and follows its outline upward with the hug tracer (`traceOutline`), 0.03 fs outside the ink. With tight tracking it stops just short of a neighbour's ink, so it is only ever in front of its support. It takes over any hug on that glyph, which withers.
  - **Crest + spill** (behind the type). One bend from the climb's heading round to nearly straight down on the far side. The profile is `u(1-u)^b`, sharpest at `ARCH_CREST_PEAK` so the climb side is steeper, with ±15% low-frequency noise. The bend's length is solved so the crest stays under the cap: 0.25 fs above the support's top, lowered further if needed to keep `ARCH_TOP_MARGIN_VH` clear of the viewport's top. The spill then drops on. It is trimmed where the estimated main-bunch centre lands within 0.2 fs (horizontal) and 0.3 fs (vertical) of ink, choosing the point nearest the neighbour's top. The whole arch, bunch included, must span at most 1.6 fs.
  - **Retries and fallback.** Each attempt flips the arch to the other side of the support, then shortens the spill. After 6 failed attempts, a drape carries the hero bunch instead.
  - **Width, leaves and twigs.** The width tapers from 1.0 to 0.55 × base over both phases, with no knot at the hand-over. Leaves start at 20% of the length and are spaced about 0.12 fs, alternating sides. On the climb they point outward only, so they don't cover the support. They grow larger near the crest and gather in pairs within 0.15 fs of the bunch. There are 2–3 side twigs on the outer side of the curve (one always on the spill), each ending in a small cluster or a leaf pair.
  - **Blooms.** The main bunch has 4–6 hero clusters on a short drooping stalk, shrunk if needed to stay 0.5 fs across. A second bunch of 2–3 smaller clusters hangs 40% of the way down the spill.
  - **Timing.** The climb grows first, then the crest. Leaves and twigs spring in as the tip passes them, and the main bunch opens last.
- **Hugs.** About one per 2 letters. A hug traces the iso-line `HUG_OFFSET_EM` outside the ink of the outside distance field, upward from just above the baseline. It stops near the top or where the outline turns down, and ends in a small bloom or a leaf pair. Hugs are always in front, and the offset keeps them off the stroke.
- **Bridges.** Between neighbouring glyphs whose ink gap at a random height is under 0.6 fs, at most one per 2–3 letters. A bridge is a parabola sagging 0.15 fs, with both ends just inside the ink. Bridges are always behind the type.
- **Clearance (`judge` in `plant.ts`).** Each candidate stem is checked in this order, and the decorations are then checked too:
  - **reach:** stays near the word.
  - **self:** doesn't cross itself; the tendril and its lead-in are exempt.
  - **parallel:** isn't within 0.04 fs and 35° of another stem for more than 20% of its length; the first 0.1 fs is exempt.
  - **front:** a stem goes in front of the type (layer 1) only if it crosses ink for at most 0.4 fs on one glyph; otherwise it goes behind (layer 0).
  - **calm:** what's drawn in front (layer-1 stems and leaves, all blooms) may cover at most 60% of the word's ink cells.

  A rejected stem retries with a new seed up to `VINE_TRIES` times, then is skipped. The rejection counts per rule are logged when Shift+V is pressed and when a word settles, along with the arch's rejected candidates (climb, landing, span, top, the clearance rules, and fallback). The debug view also draws the support's ink box, the crest cap line, and a line from the main bunch to the ink it lands against.
- **Blooms.** There are 3–6 bloom sites per word: the hero, up to 2 medium bunches, and the rest small singles or pairs on twigs. Buds don't count. Blooms are always drawn in front.
- **Rendering (`render.ts`).** Stems are filled tapered outlines. Layer-0 stems, thorns and leaves are drawn, then the letters, then layer 1, then blooms, falling bracts, the debug overlay and the caret.

## Motion

These are the same systems as before, applied to plants.
- **Springs:** pop-ins and the staggered bract opening.
- **Sway:** each stem sways about its root on a spring chasing a wind lean plus gusts. A child composes onto its parent at the branch point. Clusters swing on a heavier pendulum spring that follows their stem 80ms late.
- **Boil:** at 8fps, with half amplitude on bracts.
- **Kicks:** typing kicks the current word's plant, and backspace makes it flinch.
- **Backspace and wither.** The handler is synchronous and is the whole deletion. It sets `dead = now` on the last live glyph, marks its own stems dying, and gives the live glyphs and the caret new targets that frame. Nothing is awaited or regenerated, and every keydown counts, auto-repeats included.
  - **Ownership.** Each glyph owns its stems, and a child always belongs to the later of its own glyph and its parent's glyph, so nothing is orphaned. Deleting a glyph also takes any neighbour's stem whose tip or blooms hang over it (`WITHER_REST_PAD_EM`), with its children. If any part of the arch goes, the whole arch goes.
  - **The letter.** Its letterform vanishes on the keypress frame and its glyph keeps its last position.
  - **The plant.** It retracts by `kk = 1 - easeOutCubic(t / WITHER_MS)` (260ms), applied to stem lengths, leaf scale and bloom size together. Children are drawn back before the parent's tip passes their branch point, and the arch's climb and crest retract as one line.
  - **Removal.** The glyph is dropped after `REMOVE_MS` (300ms). At most `WITHER_MAX` (30) glyphs wither at once; older ones are fast-forwarded.
  - **Falling bracts.** Up to 8 bracts from the glyph's open clusters fall as independent particles, each after a random delay of up to 120ms, within the 40-particle cap. They fade out as they fall (`WITHER_BURST_LIFE_MS`) instead of coming to rest. Petals already lying on the deleted letter fade within `PETAL_FADE_MS`.
  - **Settle and the arch.** A word only settles after `WORD_SETTLE_MS` with no key at all, so holding Backspace never triggers growth mid-deletion. If the deleted letter held the arch, a new arch grows at the next settle.

## Key files

- `page.tsx` — loads Playfair Display (Fraunces fallback), mounts the scene
- `config.ts` — every tunable
- `scene.ts` — input (synchronous delete), eased layout and caret, words → plants, bract bursts, letter layer, layered draw, debug and backspace diagnostics
- `plant.ts` — growth points, gestures, hierarchy, bridges, clearance rules, bloom budget
- `walker.ts` — curvature walk, Catmull-Rom smoothing, sampling
- `render.ts` — springs/sway/boil/wither update, tapered stems, knots, thorns, leaves, clusters, debug skeletons
- `glyph.ts` — letter masks, outside distance field, lattice sprite
- `bracts.ts`, `falling.ts`, `motion.ts`, `mask.ts`, `text-layout.ts`, `rng.ts`, `font.ts`, `ease.ts`, `color.ts`

## Open questions

- Hugs and bridges don't come from a growth point. The hug brief ("from the baseline, following the outline") and the bridge brief (both ends on ink) imply that. Should hugs instead branch off a nearby trunk?
- "3–6 clusters per word" is read as bloom sites. A bunch of 4–7 clusters counts as one site, otherwise drape bunches alone would exceed 6.
- The bunch's landing is checked against an estimate of its centre (spill tip + stalk + cluster). The real bunch fans out around that point.
- Climbing trunks aren't one of the four named gestures, but drapes need something to leave from, and the gravity values name "climbers".
- A word that wraps mid-word, past `MAX_LETTERS_PER_ROW`, draws its plant from the first row's pen, so the second row's letters won't line up with it.
