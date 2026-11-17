// ─────────────────────────────────────────────────────────────
// WebP export pre-flight (Wave 5 remainder) — the pure helpers
// the export dialog needs, split from the capture path so the
// module stays node-testable (the gif-plan precedent): the
// browser-only probe takes the canvas encoder as an argument.
//
// The honesty problem this module exists for: Safari's canvas
// ACCEPTS 'image/webp' in toDataURL() and then silently returns
// PNG bytes. A WebP card that saves PNG bytes under a .webp name
// would be a lie with a file extension — so the probe checks the
// encoded prefix, and the post-capture assert fails closed with
// an actionable message (the §8 discipline: features degrade
// honestly, never silently).
// ─────────────────────────────────────────────────────────────

/** Quality handed to the canvas encoder for WebP (lossy). The 1×/2×/3×
 *  detail scale is the resolution lever; 0.92 is the JPEG precedent. */
export const WEBP_QUALITY = 0.92

/** Does THIS environment's canvas actually encode WebP? The injectable
 *  `encode` is `(mimeType) => dataUrl` — in the browser it closes over
 *  a scratch canvas's toDataURL. Fail-closed: a throw means no. */
export function canvasEncodesWebp(encode: (mimeType: string) => string): boolean {
  try {
    return encode('image/webp').startsWith('data:image/webp')
  } catch {
    return false
  }
}

/** Post-capture honesty check. Konva's toDataURL returns whatever the
 *  browser encoded — on Safari that is PNG bytes wearing a WebP request.
 *  Verify the prefix before the bytes get a .webp filename. */
export function assertWebpDataUrl(url: string): void {
  if (!url.startsWith('data:image/webp')) {
    throw new Error(
      'This browser cannot encode WebP — the file would actually be PNG. Export as PNG or JPG instead.',
    )
  }
}

/** The WebP card is offered only where the probe passed; `null` means
 *  "not probed yet" (card hidden until known — never offer, then yank). */
export function offerWebpCard(probed: boolean | null): boolean {
  return probed === true
}
