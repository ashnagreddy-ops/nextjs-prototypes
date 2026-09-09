"use client"

import { useEffect, useMemo, useState } from "react"
import type { FormEvent } from "react"
import Link from "next/link"
import { formatDistanceToNow } from "date-fns"
import {
  Eye,
  EyeOff,
  ExternalLink,
  LayoutGrid,
  MoreVertical,
  Plus,
  Search,
  Trash2,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { Prototype } from "@/lib/prototypes"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "@/components/ui/toast"

const PREVIEW_SCALE = 0.5

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function sortByUpdatedAt(list: Prototype[]) {
  return [...list].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

export default function HomePage() {
  const [prototypes, setPrototypes] = useState<Prototype[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Prototype | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    void loadPrototypes()
  }, [])

  async function loadPrototypes() {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch("/api/prototypes")
      if (!res.ok) throw new Error("Failed to load prototypes")
      const data: Prototype[] = await res.json()
      setPrototypes(data)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load prototypes")
    } finally {
      setLoading(false)
    }
  }

  const allTags = useMemo(
    () => Array.from(new Set(prototypes.flatMap((p) => p.tags))).sort(),
    [prototypes]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return prototypes.filter((p) => {
      if (!showHidden && p.hidden) return false
      if (selectedTags.size > 0 && !p.tags.some((tag) => selectedTags.has(tag))) return false
      if (q) {
        const haystack = `${p.title} ${p.description} ${p.tags.join(" ")}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [prototypes, showHidden, selectedTags, query])

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  function handleCreated(created: Prototype) {
    setPrototypes((prev) => sortByUpdatedAt([created, ...prev]))
  }

  async function handleToggleHidden(prototype: Prototype) {
    setPrototypes((prev) =>
      prev.map((p) => (p.slug === prototype.slug ? { ...p, hidden: !p.hidden } : p))
    )
    try {
      const res = await fetch("/api/prototypes/toggle-hidden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: prototype.slug }),
      })
      if (!res.ok) throw new Error("Failed to update prototype")
      const updated: Prototype = await res.json()
      setPrototypes((prev) =>
        sortByUpdatedAt(prev.map((p) => (p.slug === updated.slug ? updated : p)))
      )
    } catch (err) {
      setPrototypes((prev) =>
        prev.map((p) => (p.slug === prototype.slug ? { ...p, hidden: prototype.hidden } : p))
      )
      toast.add({
        title: err instanceof Error ? err.message : "Failed to update prototype",
        type: "error",
      })
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/prototypes/${pendingDelete.slug}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete prototype")
      setPrototypes((prev) => prev.filter((p) => p.slug !== pendingDelete.slug))
      toast.add({ title: `Deleted "${pendingDelete.title}"`, type: "success" })
      setPendingDelete(null)
    } catch (err) {
      toast.add({
        title: err instanceof Error ? err.message : "Failed to delete prototype",
        type: "error",
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Prototypes</h1>
          <p className="text-sm text-muted-foreground">
            {prototypes.length} prototype{prototypes.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          New prototype
        </Button>
      </header>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search prototypes..."
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="show-hidden" checked={showHidden} onCheckedChange={setShowHidden} />
            <Label htmlFor="show-hidden">Show hidden</Label>
          </div>
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {allTags.map((tag) => (
              <button key={tag} type="button" onClick={() => toggleTag(tag)}>
                <Badge variant={selectedTags.has(tag) ? "default" : "outline"}>{tag}</Badge>
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading prototypes...</p>
      ) : loadError ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button variant="outline" onClick={loadPrototypes}>
            Retry
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <LayoutGrid className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {prototypes.length === 0 ? "No prototypes yet." : "No prototypes match your filters."}
          </p>
          {prototypes.length === 0 && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              Create your first prototype
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((prototype) => (
            <PrototypeCard
              key={prototype.slug}
              prototype={prototype}
              onToggleHidden={handleToggleHidden}
              onDelete={setPendingDelete}
            />
          ))}
        </div>
      )}

      <CreatePrototypeDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{pendingDelete?.title}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes app/prototypes/{pendingDelete?.slug} and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function PrototypeCard({
  prototype,
  onToggleHidden,
  onDelete,
}: {
  prototype: Prototype
  onToggleHidden: (prototype: Prototype) => void
  onDelete: (prototype: Prototype) => void
}) {
  return (
    <Card className="overflow-hidden pt-0">
      <div className="relative aspect-video overflow-hidden bg-muted">
        <div
          className="pointer-events-none absolute inset-0 origin-top-left"
          style={{
            width: `${100 / PREVIEW_SCALE}%`,
            height: `${100 / PREVIEW_SCALE}%`,
            transform: `scale(${PREVIEW_SCALE})`,
          }}
        >
          <iframe
            src={`/prototypes/${prototype.slug}`}
            title={prototype.title}
            tabIndex={-1}
            loading="lazy"
            className="h-full w-full border-0"
          />
        </div>
        <Link
          href={`/prototypes/${prototype.slug}`}
          target="_blank"
          className="absolute inset-0"
          aria-label={`Open ${prototype.title}`}
        />
      </div>
      <CardHeader>
        <CardTitle className="truncate">{prototype.title}</CardTitle>
        {prototype.description && (
          <CardDescription className="line-clamp-2">{prototype.description}</CardDescription>
        )}
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}>
              <MoreVertical className="size-4" />
              <span className="sr-only">Actions</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => window.open(`/prototypes/${prototype.slug}`, "_blank")}>
                <ExternalLink />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onToggleHidden(prototype)}>
                {prototype.hidden ? <Eye /> : <EyeOff />}
                {prototype.hidden ? "Unhide" : "Hide"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(prototype)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-1.5 empty:hidden">
        {prototype.tags.map((tag) => (
          <Badge key={tag} variant="secondary">
            {tag}
          </Badge>
        ))}
        {prototype.hidden && <Badge variant="outline">Hidden</Badge>}
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        Updated {formatDistanceToNow(new Date(prototype.updatedAt), { addSuffix: true })}
      </CardFooter>
    </Card>
  )
}

function CreatePrototypeDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (prototype: Prototype) => void
}) {
  const [title, setTitle] = useState("")
  const [slug, setSlug] = useState("")
  const [slugEdited, setSlugEdited] = useState(false)
  const [description, setDescription] = useState("")
  const [tagsInput, setTagsInput] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetForm() {
    setTitle("")
    setSlug("")
    setSlugEdited(false)
    setDescription("")
    setTagsInput("")
    setError(null)
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm()
    onOpenChange(next)
  }

  function handleTitleChange(value: string) {
    setTitle(value)
    if (!slugEdited) setSlug(slugify(value))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || !slug.trim()) return

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/prototypes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          title: title.trim(),
          description: description.trim(),
          tags: tagsInput
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to create prototype")
      onCreated(data)
      handleOpenChange(false)
      toast.add({ title: `Created "${data.title}"`, type: "success" })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create prototype")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader>
            <DialogTitle>New prototype</DialogTitle>
            <DialogDescription>
              Creates a new directory under app/prototypes with boilerplate files.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="proto-title">Title</Label>
              <Input
                id="proto-title"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Kanban board"
                autoFocus
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="proto-slug">Slug</Label>
              <Input
                id="proto-slug"
                value={slug}
                onChange={(e) => {
                  setSlug(slugify(e.target.value))
                  setSlugEdited(true)
                }}
                placeholder="kanban-board"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="proto-description">Description</Label>
              <Textarea
                id="proto-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this prototype demonstrate?"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="proto-tags">Tags</Label>
              <Input
                id="proto-tags"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="dashboard, charts, admin"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <DialogClose className={cn(buttonVariants({ variant: "outline" }))}>Cancel</DialogClose>
            <button
              type="submit"
              className={cn(buttonVariants({ variant: "default" }))}
              disabled={submitting}
            >
              {submitting ? "Creating..." : "Create"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
