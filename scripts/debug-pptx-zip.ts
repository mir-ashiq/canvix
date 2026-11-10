// Debug: list zip entries of a generated pptx
import { exportDesignToPptx } from '../src/lib/pptx-export'
import { createShapeElement } from '../src/lib/types'

async function main() {
  const wav = new Uint8Array(128)
  wav.set([0x52, 0x49, 0x46, 0x46], 0)
  const rect = createShapeElement('rect', { x: 0, y: 0, width: 100, height: 100, fill: '#FFF' })
  const r = await exportDesignToPptx({
    designWidth: 400,
    designHeight: 300,
    pages: [
      {
        id: 'p',
        background: { type: 'solid', color: '#FFF' },
        elements: [rect],
        transition: { kind: 'fade', duration: 0.5, sfxId: 'whoosh-soft' },
      } as never,
    ],
    sfxIo: { fetchBytes: async () => wav },
  })
  const bytes = new Uint8Array(await r.blob.arrayBuffer())
  const dv = new DataView(bytes.buffer)
  const dec = new TextDecoder()
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  let p = dv.getUint32(eocd + 16, true)
  for (let i = 0; i < dv.getUint16(eocd + 10, true); i++) {
    const nl = dv.getUint16(p + 28, true)
    const el = dv.getUint16(p + 30, true)
    const cl = dv.getUint16(p + 32, true)
    console.log(dec.decode(bytes.subarray(p + 46, p + 46 + nl)))
    p += 46 + nl + el + cl
  }
  process.exit(0)
}
main()
