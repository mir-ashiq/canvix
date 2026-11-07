import { NextResponse } from 'next/server'
import { hasProvider } from '@/lib/ai/provider'
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
  // the admin console has not switched the feature off. Still booleans
  // only — never config, never keys, never which layer answered.
  const configured = await hasProvider()
  const flags = await getFeatures()
  return NextResponse.json({
    configured,
    capabilities: {
      magicWrite: configured && flags.magicWrite,
      imageGeneration: configured && flags.imageGeneration,
      imageEditing: configured && flags.imageEditing,
      vision: configured && flags.vision,          // Magic Layers
      translation: configured && flags.translation,
      assistant: configured && flags.assistant,
      photoSearch: configured && flags.photoSearch,
      backgroundRemoval: true,     // local ONNX — always available
      colorPalette: true,          // local deterministic
      layoutSuggestions: true,     // local deterministic
    },
  })
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const GET = withLogging('GET /api/ai/capabilities', __canvix_get)
