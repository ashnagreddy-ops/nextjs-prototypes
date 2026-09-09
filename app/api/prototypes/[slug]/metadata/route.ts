import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { updatePrototypeMetadata } from "@/lib/prototypes"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const body = await request.json().catch(() => null)

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 })
  }

  const { title, description, tags, hidden } = body
  const patch: Record<string, unknown> = {}

  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 })
    }
    patch.title = title.trim()
  }

  if (description !== undefined) {
    if (typeof description !== "string") {
      return NextResponse.json({ error: "description must be a string" }, { status: 400 })
    }
    patch.description = description
  }

  if (tags !== undefined) {
    if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string")) {
      return NextResponse.json({ error: "tags must be an array of strings" }, { status: 400 })
    }
    patch.tags = tags
  }

  if (hidden !== undefined) {
    if (typeof hidden !== "boolean") {
      return NextResponse.json({ error: "hidden must be a boolean" }, { status: 400 })
    }
    patch.hidden = hidden
  }

  const updated = updatePrototypeMetadata(slug, patch)

  if (!updated) {
    return NextResponse.json({ error: `prototype "${slug}" not found` }, { status: 404 })
  }

  return NextResponse.json(updated)
}
