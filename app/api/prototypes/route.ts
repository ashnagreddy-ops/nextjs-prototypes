import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { createPrototype, getPrototypes, isValidSlug, prototypeExists } from "@/lib/prototypes"

export async function GET() {
  return NextResponse.json(getPrototypes())
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)

  if (!body || typeof body.slug !== "string" || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "slug and title are required" }, { status: 400 })
  }

  const { slug, title, description, tags } = body

  if (!isValidSlug(slug)) {
    return NextResponse.json(
      { error: "slug must contain only lowercase letters, numbers, and hyphens" },
      { status: 400 }
    )
  }

  if (prototypeExists(slug)) {
    return NextResponse.json(
      { error: `a prototype named "${slug}" already exists` },
      { status: 409 }
    )
  }

  const prototype = createPrototype({
    slug,
    title: title.trim(),
    description: typeof description === "string" ? description.trim() : undefined,
    tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : undefined,
  })

  return NextResponse.json(prototype, { status: 201 })
}
