import { NextResponse } from "next/server"

import { deletePrototype } from "@/lib/prototypes"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  if (!deletePrototype(slug)) {
    return NextResponse.json({ error: `prototype "${slug}" not found` }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
