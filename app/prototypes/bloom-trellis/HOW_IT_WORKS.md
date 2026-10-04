# Bloom Trellis

A bougainvillea take on Frost Flat. Typed letters sit tightly tracked in cream with a diamond trellis lattice cut into them. Each word grows one plant: woody stems rooted on the type, ovate leaves, hooked thorns, and hanging three-bract clusters. The plant also has an arching branch that drapes a hero bunch, and loose bracts flutter down to the baseline. Everything is flat: no gradients, glows or shadows. This prototype is a copy of `frost-flat`, which is untouched.

## How it works

- **Layout.** Tracking is `TRACKING_EM` (-0.01). The font is sized so the first row spans `LINE_VW` (75%) of the viewport, capped by `FONT_MAX_VH`. Each word rolls a personality (`STYLES`: LUSH, CLIMBING or SPILLING) and a bract variety. Shift+R regrows, Shift+T toggles the lattice panel, and Shift+V toggles the debug view.
- **Letters (`glyph.ts`).** Each character is rasterised once at `REF_FONT_PX`. It keeps its ink mask, ink bounds and an outside distance field, which hugs use. It is drawn as a cached sprite: `LETTER` fill with ±45° lattice lines stroked `source-atop`, in screen space, and static.
- **One plant per word (`plant.ts`).** All geometry is in word coordinates at `REF_FONT_PX`: the origin is the word's first pen and the baseline is y = 0. The scene draws a plant from that pen, scaled to the layout size. Letters are added and removed at the end of the word as it is typed, and every stem is owned by a letter.
- **Stems (`walker.ts`).** Every stem is a 60-step walk over u in [0, 1]. Its heading turns by `k(u) du`, where k is linear in u, so it changes sign at most once (`INFLECT_CHANCE`). Gravity adds a pull toward straight down of `g · u² · GRAVITY_K` per radian off vertical. Curvatures are total turns, so a shape doesn't depend on its length. The walk is joined with Catmull-Rom cubics. There is no noise or wiggle.
- **Hierarchy.**
  - Each word places 2–3 **growth points** on ink near the baseline, spread across it (`GROWTH_EVERY`, topped up at settle). Each grows a **trunk**: a short climber with g 0.2, bare for its first 35%.
  - **Drapes** are branches (2–3 per word) that leave a trunk at 30–45° on the outer side of its curve and fall with g 0.8. The first two end in a medium bunch; the rest end in a twig.
  - **Twigs** leave trunks and drapes. They carry a single or pair of small blooms, buds on their last 15%, and leaf pairs just behind the blooms. A twig sometimes ends in a **tendril** spiral, at most 2 per word.
  - Children start when the parent's tip passes the branch point, and each gets a 1.3× **knot** on its parent.
  - Widths are trunk 1.0, branch 0.65 and twig 0.4 × `0.022 · fs`, tapering to 60% at the tip.
- **Arch.** When the word settles, the outermost growth point grows one arch toward the word's middle. It heads up within 0.5 rad of vertical, has constant curvature, and gravity (0.4) only acts in its last third. Its length is solved so the crest sits 0.5–0.8 fs above the word's highest ink. The **hero bunch** hangs from its tip: 4–7 clusters on a drooping sub-stem.
- **Hugs.** About one per 2 letters. A hug traces the iso-line `HUG_OFFSET_EM` outside the ink of the outside distance field, upward from just above the baseline. It stops near the top or where the outline turns down, and ends in a small bloom or a leaf pair. Hugs are always in front, and the offset keeps them off the stroke.
- **Bridges.** Between neighbouring glyphs whose ink gap at a random height is under 0.6 fs, at most one per 2–3 letters. A bridge is a parabola sagging 0.15 fs, with both ends just inside the ink. Bridges are always behind the type.
- **Clearance (`judge` in `plant.ts`).** Each candidate stem is checked in this order, and the decorations are then checked too:
  - **reach:** stays near the word.
  - **self:** doesn't cross itself; the tendril and its lead-in are exempt.
  - **parallel:** isn't within 0.04 fs and 35° of another stem for more than 20% of its length; the first 0.1 fs is exempt.
  - **front:** a stem goes in front of the type (layer 1) only if it crosses ink for at most 0.4 fs on one glyph; otherwise it goes behind (layer 0).
  - **calm:** what's drawn in front (layer-1 stems and leaves, all blooms) may cover at most 60% of the word's ink cells.

  A rejected stem retries with a new seed up to `VINE_TRIES` times, then is skipped. The rejection counts per rule are logged when Shift+V is pressed and when a word settles.
- **Blooms.** There are 3–6 bloom sites per word: the hero, up to 2 medium bunches, and the rest small singles or pairs on twigs. Buds don't count. Blooms are always drawn in front.
- **Rendering (`render.ts`).** Stems are filled tapered outlines. Layer-0 stems, thorns and leaves are drawn, then the letters, then layer 1, then blooms, falling bracts, the debug overlay and the caret.

## Motion

These are the same systems as before, applied to plants.
- **Springs:** pop-ins and the staggered bract opening.
- **Sway:** each stem sways about its root on a spring chasing a wind lean plus gusts. A child composes onto its parent at the branch point. Clusters swing on a heavier pendulum spring that follows their stem 80ms late.
- **Boil:** at 8fps, with half amplitude on bracts.
- **Kicks:** typing kicks the current word's plant, and backspace makes it flinch.
- **Wither:** on backspace, every stem owned by that letter, and everything branching from it, drops its bracts in a burst and retracts while the letter fades in its held slot. If that letter held the arch, a new arch grows at the next settle.

## Key files

- `page.tsx` — loads Playfair Display (Fraunces fallback), mounts the scene
- `config.ts` — every tunable
- `scene.ts` — input, layout, words → plants, wither, falling-bract scheduling, layered draw, caret, debug log
- `plant.ts` — growth points, gestures, hierarchy, bridges, clearance rules, bloom budget
- `walker.ts` — curvature walk, Catmull-Rom smoothing, sampling
- `render.ts` — springs/sway/boil/wither update, tapered stems, knots, thorns, leaves, clusters, debug skeletons
- `glyph.ts` — letter masks, outside distance field, lattice sprite
- `bracts.ts`, `falling.ts`, `motion.ts`, `mask.ts`, `text-layout.ts`, `rng.ts`, `font.ts`, `ease.ts`, `color.ts`

## Open questions

- Hugs and bridges don't come from a growth point. The hug brief ("from the baseline, following the outline") and the bridge brief (both ends on ink) imply that. Should hugs instead branch off a nearby trunk?
- "3–6 clusters per word" is read as bloom sites. A bunch of 4–7 clusters counts as one site, otherwise drape bunches alone would exceed 6.
- Climbing trunks aren't one of the four named gestures, but drapes need something to leave from, and the gravity values name "climbers".
- A word that wraps mid-word, past `MAX_LETTERS_PER_ROW`, draws its plant from the first row's pen, so the second row's letters won't line up with it.
