@AGENTS.md

# Prototype Playground

This repo is a sandbox for building throwaway UI prototypes. The homepage (`app/page.tsx`) is a
gallery that discovers, previews, and manages every prototype under `app/prototypes/`. Each
prototype lives in its own directory and is otherwise a normal Next.js route — treat it as an
isolated mini-app that happens to share the design system.

## Project structure

- `app/prototypes/<slug>/page.tsx` — a prototype's entry point. Directories without a `page.tsx`
  are not discovered by the gallery.
- `app/prototypes/<slug>/metadata.json` — title/description/tags/timestamps/hidden flag for the
  gallery card. See format below.
- `app/prototypes/<slug>/HOW_IT_WORKS.md` — short write-up of what the prototype does and how.
- `app/prototypes/[slug]/page.tsx` — fallback page rendered only when a slug has `metadata.json`
  but no `page.tsx` of its own yet. Don't add real prototype logic here.
- `lib/prototypes.ts` — all filesystem operations (scan, create, delete, patch metadata). API
  routes are thin wrappers around this file; put new prototype-management logic here, not in the
  route handlers.
- `app/api/prototypes/**` — REST endpoints backing the gallery (list/create, delete, patch
  metadata, toggle hidden).
- `components/ui/*` — the design system (Base UI primitives + Tailwind, shadcn-generated). Use
  these instead of building new primitives.
- `components/theme-provider.tsx` — next-themes wrapper used by the root layout.

## Commands

- `npm run dev` — start the dev server.
- `npm run build` — production build (also validates types via the Next.js plugin).
- `npm run lint` — ESLint.

There is no test runner configured; don't invent one unless asked.

## Mandatory rules

1. **Every prototype needs `metadata.json` and `HOW_IT_WORKS.md`.** When creating a prototype by
   hand (not via the "New prototype" dialog / `createPrototype()`), add both files yourself,
   matching the formats below.
2. **Design tokens only — never hardcoded colors.** Use `bg-background`, `text-foreground`,
   `bg-card`, `border-border`, `text-muted-foreground`, etc. Never write raw hex/rgb/oklch values
   or Tailwind's default color scales (`bg-gray-100`, `text-blue-500`) in prototype code.
3. **No hardcoded dark mode.** Never gate styles behind a manual `dark` prop, a `prefers-color-scheme`
   media query, or `localStorage` theme checks. Dark mode is handled entirely by `next-themes` via
   the `.dark` class on `<html>` and the token values in `app/globals.css`. Use Tailwind's `dark:`
   variant only for one-off exceptions the tokens don't already cover.
4. **Reuse `components/ui/*`** for buttons, dialogs, menus, form controls, etc. Only hand-roll a
   component when nothing in the design system fits.
5. **Slugs are lowercase letters, numbers, and hyphens only** (`^[a-z0-9]+(-[a-z0-9]+)*$`). This is
   enforced server-side in `app/api/prototypes/route.ts` and in `lib/prototypes.ts`.

## Design defaults

Unless a prototype's brief says otherwise:

- **Minimal.** Prefer plain layouts, generous whitespace, and the default type scale over dense UI.
- **Mobile-first.** Build the single-column/small-viewport layout first, then add `sm:`/`lg:`
  breakpoints for wider screens.
- **Dark-first.** The app defaults to dark mode (`defaultTheme="dark"` in the root layout). Design
  and eyeball prototypes in dark mode first, then confirm light mode still reads correctly via the
  same tokens — don't design light-only and patch in `dark:` overrides after the fact.

## `metadata.json` format

```json
{
  "title": "Kanban Board",
  "description": "Drag-and-drop task board with columns and swimlanes.",
  "tags": ["dashboard", "drag-and-drop"],
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "hidden": false
}
```

- `title` — required, shown on the gallery card and used as the fallback page's heading.
- `description` — optional, one sentence.
- `tags` — array of short lowercase strings; populates the gallery's tag filter bar.
- `createdAt` / `updatedAt` — ISO 8601 timestamps. `updatedAt` drives gallery sort order (newest
  first) — bump it whenever you make a meaningful change to the prototype.
- `hidden` — when `true`, the prototype is excluded from the gallery grid unless "Show hidden" is
  toggled on. Use this for work-in-progress or retired prototypes instead of deleting them.

## `HOW_IT_WORKS.md` format

```md
# <Title>

One paragraph: what this prototype demonstrates and why it exists.

## How it works

Explain the core mechanism, key state, and any non-obvious implementation details.

## Key files

- `page.tsx` — main entry point

## Open questions

-
```

Keep it short — this is a note to a future reader (human or agent), not documentation for an
end user.

## Common building patterns

- **New prototype via the gallery UI**: use the "New prototype" dialog on the homepage, or call
  `createPrototype()` from `lib/prototypes.ts` directly. Both create the directory, `metadata.json`,
  a boilerplate `page.tsx`, and `HOW_IT_WORKS.md` in one step — prefer this over creating the files
  by hand.
- **Client-only prototype logic** (state, effects, event handlers): mark the prototype's `page.tsx`
  with `"use client"` at the top, same as any other Next.js client component.
- **Server-fetched data inside a prototype**: keep `page.tsx` as an async Server Component and fetch
  directly in it, or push interactive pieces into a client child component — don't reach for a
  route handler unless the prototype specifically needs a persisted/mutable backend.
- **Prototype-local API routes**: if a prototype needs its own backend, add
  `app/prototypes/<slug>/api/.../route.ts` (or a top-level `app/api/<slug>/...` route) rather than
  extending the shared `app/api/prototypes/*` routes, which are reserved for gallery management.
- **Sharing UI across prototypes**: if two or more prototypes need the same non-trivial component,
  put it in `components/` (not inside a single prototype's directory) so it isn't duplicated.
