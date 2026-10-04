# Frost Type

A typing experiment. Each typed character appears right away as an ice letter. Icicles and snow caps grow on it a moment later, then carved filigree scrollwork grows inside it, the way plants grow out of letters in Type Garden. There is no backspace/melt or space behaviour yet.

## How it works

- **Glyphs.** Each keypress creates a glyph with its own character, seed (`hashSeed(globalSeed, index)`), and birth time. Building a glyph renders the letter onto its own offscreen canvas. From that canvas it takes a mask (coverage + solid), a chamfer distance field, and edge normals. It then precomputes its icicles, snow caps, and filigree from separate seeded random streams. Layers are device-pixel canvases in the glyph's local box: the ice body, icicles + snow, two filigree layers (light and shadow), and a clip canvas. When everything has finished, they're flattened into one cached canvas.
- **Per-glyph clocks.** Each element has a start time and duration relative to its glyph's birth, so the visual state is a pure function of age. Fast typing never delays anything. A rebuild (resize, size change, Shift+R) regenerates the same geometry and catches up to the current age instantly.
- **Timeline.** `BODY_DELAY` 0 with a 250ms freeze-in: the body is revealed through a clip of circles expanding from two deep interior points. Then `ICICLE_DELAY` 200, `SNOW_DELAY` 350, and `FILIGREE_DELAY` 500, each staggered per element, all with an ease-out cubic.
- **Ice body.** Shaded per pixel at mask resolution: a translucent core, a bright rim that falls off with distance from the edge, whiter where the rim faces a top-left light, a vertical tint, and grain. It's then upscaled, trimmed to the crisp text shape, and given a 1px edge line.
- **Icicles / snow.** Built from downward- and upward-facing surface runs: one point per column, linked when consecutive points step by 1px or less, and filtered by the windowed normal. Icicles are longest mid-run and stop short of ink below. Snow is a lumpy sine mound limited by the free space above. These layers are cleared and redrawn only while they're growing.
- **Filigree.** 3–6 tendrils per glyph, scaled by ink area; punctuation gets 1–2. Each tendril starts deep inside the glyph, heading along the stroke. Its heading is steered by seeded value noise. A look-ahead distance sample turns it back toward the distance-field gradient (or the centroid) as it nears `EDGE_MARGIN`. The last `CURL_FRACTION` ramps curvature linearly (an Euler spiral) so it winds `CURL_TURNS` times. The best of a few walks (fewest points outside) is kept. Paired leaflets sit at 60° on the middle section, use the Frost fern envelope, and are shortened so they don't poke out. Each leaflet's start time is the moment the eased tendril passes it, so leaflets appear behind the tip.
- **Incremental paint.** Each frame paints only the newly revealed slice of each stroke onto that glyph's filigree layers, never clearing them. Paint is opaque, and alpha is applied when compositing, so the joins don't bead. The shadow layer is offset 1px down-right. After painting, both layers are trimmed with `destination-in` against the glyph shape dilated by 1px.
- **Layout.** The font size shrinks with length until 12 characters fit in 90vw, then text wraps, shrinking further only if the rows overflow vertically. Cached glyphs are drawn scaled while the size drifts and are rebuilt (2 per frame) once the scale leaves 0.8–1.08.
- **Performance.** Finished glyphs cost one `drawImage`. The main canvas is redrawn only on frames where something changed. If more than 2000 elements are animating, the oldest glyphs are fast-forwarded to finished.
- **Keys.** Letters, numbers, and basic punctuation type; modifier combos and key repeat are ignored. **Shift+R** regenerates all glyphs with a new seed and replays them. A plain `r` types a letter. All tunables are in `config.ts`. Canvas colours are literals because canvas can't read CSS tokens. The page is scoped to `.dark` because the ice palette is tuned for a night background.

## Key files

- `page.tsx` — canvas + "type something" hint
- `scene.ts` — input, frame loop, rebuild scheduling, active-element cap
- `text-layout.ts` — font size, wrapping, pen positions (not `layout.ts`, which Next.js would treat as a route layout)
- `glyph.ts` — glyph build, ice body, freeze-in, per-frame update, baking
- `mask.ts` — mask, distance field, normals, surface runs
- `filigree.ts`, `icicles.ts`, `snow.ts` — the three growth systems
- `stroke.ts`, `rng.ts`, `color.ts`, `config.ts` — helpers and tunables

## Open questions

- Should plain R regenerate instead (and lose typing lowercase r)?
- Mobile has no keyboard: add a hidden input to summon one?
- Tendrils in the same stem can run parallel. Should they avoid each other?
