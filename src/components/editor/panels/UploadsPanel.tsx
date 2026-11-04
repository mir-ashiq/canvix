'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, Trash2, ImageIcon, Replace, Wallpaper, Music, Film, Loader2, Pencil } from 'lucide-react'
import { replaceSelectedImage, addImageFromSrc, addAudioFromLibrary, addVideoFromLibrary, uploadImageToLibrary, addAudioFromFile, addVideoFromFile, probeImageSize } from '../add-element'
import { createImageElement } from '@/lib/types'
import { useEditorStore } from '@/store/editor-store'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { fetchLibrary, renameLibraryItem, removeLibraryItem, formatBytes, type LibraryItem } from '@/lib/media/library-client'

// ── v0.14 (D1): the persistent uploads library ──────────────
// The panel reads the media store (GET /api/media/library) — uploads
// survive reload, follow the account (anon rows are claimed on login),
// and are sha256-deduped server-side. Images insert by served URL;
// audio/video keep their upload-time analysis by probing the blob.
// Removing an item only clears keepInLibrary: designs already using
// it keep working (the GC protects referenced rows).

interface MediaUpload {
  key: string
  name: string
  kind: 'image' | 'audio' | 'video'
  ratio: number
  failed?: boolean
}

export function UploadsPanel() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [mediaUploads, setMediaUploads] = useState<MediaUpload[]>([])
  const [items, setItems] = useState<LibraryItem[] | null>(null)
  const [quota, setQuota] = useState<{ used: number; total: number } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const pages = useEditorStore((s) => s.pages)
  const currentPage = useEditorStore((s) => s.currentPage)
  const hasImageSelected = pages[currentPage].elements.some(
    (e) => selectedIds.includes(e.id) && e.type === 'image'
  )

  const refresh = useCallback(async () => {
    try {
      const lib = await fetchLibrary()
      setItems(lib.items)
      setQuota({ used: lib.usedBytes, total: lib.quotaBytes })
    } catch {
      // offline / 5xx — keep whatever we had; the panel is non-critical
    }
  }, [])

  useEffect(() => {
    // async state updates live in the .then — never synchronously
    // inside the effect body (react-hooks/set-state-in-effect)
    let cancelled = false
    void fetchLibrary()
      .then((lib) => {
        if (cancelled) return
        setItems(lib.items)
        setQuota({ used: lib.usedBytes, total: lib.quotaBytes })
      })
      .catch(() => {
        // offline / 5xx — the panel shows its empty state
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    for (const file of Array.from(files)) {
      const kind = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('audio/')
          ? 'audio'
          : file.type.startsWith('video/')
            ? 'video'
            : null
      if (!kind) continue
      const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      setMediaUploads((prev) => [...prev, { key, name: file.name, kind, ratio: 0 }])
      try {
        if (kind === 'image') {
          // v0.14 (D1): images go to the media store — server bytes,
          // dedupe, quota, library persistence (not document embedding)
          const { src, w, h } = await uploadImageToLibrary(file, (ratio) => {
            setMediaUploads((prev) => prev.map((u) => (u.key === key ? { ...u, ratio } : u)))
          })
          if (hasImageSelected) {
            replaceSelectedImage(src, w, h)
            toast({ title: 'Image replaced' })
          } else {
            addImageFromSrc(src, w, h)
            toast({ title: 'Image uploaded to your library' })
          }
        } else {
          const add = kind === 'audio' ? addAudioFromFile : addVideoFromFile
          await add(file, (ratio) => {
            setMediaUploads((prev) => prev.map((u) => (u.key === key ? { ...u, ratio } : u)))
          })
          toast({ title: kind === 'audio' ? 'Audio added — open Preview to play it' : 'Video added — open Preview to play it' })
        }
      } catch (err) {
        setMediaUploads((prev) => prev.map((u) => (u.key === key ? { ...u, failed: true } : u)))
        toast({
          title: `Could not upload ${kind}`,
          description: err instanceof Error ? err.message.slice(0, 140) : undefined,
          variant: 'destructive',
        })
      } finally {
        setTimeout(() => setMediaUploads((prev) => prev.filter((u) => u.key !== key)), 30_000)
      }
    }
    void refresh()
  }

  const insertItem = async (item: LibraryItem) => {
    try {
      if (item.mime.startsWith('image/')) {
        const { w, h } = await probeImageSize(`/api/media/${item.id}`)
        if (hasImageSelected) {
          replaceSelectedImage(`/api/media/${item.id}`, w, h)
          toast({ title: 'Image replaced' })
        } else {
          addImageFromSrc(`/api/media/${item.id}`, w, h)
        }
      } else if (item.mime.startsWith('audio/')) {
        await addAudioFromLibrary(item.id, item.name ?? 'Audio')
      } else if (item.mime.startsWith('video/')) {
        await addVideoFromLibrary(item.id, item.name ?? 'Video')
      }
    } catch {
      toast({ title: 'Could not insert this file', variant: 'destructive' })
    }
  }

  const setAsBackground = async (item: LibraryItem) => {
    const { w, h } = await probeImageSize(`/api/media/${item.id}`)
    const state = useEditorStore.getState()
    const ratio = Math.max(state.width / w, state.height / h)
    const bw = Math.round(w * ratio)
    const bh = Math.round(h * ratio)
    state.addElement(
      createImageElement(`/api/media/${item.id}`, w, h, {
        x: Math.round((state.width - bw) / 2),
        y: Math.round((state.height - bh) / 2),
        width: bw,
        height: bh,
      })
    )
    const el = useEditorStore.getState().pages[useEditorStore.getState().currentPage].elements.at(-1)
    if (el) {
      state.moveLayer(el.id, 'back')
      state.setLock([el.id], true)
    }
    toast({ title: 'Set as background' })
  }

  const commitRename = async () => {
    if (!renaming) return
    const { id, value } = renaming
    setRenaming(null)
    const trimmed = value.trim().slice(0, 200)
    if (!trimmed) return
    const prev = items
    setItems((cur) => (cur ?? []).map((i) => (i.id === id ? { ...i, name: trimmed } : i)))
    try {
      await renameLibraryItem(id, trimmed)
    } catch {
      setItems(prev)
      toast({ title: 'Could not rename', variant: 'destructive' })
    }
  }

  const removeItem = async (item: LibraryItem) => {
    const prev = items
    const prevQuota = quota
    setItems((cur) => (cur ?? []).filter((i) => i.id !== item.id))
    try {
      await removeLibraryItem(item.id)
      if (prevQuota) setQuota({ ...prevQuota, used: Math.max(0, prevQuota.used - item.size) })
      toast({
        title: 'Removed from your library',
        description: 'Designs already using this file keep working.',
      })
    } catch {
      setItems(prev)
      setQuota(prevQuota)
      toast({ title: 'Could not remove', variant: 'destructive' })
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#16181D] text-[#EDEEF2]">
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.07] shrink-0">
        <h3 className="font-bold text-sm">Uploads</h3>
        <p className="text-xs text-white/50 mt-0.5">
          {hasImageSelected ? 'Click a file to replace the selected image.' : 'Your files follow your account.'}
        </p>
        {hasImageSelected && (
          <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#02C0CC] bg-[#02C0CC]/10 border border-[#02C0CC]/25 rounded-full px-2.5 py-1">
            <Replace size={11} /> Replace mode
          </div>
        )}
      </div>
      <div
        className="flex-1 overflow-y-auto cv-scroll-dark p-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          void handleFiles(e.dataTransfer.files)
        }}
      >
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full rounded-xl border-2 border-dashed border-white/15 hover:border-[#7630D7] hover:bg-[#7630D7]/10 transition-all py-8 flex flex-col items-center gap-2 text-white/50"
          aria-label="Upload images and media"
        >
          <Upload size={22} />
          <span className="text-sm font-medium text-white/80">Click or drag files here</span>
          <span className="text-xs">PNG, JPG, SVG, GIF — plus MP3/WAV audio &amp; MP4/WebM video</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,audio/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files)
            e.target.value = ''
          }}
          aria-label="File upload"
        />

        {mediaUploads.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-white/50">Uploading</h4>
            {mediaUploads.map((u) => (
              <div
                key={u.key}
                className={cn(
                  'rounded-lg border px-3 py-2.5 flex items-center gap-2.5',
                  u.failed ? 'border-red-500/40 bg-red-500/10' : 'border-white/10 bg-white/[0.04]',
                )}
              >
                {u.failed ? (
                  <Film size={16} className="text-red-400 shrink-0" />
                ) : (
                  <Loader2 size={16} className="text-[#02C0CC] shrink-0 animate-spin" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {u.kind === 'audio' ? <Music size={11} className="text-white/50 shrink-0" /> : null}
                    <span className="text-xs truncate text-white/80">{u.name}</span>
                    {u.failed ? <span className="text-[10px] font-semibold text-red-400 shrink-0">failed</span> : null}
                  </div>
                  {!u.failed && (
                    <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#02C0CC] transition-all"
                        style={{ width: `${Math.round(Math.max(0.04, u.ratio) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
                {!u.failed && <span className="text-[10px] text-white/40 shrink-0 tabular-nums">{Math.round(u.ratio * 100)}%</span>}
              </div>
            ))}
          </div>
        )}

        {items === null ? (
          <div className="mt-6 flex flex-col items-center py-6 text-white/35">
            <Loader2 size={22} className="animate-spin" />
            <p className="text-xs mt-2.5">Loading your library…</p>
          </div>
        ) : items.length > 0 ? (
          <>
            <div className="flex items-center justify-between mt-6 mb-2">
              <h4 className="text-xs font-semibold text-white/50">Your library</h4>
              {quota && (
                <span className="text-[10px] text-white/40 tabular-nums">
                  {formatBytes(quota.used)} of {formatBytes(quota.total)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {items.map((item) => {
                const isImage = item.mime.startsWith('image/')
                const isAudio = item.mime.startsWith('audio/')
                return (
                  <div key={item.id} className="group relative">
                    {renaming?.id === item.id ? (
                      <input
                        autoFocus
                        value={renaming.value}
                        onChange={(e) => setRenaming({ id: item.id, value: e.target.value })}
                        onBlur={() => void commitRename()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename()
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        className="w-full rounded-lg border border-[#02C0CC]/60 bg-[#0F1015] px-2 py-1.5 text-xs text-white outline-none"
                        aria-label="Rename file"
                      />
                    ) : (
                      <button
                        onClick={() => void insertItem(item)}
                        className={cn(
                          'w-full rounded-lg overflow-hidden border transition-all aspect-square bg-[#0F1015]',
                          hasImageSelected
                            ? 'border-[#02C0CC]/60 hover:border-[#02C0CC]'
                            : 'border-white/10 hover:border-[#7630D7]'
                        )}
                        title={item.name ?? undefined}
                        aria-label={hasImageSelected ? `Replace selected image with ${item.name ?? 'file'}` : `Add ${item.name ?? 'file'} to canvas`}
                      >
                        {isImage ? (
                          <img src={`/api/media/${item.id}`} alt={item.name ?? 'Uploaded'} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <span className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-white/45">
                            {isAudio ? <Music size={20} strokeWidth={1.5} /> : <Film size={20} strokeWidth={1.5} />}
                            <span className="text-[9px] px-1 text-center leading-tight break-all line-clamp-2">
                              {(item.name ?? 'file').replace(/\.[^.]+$/, '')}
                            </span>
                          </span>
                        )}
                      </button>
                    )}
                    <div className="absolute top-1 right-1 hidden group-hover:flex flex-col gap-1">
                      <button
                        onClick={() => setRenaming({ id: item.id, value: item.name ?? '' })}
                        className="h-6 w-6 rounded-lg bg-black/60 backdrop-blur text-white/90 items-center justify-center hover:bg-black/80 flex"
                        title="Rename"
                        aria-label={`Rename ${item.name ?? 'file'}`}
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={() => void removeItem(item)}
                        className="h-6 w-6 rounded-lg bg-black/60 backdrop-blur text-white/90 items-center justify-center hover:bg-red-600/80 flex"
                        title="Remove from library"
                        aria-label={`Remove ${item.name ?? 'file'} from library`}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    {isImage && (
                      <button
                        onClick={() => void setAsBackground(item)}
                        className="absolute bottom-1 left-1 h-7 w-7 rounded-lg bg-black/60 backdrop-blur text-white/90 hidden group-hover:flex items-center justify-center hover:bg-black/80"
                        title="Set image as background"
                        aria-label="Set image as background"
                      >
                        <Wallpaper size={13} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="mt-3 text-[11px] text-white/35 leading-relaxed">
              Files live in your account — insert them in any design. Removing a file never breaks designs using it.
            </p>
          </>
        ) : (
          <div className="mt-6 flex flex-col items-center py-6 text-white/35">
            <ImageIcon size={28} strokeWidth={1.4} />
            <p className="text-xs mt-2.5 text-center leading-relaxed">No uploads yet.<br />Your files will appear here.</p>
          </div>
        )}
      </div>
    </div>
  )
}
