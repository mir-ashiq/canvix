'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  Search,
  Plus,
  MoreHorizontal,
  Pencil,
  Copy,
  Trash2,
  RotateCcw,
  ChevronDown,
  Presentation,
  Instagram,
  Printer,
  BadgeCheck,
  Video,
  Square,
  FileImage,
  Github,
  LayoutGrid,
  LayoutTemplate,
  FolderOpen,
  BookMarked,
  CircleHelp,
  Info,
  Heart,
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
  deleteDesignForever,
  duplicateDesign,
  fetchDesign,
  listTrash,
  renameDesign,
  restoreDesign,
  timeAgo,
  useDesigns,
  type DesignMeta,
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
  document: FileImage,
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
  const { designs, loading, refresh } = useDesigns()
  const isMobile = useIsMobile()
  const [helpOpen, setHelpOpen] = useState(false)

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [customOpen, setCustomOpen] = useState(false)
  const [customW, setCustomW] = useState('1080')
  const [customH, setCustomH] = useState('1080')
  const [creating, setCreating] = useState(false)
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  // v0.4: trash + sort
  const [trashOpen, setTrashOpen] = useState(false)
  const [trash, setTrash] = useState<DesignMeta[] | null>(null)
  const [sort, setSort] = useState<'recent' | 'name'>('recent')

  const refreshTrash = useCallback(async () => {
    try {
      setTrash(await listTrash())
    } catch {
      setTrash([])
    }
  }, [])

  const toggleTrash = (open: boolean) => {
    setTrashOpen(open)
    if (open && trash === null) void refreshTrash()
  }

  const doRestore = async (id: string, name: string) => {
    try {
      await restoreDesign(id)
      await Promise.all([refresh(), refreshTrash()])
      toast({ title: `“${name}” restored` })
    } catch {
      toast({ title: 'Could not restore', variant: 'destructive' })
    }
  }

  const doDeleteForever = async (id: string, name: string) => {
    try {
      await deleteDesignForever(id)
      await refreshTrash()
      toast({ title: `“${name}” deleted forever` })
    } catch {
      toast({ title: 'Could not delete', variant: 'destructive' })
    }
  }

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
    () =>
      (designs ?? [])
        .filter((d) => d.name.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) =>
          sort === 'name'
            ? a.name.localeCompare(b.name)
            : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        ),
    [designs, query, sort]
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
    <div className="min-h-screen flex bg-[#1F142E] text-[#EDEEF2]">
      {/* ── Canva-style left rail (desktop) ── */}
      <nav className="hidden md:flex w-[72px] shrink-0 flex-col items-center bg-[#1C1229] border-r border-white/[0.06] py-3 gap-1 sticky top-0 h-screen" aria-label="Primary">
        <button
          onClick={() => setCustomOpen(true)}
          className="h-9 w-9 rounded-full bg-[#7630D7] hover:bg-[#8B5CF6] text-white flex items-center justify-center shadow-lg shadow-[#7630D7]/40 transition-colors"
          aria-label="Create a design"
          title="Create a design"
        >
          <Plus size={20} />
        </button>
        <div className="h-3" />
        {[
          { label: 'Home', icon: LayoutGrid, active: true },
          { label: 'Templates', icon: LayoutTemplate, target: 'templates' },
          { label: 'Projects', icon: FolderOpen, target: 'recents' },
          { label: 'Brand', icon: BookMarked, target: 'brand' },
        ].map((item) => (
          <button
            key={item.label}
            onClick={() => item.target && document.getElementById(`cv-${item.target}`)?.scrollIntoView({ behavior: 'smooth' })}
            className={cn(
              'w-14 py-2.5 rounded-2xl flex flex-col items-center gap-1 transition-colors',
              item.active ? 'bg-[#2A2C35] text-white' : 'text-white/60 hover:text-white hover:bg-white/[0.06]'
            )}
            aria-label={item.label}
            aria-current={item.active ? 'page' : undefined}
          >
            <item.icon size={19} />
            <span className="text-[9px] font-medium leading-none">{item.label}</span>
          </button>
        ))}
        <div className="mt-auto flex flex-col items-center gap-2">
          <a
            href="https://github.com/mir-ashiq/canvix"
            target="_blank"
            rel="noreferrer"
            className="w-9 h-9 rounded-full text-white/50 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
            aria-label="GitHub repository"
            title="GitHub repository"
          >
            <Github size={18} />
          </a>
          <button
            onClick={goLanding}
            className="h-9 w-9 rounded-full cv-topbar-gradient text-white text-[13px] font-bold flex items-center justify-center"
            aria-label="About Canvix"
            title="About Canvix"
          >
            C
          </button>
        </div>
      </nav>

      <div className="flex-1 min-w-0 flex flex-col">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#1F142E]/90 backdrop-blur-lg">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center gap-3">
          <button onClick={goLanding} aria-label="Canvix home" className="shrink-0 md:hidden">
            <Logo size={26} />
          </button>
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your designs"
              className="pl-10 h-10 rounded-full bg-white/[0.06] border-white/10 text-white placeholder:text-white/35 focus-visible:ring-[#7630D7]/50 focus-visible:border-[#7630D7]/60"
              aria-label="Search designs"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              className="btn-cv rounded-full px-4 gap-1.5 h-10"
              onClick={() => setCustomOpen(true)}
            >
              <Plus size={16} /> <span className="hidden sm:inline">Custom size</span>
            </Button>
            {/* ── account area (canva-style avatar menu) ── */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="h-10 w-10 rounded-full bg-gradient-to-br from-[#02C0CC] to-[#7630D7] text-white text-[13px] font-extrabold flex items-center justify-center shrink-0 hover:brightness-110 transition-all"
                  aria-label="Account menu"
                  title="Account"
                >
                  CV
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-[#16181D] border-white/10 text-white">
                <div className="px-3 py-2.5 border-b border-white/[0.07]">
                  <div className="text-[13px] font-semibold">Canvix creator</div>
                  <div className="text-[11px] text-white/45">Free · open-source · local-first</div>
                </div>
                <DropdownMenuItem className="gap-2" onClick={() => setHelpOpen(true)}>
                  <CircleHelp size={14} /> Help &amp; shortcuts
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onClick={goLanding}>
                  <Info size={14} /> About Canvix
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" asChild>
                  <a href="https://github.com/mir-ashiq/canvix" target="_blank" rel="noreferrer">
                    <Github size={14} /> GitHub repository
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" asChild>
                  <a href="https://github.com/mir-ashiq/canvix/stargazers" target="_blank" rel="noreferrer">
                    <Heart size={14} /> Star the project
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 pb-20">
        {/* ── Hero — canva “What will you design today?” ── */}
        <section className="pt-8 pb-2">
          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-center">
            What will you <span className="text-brand-gradient">design</span> today?
          </h1>
          <p className="mt-2 text-center text-sm text-white/50">Free, open-source, and yours forever.</p>
        </section>

        {/* ── Start a new design ── */}
        <section className="pt-6">
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
                  className="group flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-[#16171D] p-4 hover:border-[#7630D7]/60 hover:bg-[#1C1E28] transition-all disabled:opacity-50"
                  aria-label={`Create ${preset.name}`}
                >
                  <span className="h-10 w-10 rounded-xl bg-brand-gradient-soft text-[#A78BFA] flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Icon size={19} />
                  </span>
                  <span className="text-[13px] font-semibold text-center leading-tight">{preset.name}</span>
                  <span className="text-[11px] text-white/40">{preset.hint}</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* ── Templates ── */}
        <section id="cv-templates" className="pt-12 scroll-mt-20">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-xl font-bold">Templates</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setCategory('all')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium border transition-colors',
                  category === 'all'
                    ? 'bg-[#7630D7] text-white border-transparent'
                    : 'bg-transparent border-white/12 text-white/60 hover:border-white/30 hover:text-white'
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
                        ? 'bg-[#7630D7] text-white border-transparent'
                        : 'bg-transparent border-white/12 text-white/60 hover:border-white/30 hover:text-white'
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
                  className="relative rounded-xl overflow-hidden border border-white/10 shadow-lg shadow-black/30 group-hover:shadow-xl group-hover:-translate-y-0.5 transition-all bg-[#0F1015]"
                  style={{ aspectRatio: `${t.width} / ${t.height}` }}
                >
                  <DesignPreview page={t.pages[0]} width={t.width} height={t.height} />
                  <div className="absolute inset-0 bg-[#7630D7]/0 group-hover:bg-[#7630D7]/15 transition-colors" />
                  <span className="absolute top-2 right-2 h-6 w-6 rounded-full bg-[#7630D7] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Plus size={14} />
                  </span>
                </div>
                <div className="mt-2 text-sm font-medium truncate text-white/85 group-hover:text-[#A78BFA] transition-colors">{t.name}</div>
                <div className="text-xs text-white/40">{t.width} × {t.height}</div>
              </button>
            ))}
          </div>
        </section>

        {/* ── Brand kit ── */}
        <section id="cv-brand" className="pt-12 scroll-mt-20">
          <h2 className="text-xl font-bold">Brand kit</h2>
          <div className="mt-4 rounded-2xl border border-white/10 bg-[#16171D] p-5 flex flex-col sm:flex-row items-center gap-6">
            <div className="flex gap-2">
              {(['#7630D7', '#02C0CC', '#FF5C8A', '#1F142E', '#FFD166'] as const).map((c) => (
                <span key={c} className="h-10 w-10 rounded-xl border border-white/15" style={{ background: c }} aria-label={`Brand color ${c}`} />
              ))}
            </div>
            <div className="flex-1 text-center sm:text-left">
              <div className="text-sm font-semibold">Set your brand colors &amp; fonts in the editor</div>
              <div className="text-xs text-white/40 mt-0.5">Open any design → Brand tab. Saved locally, applied anywhere.</div>
            </div>
            <Button
              variant="outline"
              className="rounded-xl border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white"
              onClick={() => {
                const first = filteredDesigns[0] ?? null
                if (first) void openDesign(first.id)
                else toast({ title: 'Open a design first, then click the Brand tab' })
              }}
            >
              Open editor
            </Button>
          </div>
        </section>

        {/* ── Recent designs ── */}
        <section id="cv-recents" className="pt-12 scroll-mt-20">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-xl font-bold">Recent designs</h2>
            {/* v0.4: canva-style sort control */}
            <div className="flex items-center gap-1 rounded-full border border-white/10 p-0.5" role="group" aria-label="Sort designs">
              {(['recent', 'name'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setSort(mode)}
                  className={cn(
                    'h-7 px-3 rounded-full text-[11.5px] font-semibold transition-colors',
                    sort === mode ? 'bg-[#7630D7] text-white' : 'text-white/55 hover:text-white'
                  )}
                  aria-pressed={sort === mode}
                >
                  {mode === 'recent' ? 'Recent' : 'Name'}
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i}>
                  <div className="cv-skeleton w-full aspect-[4/3]" />
                  <div className="cv-skeleton h-3.5 w-2/3 mt-2.5" />
                  <div className="cv-skeleton h-2.5 w-1/3 mt-1.5" />
                </div>
              ))}
            </div>
          ) : filteredDesigns.length === 0 ? (
            <div className="mt-6 rounded-2xl border-2 border-dashed border-white/12 p-10 text-center">
              <div className="mx-auto h-14 w-14 rounded-2xl bg-brand-gradient-soft flex items-center justify-center text-[#A78BFA]">
                <Plus size={24} />
              </div>
              <p className="mt-4 font-semibold">No designs yet</p>
              <p className="mt-1 text-sm text-white/45">Pick a preset or template above to get started.</p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {filteredDesigns.map((d) => (
                <div key={d.id} className="group">
                  <button
                    onClick={() => openDesign(d.id)}
                    className="relative block w-full rounded-xl overflow-hidden border border-white/10 shadow-lg shadow-black/30 group-hover:shadow-xl group-hover:-translate-y-0.5 transition-all bg-[#0F1015]"
                    style={{ aspectRatio: `${d.width} / ${d.height}` }}
                    aria-label={`Open ${d.name}`}
                  >
                    {d.thumbnail ? (
                      <img src={d.thumbnail} alt={d.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center text-white/30 text-xs font-medium">
                        {d.width} × {d.height}
                      </span>
                    )}
                  </button>
                  <div className="mt-2 flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate text-white/85">{d.name}</div>
                      <div className="text-xs text-white/40">{timeAgo(d.updatedAt)}</div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg shrink-0 text-white/60 hover:bg-white/10 hover:text-white" aria-label={`Options for ${d.name}`}>
                          <MoreHorizontal size={15} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44 bg-[#16181D] border-white/10 text-white">
                        <DropdownMenuItem onClick={() => openDesign(d.id)}>
                          <Pencil size={14} className="mr-2" /> Open
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setRenameTarget({ id: d.id, name: d.name }); setRenameValue(d.name) }}>
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
        {/* ── Trash (v0.4 — soft-deleted designs) ── */}
        <section id="cv-trash" className="pt-12 scroll-mt-20">
          <button
            onClick={() => toggleTrash(!trashOpen)}
            className="flex items-center gap-2 w-full text-left group"
            aria-expanded={trashOpen}
            aria-controls="trash-list"
          >
            <ChevronDown size={18} className={cn('text-white/50 transition-transform', trashOpen ? '' : '-rotate-90')} />
            <h2 className="text-xl font-bold group-hover:text-[#A78BFA] transition-colors">Trash</h2>
            {trash !== null && (
              <span className="text-xs text-white/40 font-medium">· {trash.length} item{trash.length === 1 ? '' : 's'}</span>
            )}
          </button>

          {trashOpen && (
            <div id="trash-list" className="mt-4">
              {trash === null ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i}>
                      <div className="cv-skeleton w-full aspect-[4/3]" />
                      <div className="cv-skeleton h-3.5 w-2/3 mt-2.5" />
                    </div>
                  ))}
                </div>
              ) : trash.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/12 p-8 text-center text-sm text-white/45">
                  Trash is empty. Deleted designs land here first — nothing is lost forever.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                  {trash.map((d) => (
                    <div key={d.id} className="group opacity-80 hover:opacity-100 transition-opacity">
                      <div
                        className="relative rounded-xl overflow-hidden border border-white/10 bg-[#0F1015] grayscale group-hover:grayscale-0 transition-all"
                        style={{ aspectRatio: `${d.width} / ${d.height}` }}
                      >
                        {d.thumbnail ? (
                          <img src={d.thumbnail} alt={d.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="absolute inset-0 flex items-center justify-center text-white/30 text-xs font-medium">
                            {d.width} × {d.height}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate text-white/85">{d.name}</div>
                          <div className="text-xs text-white/40">
                            deleted {timeAgo(d.deletedAt ?? d.updatedAt)}
                          </div>
                        </div>
                        <div className="flex gap-0.5 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
                            onClick={() => void doRestore(d.id, d.name)}
                            aria-label={`Restore ${d.name}`}
                            title="Restore"
                          >
                            <RotateCcw size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-lg text-white/60 hover:bg-red-500/15 hover:text-red-400"
                            onClick={() => void doDeleteForever(d.id, d.name)}
                            aria-label={`Delete ${d.name} forever`}
                            title="Delete forever"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="mt-auto border-t border-white/[0.06] bg-[#1C1229]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-white/40">
          <div className="flex items-center gap-2.5">
            <Logo size={20} />
            <span>© 2026 · MIT License</span>
          </div>
          <a
            href="https://github.com/mir-ashiq/canvix"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 hover:text-white/80 transition-colors"
          >
            <Github size={14} /> {isMobile ? 'GitHub' : 'github.com/mir-ashiq/canvix'}
          </a>
        </div>
      </footer>
      </div>{/* end flex-1 column */}

      {/* ── Canva-style “Get help” FAB ── */}
      <button
        onClick={() => setHelpOpen(true)}
        className="fixed bottom-5 right-5 z-50 h-12 w-12 rounded-full bg-[#7630D7] hover:bg-[#8B5CF6] text-white flex items-center justify-center shadow-xl shadow-[#7630D7]/40 transition-colors"
        aria-label="Get help"
        title="Get help"
      >
        <CircleHelp size={22} />
      </button>

      {/* ── Help & shortcuts modal ── */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="rounded-[28px] sm:max-w-md bg-[#16181D] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CircleHelp size={18} className="text-[#02C0CC]" /> Help &amp; shortcuts
            </DialogTitle>
            <DialogDescription className="text-white/55">Everything you need to design faster.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto cv-scroll-dark">
            <div>
              <div className="text-[12px] font-bold text-white/85 mb-2 uppercase tracking-wide">Editor shortcuts</div>
              <div className="space-y-1.5">
                {[
                  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
                  ['Ctrl+D', 'Duplicate'],
                  ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'],
                  ['Ctrl+A', 'Select all'],
                  ['Ctrl+L', 'Lock / unlock'],
                  ['Ctrl+Alt+S', 'Save a version snapshot'],
                  ['Shift+R', 'Show / hide rulers'],
                  ['V', 'Select tool'],
                  ['Delete', 'Delete selection'],
                  ['Double-click text', 'Edit text inline'],
                  ['Double-click layer', 'Rename a layer'],
                  ['Space + drag', 'Pan the canvas'],
                  ['Drag empty canvas', 'Marquee select'],
                  ['Drag from ruler', 'Pull out a guide'],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-[12px]">
                    <span className="text-white/70">{v}</span>
                    <kbd className="text-[10px] font-semibold bg-white/[0.08] border border-white/10 rounded-md px-2 py-1">{k}</kbd>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[12px] font-bold text-white/85 mb-2 uppercase tracking-wide">Where things live</div>
              <ul className="text-[12px] text-white/70 space-y-1.5 leading-relaxed">
                <li>· <b className="text-white/90">Templates / Elements / Text</b> — left rail in the editor</li>
                <li>· <b className="text-white/90">Brand</b> — colors, palettes, fonts &amp; logos (saved locally)</li>
                <li>· <b className="text-white/90">Apps</b> — charts, QR codes, icons, palettes &amp; placeholder text</li>
                <li>· <b className="text-white/90">Uploads</b> — drop images onto the canvas anytime</li>
                <li>· <b className="text-white/90">Layers</b> — rename (double-click), reorder, lock &amp; hide</li>
                <li>· <b className="text-white/90">File menu</b> — rulers, version history &amp; downloads</li>
                <li>· <b className="text-white/90">Crop</b> — select an image → Crop button or right-click</li>
              </ul>
            </div>
            <a
              href="https://github.com/mir-ashiq/canvix/discussions"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-[12px] text-[#02C0CC] hover:underline"
            >
              <Github size={13} /> Still stuck? Ask in GitHub discussions
            </a>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Custom size dialog ── */}
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="rounded-[28px] sm:max-w-sm bg-[#16181D] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>Create a custom design</DialogTitle>
            <DialogDescription className="text-white/55">Pick any pixel size — you can resize later.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium" htmlFor="custom-w">Width (px)</label>
              <Input id="custom-w" type="number" min={40} max={8000} value={customW} onChange={(e) => setCustomW(e.target.value)} className="mt-1 bg-white/[0.06] border-white/10 text-white [color-scheme:dark]" />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="custom-h">Height (px)</label>
              <Input id="custom-h" type="number" min={40} max={8000} value={customH} onChange={(e) => setCustomH(e.target.value)} className="mt-1 bg-white/[0.06] border-white/10 text-white [color-scheme:dark]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => setCustomOpen(false)}>Cancel</Button>
            <Button
              className="btn-cv"
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
        <DialogContent className="rounded-[28px] sm:max-w-sm bg-[#16181D] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>Rename design</DialogTitle>
          </DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && doRename()} className="bg-white/[0.06] border-white/10 text-white" />
          <DialogFooter>
            <Button variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button className="btn-cv" onClick={doRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm dialog (moves to Trash) ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="rounded-[28px] sm:max-w-sm bg-[#16181D] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>Delete this design?</DialogTitle>
            <DialogDescription className="text-white/55">
              It will move to your Trash. You can restore it anytime — or delete it forever from there.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteTarget && doDelete(deleteTarget)}>Move to Trash</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
