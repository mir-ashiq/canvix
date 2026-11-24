// ─────────────────────────────────────────────────────────────
// DesignAgent · the BYOK production adapter (Phase B P0-B).
//
// Bridges the pipeline's DesignAgentModel seam onto Canvix's
// provider system (src/lib/ai/provider.ts): the same resolution
// chain (user BYOK providers → instance multi/db/env/file), the
// same SDK client, the same JSON-mode-with-fallback call shape the
// shipped design-spec normalizer uses.
//
// · plan     → text slot:  chat.completions.create (json_object
//             response_format, plain-text fallback on error)
// · critique → vision slot: chat.completions.createVision over the
//             rendered image (omitted entirely when no vision
//             provider exists — the pipeline then discloses
//             'visual verification unavailable', fail-closed)
//
// The adapter is a PURE function of ProviderContext — unit tests
// stub the SDK client, no network, no provider resolution.
// ─────────────────────────────────────────────────────────────

import { DEFAULT_VISION_MODEL, type ProviderContext } from '@/lib/ai/provider'
import type { DesignAgentModel, PlanRequest, CritiqueRequest } from './model'
import { PLANNER_SYSTEM, planUserPrompt, revisionUserPrompt, CRITIQUE_SYSTEM, critiqueUserPrompt } from './prompts'

/** The SDK's chat completion type (loose — the shape we read). */
interface CompletionLike {
  choices?: { message?: { content?: string } }[]
}

/** Minimal SDK client surface the adapter consumes. */
interface ZaiLike {
  chat: {
    completions: {
      create: (args: Record<string, unknown>) => Promise<CompletionLike>
      createVision: (args: Record<string, unknown>) => Promise<CompletionLike>
    }
  }
}

/**
 * Build a DesignAgentModel from resolved provider contexts.
 * `text` is required (the planner); `vision` is optional — without
 * it the model has no critique capability and the pipeline reports
 * visual verification as unavailable rather than skipping silently.
 */
export function byokDesignAgentModel(text: ProviderContext, vision?: ProviderContext | null): DesignAgentModel {
  const textZai = text.zai as unknown as ZaiLike

  /** one planner call: JSON mode first, plain fallback (the SDK's
   * json_object support varies by endpoint — same recovery the
   * design-spec normalizer uses) */
  async function plan(req: PlanRequest): Promise<string> {
    const system = PLANNER_SYSTEM
    const user = req.feedback ? revisionUserPrompt(req.feedback) : planUserPrompt(req.brief)
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]
    try {
      const completion = (await textZai.chat.completions.create({
        ...(text.model ? { model: text.model } : {}),
        messages,
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
      })) as CompletionLike
      return completion.choices?.[0]?.message?.content ?? ''
    } catch {
      const completion = (await textZai.chat.completions.create({
        ...(text.model ? { model: text.model } : {}),
        messages,
        thinking: { type: 'disabled' },
      })) as CompletionLike
      return completion.choices?.[0]?.message?.content ?? ''
    }
  }

  const model: DesignAgentModel = { plan }

  if (vision) {
    const visionZai = vision.zai as unknown as ZaiLike
    model.critique = async (req: CritiqueRequest): Promise<string> => {
      const completion = (await visionZai.chat.completions.createVision({
        model: vision.model ?? DEFAULT_VISION_MODEL,
        messages: [
          { role: 'system', content: CRITIQUE_SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'text', text: critiqueUserPrompt(req.brief) },
              { type: 'image_url', image_url: { url: req.image } },
            ],
          },
        ],
        thinking: { type: 'disabled' },
      })) as CompletionLike
      return completion.choices?.[0]?.message?.content ?? ''
    }
  }

  return model
}
