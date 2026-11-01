import { NextResponse } from 'next/server'
import { hasProvider } from '@/lib/ai/provider'
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
  const configured = hasProvider()
  return NextResponse.json({
    configured,
    capabilities: {
      magicWrite: configured,
      imageGeneration: configured,
      imageEditing: configured,
      vision: configured,          // Magic Layers
      translation: configured,
      assistant: configured,
      photoSearch: configured,
      backgroundRemoval: true,     // local ONNX — always available
      colorPalette: true,          // local deterministic
      layoutSuggestions: true,     // local deterministic
    },
  })
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const GET = withLogging('GET /api/ai/capabilities', __canvix_get)
