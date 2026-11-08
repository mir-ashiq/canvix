import { NextResponse } from 'next/server'
import { hasProviderForSlot } from '@/lib/ai/provider'
import { stockPhotoAvailable } from '@/lib/stock-photo'
import { getFeatures } from '@/lib/admin/config'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/ai/capabilities
 * Public, secret-free feature detection. Panels use these boolean flags to
 * show "requires server AI provider" states before the user tries a feature.
 * Only ever exposes which capabilities exist — never config, never keys.
 */
async function __canvix_get() {
  // v0.16 (A1): a capability is available when a provider answers AND
  // the admin console has not switched the feature off. v0.16.2 (A2):
  // the provider check is per capability SLOT — with the multi-provider
  // table you can wire text to one vendor and images to another, so
  // "a provider exists" is no longer a single boolean. Still booleans
  // only — never config, never keys, never which layer answered.
  // v0.16.4 (A4): photoSearch left the AI table — it answers on the
  // stock-provider keys (Pexels/Pixabay), like the Videos rail.
  const [text, vision, image, imageEdit, stockPhotos] = await Promise.all([
    hasProviderForSlot('text'),
    hasProviderForSlot('vision'),
    hasProviderForSlot('image'),
    hasProviderForSlot('imageEdit'),
    stockPhotoAvailable(), // async since A5 — keys resolve console-first
  ])
  const configured = text || vision || image || imageEdit
  const flags = await getFeatures()
  return NextResponse.json({
    configured,
    capabilities: {
      magicWrite: text && flags.magicWrite,
      imageGeneration: image && flags.imageGeneration,
      imageEditing: imageEdit && flags.imageEditing,
      vision: vision && flags.vision,          // Magic Layers
      translation: text && flags.translation,
      assistant: text && flags.assistant,
      photoSearch: stockPhotos && flags.photoSearch, // stock keys, not a model slot
      backgroundRemoval: true,     // local ONNX — always available
      colorPalette: true,          // local deterministic
      layoutSuggestions: true,     // local deterministic
    },
  })
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const GET = withLogging('GET /api/ai/capabilities', __canvix_get)
