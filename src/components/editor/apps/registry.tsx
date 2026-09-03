'use client'

import { BarChart3, QrCode, Smile, Shapes, Palette, Type, Wand2, ImageIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** ── Canvix app registry ─────────────────────────────────────
 *  Apps are self-contained panel modules. To add a new app:
 *  1. create a component in src/components/editor/apps/
 *  2. register it here with metadata.
 *  The AppsPanel renders the grid + routes to the open app.
 */
export interface CanvixApp {
  id: string
  name: string
  desc: string
  icon: LucideIcon
  color: string
  content: React.ComponentType<AppPanelProps>
}

export interface AppPanelProps {
  /** ask the host panel to close this app (back to grid) */
  onClose: () => void
}

// apps are imported lazily below to keep this file lean
import { ChartsApp } from './ChartsApp'
import { QRApp } from './QRApp'
import { IconsApp } from './IconsApp'
import { PaletteApp } from './PaletteApp'
import { LoremApp } from './LoremApp'
import { StickersApp } from './StickersApp'
import { MagicWriteApp } from './MagicWriteApp'
import { AIImageApp } from './AIImageApp'

export const CANVIX_APPS: CanvixApp[] = [
  // AI apps first (canva 2026: “Canva AI” is the flagship surface)
  { id: 'magic-write', name: 'Magic Write', desc: 'AI copy — headlines, taglines & captions', icon: Wand2, color: '#9B6BFF', content: MagicWriteApp },
  { id: 'ai-image', name: 'AI image generator', desc: 'Turn a prompt into a design-ready image', icon: ImageIcon, color: '#02C0CC', content: AIImageApp },
  { id: 'charts', name: 'Charts', desc: 'Bar, line & donut charts as editable shapes', icon: BarChart3, color: '#7630D7', content: ChartsApp },
  { id: 'qr', name: 'QR generator', desc: 'Turn any link or text into a QR code', icon: QrCode, color: '#3B82F6', content: QRApp },
  { id: 'icons', name: 'Icons', desc: 'Line & solid icon shapes for any design', icon: Shapes, color: '#02C0CC', content: IconsApp },
  { id: 'palette', name: 'Colour palette', desc: 'Generate harmonious palettes on canvas', icon: Palette, color: '#FF5C8A', content: PaletteApp },
  { id: 'lorem', name: 'Placeholder text', desc: 'Lorem ipsum & real-feel filler copy', icon: Type, color: '#FFD166', content: LoremApp },
  { id: 'stickers', name: 'Stickers', desc: 'Emoji stickers & reactions', icon: Smile, color: '#F97316', content: StickersApp },
]

/** shared small header shown inside an open app */
export function AppHeader({ icon: Icon, title, onClose, children }: { icon: LucideIcon; title: string; onClose: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3.5">
      <Icon size={15} className="text-[#02C0CC] shrink-0" />
      <span className="text-[13px] font-bold text-white">{title}</span>
      <button className="ml-auto text-[11px] text-white/50 hover:text-white" onClick={onClose}>
        Back to apps
      </button>
      {children}
    </div>
  )
}
