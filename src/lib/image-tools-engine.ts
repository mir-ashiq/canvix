// ─────────────────────────────────────────────────────────────
// Image-tools engine preference (v0.22, user request).
//
// The one-click image tools — BG remover and Upscale — have two
// execution engines:
//
//   'provider'  the configured image-edit AI provider does the work
//               server-side (default — no local compute, no model
//               download)
//   'device'    the local in-browser paths: the ONNX segmentation
//               cut-out (~40 MB model, downloaded once) and the
//               Lanczos-3 resampler (pure math, offline)
//
// The choice is a single per-browser preference shared by both tools,
// persisted in localStorage. Server-side rendering and private-mode
// failures degrade to the 'provider' default silently.
// ─────────────────────────────────────────────────────────────

export type ImageToolsEngine = 'provider' | 'device'

const STORAGE_KEY = 'canvix.image-tools.engine'

/** The engines shown in the tool popovers, in UI order. */
export const IMAGE_TOOL_ENGINES: readonly { id: ImageToolsEngine; label: string; hint: string }[] = [
  { id: 'provider', label: 'Provider', hint: 'AI provider — server-side, nothing downloads' },
  { id: 'device', label: 'This device', hint: 'Runs locally in your browser — works offline' },
] as const

function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage
    return s && typeof s.getItem === 'function' ? s : null
  } catch {
    // SecurityError in some sandboxed contexts — behave as no storage
    return null
  }
}

/** Current engine — 'provider' unless the user explicitly chose 'device'. */
export function getImageToolsEngine(): ImageToolsEngine {
  const s = storage()
  if (!s) return 'provider'
  try {
    return s.getItem(STORAGE_KEY) === 'device' ? 'device' : 'provider'
  } catch {
    return 'provider'
  }
}

/** Persist the choice (no-op when storage is unavailable). */
export function setImageToolsEngine(engine: ImageToolsEngine): void {
  const s = storage()
  if (!s) return
  try {
    s.setItem(STORAGE_KEY, engine)
  } catch {
    /* quota / private mode — the default stands for this session */
  }
}
