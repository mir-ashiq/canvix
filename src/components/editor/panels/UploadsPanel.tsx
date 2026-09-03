'use client'

import { useRef, useState } from 'react'
import { Upload, Trash2 } from 'lucide-react'
import { addImageFromFile, addImageFromSrc } from '../add-element'
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

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    let ok = 0
    for (const file of Array.from(files)) {
      try {
        const src = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(String(r.result))
          r.onerror = () => reject(new Error('read failed'))
          r.readAsDataURL(file)
        })
        const dims = await new Promise<{ w: number; h: number }>((resolve) => {
          const img = new window.Image()
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
          img.onerror = () => resolve({ w: 500, h: 500 })
          img.src = src
        })
        uploadGallery.items.unshift({ src, w: dims.w, h: dims.h })
        await addImageFromFile(file)
        ok += 1
      } catch {
        // ignore this file
      }
    }
    if (ok === 0) toast({ title: 'Could not upload images', variant: 'destructive' })
    force((n) => n + 1)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 border-b border-black/5">
        <h3 className="font-bold text-sm">Uploads</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Images stay in this browser session.</p>
      </div>
      <div
        className="flex-1 overflow-y-auto cv-scroll p-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          void handleFiles(e.dataTransfer.files)
        }}
      >
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full rounded-xl border-2 border-dashed border-black/15 hover:border-[#00C4CC] hover:bg-[#F0FBFC] transition-all py-8 flex flex-col items-center gap-2 text-muted-foreground"
          aria-label="Upload images"
        >
          <Upload size={22} />
          <span className="text-sm font-medium">Click or drag images here</span>
          <span className="text-xs">PNG, JPG, SVG, GIF</span>
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

        {uploadGallery.items.length > 0 && (
          <>
            <div className="flex items-center justify-between mt-6 mb-2">
              <h4 className="text-xs font-semibold text-muted-foreground">Session uploads</h4>
              <button
                className="text-xs text-muted-foreground hover:text-red-600 inline-flex items-center gap-1"
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
                <button
                  key={i}
                  onClick={() => addImageFromSrc(item.src, item.w, item.h)}
                  className={cn('rounded-lg overflow-hidden border border-black/8 hover:border-[#00C4CC] transition-all aspect-square bg-[#F4F5F7]')}
                  aria-label="Add uploaded image to canvas"
                >
                  <img src={item.src} alt="Uploaded" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
