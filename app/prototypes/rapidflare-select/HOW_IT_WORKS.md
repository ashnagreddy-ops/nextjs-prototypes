# Rapidflare Select

A prototype of Rapidflare's conversational product-selection agent for electronics/
semiconductor buyers, built specifically to be screen-recorded. It walks one scripted
antenna-selection conversation across three user turns through five discrete states
(landing/initiation, interpretation, shortlist, recommend, reset), each entered by an
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
  state's specific transition. State 1 combines the landing screen and the first
  prompt's typing/submit animation into one continuous take: it renders the landing
  pills, pauses, fades them out, then types and fires the first prompt into the input
  bar (`type()` / `fire()`). States 3 and 4 replay the same typing/submit choreography
  for the follow-up turns.
- A persistent right-hand `.filterpanel` (not inline in the chat) shows the
  cumulative STATED/ASSUMED filters read from the conversation so far; it's closed by
  width/padding until state 2 opens it partway through its own reveal sequence, and
  states 3/4 show it already settled open with no replay of that motion.
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
  quote" / "Talk to team") only appears once the agent has actually responded (state 2
  onward, hidden again on the landing-alike reset state), and a "Powered by Rapidflare"
  footer bar sits outside the scrolling transcript, as in the reference.

## Key files

- `public/prototypes/rapidflare-select/index.html` — the entire prototype (HTML, CSS, JS)
- `page.tsx` — thin iframe wrapper so it appears in the gallery

## Open questions

- Whether the reasoning-block content per turn (`REASONING[1..3]`) is worth expanding
  with more turns if the script ever grows past three exchanges.
- Icon set is hand-authored Lucide-style outline SVGs sized per context (14/16/20px);
  worth swapping for an actual icon library import if this ever graduates past a
  recording rig.
