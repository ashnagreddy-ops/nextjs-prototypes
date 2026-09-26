# Rapidflare Select — Mobile

A static, non-animated mobile layout of the end state of state 1 ("Landing") from
[`rapidflare-select`](../rapidflare-select/HOW_IT_WORKS.md): the first user prompt, the
agent's complete first response, the assumed/stated filters, and the docked actions.

## How it works

Same isolation pattern as the desktop rig: a single static HTML file at
`public/prototypes/rapidflare-select-mobile/index.html` loaded through a full-bleed
`<iframe>`, using the same fixed light palette (the brief has no dark mode).

Desktop → mobile adaptations:
- The side nav collapses to a menu button; the breadcrumb is reduced to a centred agent name.
- The right-hand filters panel becomes a horizontally scrolling chip strip under the top
  bar (the assumed impedance chip is tinted, matching the sparkle "assumed" marker), with a
  "Filters" button that opens a bottom sheet holding the full filter rows.
- The docked action buttons scroll horizontally as pills above the input.
- On a wide window the page renders inside a 390×844 device frame; on a phone it's full-bleed.

Only the reasoning toggle and the filters sheet are interactive — nothing animates in.

## Key files

- `public/prototypes/rapidflare-select-mobile/index.html` — the whole layout
- `page.tsx` — iframe wrapper for the gallery

## Open questions

- Whether filters should live inline in the transcript on mobile instead of a sheet.
