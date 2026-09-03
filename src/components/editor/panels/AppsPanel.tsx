'use client'

import { useState } from 'react'
import { BarChart3, PieChart, LineChart, Smile, QrCode, Table2, Code2, Sparkles, ArrowRight } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { PanelShell } from './panel-shell'
import { createShapeElement, createTextElement, createLineElement, type AnyElement } from '@/lib/types'
import { addSticker } from '../add-element'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

const STICKERS = ['😀', '😍', '🤩', '🥳', '😎', '🤔', '😴', '🤯', '🥰', '😭', '😡', '🤡', '👻', ' 💀', '👽', '🤖', '🎃', '🎉', '🎈', '🎁', '🏆', '🥇', '⚽', '🏀', '🎮', '🎵', '🎸', '🎬', '📷', '🔥', '✨', '⚡', '🌈', '☀️', '🌙', '⭐', '❤️', '💜', '✅', '❌']

/** Canva Apps panel — connectable mini-apps. Charts & Stickers are live; others roadmap. */
export function AppsPanel() {
  const [tab, setTab] = useState<'apps' | 'stickers'>('apps')

  return (
    <PanelShell title="Apps" subtitle="Superpowers for your design">
      <div className="flex gap-1 mt-1 mb-3 bg-white/[0.05] rounded-xl p-1">
        <button
          onClick={() => setTab('apps')}
          className={cn('flex-1 h-8 rounded-lg text-[11px] font-semibold transition-colors', tab === 'apps' ? 'bg-[#7630D7] text-white' : 'text-white/60 hover:text-white hover:bg-white/10')}
          aria-pressed={tab === 'apps'}
        >
          All apps
        </button>
        <button
          onClick={() => setTab('stickers')}
          className={cn('flex-1 h-8 rounded-lg text-[11px] font-semibold transition-colors', tab === 'stickers' ? 'bg-[#7630D7] text-white' : 'text-white/60 hover:text-white hover:bg-white/10')}
          aria-pressed={tab === 'stickers'}
        >
          Stickers
        </button>
      </div>

      {tab === 'apps' ? <AppsGrid /> : <StickersGrid />}
    </PanelShell>
  )
}

function AppsGrid() {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <AppCard icon={BarChart3} name="Bar chart" desc="Data-driven bars" cta="Add" color="#7630D7" onClick={() => addBarChart()} />
      <AppCard icon={LineChart} name="Line chart" desc="Trend as a path" cta="Add" color="#02C0CC" onClick={() => addLineChart()} />
      <AppCard icon={PieChart} name="Donut chart" desc="Progress ring" cta="Add" color="#FF5C8A" onClick={() => addDonut()} />
      <AppCard icon={Smile} name="Stickers" desc="Emoji stickers" cta="Open" color="#FFD166" onClick={() => { /* switches via parent tab */ }} switchTab="stickers" />
      <AppCard icon={QrCode} name="QR code" desc="Link to anywhere" cta="Soon" color="#3B82F6" soon />
      <AppCard icon={Table2} name="Tables" desc="Rows & columns" cta="Soon" color="#22C55E" soon />
      <AppCard icon={Code2} name="Embed" desc="Web content" cta="Soon" color="#F97316" soon />
      <AppCard icon={Sparkles} name="Magic Studio" desc="AI toolkit" cta="Soon" color="#A78BFA" soon />
    </div>
  )
}

function AppCard({ icon: Icon, name, desc, cta, color, onClick, soon, switchTab }: {
  icon: typeof BarChart3
  name: string
  desc: string
  cta: string
  color: string
  onClick?: () => void
  soon?: boolean
  switchTab?: 'stickers'
}) {
  const handleClick = () => {
    if (soon) {
      toast({ title: `${name} is on the open-source roadmap`, description: 'Star the repo to follow along: github.com/mir-ashiq/canvix' })
      return
    }
    if (switchTab) {
      // click the Stickers tab button in the parent
      const btn = document.querySelector<HTMLButtonElement>('[aria-pressed].flex-1 + button')
      btn?.click()
      return
    }
    onClick?.()
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 hover:border-[#7630D7] transition-colors flex flex-col">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}22` }}>
        <Icon size={20} style={{ color }} />
      </div>
      <div className="mt-2 text-[13px] font-semibold">{name}</div>
      <div className="text-[11px] text-white/45 leading-tight">{desc}</div>
      <button
        className={cn('mt-2.5 h-8 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors', soon ? 'bg-white/5 text-white/40' : 'bg-[#7630D7] hover:bg-[#8B5CF6] text-white')}
        onClick={handleClick}
      >
        {cta} {!soon && <ArrowRight size={11} />}
      </button>
    </div>
  )
}

function StickersGrid() {
  return (
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
  )
}

// ── chart generators (native elements — fully editable) ────────

const PALETTE = ['#7630D7', '#02C0CC', '#FF5C8A', '#FFD166', '#22C55E', '#3B82F6', '#F97316', '#EF4444']
const DATA = [42, 68, 55, 90, 37, 74]

function chartBase(w: number, h: number) {
  const state = useEditorStore.getState()
  return { x: Math.round((state.width - w) / 2), y: Math.round((state.height - h) / 2) }
}

function addBarChart() {
  const store = useEditorStore.getState()
  store.pushHistory()
  const W = 700, H = 420, padL = 40, padB = 46, padT = 20
  const max = Math.max(...DATA)
  const n = DATA.length
  const bandW = (W - padL - 12) / n
  const barW = bandW * 0.6
  const { x, y } = chartBase(W, H)
  const els: AnyElement[] = []

  // baseline
  els.push(createLineElement({ x: x + padL, y: y + H - padB, width: W - padL - 12, height: 0, stroke: '#9CA3AF', strokeWidth: 3 }))
  DATA.forEach((v, i) => {
    const barH = Math.round(((H - padB - padT) * v) / max)
    const bx = x + padL + i * bandW + (bandW - barW) / 2
    const by = y + H - padB - barH
    els.push(createShapeElement('rect', { x: Math.round(bx), y: by, width: Math.round(barW), height: barH, fill: PALETTE[i % PALETTE.length], cornerRadius: 8 }))
    // label
    els.push(createTextElement({ x: Math.round(bx), y: y + H - padB + 10, width: Math.round(barW), text: `Q${i + 1}`, fontSize: 22, fill: '#6B7280', align: 'center' }))
  })
  els.forEach((el) => store.addElement(el))
  toast({ title: 'Bar chart added — edit any bar like a shape' })
}

function addLineChart() {
  const store = useEditorStore.getState()
  store.pushHistory()
  const W = 700, H = 380, padL = 30, padB = 40, padT = 20
  const max = Math.max(...DATA)
  const { x, y } = chartBase(W, H)
  const pts = DATA.map((v, i) => {
    const px = padL + (i * (W - padL - 20)) / (DATA.length - 1)
    const py = padT + (1 - v / max) * (H - padB - padT)
    return { px: Math.round(px), py: Math.round(py) }
  })
  pts.forEach((p, i) => {
    if (i === 0) return
    const a = pts[i - 1]
    const dx = p.px - a.px
    const dy = p.py - a.py
    const len = Math.round(Math.hypot(dx, dy))
    const angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI)
    store.addElement(createLineElement({ x: x + a.px, y: y + a.py, width: len, height: 0, rotation: angle, stroke: '#02C0CC', strokeWidth: 6 }))
    // vertex dot
    store.addElement(createShapeElement('ellipse', { x: x + p.px - 9, y: y + p.py - 9, width: 18, height: 18, fill: '#02C0CC' }))
  })
  toast({ title: 'Line chart added' })
}

function addDonut() {
  const store = useEditorStore.getState()
  store.pushHistory()
  const { x, y } = chartBase(320, 320)
  // donut = ring of arc segments as thick-stroked ellipse arcs; approximate with ring + progress arc using two circles is not possible → use ring via 12 rotated capsule segments
  const segments = 12
  const filled = 8
  const cx = x + 160, cy = y + 160, r = 110
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2 - Math.PI / 2
    const chord = 2 * r * Math.sin(Math.PI / segments)
    const midA = a0 + Math.PI / segments
    const len = Math.round(chord * 0.82)
    const ang = Math.round((midA * 180) / Math.PI)
    const px = cx + r * Math.cos(midA) - len / 2
    const py = cy + r * Math.sin(midA)
    store.addElement(
      createLineElement({
        x: Math.round(px),
        y: Math.round(py),
        width: len,
        height: 0,
        rotation: ang,
        stroke: i < filled ? '#7630D7' : '#2A2C35',
        strokeWidth: 34,
      })
    )
  }
  // center label
  store.addElement(createTextElement({ x: x + 60, y: y + 130, width: 200, text: '68%', fontSize: 64, bold: true, fill: '#FFFFFF', align: 'center' }))
  toast({ title: 'Donut chart added — tweak segments as lines' })
}
