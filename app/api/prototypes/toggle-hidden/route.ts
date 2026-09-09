import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { toggleHidden } from "@/lib/prototypes"

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)

  if (!body || typeof body.slug !== "string") {
    return NextResponse.json({ error: "slug is required" }, { status: 400 })
  }

  const updated = toggleHidden(body.slug)

  if (!updated) {
    return NextResponse.json({ error: `prototype "${body.slug}" not found` }, { status: 404 })
  }

  return NextResponse.json(updated)
}
