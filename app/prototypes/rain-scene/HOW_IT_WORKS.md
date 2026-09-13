# Rain Scene

A blurred rain-on-window photo with animated water rivulets running down the glass over a dense
field of static clinging droplets, both refracting the background where they sit.

## How it works

**Background** — `next/image` renders `rain-window.png` with `fill` + `object-cover`. The blur
radius is a CSS custom property (`--bg-blur`, from the `BACKGROUND_BLUR` constant in `page.tsx`)
applied via `blur-[var(--bg-blur)]`. A slight `scale-105` keeps blurred edges off the viewport
border.

**Streaks** (`RainCanvas.tsx`) — each rivulet is a variable-width filled ribbon, not a stroked
line. A centerline is sampled at 16 points down its length; `bendAt()` adds a very slight
low-frequency waver, and `halfWidthAt()` tapers the width toward the tail with 1-2 Gaussian
"swells" that read as droplets *within* the stroke. The ribbon polygon is built by offsetting each
sample along its local normal. Fill is a head→tail alpha gradient in `#C1C4C4`, per-streak opacity
0.46-1.0, on `mix-blend-overlay` so streaks pick up warmth/shadow from the image behind them.
Streaks recycle individually once past the bottom edge, so there's no synchronized reset.

**Static droplets** (`generateDroplets`/`renderDroplets` in `RainCanvas.tsx`) — a dense field of
clinging beads that never move, layered *beneath* the streak canvases. Positions come from
irregular clusters (random cluster centers, each spawning 8-38 droplets with a roughly gaussian
spread via summed uniforms) plus a sparser uniform scatter to fill the gaps between clusters, so
coverage reads as dense and clumped rather than an even grid. Radius uses explicit tiers rather
than a continuous curve — ~80% tiny specks (0.35-1.1px, a fine-mist majority), ~16% uncommon medium
drops (1.1-2.7px), ~4% rare large ones (2.7-7px) — so the mix is easy to reason about and tune.
Because droplets are static, both their refraction and shading are rendered once per resize
(`renderDroplets`), not per animation frame — cheap even at a few thousand beads, since there's no
ongoing per-frame cost.

Each droplet gets: (1) a refraction clip identical in technique to the streaks' (see below), offset
by a random angle scaled with radius; (2) shading on a normal-blend canvas, deliberately built to
read as a flat bead sitting on glass rather than a lit 3D sphere — a *symmetric* darker core
(radial gradient, darkest at center, fading to the edge — the bead refracting the darker background
through it, not directional lighting), a thin edge rim just enough to separate it from the glass,
and one small sharp highlight pinpoint near a random edge (radius floored at 0.3px so it stays
visible even on tiny specks) instead of a broad soft sheen. Normal blend, not overlay, avoids the
same brightness-coupled apparent-size bug the streaks originally had.

**Refraction** — `feDisplacementMap` can't consume a live `<canvas>`: SVG filters only take
filter-graph inputs, and the only routes in (`feImage href="#el"`, or re-encoding the canvas to a
data URL each frame) are respectively Firefox-only and far too slow to animate. So displacement is
done in canvas instead. There are four stacked canvases, bottom to top:

1. `dropRefractRef` (normal blend) — static droplet refraction, rendered once per resize.
2. `dropColorRef` (normal blend) — static droplet shading, rendered once per resize.
3. `refractRef` (normal blend) — streak refraction, redrawn every frame since streaks move. Clips
   to each ribbon and re-blits an offscreen copy of the background *offset* by a few px, so the
   image appears to bend where a streak crosses it. Offset scales with the streak's max half-width,
   so thick rivulets and droplet swells refract harder.
4. `colorRef` (`mix-blend-overlay`) — streak color, redrawn every frame on top of everything else.

The offscreen background is pre-rendered once per resize with the same cover-fit, `scale-105` and
7px blur as the `<Image>`, so the refracted pixels line up with what's actually on screen. Only a
small bounding-box sub-rect is blitted per streak to keep the per-frame cost down.

## Key files

- `page.tsx` — background image; `BACKGROUND_BLUR` controls blur radius
- `RainCanvas.tsx` — streak simulation, static droplet field, ribbon geometry, refraction pass
- `public/prototypes/rain-scene/rain-window.png` — the source image

## Open questions

- `BG_BLUR_PX` / `BG_SCALE` in `RainCanvas.tsx` are duplicated from `page.tsx`'s `BACKGROUND_BLUR`
  and `scale-105`; they must be changed together or the refraction will misalign.
- Streak density is `area / 4500`; on very large displays that's a lot of clip+blit calls per
  frame. Droplet density (clusters + scatter, roughly `area / 2200` from scatter alone) can put the
  total well into the thousands, but since `renderDroplets` only runs on resize, not per frame,
  it's a one-time cost rather than an ongoing one.
- Known trade-off of `mix-blend-overlay` on the color layer: because overlay's transfer function
  pushes partial-opacity edge pixels toward invisible over dark backdrops and toward white over
  bright ones, a streak's *apparent* width varies with what's behind it. A later revision replaced
  this with a normal-blend base plus a low-alpha soft-light accent layer to decouple the two, but
  that version was rejected on look; this one is the keeper.
