# Inkset Kinetic Type

A proof-of-concept "tactile kinetic typography" design language: one flat ink-black
surface, one indigo-violet accent reserved for interactive elements, and four reusable
motion primitives (stagger-drop, press-and-settle, flex-on-hover, snap-transition)
demonstrated on a self-contained spec page.

## How it works

The whole prototype is a single static HTML file at
`public/prototypes/inkset-kinetic-type/index.html`, loaded through a full-bleed
`<iframe>` in `page.tsx`. It's kept outside the app's Tailwind/shadcn tree deliberately —
the brief called for a fixed, non-themeable palette (deep ink black + one accent color,
no light mode), which conflicts with this repo's "design tokens only, no hardcoded
colors" rule for in-app components. Isolating it in an iframe lets the prototype own
its palette completely without that rule applying to code that was never meant to pick
up the app's tokens.

Inside the file:
- All color and motion-timing values are CSS custom properties in one `:root` block at
  the top of the `<style>` tag, commented by primitive (stagger-drop, press-and-settle,
  flex-on-hover, snap-transition).
- The stagger-drop headline uses a real damped-spring curve baked into a CSS
  `linear()` easing (with a `cubic-bezier` fallback via `@supports`).
- The tab component in the "Primitives, live" section *is* the snap-transition
  primitive; its three panels each demo one of the other three primitives, so nothing
  on the page is a mockup — it's the system running.
- Sound is synthesized with the Web Audio API (oscillators + a shared noise buffer via
  `BiquadFilterNode`), muted by default; the `AudioContext` is only constructed on the
  first toggle click, which doubles as the browser's audio-unlock gesture.

## Key files

- `public/prototypes/inkset-kinetic-type/index.html` — the entire prototype (HTML, CSS, JS)
- `page.tsx` — thin iframe wrapper so it appears in the gallery

## Open questions

- Whether to eventually port this into the shared design system as reusable
  `.stagger-drop` / `.press-and-settle` / `.flex-on-hover` / `.snap-transition` utility
  classes for use in later prototypes, or keep it a standalone reference.
