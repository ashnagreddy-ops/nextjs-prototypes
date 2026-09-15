# Rain Scene

A blurred rain-on-window photo with animated water rivulets running down the glass over a dense
field of clinging droplets, both refracting the background where they sit.

## How it works

**Background** — `next/image` renders `rain-window.png` with `fill` + `object-cover`. The blur
radius is a CSS custom property (`--bg-blur`, from the `BACKGROUND_BLUR` constant in `page.tsx`)
applied via `blur-[var(--bg-blur)]`. A slight `scale-105` keeps blurred edges off the viewport
border.

**Audio** (`RainAudio.tsx`) — a looping `<audio>` element with two `<source>`s: `rain-ambience.m4a`
(AAC, ~1.1MB) tried first, `rain-ambience.wav` (16-bit PCM, ~9.7MB) as a fallback. `muted` by
default so the browser allows it to autoplay (autoplay policies universally permit muted autoplay,
not unmuted); `muted` is a controlled prop bound to state rather than a static attribute, so
toggling it via the bottom-right control actually flips the element's `.muted` property. Volume is
set imperatively in an effect (`audioRef.current.volume = AMBIENT_VOLUME`, 0.35) since `volume`
isn't a settable JSX attribute on media elements in React.

The toggle itself is a bespoke control, not an icon button, pinned top-right: a small squiggle icon
sits permanently to the left of a "Play sound" label, laid out as an ordinary flex row (not
absolutely stacked — the two elements never occupy the same space, so there's nothing to crossfade
between them). The icon animates continuously in *both* mute states — it isn't gated on `playing` —
because it's meant to read as the control's identity, not as a state flag; only the label crossfades
(a plain `opacity` transition, `1` when muted, `0` when playing — it keeps its layout space either
way so the button's width never changes). An earlier version crossfaded the icon and the label
against each other (icon only appeared once actually playing); that read as the icon being hidden
"by default," which wasn't the intent.

The squiggle is a `<path>` in an inner `<svg>` holding *two* copies of one wave period side by side;
each period has 3 peaks (short/tall/medium: true amplitudes 4/16/9) rising from a baseline near the
*bottom* of a 24-unit-tall viewBox, not a centered baseline, for a dramatic, irregular skyline.

Getting the peaks to actually *be* that tall took fixing a real math error, not just picking bigger
numbers: each hump is a symmetric cubic Bézier (`C cx,cy cx,cy endX,endY` with both control points at
the same y) from one baseline point to the next. For that shape, the curve's actual peak is **not**
the control points' y-value — at the midpoint (t=0.5) a cubic Bézier evaluates to
`0.25×P0 + 0.75×P1` when `P1=P2` and `P0=P3` (the baseline), i.e. rendered peak =
`0.25×baseline + 0.75×controlY`. Three earlier versions all set `controlY` directly to the *intended*
peak height, which the 0.25/0.75 pull-toward-baseline damped down — peaks that were supposed to
reach amplitude 11+ were actually landing around 8, and every hump read as a flat, rounded blob no
matter how much the intended heights varied. The current path instead solves the formula for the
`controlY` each target peak needs (`controlY = (targetPeakY − 0.25×baseline) / 0.75`) — for the tall
peak that solves to a control point *above* the viewBox entirely (`y ≈ -2.33`, well outside the
visible 0-24 range), which is expected and correct: an out-of-bounds control point is exactly what
pulls the curve's midpoint up to the intended in-bounds peak. The inner svg sits inside an outer
`<svg>` sized to exactly *one* period and scrolls the inner one left by exactly that period width (30
viewBox units, matched to the CSS `translateX` distance since both svgs use 1:1 viewBox-to-pixel
sizing — scaling one without the other would desync the loop) on an infinite CSS animation
(`rain-scene-wave-scroll`, defined in a plain `<style>` tag in the component rather than styled-jsx
or global CSS, so it needs no build config and can't leak). Because the scroll distance equals the
period, the wrap is seamless. Stroke width is 4 for a bold, rounded line matching the reference's
thickness rather than a thin hairline. The whole button sits
at
`opacity-40` at rest and `opacity-90` on hover/focus-visible, per the "unobtrusive at rest, clearly
clickable on hover" brief.

Color is a literal `#C1C4C4` (`WAVE_COLOR`), not a design token — a deliberate, narrow exception to
this repo's "design tokens only" rule. It matches the exact hardcoded value already baked into
`RainCanvas`'s canvas fills (`STREAK = {r:193,g:196,b:196}`), which can't reference CSS custom
properties at all since canvas 2D takes literal color strings — the streak/droplet color was never
a token to begin with. Using the token system here instead would mean this control's color drifting
from the rest of the scene whenever the app's theme tokens change, which is the opposite of the
intent (visual consistency with the rain effect, not with the app chrome).

Two real bugs hit during setup, both worth knowing about if audio silently doesn't work again:
1. **The uploaded source file was 32-bit float PCM WAV.** `afinfo` showed `Float32` — the HTML
   `<audio>` element's decoder support for float PCM WAV is inconsistent across browsers (some
   decode it fine, some fail silently: `.play()` resolves, nothing throws, no sound). Converted with
   `afconvert` to AAC/M4A (primary, much smaller too) and 16-bit integer PCM WAV (fallback) — both
   are formats every browser's `<audio>` element handles reliably. If a future audio asset gets
   swapped in, check its bit depth/format before assuming a code bug.
2. **`autoPlay` alone isn't reliable enough to guarantee the element is actually playing.** Even
   though muted autoplay is broadly permitted, it can still fail to actually start in some
   circumstances, leaving the element paused; simply flipping `.muted = false` on a paused element
   produces no sound. The mount effect and the mute-toggle handler both explicitly call
   `audio.play()` (swallowing rejections) rather than relying on the attribute — a click is always a
   valid user gesture, so calling `play()` again inside `toggleMuted` when the element is still
   `paused` guarantees sound starts regardless of what happened on mount.

**Streaks** (`RainCanvas.tsx`) — each rivulet is a variable-width filled ribbon, not a stroked
line. A centerline is sampled at 16 points down its length; `bendAt()` adds a very slight
low-frequency waver, and `halfWidthAt()` tapers the width toward the tail with 1-2 Gaussian
"swells" that read as droplets *within* the stroke. The ribbon polygon is built by offsetting each
sample along its local normal. Fill color is `#C1C4C4` on `mix-blend-overlay` so streaks pick up
warmth/shadow from the image behind them. Streaks recycle individually once past the bottom edge,
so there's no synchronized reset.

Opacity uses `fadedGradient()` — a 4-stop linear gradient (`0 → peak → peak → 0` at offsets
`0, FADE_FRAC, 1-FADE_FRAC, 1`, `FADE_FRAC = 0.13`) rather than the simpler 2-stop
"full at head, zero at tail" gradient it replaced. That earlier version left the head end hard-cut
at full opacity (no fade at all) while spreading the tail's fade across the *entire* length instead
of concentrating it near the tip. The 4-stop version fades in over the first 13% of length, holds
peak through the middle, and fades out over the last 13% — both tips dissolve, the body stays fully
visible. `fadedGradient()` is shared by the main body fill and both edge bands (below) so the
highlight/shadow never leave a hard mark at a tip the body has already faded past.

Opacity alone wasn't enough, though: `halfWidthAt` only tapers width toward the tail (`1 - 0.5t`)
and at gaps — it never reaches zero at the actual tips (t=0 or t=1) — so each end of the polygon was
a flat perpendicular cut, which still reads as a straight rectangular edge at low-but-nonzero alpha
(especially over a bright backdrop, where even faint coverage shows clearly). An early fix tried
tapering width to a literal zero at both tips, but that reads as a sharp point, not what was wanted
(a curved, oval-bottomed bulge like `lineCap: "round"`). The actual fix is geometric, in `trace()`:
each end of the ribbon polygon closes with a semicircular arc (`traceCap()`, radius = the local
half-width there) instead of a straight line across. `normalAt(i)` gives the unit normal at a
sample; the cap sweeps the angle by `-π` in `CAP_STEPS` (6) increments starting from wherever the
preceding edge loop left off — which lands exactly on the opposite edge point while passing through
the correct *outward* direction at the sweep's midpoint (past the head at the bottom, past the tail
at the top). Since `trace()` is shared by the body fill and the streak's refraction clip, both get
the same rounded ends for free; the two edge highlight/shadow bands (`traceEdgeBand`) don't — they
stay flat-capped, since they're thin slivers where it isn't very noticeable.

Most streaks are thin (`spawn()`'s default path: opacity 0.46-1.0, width 0.7-3.5). A `hero` flag on
`Streak` marks a small set — 4-5 per resize, count doesn't scale with viewport area — that are
distinctly wider (11-19) and a bit brighter (opacity 0.72-1.0), reading as channels where more
water has gathered. Heroes use the exact same `halfWidthAt`/`trace` geometry as thin streaks (parallel
edges, same head→tail fade); only `baseWidth` and `opacity` differ. The `hero` flag is carried
through on recycle (`spawn(w, h, false, s.hero)`) so a hero streak respawns as a hero, not a thin
one — otherwise the count would drift down over time as heroes eventually got recycled into the
regular pool.

`Gap`s break the ribbon up instead of letting it read as one unbroken line: each gap is a Gaussian
pinch applied *multiplicatively* to the already-tapered width in `halfWidthAt`, strong enough
(`strength` 0.85-0.99) to bring the ribbon down to a sliver at its center. Most streaks get one
gap, some get two, a few stay continuous. Because the width genuinely reaches near-zero rather than
being floored, the fill naturally splits into separate visual segments at each gap — no special
multi-path logic needed, the ribbon polygon just pinches to a point and reopens.

A `trickle` flag (~20% of non-hero streaks) pushes this further: 3-5 gaps carve the trail into a
chain of distinct beads, and speed drops to 3-10px/s (vs. the normal 14-84px/s) so it reads as
droplets slowly trickling down rather than a rivulet running. `trickle` isn't preserved across
recycles the way `hero` is — it's re-rolled each time a streak respawns, since it's meant to be a
transient look some streaks pass through, not a fixed identity.

A separate `fast` roll (~6% of non-hero, non-trickle streaks — the three are mutually exclusive)
goes the other direction: speed jumps to 130-240px/s, noticeably outrunning the normal 14-84px/s
range. Like `trickle`, it's re-rolled on every respawn rather than persisted.

**Volume** — after the main fill, `traceEdgeBand()` draws a thin bright highlight along one edge of
the ribbon and a subtle dark line along the other, so each streak reads as rounded water rather
than a flat band. It reuses the same `cx`/`cy`/`hw` samples as `trace()`, tracing from the edge
inward by `bandFrac` of the local half-width — so the band is geometrically part of the same
ribbon, not a separate stroke that could drift out of alignment. Both the band's width (`bandFrac`)
and its peak opacity (`hlPeak`/`shPeak`) scale with `sizeT = min(1, s.baseWidth / 14)`, so thin
streaks get a near-invisible whisper of rounding while hero streaks show a clearly convex edge —
reinforcing the thin-vs-thick distinction instead of flattening it. The light direction is the same
for every streak for free, with no per-streak flag: `trace()`'s first-loop normal (`-ty/len`) is
always positive because every streak's centerline runs top-to-bottom (`cy` strictly decreases with
`i`), so `ty` is always negative regardless of a streak's own bend — `traceEdgeBand(cctx, 1, …)` is
therefore always the same real-world side across the whole scene.

**Droplets** (`generateDroplets`/`makeDroplet`/`updateDroplets`/`drawDroplets` in `RainCanvas.tsx`)
— a dense field of clinging beads, layered *beneath* the streak canvases. They don't fall or slide
(no physics), but they aren't purely static either — see the lifecycle note below. Positions come
from irregular clusters (random cluster centers, each spawning 6-25 droplets with a roughly
gaussian spread via summed uniforms) plus a sparser uniform scatter to fill the gaps between
clusters, so coverage reads as dense and clumped rather than an even grid.

Radius (`randomDropletRadius()`) uses three explicit tiers rather than a continuous curve: ~68%
small but clearly legible beads (1.3-3.4px), ~25% occasional medium ones (3.4-6px), ~7% rare,
significantly bigger ones (6-11px). There's no sub-pixel "fine mist" tier — an earlier version went
as small as 0.35px, which read as noise specks rather than droplets. The highlight-to-radius ratio
(`hlScale` in `drawDroplets`) also grows with size, from 22% at the small end up to 36% at the top
of the big tier, so the rare large droplets get a proportionally bigger, more prominent glint
rather than a pinprick lost in a big bead.

Each droplet gets: (1) a refraction clip identical in technique to the streaks' (see below), offset
by a random angle scaled with radius; (2) shading on a normal-blend canvas, deliberately built to
read as a flat bead sitting on glass rather than a lit 3D sphere — a *symmetric* darker core
(radial gradient, darkest at center, fading to the edge — the bead refracting the darker background
through it, not directional lighting), a thin edge rim just enough to separate it from the glass,
and one small sharp highlight pinpoint near a random edge instead of a broad soft sheen. Normal
blend, not overlay, avoids the same brightness-coupled apparent-size bug the streaks originally had.

**Droplet lifecycle** — a droplet a passing streak crosses doesn't just sit under it; it's absorbed.
Each droplet is a small state machine (`steady → fadeOut → waiting → fadeIn → steady`), advanced in
`updateDroplets(dt)` every frame: while `steady`, it's checked against every streak's current
vertical span and x-position (bend/taper ignored for the hit test — fine at this scale), and a hit
starts a 0.3-0.6s fade-out. Once fully faded it waits 1.5-6s, then `Object.assign`s in a freshly
generated droplet at a new random position and fades that in over 0.3-0.6s. `drawDroplets()` runs
every frame (not once, like an earlier version) and multiplies both the refraction blit
(`ctx.globalAlpha`) and all three shading gradients by the droplet's current alpha, so nothing pops
or leaves a stale hard edge mid-fade. This exists because a droplet field that truly never changed
read as inert/weird next to the moving streaks — this keeps "no physics" while giving the field some
life, and ties it to the one thing already happening in the scene (streaks falling) rather than an
arbitrary independent timer.

**Refraction** — `feDisplacementMap` can't consume a live `<canvas>`: SVG filters only take
filter-graph inputs, and the only routes in (`feImage href="#el"`, or re-encoding the canvas to a
data URL each frame) are respectively Firefox-only and far too slow to animate. So displacement is
done in canvas instead. There are four stacked canvases, bottom to top:

1. `dropRefractRef` (normal blend) — droplet refraction, redrawn every frame (see droplet
   lifecycle above — positions are static but per-droplet alpha isn't).
2. `dropColorRef` (normal blend) — droplet shading, redrawn every frame alongside it.
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
- `RainCanvas.tsx` — streak simulation, droplet field + lifecycle, ribbon geometry, refraction pass
- `RainAudio.tsx` — looping ambience track, mute toggle, `AMBIENT_VOLUME` controls level
- `public/prototypes/rain-scene/rain-window.png` — the source image
- `public/prototypes/rain-scene/rain-ambience.m4a` — ambience loop, primary source (AAC)
- `public/prototypes/rain-scene/rain-ambience.wav` — ambience loop, fallback source (16-bit PCM)

## Open questions

- `BG_BLUR_PX` / `BG_SCALE` in `RainCanvas.tsx` are duplicated from `page.tsx`'s `BACKGROUND_BLUR`
  and `scale-105`; they must be changed together or the refraction will misalign.
- Streak density is `area / 4500`; on very large displays that's a lot of clip+blit calls per
  frame. Droplet density (clusters + scatter, roughly `area / 3600` from scatter alone) can put the
  total into the hundreds to low thousands depending on viewport size — and since `drawDroplets`
  now runs every frame (needed for the absorb/respawn fades), that cost is ongoing, not one-time
  like the original static version. Hasn't been a problem in practice at the sizes tested, but
  worth knowing if this gets embedded somewhere with a much bigger canvas.
- `updateDroplets`'s hit test is `O(droplets × streaks)` per frame (a droplet checks every streak
  until it finds a hit or runs out). Fine at current counts; would want spatial partitioning if
  either count grows a lot.
- Known trade-off of `mix-blend-overlay` on the color layer: because overlay's transfer function
  pushes partial-opacity edge pixels toward invisible over dark backdrops and toward white over
  bright ones, a streak's *apparent* width varies with what's behind it. A later revision replaced
  this with a normal-blend base plus a low-alpha soft-light accent layer to decouple the two, but
  that version was rejected on look; this one is the keeper.
