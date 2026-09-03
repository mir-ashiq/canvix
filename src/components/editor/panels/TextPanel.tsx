'use client'

import { Heading1, Heading2, Type as TypeIcon } from 'lucide-react'
import { addText, addTextStyled } from '../add-element'
import { FONT_STYLES } from '@/lib/editor-utils'

export function TextPanel() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 border-b border-black/5">
        <h3 className="font-bold text-sm">Text</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Click to add — style it from the toolbar above the canvas.</p>
      </div>
      <div className="flex-1 overflow-y-auto cv-scroll p-4">
        <div className="space-y-2">
          <button
            onClick={() => addText('heading')}
            className="w-full rounded-xl border border-black/8 px-4 py-4 hover:border-[#00C4CC] hover:bg-[#F0FBFC] transition-all flex items-center gap-3"
            aria-label="Add a heading"
          >
            <Heading1 size={20} className="text-muted-foreground" />
            <span style={{ fontFamily: 'Montserrat', fontWeight: 800, fontSize: 26 }} className="leading-none">Add a heading</span>
          </button>
          <button
            onClick={() => addText('subheading')}
            className="w-full rounded-xl border border-black/8 px-4 py-4 hover:border-[#00C4CC] hover:bg-[#F0FBFC] transition-all flex items-center gap-3"
            aria-label="Add a subheading"
          >
            <Heading2 size={18} className="text-muted-foreground" />
            <span style={{ fontFamily: 'Poppins', fontWeight: 700, fontSize: 19 }} className="leading-none">Add a subheading</span>
          </button>
          <button
            onClick={() => addText('body')}
            className="w-full rounded-xl border border-black/8 px-4 py-4 hover:border-[#00C4CC] hover:bg-[#F0FBFC] transition-all flex items-center gap-3"
            aria-label="Add body text"
          >
            <TypeIcon size={16} className="text-muted-foreground" />
            <span style={{ fontFamily: 'Poppins', fontSize: 15 }} className="leading-none">Add a little bit of body text</span>
          </button>
        </div>

        <h4 className="mt-6 mb-3 text-xs font-semibold text-muted-foreground">Font combinations</h4>
        <div className="grid grid-cols-2 gap-3">
          {FONT_STYLES.map((style) => (
            <button
              key={style.id}
              onClick={() => {
                addTextStyled({
                  text: style.name.replace(/&/g, 'and'),
                  fontFamily: style.heading.family,
                  bold: style.heading.weight >= 700,
                  fontSize: 72,
                  width: 700,
                })
                addTextStyled({
                  text: 'Pair it with a clean, readable body font.',
                  fontFamily: style.body.family,
                  bold: false,
                  fontSize: 30,
                  width: 620,
                  y: undefined,
                })
              }}
              className="rounded-xl border border-black/8 p-4 hover:border-[#00C4CC] hover:bg-[#F0FBFC] transition-all text-left"
              aria-label={`Add ${style.name} font pairing`}
            >
              <div
                style={{ fontFamily: style.heading.family, fontWeight: style.heading.weight, fontSize: 22, lineHeight: 1.15 }}
                className="truncate"
              >
                {style.name.split(' ')[0]}
              </div>
              <div
                style={{ fontFamily: style.body.family, fontWeight: style.body.weight, fontSize: 13, lineHeight: 1.4 }}
                className="mt-1 text-muted-foreground truncate"
              >
                Body text sample
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
