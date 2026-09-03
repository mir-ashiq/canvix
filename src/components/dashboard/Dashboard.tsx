'use client'

import { useMemo, useState } from 'react'
import {
  Search,
  Plus,
  MoreHorizontal,
  Pencil,
  Copy,
  Trash2,
  Presentation,
  Instagram,
  Printer,
  BadgeCheck,
  Video,
  Square,
  FileImage,
  Github,
  LayoutGrid,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useEditorStore } from '@/store/editor-store'
import { Logo } from '@/components/logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DesignPreview } from '@/components/design-preview'
import { TEMPLATES } from '@/lib/templates'
import { createPage, TEMPLATE_CATEGORIES, type TemplateRecord } from '@/lib/types'
import { PRESET_SIZES } from '@/lib/editor-utils'
import { cn } from '@/lib/utils'
import {
  createDesign,
  deleteDesign,
  duplicateDesign,
  fetchDesign,
  renameDesign,
  timeAgo,
  useDesigns,
} from './hooks'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/hooks/use-toast'
import { useIsMobile } from '@/hooks/use-mobile'

const CATEGORY_ICONS: Record<string, typeof Presentation> = {
  social: Instagram,
  presentation: Presentation,
  print: Printer,
  logo: BadgeCheck,
  thumbnail: Video,
}

const PRESET_ICONS = [Instagram, Instagram, Presentation, Printer, BadgeCheck, Video, Square, FileImage]

function newBlankPages() {
  return [createPage()]
}

export function Dashboard() {
  const goLanding = useAppStore((s) => s.goLanding)
  const openEditor = useAppStore((s) => s.openEditor)
  const loadEditorDesign = useEditorStore((s) => s.loadDesign)
  const { designs, refresh } = useDesigns()
  const isMobile = useIsMobile()

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [customOpen, setCustomOpen] = useState(false)
  const [customW, setCustomW] = useState('1080')
  const [customH, setCustomH] = useState('1080')
  const [creating, setCreating] = useState(false)
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const filteredTemplates = useMemo<TemplateRecord[]>(
    () =>
      TEMPLATES.map((t) => ({
        id: t.slug,
        slug: t.slug,
        name: t.name,
        category: t.category,
        width: t.width,
        height: t.height,
        accent: t.accent,
        pages: t.pages,
      })).filter((t) => category === 'all' || t.category === category),
    [category]
  )

  const filteredDesigns = useMemo(
    () => (designs ?? []).filter((d) => d.name.toLowerCase().includes(query.toLowerCase())),
    [designs, query]
  )

  // ── actions ─────────────────────────────────────────────────
  const startBlank = async (w: number, h: number, name?: string) => {
    setCreating(true)
    try {
      const record = await createDesign({
        name: name ?? 'Untitled design',
        width: w,
        height: h,
        pages: newBlankPages(),
      })
      openEditor(record)
      loadEditorDesign(record)
    } catch {
      toast({ title: 'Could not create design', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const startFromTemplate = async (t: TemplateRecord) => {
    setCreating(true)
    try {
      const record = await createDesign({
        name: t.name,
        width: t.width,
        height: t.height,
        pages: t.pages,
        source: `template:${t.slug}`,
      })
      openEditor(record)
      loadEditorDesign(record)
    } catch {
      toast({ title: 'Could not open template', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const openDesign = async (id: string) => {
    try {
      const record = await fetchDesign(id)
      openEditor(record)
      loadEditorDesign(record)
    } catch {
      toast({ title: 'Could not open design', variant: 'destructive' })
    }
  }

  const doDuplicate = async (id: string) => {
    try {
      await duplicateDesign(id)
      await refresh()
      toast({ title: 'Design duplicated' })
    } catch {
      toast({ title: 'Could not duplicate', variant: 'destructive' })
    }
  }

  const doDelete = async (id: string) => {
    setDeleteTarget(null)
    try {
      await deleteDesign(id)
      await refresh()
      toast({ title: 'Design deleted' })
    } catch {
      toast({ title: 'Could not delete', variant: 'destructive' })
    }
  }

  const doRename = async () => {
    if (!renameTarget) return
    const target = renameTarget
    setRenameTarget(null)
    if (!renameValue.trim()) return
    try {
      await renameDesign(target.id, renameValue.trim())
      await refresh()
    } catch {
      toast({ title: 'Could not rename', variant: 'destructive' })
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-black/5 bg-white/85 backdrop-blur-lg">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center gap-3">
          <button onClick={goLanding} aria-label="Canvix home" className="shrink-0">
            <Logo size={28} />
          </button>
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your designs"
              className="pl-10 h-10 rounded-full bg-[#F4F5F7] border-black/5 focus-visible:ring-[#00C4CC]/40"
              aria-label="Search designs"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <a href="https://github.com/mir-ashiq/canvix" target="_blank" rel="noreferrer">
              <Button variant="ghost" size="icon" className="rounded-full hidden sm:inline-flex" aria-label="GitHub repository">
                <Github size={18} />
              </Button>
            </a>
            <Button
              size="sm"
              className="btn-brand-gradient rounded-full px-4 gap-1.5"
              onClick={() => setCustomOpen(true)}
            >
              <Plus size={16} /> Custom size
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 pb-20">
        {/* ── Start a new design ── */}
        <section className="pt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Start a new design</h2>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {PRESET_SIZES.map((preset, i) => {
              const Icon = PRESET_ICONS[i % PRESET_ICONS.length]
              return (
                <button
                  key={preset.name}
                  onClick={() => startBlank(preset.width, preset.height, preset.name)}
                  disabled={creating}
                  className="group flex flex-col items-center gap-2 rounded-xl border border-black/8 bg-white p-4 hover:border-[#00C4CC]/50 hover:shadow-md hover:shadow-black/5 transition-all disabled:opacity-50"
                  aria-label={`Create ${preset.name}`}
                >
                  <span className="h-10 w-10 rounded-lg bg-brand-gradient-soft text-[#7D2AE8] flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Icon size={19} />
                  </span>
                  <span className="text-[13px] font-semibold text-center leading-tight">{preset.name}</span>
                  <span className="text-[11px] text-muted-foreground">{preset.hint}</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* ── Templates ── */}
        <section className="pt-12">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-xl font-bold">Templates</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setCategory('all')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium border transition-colors',
                  category === 'all'
                    ? 'bg-[#17181D] text-white border-transparent'
                    : 'bg-white border-black/10 text-muted-foreground hover:border-black/25'
                )}
              >
                <LayoutGrid size={14} /> All
              </button>
              {TEMPLATE_CATEGORIES.map((c) => {
                const Icon = CATEGORY_ICONS[c.id] ?? LayoutGrid
                return (
                  <button
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium border transition-colors',
                      category === c.id
                        ? 'bg-[#17181D] text-white border-transparent'
                        : 'bg-white border-black/10 text-muted-foreground hover:border-black/25'
                    )}
                  >
                    <Icon size={14} /> {c.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {filteredTemplates.map((t) => (
              <button
                key={t.slug}
                onClick={() => startFromTemplate(t)}
                disabled={creating}
                className="group text-left"
                aria-label={`Open template ${t.name}`}
              >
                <div
                  className="relative rounded-xl overflow-hidden border border-black/8 shadow-sm group-hover:shadow-lg group-hover:-translate-y-0.5 transition-all bg-white"
                  style={{ aspectRatio: `${t.width} / ${t.height}` }}
                >
                  <DesignPreview page={t.pages[0]} width={t.width} height={t.height} />
                  <div className="absolute inset-0 bg-[#7D2AE8]/0 group-hover:bg-[#7D2AE8]/10 transition-colors" />
                  <span className="absolute top-2 right-2 h-6 w-6 rounded-full bg-black/45 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Plus size={14} />
                  </span>
                </div>
                <div className="mt-2 text-sm font-medium truncate group-hover:text-[#7D2AE8] transition-colors">{t.name}</div>
                <div className="text-xs text-muted-foreground">{t.width} × {t.height}</div>
              </button>
            ))}
          </div>
        </section>

        {/* ── Recent designs ── */}
        <section className="pt-12">
          <h2 className="text-xl font-bold">Recent designs</h2>
          {filteredDesigns.length === 0 ? (
            <div className="mt-6 rounded-2xl border-2 border-dashed border-black/10 p-10 text-center">
              <div className="mx-auto h-14 w-14 rounded-2xl bg-brand-gradient-soft flex items-center justify-center text-[#7D2AE8]">
                <Plus size={24} />
              </div>
              <p className="mt-4 font-semibold">No designs yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Pick a preset or template above to get started.</p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {filteredDesigns.map((d) => (
                <div key={d.id} className="group">
                  <button
                    onClick={() => openDesign(d.id)}
                    className="relative block w-full rounded-xl overflow-hidden border border-black/8 shadow-sm group-hover:shadow-lg group-hover:-translate-y-0.5 transition-all bg-[#F4F5F7]"
                    style={{ aspectRatio: `${d.width} / ${d.height}` }}
                    aria-label={`Open ${d.name}`}
                  >
                    {d.thumbnail ? (
                      <img src={d.thumbnail} alt={d.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs font-medium">
                        {d.width} × {d.height}
                      </span>
                    )}
                  </button>
                  <div className="mt-2 flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{d.name}</div>
                      <div className="text-xs text-muted-foreground">{timeAgo(d.updatedAt)}</div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg shrink-0" aria-label={`Options for ${d.name}`}>
                          <MoreHorizontal size={15} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => openDesign(d.id)}>
                          <Pencil size={14} className="mr-2" /> Open
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setRenameTarget({ id: d.id, name: d.name }) || setRenameValue(d.name)}>
                          <Pencil size={14} className="mr-2" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => doDuplicate(d.id)}>
                          <Copy size={14} className="mr-2" /> Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => setDeleteTarget(d.id)}>
                          <Trash2 size={14} className="mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="mt-auto border-t border-black/5 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2.5">
            <Logo size={20} />
            <span>© 2026 · MIT License</span>
          </div>
          <a
            href="https://github.com/mir-ashiq/canvix"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <Github size={14} /> {isMobile ? 'GitHub' : 'github.com/mir-ashiq/canvix'}
          </a>
        </div>
      </footer>

      {/* ── Custom size dialog ── */}
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create a custom design</DialogTitle>
            <DialogDescription>Pick any pixel size — you can resize later.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium" htmlFor="custom-w">Width (px)</label>
              <Input id="custom-w" type="number" min={40} max={8000} value={customW} onChange={(e) => setCustomW(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="custom-h">Height (px)</label>
              <Input id="custom-h" type="number" min={40} max={8000} value={customH} onChange={(e) => setCustomH(e.target.value)} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomOpen(false)}>Cancel</Button>
            <Button
              className="btn-brand-gradient"
              onClick={() => {
                const w = parseInt(customW, 10)
                const h = parseInt(customH, 10)
                if (!Number.isFinite(w) || !Number.isFinite(h) || w < 40 || h < 40 || w > 8000 || h > 8000) {
                  toast({ title: 'Size must be between 40 and 8000 px', variant: 'destructive' })
                  return
                }
                setCustomOpen(false)
                void startBlank(w, h)
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rename dialog ── */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename design</DialogTitle>
          </DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && doRename()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button className="btn-brand-gradient" onClick={doRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm dialog ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this design?</DialogTitle>
            <DialogDescription>This action can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteTarget && doDelete(deleteTarget)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
