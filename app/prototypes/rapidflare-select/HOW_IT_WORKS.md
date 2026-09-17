# Rapidflare Select

A prototype of Rapidflare's conversational product-selection agent for electronics/
semiconductor buyers, built specifically to be screen-recorded. It walks one scripted
antenna-selection conversation across three user turns through five discrete states
(landing/interpretation, recalculate, shortlist, recommend, reset), each entered by an
explicit click rather than autoplay, so each state can be recorded in its own clean take.

## The script

1. **User:** "I need an omnidirectional antenna for a drone, with as few nulls as
   possible." **Agent:** reasons to dipole/monopole designs, assumes 50Ω impedance
   (24 → 20 candidates), asks for bands + connector type.
2. **User:** "LTE and GNSS, connector is u.FL." **Agent:** narrows 20 → 5, shows a
   product-card strip + comparison table (ANT-521 / ANT-518 / ANT-533) with per-model
   notes, asks whether a ground plane is available.
3. **User:** "No ground plane — small frame, limited surface." **Agent:** recommends
   ANT-518 (the only one of the three that doesn't need a ground plane), shown as a
   3-card grid with per-requirement verdicts, plus a summary of why the other two
   weren't chosen.

## How it works

The whole prototype is a single static HTML file at
`public/prototypes/rapidflare-select/index.html`, loaded through a full-bleed
`<iframe>` in `page.tsx` — the same isolation pattern used by
[`inkset-kinetic-type`](../inkset-kinetic-type/HOW_IT_WORKS.md). The brief calls for a
fixed light surface with a named token palette (`--primary`/`--attention`/`--trace`
etc.), matched to specific brand reference screenshots, and explicitly *no* dark mode —
that's a hard requirement here, not an oversight, so it's kept outside the app's
Tailwind/shadcn/token tree rather than fought into `dark:` variants that don't apply to
this piece.

Inside the file:
- A fixed 16:9 `#frame` (1280×720) is scaled to fit the viewport by a `fit()` function,
  so recordings crop consistently regardless of window size.
- A step control (`#steps`, outside the frame) jumps directly to any state and replays
  its animation from the start; `H` hides it for clean recording, arrow keys step, `R`
  replays the current state. Nothing auto-advances.
- All five states are produced by one `render(n)` function that rebuilds the
  conversation's HTML from scratch for state `n`, then an `ANIM[n]` entry (a chain of
  `setTimeout`s in a `timers` array, cleared on every `render()` call) drives that
  state's specific transition. State 1 combines the landing screen, the first prompt's
  typing/submit animation, *and* the agent's full first response into one continuous
  take: it renders the landing pills, pauses, fades them out, types and fires the first
  prompt (`type()` / `fire()`), then keeps going straight into the thinking cycle,
  reasoning reveal, paragraphs, and clarifying question — no separate "click to see the
  response" step. The docked action bar stays hidden through the landing/typing portion
  and only un-hides (`actbar.hidden = false`) once the agent's response actually starts
  appearing. States 3 and 4 replay the same typing/submit choreography for the
  follow-up turns.
- Two filters (Radiation pattern, Connector, Frequency bands, Ground plane) render as
  dropdowns since they're categorical picks; **Impedance** is a true numeric range
  slider (`slider:true, numeric:true` on its `FILTERS` entry, 40–100 Ω) since it's the
  one filter with an actual ordinal quality. State 2 ("Recalculate") sits right after
  the first interpretation and before the shortlist exists, so it demonstrates
  cross-filter interdependency *within turn 1*: it eases the impedance slider from
  50→80 Ω via `animateSliderTo()` (an ease-out cubic over ~30 small steps — replaying
  real `input` events, the same code path a manual drag would hit, not a separate fake
  animation), shimmers the Radiation pattern row (`.frow.shimmer` — the only other
  turn-1 filter) and — since the brief calls for the *whole* response looking like it's
  regenerating, not just the dependent filter — also drops a skeleton curtain
  (`.recalcwrap`/`.reload-overlay`, ids `recalcwrap1`/`reloadOverlay1`) over turn 1's
  own paragraphs and clarifying question. They fade under shimmering placeholder lines
  for about two seconds before fading back to the real content and landing a new agent
  paragraph (`data-k="recalc1"`) confirming the 24→20 narrowing still holds. That new
  paragraph starts genuinely collapsed (`.recalc-collapse`: `max-height:0`, not just
  `opacity:0`) rather than merely invisible, and JS sets an explicit `max-height` at
  reveal time — otherwise the still-in-the-DOM-but-invisible paragraph would reserve
  its own height during the loading phase and visibly push the feedback icons down
  below it, breaking the icon row's normally-consistent spacing from the last visible
  line. Dragging the impedance slider by hand at any point also live-updates its own
  reason text and the one place its value is echoed back in the turn-1 agent response
  (`#bind-impedance`) — the scripted state-2 replay is that same mechanism driven
  programmatically, not a separate code path. Impedance's value itself is derived from
  the state number on every render (`n > 2 ? 80 : 50`) rather than left as sticky
  mutable state, so jumping around the step control can't leave it stuck at 80.
- A persistent right-hand `.filterpanel` (not inline in the chat) shows the
  cumulative STATED/ASSUMED filters read from the conversation so far; it's closed by
  width/padding until state 1 opens it partway through its own reveal sequence, and
  states 2/3/4 show it already settled open with no replay of that motion.
- Each agent turn has its own collapsed-by-default reasoning block (`reasoningBlock()`
  / the `REASONING` map, one entry per turn) — a plain, no-background region that caps
  at a fixed height and scrolls internally with a mask-image fade instead of a visible
  scrollbar once expanded.
- Citations use a shared popover (`showCitePop()`) appended directly to `#frame` and
  positioned from the trigger's bounding box, so it's never clipped by `.scroll`'s
  overflow or painted under the topbar.
- Each agent turn ends with a `metaRow()` — a reaction/read-aloud/copy icon row and a
  timestamp — revealed together with the rest of that turn's content rather than
  sitting statically above it. A docked action bar ("Submit an enquiry" / "Request
  quote" / "Talk to team") only appears once the agent has actually responded (partway
  through state 1, hidden again on the landing-alike reset state), and a "Powered by
  Rapidflare" footer bar sits outside the scrolling transcript, as in the reference.

## Key files

- `public/prototypes/rapidflare-select/index.html` — the entire prototype (HTML, CSS, JS)
- `page.tsx` — thin iframe wrapper so it appears in the gallery

## Open questions

- Whether the reasoning-block content per turn (`REASONING[1..3]`) is worth expanding
  with more turns if the script ever grows past three exchanges.
- Icon set is hand-authored Lucide-style outline SVGs sized per context (14/16/20px);
  worth swapping for an actual icon library import if this ever graduates past a
  recording rig.
