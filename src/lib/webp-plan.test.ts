// ─────────────────────────────────────────────────────────────
// WebP export pre-flight — the acceptance suite (Wave 5).
//
//   1. the probe passes only for genuine webp data URLs
//   2. the probe rejects Safari's silent PNG fallback (the lie
//      this module exists to prevent)
//   3. the probe fail-closes on a throwing encoder
//   4. assertWebpDataUrl fails closed on PNG bytes / junk
//   5. the card is offered only after a positive probe
//   6. WEBP_QUALITY rides the JPEG precedent
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import {
  WEBP_QUALITY,
  canvasEncodesWebp,
  assertWebpDataUrl,
  offerWebpCard,
} from '@/lib/webp-plan'

describe('canvasEncodesWebp', () => {
  it('passes for a genuine webp data URL', () => {
    expect(canvasEncodesWebp(() => 'data:image/webp;base64,UklGRhoA')).toBe(true)
  })

  it("rejects Safari's silent PNG fallback", () => {
    // Safari accepts 'image/webp' then returns PNG bytes — the probe
    // must not offer the card in that environment
    expect(canvasEncodesWebp(() => 'data:image/png;base64,iVBORw0KGgo')).toBe(false)
  })

  it('fail-closes when the encoder throws', () => {
    expect(
      canvasEncodesWebp(() => {
        throw new Error('SecurityError')
      }),
    ).toBe(false)
  })

  it('rejects junk that merely contains webp somewhere', () => {
    expect(canvasEncodesWebp(() => 'data:image/png;base64,webpwebpwebp')).toBe(false)
  })
})

describe('assertWebpDataUrl', () => {
  it('accepts a real webp capture', () => {
    expect(() => assertWebpDataUrl('data:image/webp;base64,UklGRhoA')).not.toThrow()
  })

  it('throws on PNG bytes wearing a webp request', () => {
    expect(() => assertWebpDataUrl('data:image/png;base64,iVBORw0KGgo')).toThrow(
      /cannot encode WebP/,
    )
  })

  it('throws on empty / malformed URLs', () => {
    expect(() => assertWebpDataUrl('')).toThrow()
    expect(() => assertWebpDataUrl('not-a-data-url')).toThrow()
  })
})

describe('offerWebpCard', () => {
  it('is offered only after a positive probe', () => {
    expect(offerWebpCard(true)).toBe(true)
    expect(offerWebpCard(false)).toBe(false)
    expect(offerWebpCard(null)).toBe(false)
  })
})

describe('WEBP_QUALITY', () => {
  it('rides the JPEG precedent (0.92)', () => {
    expect(WEBP_QUALITY).toBe(0.92)
  })
})
