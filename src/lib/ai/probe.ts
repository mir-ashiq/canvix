// ─────────────────────────────────────────────────────────────
// Per-slot provider probing (v0.16.3 A3) — the machinery behind
// the AI & models page's per-slot "Test" buttons.
//
// The A2 test connection only ever proved chat worked, so a
// chat-only provider (NVIDIA NIM and friends) passed every test
// while image generation 404'd in production — the exact incident
// this module exists to prevent. Each slot is probed through the
// ENDPOINT it actually uses, and failures are classified into an
// admin-actionable verdict ("this provider does not serve image
// generation"), never a bare status code.
//
// CONTRACT: server-only (constructs SDK clients); never logs or
// returns credentials — error text is scrubbed before shaping.
// ─────────────────────────────────────────────────────────────

import { makeClient } from '@/lib/ai/provider'

/** Probe timeout — generous: image generation legitimately takes seconds. */
export const PROBE_TIMEOUT_MS = 25_000

/** Which SDK endpoint each slot exercises (shown in verdicts + docs). */
export const SLOT_ENDPOINT: Record<string, string> = {
  text: 'POST {base}/chat/completions',
  vision: 'POST {base}/chat/completions',
  image: 'POST {base}/images/generations',
  imageEdit: 'POST {base}/images/generations/edit',
  imageSearch: 'POST {base}/images/search',
}

export interface ProbeVerdict {
  ok: boolean
  slot: string
  endpoint: string
  httpStatus: number | null
  message: string
}

/** Classify a thrown probe error into an admin-actionable verdict. */
export function classifyProbeError(slot: string, err: unknown): ProbeVerdict {
  const raw = err instanceof Error ? err.message : String(err)
  const m = raw.match(/status (\d{3})/i)
  const status = m ? Number(m[1]) : null
  const endpoint = SLOT_ENDPOINT[slot] ?? 'provider endpoint'
  const clean = raw
    .replace(/(nvapi-|sk-|gsk_|pk-|rk-|ak-|xai-|hf_|Bearer\s+)[A-Za-z0-9_\-]{8,}/gi, '$1***')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 220)

  if (status === 404 || status === 405) {
    return {
      ok: false,
      slot,
      endpoint,
      httpStatus: status,
      message:
        `The provider answered ${status} for ${endpoint.replace('{base}', 'its base URL')} — it does not serve this ` +
        `endpoint, so the ${slot === 'text' || slot === 'vision' ? 'chat' : slot} capability cannot run on it. ` +
        `Chat-only providers (e.g. NVIDIA NIM) work for text and vision but cannot generate images or edit them — ` +
        `pin those slots to a provider that serves image endpoints (e.g. Z.ai, OpenAI).`,
    }
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      slot,
      endpoint,
      httpStatus: status,
      message: `The provider rejected the credentials (HTTP ${status}) — check the API key for this provider.`,
    }
  }
  if (status !== null && status >= 400 && status < 500) {
    return {
      ok: true, // endpoint exists and answered — request shape rejected, expected for empty probes
      slot,
      endpoint,
      httpStatus: status,
      message: `Endpoint is reachable (HTTP ${status} rejecting the minimal probe — expected for this test shape). ` +
        `The provider serves ${endpoint.replace('{base}', 'this route')}; ${clean}`,
    }
  }
  return {
    ok: false,
    slot,
    endpoint,
    httpStatus: status,
    message: clean || 'The provider did not answer in time.',
  }
}

/** What a probe needs to reach the provider (never logged verbatim —
 * the apiKey rides in the SDK client only). */
export interface ProbeTarget {
  baseUrl: string
  apiKey: string
  model?: string
  label: string
  source: string
}

/** Probe ONE capability slot through its real endpoint (A3). Provider
 * errors are CAUGHT and classified — a rejection is a verdict, not an
 * exception; only unexpected throws (client construction) propagate. */
export async function probeSlot(slot: string, target: ProbeTarget): Promise<{ verdict: ProbeVerdict; reply?: string }> {
  const zai = await makeClient(target.baseUrl, target.apiKey)
  const model = target.model
  const withTimeout = <T,>(p: Promise<T>): Promise<T> => {
    return Promise.race([
      p,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error('provider timed out')), PROBE_TIMEOUT_MS)
      }),
    ])
  }

  if (slot === 'image') {
    try {
      const r = await withTimeout(
        zai.images.generations.create({
          ...(model ? { model } : {}),
          prompt: 'a small solid red circle on a white background',
          size: '1024x1024',
        })
      )
      // v0.16.3 (A3): OpenAI-compatible providers answer b64_json — the
      // same fallback the image route applies.
      const item = (r as { data?: { base64?: string; b64_json?: string }[] }).data?.[0]
      const has = Boolean(item?.base64 ?? item?.b64_json)
      return {
        verdict: {
          ok: true,
          slot,
          endpoint: SLOT_ENDPOINT.image,
          httpStatus: 200,
          message: has
            ? 'Generated a test image end-to-end — the full path works.'
            : 'The provider answered but returned no image data — check the Logs view for its error (prompt filters reject benign probes now and then).',
        },
      }
    } catch (err) {
      return { verdict: classifyProbeError(slot, err) }
    }
  }
  if (slot === 'imageEdit') {
    try {
      // deliberately image-less: a 400-class rejection proves the route
      // exists without spending an edit
      await withTimeout(
        zai.images.generations.edit({
          ...(model ? { model } : {}),
          prompt: 'probe',
        } as unknown as Parameters<typeof zai.images.generations.edit>[0])
      )
      return {
        verdict: {
          ok: true,
          slot,
          endpoint: SLOT_ENDPOINT.imageEdit,
          httpStatus: 200,
          message: 'The edit endpoint accepted the probe.',
        },
      }
    } catch (err) {
      return { verdict: classifyProbeError(slot, err) }
    }
  }
  if (slot === 'imageSearch') {
    try {
      const r = await withTimeout(zai.images.search.create({ query: 'red circle', count: 1 }))
      const n = (r as { results?: unknown[] }).results?.length ?? 0
      return {
        verdict: {
          ok: true,
          slot,
          endpoint: SLOT_ENDPOINT.imageSearch,
          httpStatus: 200,
          message: n
            ? `Search answered with ${n} result${n === 1 ? '' : 's'} — the full path works.`
            : 'Search answered but returned no results.',
        },
      }
    } catch (err) {
      return { verdict: classifyProbeError(slot, err) }
    }
  }
  // text / vision — the existing minimal chat completion
  const completion = await withTimeout(
    zai.chat.completions.create({
      ...(model ? { model } : {}),
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      thinking: { type: 'disabled' },
    })
  )
  const reply = String(
    (completion as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? ''
  ).slice(0, 120)
  return {
    verdict: { ok: true, slot, endpoint: SLOT_ENDPOINT[slot] ?? 'chat', httpStatus: 200, message: 'Chat completion answered.' },
    reply,
  }
}
