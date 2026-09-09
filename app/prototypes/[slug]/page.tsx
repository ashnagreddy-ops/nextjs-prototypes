import { notFound } from "next/navigation"

import { getPrototype } from "@/lib/prototypes"

export default async function PrototypeFallbackPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const prototype = getPrototype(slug)

  if (!prototype) {
    notFound()
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold text-foreground">{prototype.title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        This prototype doesn&apos;t have a page.tsx yet. Add one at{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-foreground">
          app/prototypes/{slug}/page.tsx
        </code>
        .
      </p>
    </div>
  )
}
