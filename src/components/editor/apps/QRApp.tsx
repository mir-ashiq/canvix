'use client'

import { useState } from 'react'
import QRCode from 'qrcode'
import { QrCode } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { createImageElement } from '@/lib/types'
import { AppHeader, type AppPanelProps } from './registry'
import { toast } from '@/hooks/use-toast'

export function QRApp({ onClose }: AppPanelProps) {
  const [text, setText] = useState('https://github.com/mir-ashiq/canvix')
  const [size, setSize] = useState(320)
  const [dark, setDark] = useState('#1F2226')
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const generate = async () => {
    if (!text.trim()) {
      toast({ title: 'Enter a link or text first' })
      return
    }
    setBusy(true)
    try {
      const dataUrl = await QRCode.toDataURL(text.trim(), {
        width: size * 2,
        margin: 2,
        color: { dark, light: '#FFFFFF' },
        errorCorrectionLevel: 'M',
      })
      setPreview(dataUrl)
    } catch {
      toast({ title: 'Could not generate QR code', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const addToCanvas = () => {
    if (!preview) return
    const store = useEditorStore.getState()
    const x = Math.round((store.width - size) / 2)
    const y = Math.round((store.height - size) / 2)
    store.addElement(
      createImageElement(preview, size, size, {
        x, y, width: size, height: size, radius: 12,
      })
    )
    toast({ title: 'QR code added to canvas' })
  }

  return (
    <div>
      <AppHeader icon={QrCode} title="QR generator" onClose={onClose} />
      <label className="block text-[11px] font-semibold text-white/55 mb-1.5">Link or text</label>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="https://example.com"
        className="w-full h-10 rounded-xl bg-white/[0.05] border border-white/10 px-3 text-[12px] text-white outline-none focus:border-[#7630D7] mb-3"
        aria-label="QR content"
      />
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="block text-[11px] font-semibold text-white/55 mb-1.5">Size</label>
          <select
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="w-full h-9 rounded-xl bg-white/[0.05] border border-white/10 px-2 text-[12px] text-white outline-none [color-scheme:dark]"
            aria-label="QR size"
          >
            {[160, 240, 320, 480].map((s) => (
              <option key={s} value={s}>{s} px</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-white/55 mb-1.5">Colour</label>
          <input
            type="color"
            value={dark}
            onChange={(e) => setDark(e.target.value)}
            className="w-full h-9 rounded-xl bg-white/[0.05] border border-white/10 px-1 cursor-pointer"
            aria-label="QR colour"
          />
        </div>
      </div>
      <button className="btn-cv w-full h-10 text-[12px] mb-3" onClick={() => void generate()} disabled={busy}>
        {busy ? 'Generating…' : 'Generate QR code'}
      </button>

      {preview && (
        <div className="rounded-xl border border-white/12 bg-white p-3 flex flex-col items-center">
          <img src={preview} alt="QR code preview" className="w-[150px] h-[150px]" />
          <button className="btn-cv h-9 px-4 text-[12px] mt-3 w-full" onClick={addToCanvas}>
            Add to canvas
          </button>
        </div>
      )}
    </div>
  )
}
