// v0.22 round-trip proof: export a deck exercising every new feature
// (normAutofit text, entrance animations incl. dropped rotate,
// fade+slide transitions, transition SFX) then verify with Python's
// zipfile; the caller follows up with `soffice --convert-to pdf`.
import { exportDesignToPptx } from '../src/lib/pptx-export'
import { createShapeElement, createTextElement } from '../src/lib/types'
import type { PageData } from '../src/lib/types'
import { writeFileSync } from 'node:fs'

function page(elements: PageData['elements'], extra: Partial<PageData> = {}): PageData {
  return {
    id: 'p',
    background: { type: 'solid', color: '#FFFFFF' },
    elements,
    ...extra,
  } as PageData
}

async function main() {
  const wav = new Uint8Array(2048)
  wav.set([0x52, 0x49, 0x46, 0x46, 0xfc, 0x07, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45], 0)
  // fmt + data chunks so the header is structurally a wav
  wav.set([0x66, 0x6d, 0x74, 0x20, 16, 0, 0, 0, 1, 0, 1, 0, 0x40, 0x1f, 0, 0, 0, 0x40, 0x1f, 0, 0, 2, 0, 16, 0], 12)
  wav.set([0x64, 0x61, 0x74, 0x61, 0xf0, 0x07, 0, 0], 36)

  const t1 = createTextElement({ x: 40, y: 40, width: 500, text: 'v0.22 heading', fontSize: 44 })
  t1.animation = { kind: 'fade', duration: 0.9, delay: 0, easing: 'easeOut' }
  const t2 = createTextElement({ x: 40, y: 140, width: 500, text: 'wipes in from the left', fontSize: 24 })
  t2.animation = { kind: 'pan', duration: 0.5, delay: 1.2, easing: 'easeOut', direction: 'left' }
  const t3 = createTextElement({ x: 40, y: 220, width: 500, text: 'rotate stays home', fontSize: 24 })
  t3.animation = { kind: 'rotate', duration: 2, delay: 0, easing: 'linear' }
  const rect = createShapeElement('rect', { x: 40, y: 300, width: 200, height: 120, fill: '#3B82F6' })

  const r = await exportDesignToPptx({
    designWidth: 800,
    designHeight: 450,
    title: 'v0.22 round-trip',
    pages: [
      page([t1, t2, t3, rect], { transition: { kind: 'fade', duration: 0.5, sfxId: 'whoosh-soft' } }),
      page([rect], { transition: { kind: 'slide', duration: 2.0, direction: 'left' } }),
    ],
    sfxIo: { fetchBytes: async () => wav },
  })
  console.log(
    `export: pages=${r.pages} natives=${r.natives} transitions=${r.transitions} sounds=${r.sounds} animated=${r.animated} fontsEmbedded=${r.fontsEmbedded}`,
  )
  writeFileSync('/tmp/pptx-v022-roundtrip.pptx', new Uint8Array(await r.blob.arrayBuffer()))
  console.log('wrote /tmp/pptx-v022-roundtrip.pptx')
}

main()
