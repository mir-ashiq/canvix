'use client'

import { BarChart3, LineChart, PieChart } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { createShapeElement, createTextElement, createLineElement, type AnyElement } from '@/lib/types'
import { AppHeader, type AppPanelProps } from './registry'
import { toast } from '@/hooks/use-toast'

const PALETTE = ['#7630D7', '#02C0CC', '#FF5C8A', '#FFD166', '#22C55E', '#3B82F6', '#F97316', '#EF4444']
const DATA = [42, 68, 55, 90, 37, 74]

function chartBase(w: number, h: number) {
  const state = useEditorStore.getState()
  return { x: Math.round((state.width - w) / 2), y: Math.round((state.height - h) / 2) }
}

export function ChartsApp({ onClose }: AppPanelProps) {
  return (
    <div>
      <AppHeader icon={BarChart3} title="Charts" onClose={onClose} />
      <p className="text-[11px] text-white/45 leading-relaxed mb-3">
        Charts are added as native elements — every bar, dot and label stays fully editable on the canvas.
      </p>
      <div className="space-y-2">
        <ChartRow icon={BarChart3} name="Bar chart" desc="6 bars, colourful, editable" onAdd={addBarChart} />
        <ChartRow icon={LineChart} name="Line chart" desc="Trend line with vertex dots" onAdd={addLineChart} />
        <ChartRow icon={PieChart} name="Donut chart" desc="Progress ring + centre label" onAdd={addDonut} />
      </div>
    </div>
  )
}

function ChartRow({ icon: Icon, name, desc, onAdd }: { icon: typeof BarChart3; name: string; desc: string; onAdd: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 hover:border-[#7630D7] transition-colors">
      <Icon size={18} className="text-[#02C0CC] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-white">{name}</div>
        <div className="text-[11px] text-white/45 truncate">{desc}</div>
      </div>
      <button className="btn-cv h-8 px-3.5 text-[11px] shrink-0" onClick={onAdd}>
        Add
      </button>
    </div>
  )
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
