'use client'

// ─────────────────────────────────────────────────────────────
// UnifiedAIApp (v0.32.1) — ONE AI surface.
//
// The review that mattered: "I don't want multiple AI apps in
// canvix, just keep it few." Six AI-branded panels (chat copilot,
// design agent, Magic Write, AI image, AI design plan, AI theme)
// became this one app with five modes:
//
//   Chat      — the agent: refine THIS design in natural language
//               (brief-contract gated, edit-safe)
//   Generate  — the autonomous pipeline: one prompt → planned,
//               compiled, checked, visually verified, reviewed by
//               you, applied editable
//   Write     — AI copy: headlines, taglines, captions
//   Image     — prompt → design-ready image
//   Theme     — palette + fonts, applied safely with contrast guards
//
// The former AI design plan app is retired — its describe → review
// → apply flow IS the Generate tab, with the stronger engine behind
// it. The /api/ai/plan route stays available as an API.
//
// Each tab renders the original self-contained app component —
// behavior, review gates and honesty contracts unchanged. The panel
// opens on Chat (the most-used mode); switching tabs keeps each
// app's internal state only while it is active, exactly as before.
// ─────────────────────────────────────────────────────────────

import { useState } from 'react'
import type { AppPanelProps } from './registry'
import { cn } from '@/lib/utils'
import { AssistantApp } from './AssistantApp'
import { DesignAgentApp } from './DesignAgentApp'
import { MagicWriteApp } from './MagicWriteApp'
import { AIImageApp } from './AIImageApp'
import { AIThemeApp } from './AIThemeApp'

const TABS = [
  {
    id: 'chat',
    label: 'Chat',
    hint: 'Refine this design in natural language — brief-contract gated',
    Component: AssistantApp,
  },
  {
    id: 'generate',
    label: 'Generate',
    hint: 'One prompt in — a checked, reviewed, editable design out',
    Component: DesignAgentApp,
  },
  {
    id: 'write',
    label: 'Write',
    hint: 'AI copy — headlines, taglines & captions',
    Component: MagicWriteApp,
  },
  {
    id: 'image',
    label: 'Image',
    hint: 'Turn a prompt into a design-ready image',
    Component: AIImageApp,
  },
  {
    id: 'theme',
    label: 'Theme',
    hint: 'Palette + fonts for the whole design, applied safely',
    Component: AIThemeApp,
  },
] as const

type TabId = (typeof TABS)[number]['id']

export function UnifiedAIApp({ onClose }: AppPanelProps) {
  const [tab, setTab] = useState<TabId>('chat')
  const active = TABS.find((t) => t.id === tab) ?? TABS[0]
  const Active = active.Component
  const select = (id: TabId) => {
    setTab(id)
  }
  return (
    <div className="flex flex-col gap-2">
      <div role="tablist" aria-label="Canvix AI modes" className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <div
            key={t.id}
            role="tab"
            tabIndex={0}
            aria-selected={tab === t.id}
            title={t.hint}
            onClick={() => select(t.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                select(t.id)
              }
            }}
            className={cn(
              'cursor-pointer select-none rounded-full px-3 py-1 text-[11px] font-semibold transition-colors',
              tab === t.id
                ? 'bg-[#7630D7] text-white'
                : 'bg-white/5 text-white/55 hover:bg-white/10 hover:text-white',
            )}
          >
            {t.label}
          </div>
        ))}
      </div>
      <Active onClose={onClose} />
    </div>
  )
}
