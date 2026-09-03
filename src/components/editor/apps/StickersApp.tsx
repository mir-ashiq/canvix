'use client'

import { Smile } from 'lucide-react'
import { addSticker } from '../add-element'
import { AppHeader, type AppPanelProps } from './registry'

const STICKERS = ['😀', '😍', '🤩', '🥳', '😎', '🤔', '😴', '🤯', '🥰', '😭', '😡', '🤡', '👻', '💀', '👽', '🤖', '🎃', '🎉', '🎈', '🎁', '🏆', '🥇', '⚽', '🏀', '🎮', '🎵', '🎸', '🎬', '📷', '🔥', '✨', '⚡', '🌈', '☀️', '🌙', '⭐', '❤️', '💜', '✅', '❌']

export function StickersApp({ onClose }: AppPanelProps) {
  return (
    <div>
      <AppHeader icon={Smile} title="Stickers" onClose={onClose} />
      <div className="grid grid-cols-5 gap-1.5">
        {STICKERS.map((s) => (
          <button
            key={s}
            onClick={() => addSticker(s)}
            className="aspect-square rounded-xl bg-white/[0.04] hover:bg-[#7630D7]/30 border border-white/10 hover:border-[#7630D7] text-2xl flex items-center justify-center transition-colors"
            aria-label={`Add sticker ${s}`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
