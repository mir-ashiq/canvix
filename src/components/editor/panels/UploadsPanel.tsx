'use client'

import { useRef, useState } from 'react'
import { Upload, Trash2, ImageIcon, Replace, Wallpaper, Music, Film, Loader2 } from 'lucide-react'
import { addImageFromFile, addImageFromSrc, readImageFile, replaceSelectedImage, addAudioFromFile, addVideoFromFile } from '../add-element'
import { createImageElement } from '@/lib/types'
import { useEditorStore } from '@/store/editor-store'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// session-level upload gallery (per editor session, not persisted)
interface UploadItem {
  src: string
  w: number
  h: number
}

const uploadGallery: { items: UploadItem[] } = { items: [] }

/** v0.11: in-flight media uploads (audio/video) shown with progress */
interface MediaUpload {
  key: string
  name: string
  kind: 'audio' | 'video'
  ratio: number
  failed?: boolean
}

export function UploadsPanel() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [, force] = useState(0)
  const [mediaUploads, setMediaUploads] = useState<MediaUpload[]>([])
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const pages = useEditorStore((s) => s.pages)
  const currentPage = useEditorStore((s) => s.currentPage)
  const hasImageSelected = pages[currentPage].elements.some(
    (e) => selectedIds.includes(e.id) && e.type === 'image'
  )

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    let ok = 0
    const media: File[] = []
    for (const file of Array.from(files)) {
      if (file.type.startsWith('audio/') || file.type.startsWith('video/')) {
        media.push(file)
        continue
      }
      try {
        const { src, w, h } = await readImageFile(file)
        uploadGallery.items.unshift({ src, w, h })
        await addImageFromFile(file)
        ok += 1
      } catch {
        // ignore this file
      }
    }
    if (ok > 0) toast({ title: `${ok} image${ok > 1 ? 's' : ''} uploaded` })

    // v0.11: audio/video → media store (chunked) + analysis, with progress
    for (const file of media) {
      const kind: 'audio' | 'video' = file.type.startsWith('audio/') ? 'audio' : 'video'
      const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      setMediaUploads((prev) => [...prev, { key, name: file.name, kind, ratio: 0 }])
      try {
        const add = kind === 'audio' ? addAudioFromFile : addVideoFromFile
        await add(file, (ratio) => {
          setMediaUploads((prev) => prev.map((u) => (u.key === key ? { ...u, ratio } : u)))
        })
        toast({ title: kind === 'audio' ? 'Audio added — open Preview to play it' : 'Video added — open Preview to play it' })
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
  }

  const applyGalleryItem = (item: UploadItem) => {
    if (hasImageSelected) {
      replaceSelectedImage(item.src, item.w, item.h)
      toast({ title: 'Image replaced' })
    } else {
      addImageFromSrc(item.src, item.w, item.h)
    }
  }

  const setAsBackground = (item: UploadItem) => {
    // full-bleed cover image via a page-sized image element locked behind everything
    const state = useEditorStore.getState()
    const ratio = Math.max(state.width / item.w, state.height / item.h)
    const w = Math.round(item.w * ratio)
    const h = Math.round(item.h * ratio)
    state.addElement(
      createImageElement(item.src, item.w, item.h, {
        x: Math.round((state.width - w) / 2),
        y: Math.round((state.height - h) / 2),
        width: w,
        height: h,
      })
    )
    // send to back + lock — a canva background behaves non-interactive
    const el = useEditorStore.getState().pages[useEditorStore.getState().currentPage].elements.at(-1)
    if (el) {
      state.moveLayer(el.id, 'back')
      state.setLock([el.id], true)
    }
    toast({ title: 'Set as background' })
  }

  return (
    <div className="flex flex-col h-full bg-[#16181D] text-[#EDEEF2]">
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.07] shrink-0">
        <h3 className="font-bold text-sm">Uploads</h3>
        <p className="text-xs text-white/50 mt-0.5">
          {hasImageSelected ? 'Click a file to replace the selected image.' : 'Images stay in this browser session.'}
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
          <span className="text-xs">PNG, JPG, SVG, GIF — plus MP3/WAV audio & MP4/WebM video</span>
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
            <h4 className="text-xs font-semibold text-white/50">Media uploads</h4>
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
            <p className="text-[11px] text-white/35 leading-relaxed">
              Audio is analyzed for tempo &amp; beats (Beat Sync). Media plays in Preview / Present mode.
            </p>
          </div>
        )}

        {uploadGallery.items.length > 0 ? (
          <>
            <div className="flex items-center justify-between mt-6 mb-2">
              <h4 className="text-xs font-semibold text-white/50">Session uploads</h4>
              <button
                className="text-xs text-white/50 hover:text-red-400 inline-flex items-center gap-1"
                onClick={() => {
                  uploadGallery.items = []
                  force((n) => n + 1)
                }}
              >
                <Trash2 size={12} /> Clear
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {uploadGallery.items.map((item, i) => (
                <div key={i} className="group relative">
                  <button
                    onClick={() => applyGalleryItem(item)}
                    className={cn(
                      'w-full rounded-lg overflow-hidden border transition-all aspect-square bg-[#0F1015]',
                      hasImageSelected
                        ? 'border-[#02C0CC]/60 hover:border-[#02C0CC]'
                        : 'border-white/10 hover:border-[#7630D7]'
                    )}
                    aria-label={hasImageSelected ? 'Replace selected image' : 'Add uploaded image to canvas'}
                  >
                    <img src={item.src} alt="Uploaded" className="w-full h-full object-cover" />
                  </button>
                  <button
                    onClick={() => setAsBackground(item)}
                    className="absolute bottom-1 right-1 h-7 w-7 rounded-lg bg-black/60 backdrop-blur text-white/90 hidden group-hover:flex items-center justify-center hover:bg-black/80"
                    title="Set image as background"
                    aria-label="Set image as background"
                  >
                    <Wallpaper size={13} />
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="mt-6 flex flex-col items-center py-6 text-white/35">
            <ImageIcon size={28} strokeWidth={1.4} />
            <p className="text-xs mt-2.5 text-center leading-relaxed">No uploads yet.<br />Your images will appear here.</p>
          </div>
        )}
      </div>
    </div>
  )
}
