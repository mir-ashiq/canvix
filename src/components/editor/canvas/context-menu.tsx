'use client'

import { useEffect, useRef } from 'react'
import {
  Copy,
  Scissors,
  ClipboardPaste,
  CopyPlus,
  Trash2,
  BringToFront,
  SendToBack,
  ArrowUpToLine,
  ArrowDownToLine,
  Group,
  Ungroup,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  SquareStack,
  FilePlus2,
  Palette,
  MousePointerClick,
  Crop,
  Ruler,
} from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { isGroup } from '@/lib/types'

export interface ContextMenuState {
  x: number
  y: number
  kind: 'element' | 'page'
}

interface Item {
  label: string
  icon: React.ComponentType<{ size?: number | string; className?: string }>
  kbd?: string
  danger?: boolean
  disabled?: boolean
  onSelect?: () => void
}

const Sep = () => <div className="cv-menu-sep" />

export function CanvasContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const store = useEditorStore()

  useEffect(() => {
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // close on any click outside / scroll / resize
    window.addEventListener('mousedown', (e) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }, { once: true, capture: true })
    window.addEventListener('wheel', close, { once: true, capture: true })
    window.addEventListener('keydown', onKey, { once: true })
    return () => {
      window.removeEventListener('mousedown', close, { capture: true })
      window.removeEventListener('wheel', close, { capture: true })
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const selectedIds = store.selectedIds
  const canGroup = selectedIds.length >= 2
  const canUngroup = store.pages[store.currentPage].elements.some(
    (el) => selectedIds.includes(el.id) && isGroup(el)
  )
  const hasLocked = store.pages[store.currentPage].elements.some(
    (el) => selectedIds.includes(el.id) && el.locked
  )
  const anyHidden = store.pages[store.currentPage].elements.some(
    (el) => selectedIds.includes(el.id) && !el.visible
  )

  // v0.3.1: crop entry applies to a single selected image
  const singleImage = selectedIds.length === 1
    ? store.pages[store.currentPage].elements.find((el) => el.id === selectedIds[0] && el.type === 'image')
    : undefined

  const elementItems: Item[] = [
    { label: 'Copy', icon: Copy, kbd: 'Ctrl+C', onSelect: () => store.copySelection() },
    { label: 'Cut', icon: Scissors, kbd: 'Ctrl+X', onSelect: () => { store.cutSelection() } },
    { label: 'Duplicate', icon: CopyPlus, kbd: 'Ctrl+D', onSelect: () => store.duplicateSelection() },
    ...(singleImage ? [{ label: 'Crop image', icon: Crop, onSelect: () => store.openCrop(singleImage.id) }] : []),
    Sep as unknown as Item,
    { label: 'Bring to front', icon: BringToFront, onSelect: () => selectedIds.forEach((id) => store.moveLayer(id, 'front')) },
    { label: 'Bring forward', icon: ArrowUpToLine, onSelect: () => selectedIds.forEach((id) => store.moveLayer(id, 'up')) },
    { label: 'Send backward', icon: ArrowDownToLine, onSelect: () => selectedIds.forEach((id) => store.moveLayer(id, 'down')) },
    { label: 'Send to back', icon: SendToBack, onSelect: () => selectedIds.forEach((id) => store.moveLayer(id, 'back')) },
    Sep as unknown as Item,
    { label: 'Group', icon: Group, kbd: 'Ctrl+G', disabled: !canGroup, onSelect: () => store.groupSelection() },
    { label: 'Ungroup', icon: Ungroup, kbd: 'Ctrl+Shift+G', disabled: !canUngroup, onSelect: () => store.ungroupSelection() },
    { label: hasLocked ? 'Unlock' : 'Lock', icon: hasLocked ? Unlock : Lock, kbd: 'Ctrl+L', onSelect: () => store.setLock(selectedIds, !hasLocked) },
    { label: anyHidden ? 'Show' : 'Hide', icon: anyHidden ? Eye : EyeOff, onSelect: () => store.setVisible(selectedIds, anyHidden) },
    Sep as unknown as Item,
    { label: 'Delete', icon: Trash2, kbd: 'DEL', danger: true, onSelect: () => store.deleteSelection() },
  ]

  const pageItems: Item[] = [
    { label: 'Paste', icon: ClipboardPaste, kbd: 'Ctrl+V', onSelect: () => store.pasteClipboard() },
    { label: 'Select all', icon: MousePointerClick, kbd: 'Ctrl+A', onSelect: () => store.setSelection(store.pages[store.currentPage].elements.filter((e) => !e.locked).map((e) => e.id)) },
    ...(store.manualGuides.length > 0
      ? [{ label: `Clear guides (${store.manualGuides.length})`, icon: Ruler, onSelect: () => store.clearManualGuides() }]
      : []),
    Sep as unknown as Item,
    { label: 'Add page', icon: FilePlus2, onSelect: () => store.addPage() },
    { label: 'Duplicate page', icon: SquareStack, onSelect: () => store.duplicatePage(store.currentPage) },
    { label: 'Page background', icon: Palette, onSelect: () => store.setPanel('background') },
    Sep as unknown as Item,
    { label: 'Delete page', icon: Trash2, kbd: 'DEL', danger: true, onSelect: () => store.deletePage(store.currentPage) },
  ]

  const items = state.kind === 'element' ? elementItems : pageItems

  // clamp the menu inside the viewport
  const style: React.CSSProperties = {
    left: Math.min(state.x, window.innerWidth - 250),
    top: Math.min(state.y, window.innerHeight - 420),
  }

  return (
    <div ref={ref} className="cv-menu" style={style} role="menu" aria-label="Context menu" onClick={(e) => e.stopPropagation()}>
      {items.map((item, i) =>
        'icon' in item && item.icon ? (
          <button
            key={i}
            role="menuitem"
            className={`cv-menu-item ${item.danger ? 'cv-menu-item-danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              item.onSelect?.()
              onClose()
            }}
          >
            <item.icon size={15} className="shrink-0 opacity-70" />
            <span className="truncate">{item.label}</span>
            {item.kbd && <span className="cv-menu-kbd">{item.kbd}</span>}
          </button>
        ) : (
          <Sep key={`sep-${i}`} />
        )
      )}
    </div>
  )
}
