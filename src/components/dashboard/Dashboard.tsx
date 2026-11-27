'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  AlertTriangle,
  Folder,
  FolderPlus,
  FolderMinus,
  Check,
  Maximize,
  Smartphone,
  Monitor,
  FileSpreadsheet,
  Loader2,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useEditorStore } from '@/store/editor-store'
import { Logo } from '@/components/logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DesignPreview } from '@/components/design-preview'
import { TEMPLATES } from '@/lib/templates'
import { createPage, TEMPLATE_CATEGORIES, type TemplateRecord } from '@/lib/types'
import { PRESET_SIZES, PRESET_GROUPS, type SizePreset } from '@/lib/editor-utils'
import { parseCsv, csvToFieldRows, fillTemplateFields } from '@/lib/templates/fields'
import { cn } from '@/lib/utils'
import {
  ApiError,
  createDesign,
  createFolder,
  deleteDesign,
  deleteDesignForever,
  deleteFolder,
  duplicateDesign,
  fetchDesign,
  listTrash,
  moveDesignToFolder,
  renameDesign,
  renameFolder,
  restoreDesign,
  timeAgo,
  useDesigns,
  useFolders,
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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

/** v0.26 performance: render children only once the placeholder scrolls
 *  near the viewport. The home page mounts ~370 template cards, each a
 *  full Konva stage — mounting them all at once was the 5–6 s "template
 *  grid takes forever" jank. One shared IntersectionObserver, a cheap
 *  div placeholder, and a generous 600 px rootMargin so cards are ready
 *  BEFORE the user scrolls to them (no visible pop-in on normal scroll
 *  speeds). Falls back to eager rendering when IO is unavailable. */
function LazyCard({ children, minHeight = 180 }: { children: React.ReactNode; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  // lazy init in the state ctor — renders eagerly when IO is unavailable;
  // otherwise starts hidden and flips visible from the observer callback
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (visible) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible])
  return (
    <div ref={ref} style={!visible ? { minHeight } : undefined}>
      {visible ? children : null}
    </div>
  )
}

// v0.17 (Wave 2): icon per preset group in the “More sizes” browser
const GROUP_ICONS: Record<string, typeof Instagram> = {
  social: Smartphone,
  video: Video,
  docs: Presentation,
  print: Printer,
  web: Monitor,
}

function newBlankPages() {
  return [createPage()]
}

/** v0.8: translate server-side DB trouble into a toast that says what to DO
 *  (the #1 confusion after switching database hosts, e.g. Neon → Supabase). */
function apiErrorToast(error: unknown, fallbackTitle: string) {
  if (error instanceof ApiError) {
    const detail =
      error.code === 'DB_NOT_MIGRATED'
        ? ' — run  npm run db:setup  once'
        : error.code === 'DB_UNREACHABLE'
          ? ' — check DATABASE_URL (see /api/health)'
          : error.fix
            ? ` — ${error.fix}`
            : ''
    toast({ title: `${error.message}${detail}`, variant: 'destructive' })
  } else {
    toast({ title: fallbackTitle, variant: 'destructive' })
  }
}

export function Dashboard() {
  const goLanding = useAppStore((s) => s.goLanding)
  const openEditor = useAppStore((s) => s.openEditor)
  const loadEditorDesign = useEditorStore((s) => s.loadDesign)
  // v0.14 (D6): folder organization — activeFolder null = "كل التصاميم"
  // (the root, the pre-v0.14 view). The designs hook refetches on switch.
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const { designs, loading, refresh, dbIssue, hasMore, loadMore } = useDesigns(activeFolder)
  const { folders, refresh: refreshFolders } = useFolders()
  const isMobile = useIsMobile()
  const [helpOpen, setHelpOpen] = useState(false)

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [customOpen, setCustomOpen] = useState(false)
  const [customW, setCustomW] = useState('1080')
  const [customH, setCustomH] = useState('1080')
  const [creating, setCreating] = useState(false)
  // v0.17 (Wave 2): “More sizes” browser state
  const [sizesOpen, setSizesOpen] = useState(false)
  const [sizeQuery, setSizeQuery] = useState('')
  // v0.17 (Wave 2): CSV bulk fill for smart templates
  const [csvTarget, setCsvTarget] = useState<TemplateRecord | null>(null)
  const [csvText, setCsvText] = useState('')
  const [csvBusy, setCsvBusy] = useState(false)

  const csvParsed = useMemo(() => {
    if (!csvTarget?.fields?.length || !csvText.trim()) return null
    try {
      return csvToFieldRows(parseCsv(csvText), csvTarget.fields.map((f) => f.key))
    } catch (err) {
      return { rows: [], missing: [], error: err instanceof Error ? err.message : 'تعذّر تحليل ملف CSV' }
    }
  }, [csvTarget, csvText])

  const generateCsvDesigns = async () => {
    if (!csvTarget || !csvParsed?.rows.length) return
    setCsvBusy(true)
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(csvTarget.slug)}/fill?persist=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: csvParsed.rows.slice(0, 100) }),
      })
      if (!res.ok) throw new Error('fill failed')
      const body = (await res.json()) as { created?: { id: string }[] }
      toast({ title: `تم إنشاء ${body.created?.length ?? 0} تصميم من «${csvTarget.name}»` })
      setCsvTarget(null)
      setCsvText('')
      await refresh()
    } catch {
      toast({ title: 'تعذّر إنشاء التصاميم دفعة واحدة — جرّب عدداً أقل من الصفوف', variant: 'destructive' })
    } finally {
      setCsvBusy(false)
    }
  }
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  // v0.4: trash + sort
  const [trashOpen, setTrashOpen] = useState(false)
  const [trash, setTrash] = useState<DesignMeta[] | null>(null)
  const [sort, setSort] = useState<'recent' | 'name'>('recent')
  // v0.14 (D6): the create/rename folder dialog (one dialog, two modes)
  const [folderDialog, setFolderDialog] = useState<
    { mode: 'create' } | { mode: 'rename'; id: string; name: string } | null
  >(null)
  const [folderValue, setFolderValue] = useState('')

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
      toast({ title: `تمت استعادة «${name}»` })
    } catch {
      toast({ title: 'تعذّرت استعادة التصميم', variant: 'destructive' })
    }
  }

  const doDeleteForever = async (id: string, name: string) => {
    try {
      await deleteDesignForever(id)
      await refreshTrash()
      toast({ title: `تم حذف «${name}» نهائياً` })
    } catch {
      toast({ title: 'تعذّر حذف التصميم', variant: 'destructive' })
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
        ...(t.fields ? { fields: t.fields } : {}),
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
  // v0.14 (D6): anything created from this dashboard is born inside the
  // folder the user is currently viewing (null = the root)
  const startBlank = async (w: number, h: number, name?: string) => {
    setCreating(true)
    try {
      const record = await createDesign({
        name: name ?? 'تصميم بلا عنوان',
        width: w,
        height: h,
        pages: newBlankPages(),
        folderId: activeFolder,
      })
      openEditor(record)
      loadEditorDesign(record)
    } catch (error) {
      apiErrorToast(error, 'تعذّر إنشاء التصميم')
    } finally {
      setCreating(false)
    }
  }

  const startFromTemplate = async (t: TemplateRecord) => {
    setCreating(true)
    try {
      // v0.17 (Wave 2): smart templates open with their EXAMPLE values —
      // raw {{markers}} never reach the canvas from the dashboard (the
      // editor panel offers the guided fill dialog, CSV does bulk).
      const exampleValues = Object.fromEntries((t.fields ?? []).map((f) => [f.key, f.example]))
      const pages = t.fields?.length ? fillTemplateFields(t.pages, exampleValues) : t.pages
      const record = await createDesign({
        name: t.name,
        width: t.width,
        height: t.height,
        pages,
        source: `template:${t.slug}`,
        folderId: activeFolder,
      })
      openEditor(record)
      loadEditorDesign(record)
    } catch (error) {
      // v0.8: “Could not open template” now explains itself (migration/host
      // switch issues include the exact fix instead of a dead end).
      apiErrorToast(error, 'تعذّر فتح القالب')
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
      toast({ title: 'تعذّر فتح التصميم', variant: 'destructive' })
    }
  }

  const doDuplicate = async (d: DesignMeta) => {
    try {
      // v0.14 (D6): the copy stays in the design's folder — but only when
      // that folder is one of the caller's own (foreign folders 404)
      const mineFolder =
        d.folderId && (folders ?? []).some((f) => f.id === d.folderId) ? d.folderId : null
      await duplicateDesign(d.id, mineFolder)
      await Promise.all([refresh(), refreshFolders()])
      toast({ title: 'تم نسخ التصميم' })
    } catch {
      toast({ title: 'تعذّر نسخ التصميم', variant: 'destructive' })
    }
  }

  const doDelete = async (id: string) => {
    setDeleteTarget(null)
    try {
      await deleteDesign(id)
      await refresh()
      toast({ title: 'تم حذف التصميم' })
    } catch {
      toast({ title: 'تعذّر حذف التصميم', variant: 'destructive' })
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
      toast({ title: 'تعذّرت إعادة تسمية التصميم', variant: 'destructive' })
    }
  }

  // ── v0.14 (D6): folder actions ──────────────────────────────
  const openCreateFolder = () => {
    setFolderValue('')
    setFolderDialog({ mode: 'create' })
  }

  const openRenameFolder = (id: string, name: string) => {
    setFolderValue(name)
    setFolderDialog({ mode: 'rename', id, name })
  }

  const doFolderSubmit = async () => {
    if (!folderDialog) return
    const dialog = folderDialog
    const name = folderValue.trim()
    setFolderDialog(null)
    if (!name) return
    try {
      if (dialog.mode === 'create') {
        const folder = await createFolder(name)
        await refreshFolders()
        toast({ title: `تم إنشاء المجلد «${folder.name}»` })
      } else {
        await renameFolder(dialog.id, name)
        await refreshFolders()
        toast({ title: 'تمت إعادة تسمية المجلد' })
      }
    } catch (error) {
      apiErrorToast(error, 'تعذّر حفظ المجلد')
    }
  }

  const doDeleteFolder = async (id: string, name: string) => {
    const ok = window.confirm(
      `هل تريد حذف المجلد «${name}»؟\n\nلن تُحذف التصاميم الموجودة داخله، بل ستعود إلى كل التصاميم.`,
    )
    if (!ok) return
    try {
      await deleteFolder(id)
      if (activeFolder === id) setActiveFolder(null)
      await Promise.all([refreshFolders(), refresh()])
      toast({ title: `تم حذف المجلد «${name}» — التصاميم موجودة ضمن كل التصاميم` })
    } catch {
      toast({ title: 'تعذّر حذف المجلد', variant: 'destructive' })
    }
  }

  const doMoveDesign = async (id: string, folderId: string | null, name: string) => {
    try {
      await moveDesignToFolder(id, folderId)
      await Promise.all([refresh(), refreshFolders()])
      toast({
        title: folderId
          ? `تم نقل «${name}» إلى «${(folders ?? []).find((f) => f.id === folderId)?.name ?? 'مجلد'}`
          : `تم نقل «${name}» إلى كل التصاميم`,
      })
    } catch (error) {
      apiErrorToast(error, 'تعذّر نقل التصميم')
    }
  }

  return (
    <div className="min-h-screen flex bg-[#1F142E] text-[#EDEEF2]">
      {/* ── Canva-style left rail (desktop) ── */}
      <nav className="hidden md:flex w-[72px] shrink-0 flex-col items-center bg-[#1C1229] border-r border-white/[0.06] py-3 gap-1 sticky top-0 h-screen" aria-label="التنقل الرئيسي">
        <button
          onClick={() => setCustomOpen(true)}
          className="h-9 w-9 rounded-full bg-[#7630D7] hover:bg-[#8B5CF6] text-white flex items-center justify-center shadow-lg shadow-[#7630D7]/40 transition-colors"
          aria-label="إنشاء تصميم"
          title="إنشاء تصميم"
        >
          <Plus size={20} />
        </button>
        <div className="h-3" />
        {[
          { label: 'الرئيسية', icon: LayoutGrid, active: true },
          { label: 'القوالب', icon: LayoutTemplate, target: 'templates' },
          { label: 'المشاريع', icon: FolderOpen, target: 'recents' },
          { label: 'الهوية', icon: BookMarked, target: 'brand' },
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
            href="https://github.com/TEaG3/eng-salman"
            target="_blank"
            rel="noreferrer"
            className="w-9 h-9 rounded-full text-white/50 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
            aria-label="مستودع GitHub"
            title="مستودع GitHub"
          >
            <Github size={18} />
          </a>
          <button
            onClick={goLanding}
            className="h-9 w-9 rounded-full cv-topbar-gradient text-white text-[13px] font-bold flex items-center justify-center"
            aria-label="حول TEa.G3"
            title="حول TEa.G3"
          >
            C
          </button>
        </div>
      </nav>

      <div className="flex-1 min-w-0 flex flex-col">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#1F142E]/90 backdrop-blur-lg">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center gap-3">
          <button onClick={goLanding} aria-label="الصفحة الرئيسية لـ TEa.G3" className="shrink-0 md:hidden">
            <Logo size={26} />
          </button>
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث في تصاميمك"
              className="pl-10 h-10 rounded-full bg-white/[0.06] border-white/10 text-white placeholder:text-white/35 focus-visible:ring-[#7630D7]/50 focus-visible:border-[#7630D7]/60"
              aria-label="البحث في التصاميم"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              className="btn-cv rounded-full px-4 gap-1.5 h-10"
              onClick={() => setCustomOpen(true)}
            >
              <Plus size={16} /> <span className="hidden sm:inline">مقاس مخصص</span>
            </Button>
            <button
              onClick={() => setHelpOpen(true)}
              className="h-10 w-10 rounded-full bg-white/[0.06] border border-white/10 text-white/75 flex items-center justify-center shrink-0 hover:bg-white/10 transition-colors"
              aria-label="المساعدة"
              title="المساعدة والاختصارات"
            >
              <CircleHelp size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 pb-20">
        {/* ── Hero — canva “What will you design today?” ── */}
        <section className="pt-8 pb-2">
          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-center">
            ما الذي تريد <span className="text-brand-gradient">تصميمه</span> اليوم؟
          </h1>
          <p className="mt-2 text-center text-sm text-white/50">مجاني ومفتوح المصدر، ويبقى لك دائماً.</p>
        </section>

        {/* ── Start a new design ── */}
        <section className="pt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">ابدأ تصميماً جديداً</h2>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-3">
            {PRESET_SIZES.map((preset, i) => {
              const Icon = PRESET_ICONS[i % PRESET_ICONS.length]
              return (
                <button
                  key={preset.name}
                  onClick={() => startBlank(preset.width, preset.height, preset.name)}
                  disabled={creating}
                  className="group flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-[#16171D] p-4 hover:border-[#7630D7]/60 hover:bg-[#1C1E28] transition-all disabled:opacity-50"
                  aria-label={`إنشاء ${preset.name}`}
                >
                  <span className="h-10 w-10 rounded-xl bg-brand-gradient-soft text-[#A78BFA] flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Icon size={19} />
                  </span>
                  <span className="text-[13px] font-semibold text-center leading-tight">{preset.name}</span>
                  <span className="text-[11px] text-white/40">{preset.hint}</span>
                </button>
              )
            })}
            <button
              onClick={() => { setSizesOpen(true); setSizeQuery('') }}
              disabled={creating}
              className="group flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/20 bg-transparent p-4 hover:border-[#7630D7]/60 hover:bg-[#1C1E28] transition-all disabled:opacity-50"
              aria-label="استعراض جميع مقاسات التصميم"
            >
              <span className="h-10 w-10 rounded-xl bg-brand-gradient-soft text-[#A78BFA] flex items-center justify-center group-hover:scale-110 transition-transform">
                <Maximize size={19} />
              </span>
              <span className="text-[13px] font-semibold text-center leading-tight">مقاسات أخرى</span>
              <span className="text-[11px] text-white/40">أكثر من 60 مقاساً جاهزاً</span>
            </button>
          </div>
        </section>

        {/* ── Templates ── */}
        <section id="cv-templates" className="pt-12 scroll-mt-20">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-xl font-bold">القوالب</h2>
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
                <LayoutGrid size={14} /> الكل
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
              <LazyCard key={t.slug}>
                <button
                  onClick={() => startFromTemplate(t)}
                  disabled={creating}
                  className="group text-left w-full"
                  aria-label={`فتح القالب ${t.name}`}
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
                    {/* v0.17 (Wave 2): smart templates offer CSV bulk fill */}
                    {t.fields?.length ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setCsvTarget(t); setCsvText('') }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setCsvTarget(t); setCsvText('') } }}
                        className="absolute top-2 left-2 h-7 px-2 rounded-full bg-[#02C0CC] text-[#083344] text-[10px] font-bold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        title="إنشاء تصاميم متعددة من ملف CSV"
                      >
                        <FileSpreadsheet size={12} /> CSV
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 text-sm font-medium truncate text-white/85 group-hover:text-[#A78BFA] transition-colors">{t.name}</div>
                  <div className="text-xs text-white/40">{t.width} × {t.height}</div>
                </button>
              </LazyCard>
            ))}
          </div>
        </section>

        {/* ── Brand kit ── */}
        <section id="cv-brand" className="pt-12 scroll-mt-20">
          <h2 className="text-xl font-bold">هوية العلامة التجارية</h2>
          <div className="mt-4 rounded-2xl border border-white/10 bg-[#16171D] p-5 flex flex-col sm:flex-row items-center gap-6">
            <div className="flex gap-2">
              {(['#7630D7', '#02C0CC', '#FF5C8A', '#1F142E', '#FFD166'] as const).map((c) => (
                <span key={c} className="h-10 w-10 rounded-xl border border-white/15" style={{ background: c }} aria-label={`لون الهوية ${c}`} />
              ))}
            </div>
            <div className="flex-1 text-center sm:text-left">
              <div className="text-sm font-semibold">اضبط ألوان الهوية وخطوطها من المحرر</div>
              <div className="text-xs text-white/40 mt-0.5">افتح أي تصميم ← تبويب الهوية. تُحفظ محلياً وتُطبّق في أي تصميم.</div>
            </div>
            <Button
              variant="outline"
              className="rounded-xl border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white"
              onClick={() => {
                const first = filteredDesigns[0] ?? null
                if (first) void openDesign(first.id)
                else toast({ title: 'افتح تصميماً أولاً، ثم اختر تبويب الهوية' })
              }}
            >
              Open editor
            </Button>
          </div>
        </section>

        {/* ── AI agents (MCP) ── */}
        {/* Account-based MCP tokens are disabled in the anonymous web-app release. */}

        {/* ── v0.8: database setup banner (host switch / missing migration) ── */}
        {dbIssue && (
          <section className="mt-6 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 flex items-start gap-3">
            <AlertTriangle className="size-5 text-amber-300 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-amber-200">تحتاج قاعدة البيانات إلى معالجة</p>
              <p className="text-white/70 mt-1">
                Designs and templates can’t be saved until the database is set up on this host.
                Run <code className="rounded bg-black/40 px-1.5 py-0.5 text-amber-200">npm run db:setup</code> in the project
                (migrations + template seed), then reload. Full diagnosis:{' '}
                <a href="/api/health" target="_blank" rel="noreferrer" className="underline text-amber-200 hover:text-amber-100">
                  /api/health
                </a>
              </p>
            </div>
          </section>
        )}

        {/* ── Recent designs ── */}
        <section id="cv-recents" className="pt-12 scroll-mt-20">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-xl font-bold">
              {activeFolder
                ? (folders ?? []).find((f) => f.id === activeFolder)?.name ?? 'مجلد'
                : 'التصاميم الأخيرة'}
            </h2>
            {/* v0.4: canva-style sort control */}
            <div className="flex items-center gap-1 rounded-full border border-white/10 p-0.5" role="group" aria-label="ترتيب التصاميم">
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
                  {mode === 'recent' ? 'الأحدث' : 'الاسم'}
                </button>
              ))}
            </div>
          </div>

          {/* v0.14 (D6): folder chips — All designs + the caller's folders. */}
          <div className="mt-3 flex items-center gap-2 flex-wrap" role="group" aria-label="مجلدات التصاميم">
            <button
              onClick={() => setActiveFolder(null)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium border transition-colors',
                activeFolder === null
                  ? 'bg-[#7630D7] text-white border-transparent'
                  : 'bg-transparent border-white/12 text-white/60 hover:border-white/30 hover:text-white'
              )}
              aria-pressed={activeFolder === null}
            >
              <LayoutGrid size={14} /> جميع التصاميم
            </button>
            {(folders ?? []).map((f) => (
              <span
                key={f.id}
                className={cn(
                  'inline-flex items-center rounded-full border transition-colors',
                  activeFolder === f.id
                    ? 'bg-[#7630D7] text-white border-transparent'
                    : 'bg-transparent border-white/12 text-white/60 hover:border-white/30',
                )}
              >
                <button
                  onClick={() => setActiveFolder(f.id)}
                  className="inline-flex items-center gap-1.5 rounded-l-full pl-3.5 py-1.5 pr-1.5 text-sm font-medium hover:text-white transition-colors"
                  aria-pressed={activeFolder === f.id}
                  aria-label={`فتح المجلد ${f.name}`}
                >
                  <Folder size={14} /> {f.name}
                  <span className="text-xs text-white/40">{f.designCount}</span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-r-full text-white/50 hover:bg-white/10 hover:text-white"
                      aria-label={`خيارات المجلد ${f.name}`}
                    >
                      <MoreHorizontal size={13} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-40 bg-[#16181D] border-white/10 text-white">
                    <DropdownMenuItem onClick={() => openRenameFolder(f.id, f.name)}>
                      <Pencil size={14} className="mr-2" /> إعادة تسمية
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => void doDeleteFolder(f.id, f.name)}>
                      <Trash2 size={14} className="mr-2" /> حذف المجلد
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            ))}
            <button
              onClick={openCreateFolder}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium border border-dashed border-white/20 text-white/50 hover:border-white/40 hover:text-white transition-colors"
              aria-label="مجلد جديد"
            >
              <FolderPlus size={14} /> مجلد جديد
            </button>
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
                {activeFolder ? <Folder size={24} /> : <Plus size={24} />}
              </div>
              <p className="mt-4 font-semibold">{activeFolder ? 'هذا المجلد فارغ' : 'لا توجد تصاميم بعد'}</p>
              <p className="mt-1 text-sm text-white/45">
                {activeFolder
                  ? 'افتح قائمة ⋯ للتصميم واختر «نقل إلى مجلد»، أو أنشئ تصميماً جديداً ليظهر هنا.'
                  : 'اختر مقاساً جاهزاً أو قالباً من الأعلى للبدء.'}
              </p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {filteredDesigns.map((d) => (
                <div key={d.id} className="group">
                  <button
                    onClick={() => openDesign(d.id)}
                    className="relative block w-full rounded-xl overflow-hidden border border-white/10 shadow-lg shadow-black/30 group-hover:shadow-xl group-hover:-translate-y-0.5 transition-all bg-[#0F1015]"
                    style={{ aspectRatio: `${d.width} / ${d.height}` }}
                    aria-label={`فتح ${d.name}`}
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
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg shrink-0 text-white/60 hover:bg-white/10 hover:text-white" aria-label={`خيارات ${d.name}`}>
                          <MoreHorizontal size={15} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44 bg-[#16181D] border-white/10 text-white">
                        <DropdownMenuItem onClick={() => openDesign(d.id)}>
                          <Pencil size={14} className="mr-2" /> فتح
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setRenameTarget({ id: d.id, name: d.name }); setRenameValue(d.name) }}>
                          <Pencil size={14} className="mr-2" /> إعادة تسمية
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void doDuplicate(d)}>
                          <Copy size={14} className="mr-2" /> إنشاء نسخة
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger className="gap-2">
                            <Folder size={14} /> نقل إلى مجلد
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="w-44 bg-[#16181D] border-white/10 text-white">
                            {(folders ?? []).length === 0 ? (
                              <DropdownMenuItem disabled>
                                Create a folder first — “New folder” above
                              </DropdownMenuItem>
                            ) : (
                              (folders ?? []).map((f) => (
                                <DropdownMenuItem
                                  key={f.id}
                                  onClick={() => void doMoveDesign(d.id, f.id, d.name)}
                                  className="gap-2"
                                >
                                  {d.folderId === f.id ? (
                                    <Check size={14} className="text-[#A78BFA]" />
                                  ) : (
                                    <span className="w-[14px]" />
                                  )}
                                  <span className="truncate">{f.name}</span>
                                </DropdownMenuItem>
                              ))
                            )}
                            {d.folderId && (
                              <>
                                <DropdownMenuSeparator className="bg-white/10" />
                                <DropdownMenuItem onClick={() => void doMoveDesign(d.id, null, d.name)}>
                                  <FolderMinus size={14} className="mr-2" /> إزالة من المجلد
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => setDeleteTarget(d.id)}>
                          <Trash2 size={14} className="mr-2" /> حذف
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
          {hasMore && !loading && (
            <div className="mt-6 flex justify-center">
              <Button
                variant="outline"
                className="rounded-full px-6 gap-2 border-white/15 text-white/80 hover:bg-white/10 hover:text-white"
                onClick={() => void loadMore()}
              >
                Load more designs
              </Button>
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
            <h2 className="text-xl font-bold group-hover:text-[#A78BFA] transition-colors">سلة المحذوفات</h2>
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
                            aria-label={`استعادة ${d.name}`}
                            title="استعادة"
                          >
                            <RotateCcw size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-lg text-white/60 hover:bg-red-500/15 hover:text-red-400"
                            onClick={() => void doDeleteForever(d.id, d.name)}
                            aria-label={`حذف ${d.name} نهائياً`}
                            title="حذف نهائي"
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
            <span>© 2026 · رخصة MIT</span>
          </div>
          <a
            href="https://github.com/TEaG3/eng-salman"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 hover:text-white/80 transition-colors"
          >
            <Github size={14} /> {isMobile ? 'GitHub' : 'github.com/TEaG3/eng-salman'}
          </a>
        </div>
      </footer>
      </div>{/* end flex-1 column */}

      {/* ── Canva-style “Get help” FAB ── */}
      <button
        onClick={() => setHelpOpen(true)}
        className="fixed bottom-5 right-5 z-50 h-12 w-12 rounded-full bg-[#7630D7] hover:bg-[#8B5CF6] text-white flex items-center justify-center shadow-xl shadow-[#7630D7]/40 transition-colors"
        aria-label="الحصول على المساعدة"
        title="الحصول على المساعدة"
      >
        <CircleHelp size={22} />
      </button>

      {/* ── Help & shortcuts modal ── */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="rounded-[28px] sm:max-w-md bg-[#16181D] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CircleHelp size={18} className="text-[#02C0CC]" /> المساعدة والاختصارات
            </DialogTitle>
            <DialogDescription className="text-white/55">كل ما تحتاجه لتصميم أسرع.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto cv-scroll-dark">
            <div>
              <div className="text-[12px] font-bold text-white/85 mb-2 uppercase tracking-wide">اختصارات المحرر</div>
              <div className="space-y-1.5">
                {[
                  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
                  ['Ctrl+D', 'إنشاء نسخة'],
                  ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'],
                  ['Ctrl+A', 'Select all'],
                  ['Ctrl+L', 'Lock / unlock'],
                  ['Ctrl+Alt+S', 'Save a version snapshot'],
                  ['Shift+R', 'Show / hide rulers'],
                  ['V', 'Select tool'],
                  ['حذف', 'Delete selection'],
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
              <div className="text-[12px] font-bold text-white/85 mb-2 uppercase tracking-wide">دليل أقسام المحرر</div>
              <ul className="text-[12px] text-white/70 space-y-1.5 leading-relaxed">
                <li>· <b className="text-white/90">القوالب / العناصر / النص</b> — الشريط الجانبي في المحرر</li>
                <li>· <b className="text-white/90">الهوية</b> — الألوان ولوحات الألوان والخطوط والشعارات (تُحفظ محلياً)</li>
                <li>· <b className="text-white/90">التطبيقات</b> — المخططات ورموز QR والأيقونات ولوحات الألوان والنصوص التجريبية</li>
                <li>· <b className="text-white/90">الملفات المرفوعة</b> — أضف الصور إلى مساحة العمل في أي وقت</li>
                <li>· <b className="text-white/90">الطبقات</b> — إعادة التسمية (بالنقر المزدوج) والترتيب والقفل والإخفاء</li>
                <li>· <b className="text-white/90">قائمة ملف</b> — المساطر وسجل الإصدارات والتنزيلات</li>
                <li>· <b className="text-white/90">القص</b> — حدّد صورة ثم اختر زر القص أو انقر بزر الفأرة الأيمن</li>
              </ul>
            </div>
            <a
              href="https://github.com/TEaG3/eng-salman/discussions"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-[12px] text-[#02C0CC] hover:underline"
            >
              <Github size={13} /> هل تحتاج إلى مساعدة إضافية؟ اطرح سؤالك في نقاشات GitHub
            </a>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Custom size dialog ── */}
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="rounded-[28px] sm:max-w-sm bg-[#16181D] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>إنشاء تصميم بمقاس مخصص</DialogTitle>
            <DialogDescription className="text-white/55">اختر أي مقاس بالبكسل، ويمكنك تغييره لاحقاً.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium" htmlFor="custom-w">العرض (بكسل)</label>
              <Input id="custom-w" type="number" min={40} max={8000} value={customW} onChange={(e) => setCustomW(e.target.value)} className="mt-1 bg-white/[0.06] border-white/10 text-white [color-scheme:dark]" />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="custom-h">الارتفاع (بكسل)</label>
              <Input id="custom-h" type="number" min={40} max={8000} value={customH} onChange={(e) => setCustomH(e.target.value)} className="mt-1 bg-white/[0.06] border-white/10 text-white [color-scheme:dark]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => setCustomOpen(false)}>إلغاء</Button>
            <Button
              className="btn-cv"
              onClick={() => {
                const w = parseInt(customW, 10)
                const h = parseInt(customH, 10)
                if (!Number.isFinite(w) || !Number.isFinite(h) || w < 40 || h < 40 || w > 8000 || h > 8000) {
                  toast({ title: 'يجب أن يكون المقاس بين 40 و8000 بكسل', variant: 'destructive' })
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

      {/* ── v0.17 (Wave 2): full preset browser ── */}
      <Dialog open={sizesOpen} onOpenChange={setSizesOpen}>
        <DialogContent className="rounded-[28px] sm:max-w-2xl bg-[#16181D] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>جميع مقاسات التصميم</DialogTitle>
            <DialogDescription className="text-white/55">
              {PRESET_GROUPS.reduce((n, g) => n + g.presets.length, 0)} مقاساً جاهزاً ضمن خمس فئات — أو{' '}
              <button className="text-[#A78BFA] underline" onClick={() => { setSizesOpen(false); setCustomOpen(true) }}>
                create a custom size
              </button>
              .
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 h-10 rounded-xl bg-white/[0.06] border border-white/10 px-3">
            <Search size={15} className="text-white/40 shrink-0" />
            <input
              value={sizeQuery}
              onChange={(e) => setSizeQuery(e.target.value)}
              className="bg-transparent outline-none text-sm text-white w-full placeholder:text-white/35"
              placeholder="ابحث عن مقاس — جرّب قصة أو A4 أو شعاراً…"
              aria-label="البحث عن مقاسات التصميم"
            />
          </div>
          <div className="max-h-[52vh] overflow-y-auto cv-scroll pr-1 -mr-1">
            {PRESET_GROUPS.map((group) => {
              const q = sizeQuery.trim().toLowerCase()
              const presets = q
                ? group.presets.filter((p) => p.name.toLowerCase().includes(q) || p.hint.toLowerCase().includes(q))
                : group.presets
              if (!presets.length) return null
              const Icon = GROUP_ICONS[group.id] ?? Square
              return (
                <div key={group.id} className="mb-4 last:mb-0">
                  <h4 className="flex items-center gap-1.5 text-[11px] font-bold text-white/45 uppercase tracking-wide mb-2">
                    <Icon size={12} /> {group.label}
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {presets.map((p: SizePreset) => (
                      <button
                        key={group.id + p.name}
                        onClick={() => {
                          setSizesOpen(false)
                          void startBlank(p.width, p.height, p.name)
                        }}
                        disabled={creating}
                        className="flex flex-col items-start gap-0.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 hover:border-[#7630D7]/60 hover:bg-[#7630D7]/10 transition-all text-left disabled:opacity-50"
                        aria-label={`Create ${p.name} (${p.hint})`}
                      >
                        <span className="text-[12px] font-semibold text-white/90 truncate w-full">{p.name}</span>
                        <span className="text-[10px] text-white/40">{p.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
            {sizeQuery.trim() && !PRESET_GROUPS.some((g) => g.presets.some((p) => p.name.toLowerCase().includes(sizeQuery.trim().toLowerCase()))) && (
              <p className="text-center text-sm text-white/40 py-6">
                No size matches “{sizeQuery}” —{' '}
                <button className="text-[#A78BFA] underline" onClick={() => { setSizesOpen(false); setCustomOpen(true) }}>
                  create a custom size
                </button>
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── v0.17 (Wave 2): CSV bulk fill for smart templates ── */}
      <Dialog open={!!csvTarget} onOpenChange={(open) => { if (!open) setCsvTarget(null) }}>
        <DialogContent className="rounded-[28px] sm:max-w-md bg-[#16181D] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet size={16} className="text-[#02C0CC]" /> Bulk-fill “{csvTarget?.name}”
            </DialogTitle>
            <DialogDescription className="text-white/55">
              Upload a CSV whose header row names the fields — one design is created per data row (up to 100).
            </DialogDescription>
          </DialogHeader>

          {csvTarget?.fields?.length ? (
            <>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[11px] font-bold text-white/45 uppercase tracking-wide mb-1.5">الأعمدة المطلوبة</div>
                <div className="flex gap-1.5 flex-wrap">
                  {csvTarget.fields.map((f) => (
                    <code key={f.key} className="text-[11px] px-2 py-0.5 rounded-md bg-[#02C0CC]/10 border border-[#02C0CC]/25 text-[#7DE9E1]">{f.key}</code>
                  ))}
                </div>
                <button
                  className="mt-2 text-[11px] text-[#A78BFA] hover:underline"
                  onClick={() => {
                    const header = csvTarget.fields!.map((f) => f.key).join(',')
                    const sample = csvTarget.fields!.map((f) => f.example.replace(/[,"\n]/g, ' ')).join(',')
                    setCsvText(`${header}\n${sample}\n`)
                  }}
                >
                  Insert a sample CSV
                </button>
              </div>

              <input
                type="file"
                accept=".csv,text/csv"
                className="block w-full text-sm text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-[#7630D7] file:px-3 file:py-1.5 file:text-white file:text-xs file:font-semibold cursor-pointer"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (file) setCsvText(await file.text())
                  e.target.value = ''
                }}
                aria-label="Upload CSV file"
              />
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                rows={5}
                className="w-full rounded-xl bg-white/[0.06] border border-white/10 px-3 py-2 text-[12px] font-mono text-white outline-none focus:border-[#7630D7] placeholder:text-white/30"
                placeholder={'…or paste CSV here\nname,date\nAda,2026-03-14'}
                aria-label="CSV content"
              />

              {csvParsed && 'error' in csvParsed && csvParsed.error ? (
                <p className="text-[12px] text-red-300">{csvParsed.error}</p>
              ) : csvParsed ? (
                <p className="text-[12px] text-white/60">
                  {csvParsed.rows.length} row{csvParsed.rows.length === 1 ? '' : 's'} detected
                  {csvParsed.missing.length > 0 && (
                    <span className="text-amber-300"> · missing columns: {csvParsed.missing.join(', ')}</span>
                  )}
                </p>
              ) : null}
            </>
          ) : null}

          <DialogFooter>
            <Button variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => setCsvTarget(null)}>
              Cancel
            </Button>
            <Button className="btn-cv" disabled={!csvParsed?.rows.length || csvBusy} onClick={() => void generateCsvDesigns()}>
              {csvBusy ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
              Generate {Math.min(csvParsed?.rows.length ?? 0, 100)} design{Math.min(csvParsed?.rows.length ?? 0, 100) === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rename dialog ── */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="rounded-[28px] sm:max-w-sm bg-[#16181D] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>إعادة تسمية التصميم</DialogTitle>
          </DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && doRename()} className="bg-white/[0.06] border-white/10 text-white" />
          <DialogFooter>
            <Button variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => setRenameTarget(null)}>إلغاء</Button>
            <Button className="btn-cv" onClick={doRename}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm dialog (moves to Trash) ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="rounded-[28px] sm:max-w-sm bg-[#16181D] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>هل تريد حذف هذا التصميم؟</DialogTitle>
            <DialogDescription className="text-white/55">
              It will move to your Trash. You can restore it anytime — or delete it forever from there.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button variant="destructive" onClick={() => deleteTarget && doDelete(deleteTarget)}>نقل إلى سلة المحذوفات</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── v0.14 (D6): create / rename folder dialog ── */}
      <Dialog open={!!folderDialog} onOpenChange={(open) => !open && setFolderDialog(null)}>
        <DialogContent className="rounded-[28px] sm:max-w-sm bg-[#16181D] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>{folderDialog?.mode === 'rename' ? 'إعادة تسمية المجلد' : 'مجلد جديد'}</DialogTitle>
            {folderDialog?.mode === 'create' && (
              <DialogDescription className="text-white/55">
                Folders organize your designs — deleting one never deletes the designs inside.
              </DialogDescription>
            )}
          </DialogHeader>
          <Input
            value={folderValue}
            onChange={(e) => setFolderValue(e.target.value)}
            autoFocus
            maxLength={60}
            placeholder="اسم المجلد"
            onKeyDown={(e) => e.key === 'Enter' && void doFolderSubmit()}
            className="bg-white/[0.06] border-white/10 text-white"
            aria-label="اسم المجلد"
          />
          <DialogFooter>
            <Button variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => setFolderDialog(null)}>إلغاء</Button>
            <Button className="btn-cv" onClick={() => void doFolderSubmit()}>
              {folderDialog?.mode === 'rename' ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
