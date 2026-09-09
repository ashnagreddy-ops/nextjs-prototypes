# Rapidflare Select

A prototype of Rapidflare's conversational product-selection agent for electronics/
semiconductor buyers, built specifically to be screen-recorded. It walks one scripted
antenna-selection conversation across three user turns through eight discrete states
(landing, initiation, interpretation, auto-narrow, question, shortlist, recommend,
reset), each entered by an explicit click rather than autoplay, so each state can be
recorded in its own clean take.

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
fixed light surface with one indigo accent, matched to specific brand reference
screenshots, and explicitly *no* dark mode — that's a hard requirement here, not an
oversight, so it's kept outside the app's Tailwind/shadcn/token tree rather than fought
into `dark:` variants that don't apply to this piece.

Inside the file:
- A fixed 16:9 `#frame` (1280×720) is scaled to fit the viewport by a `fit()` function,
  so recordings crop consistently regardless of window size.
- A step control (`#steps`, numbered 1–8, outside the frame) jumps directly to any
  state and replays its animation from the start; `H` hides it for clean recording,
  arrow keys step, `R` replays the current state. Nothing auto-advances.
- All eight states are produced by one `render(n)` function that rebuilds the
  conversation's HTML from scratch for state `n`, then an `ANIM[n]` entry (a chain of
  `setTimeout`s in a `timers` array, cleared on every `render()` call) drives that
  state's specific transition. States 6 and 7 re-run the same typing/submit animation
  used for the opening prompt (`type()` / `fire()`) so each follow-up turn is typed
  into the input bar in character, not just pasted in.
- The three narrowing sources — STATED / ASSUMED / ANSWERED — are a single `chip()`
  helper reused everywhere (the narrowing widget, its legend, requirement rows) so they
  stay visually consistent by construction rather than by convention.
- The narrowing counter is an inline card in the agent's own turn (not a side panel),
  built by `narrowWidget()` / `buildNarrow()`, using stable row ids (`row24`, `row20`,
  `row5`, `row1`) so each `ANIM` entry can reveal/pulse the exact row for its state.
- Each agent turn opens with a `metaRow()` — avatar, a small reaction/read-aloud/copy
  icon row, and a timestamp — matching the reference screenshots' chat-widget chrome.
  A docked action bar ("Submit an enquiry" / "Request quote" / "Talk to team") and a
  "Powered by Rapidflare" footer bar sit outside the scrolling transcript, as in the
  reference.

## Key files

- `public/prototypes/rapidflare-select/index.html` — the entire prototype (HTML, CSS, JS)
- `page.tsx` — thin iframe wrapper so it appears in the gallery

## Open questions

- Whether the STATED/ASSUMED/ANSWERED chip system is worth lifting into a shared
  reference (alongside inkset's motion primitives) for future agent-UI prototypes, or
  whether it's specific enough to Rapidflare's brief to leave standalone.
- The reference screenshots show real reaction icons (thumbs, speaker, copy) from an
  icon font; this prototype uses plain Unicode glyphs instead to avoid pulling in an
  icon library for a throwaway piece — worth swapping for real icons if this ever
  graduates past a recording rig.
