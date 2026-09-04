import { NextResponse } from 'next/server'
import { hasProvider } from '@/lib/ai/provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/ai/capabilities
 * Public, secret-free feature detection. Panels use these boolean flags to
 * show "requires server AI provider" states before the user tries a feature.
 * Only ever exposes which capabilities exist — never config, never keys.
 */
export async function GET() {
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
