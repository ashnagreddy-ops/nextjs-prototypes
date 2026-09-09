import fs from "node:fs"
import path from "node:path"

export interface PrototypeMetadata {
  title: string
  description: string
  tags: string[]
  createdAt: string
  updatedAt: string
  hidden: boolean
}

export interface Prototype extends PrototypeMetadata {
  slug: string
}

export type MetadataPatch = Partial<
  Pick<PrototypeMetadata, "title" | "description" | "tags" | "hidden">
>

export interface CreatePrototypeInput {
  slug: string
  title: string
  description?: string
  tags?: string[]
}

const PROTOTYPES_DIR = path.join(process.cwd(), "app", "prototypes")
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug)
}

export function prototypeExists(slug: string): boolean {
  return fs.existsSync(path.join(PROTOTYPES_DIR, slug))
}

function metadataPath(slug: string) {
  return path.join(PROTOTYPES_DIR, slug, "metadata.json")
}

function pagePath(slug: string) {
  return path.join(PROTOTYPES_DIR, slug, "page.tsx")
}

function readMetadata(slug: string): PrototypeMetadata {
  let parsed: Partial<PrototypeMetadata> = {}
  try {
    parsed = JSON.parse(fs.readFileSync(metadataPath(slug), "utf8"))
  } catch {
    parsed = {}
  }

  const now = new Date().toISOString()
  return {
    title: parsed.title ?? slug,
    description: parsed.description ?? "",
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    createdAt: parsed.createdAt ?? now,
    updatedAt: parsed.updatedAt ?? now,
    hidden: parsed.hidden ?? false,
  }
}

function writeMetadata(slug: string, metadata: PrototypeMetadata) {
  fs.writeFileSync(metadataPath(slug), JSON.stringify(metadata, null, 2) + "\n")
}

/** Scans app/prototypes/*\/page.tsx and returns prototypes sorted by updatedAt, newest first. */
export function getPrototypes(): Prototype[] {
  if (!fs.existsSync(PROTOTYPES_DIR)) return []

  const prototypes = fs
    .readdirSync(PROTOTYPES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => isValidSlug(entry.name))
    .filter((entry) => fs.existsSync(pagePath(entry.name)))
    .map((entry) => ({ slug: entry.name, ...readMetadata(entry.name) }))

  return prototypes.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

export function getPrototype(slug: string): Prototype | null {
  if (!prototypeExists(slug)) return null
  return { slug, ...readMetadata(slug) }
}

export function createPrototype({
  slug,
  title,
  description = "",
  tags = [],
}: CreatePrototypeInput): Prototype {
  const dir = path.join(PROTOTYPES_DIR, slug)
  fs.mkdirSync(dir, { recursive: true })

  const now = new Date().toISOString()
  const metadata: PrototypeMetadata = {
    title,
    description,
    tags,
    createdAt: now,
    updatedAt: now,
    hidden: false,
  }

  writeMetadata(slug, metadata)
  fs.writeFileSync(pagePath(slug), pageBoilerplate(title))
  fs.writeFileSync(path.join(dir, "HOW_IT_WORKS.md"), howItWorksBoilerplate(title, description))

  return { slug, ...metadata }
}

export function deletePrototype(slug: string): boolean {
  const dir = path.join(PROTOTYPES_DIR, slug)
  if (!fs.existsSync(dir)) return false
  fs.rmSync(dir, { recursive: true, force: true })
  return true
}

export function updatePrototypeMetadata(slug: string, patch: MetadataPatch): Prototype | null {
  if (!prototypeExists(slug)) return null

  const updated: PrototypeMetadata = {
    ...readMetadata(slug),
    ...patch,
    updatedAt: new Date().toISOString(),
  }

  writeMetadata(slug, updated)
  return { slug, ...updated }
}

export function toggleHidden(slug: string): Prototype | null {
  if (!prototypeExists(slug)) return null
  const current = readMetadata(slug)
  return updatePrototypeMetadata(slug, { hidden: !current.hidden })
}

function pageBoilerplate(title: string) {
  return `export default function Page() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold text-foreground">${title}</h1>
      <p className="text-sm text-muted-foreground">Start building in this file.</p>
    </div>
  )
}
`
}

function howItWorksBoilerplate(title: string, description: string) {
  return `# ${title}

${description || "One paragraph: what this prototype demonstrates and why it exists."}

## How it works

Explain the core mechanism, key state, and any non-obvious implementation details.

## Key files

- \`page.tsx\` — main entry point

## Open questions

-
`
}
