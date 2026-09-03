'use client'

import { useRef, useState } from 'react'
import { Upload, Trash2, ImageIcon, Replace, Wallpaper } from 'lucide-react'
import { addImageFromFile, addImageFromSrc, readImageFile, replaceSelectedImage } from '../add-element'
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

export function UploadsPanel() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [, force] = useState(0)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const pages = useEditorStore((s) => s.pages)
  const currentPage = useEditorStore((s) => s.currentPage)
  const hasImageSelected = pages[currentPage].elements.some(
    (e) => selectedIds.includes(e.id) && e.type === 'image'
  )

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    let ok = 0
    for (const file of Array.from(files)) {
      try {
        const { src, w, h } = await readImageFile(file)
        uploadGallery.items.unshift({ src, w, h })
        await addImageFromFile(file)
        ok += 1
      } catch {
        // ignore this file
      }
    }
    if (ok === 0) toast({ title: 'Could not upload images', variant: 'destructive' })
    else toast({ title: `${ok} image${ok > 1 ? 's' : ''} uploaded` })
    force((n) => n + 1)
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
          aria-label="Upload images"
        >
          <Upload size={22} />
          <span className="text-sm font-medium text-white/80">Click or drag images here</span>
          <span className="text-xs">PNG, JPG, SVG, GIF — or drop straight onto the canvas</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files)
            e.target.value = ''
          }}
          aria-label="File upload"
        />

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
