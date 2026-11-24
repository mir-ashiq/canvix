import { describe, expect, it } from 'vitest'
import { byokDesignAgentModel } from './byok-adapter'
import { PLANNER_SYSTEM, planUserPrompt, revisionUserPrompt, CRITIQUE_SYSTEM, critiqueUserPrompt } from './prompts'
import type { ProviderContext } from '@/lib/ai/provider'
import { extractBrief } from '@/lib/agent/brief'
import type { RevisionFeedback } from './model'
import type { DesignSpec } from '@/lib/design-spec/types'

/**
 * The BYOK adapter proven with STUB SDK clients — no network, no
 * provider resolution. Asserts the call SHAPES (messages, JSON mode,
 * fallback, vision) that the provider system will execute, and that
 * the adapter composes with the pipeline's model seam.
 */

/** A stub SDK client that records every call. */
function stubZai(planReplies: string[], visionReply = '', failJsonMode = false) {
  const calls: { kind: 'chat' | 'vision'; args: Record<string, unknown> }[] = []
  let planIdx = 0
  return {
    calls,
    zai: {
      chat: {
        completions: {
          create: async (args: Record<string, unknown>) => {
            calls.push({ kind: 'chat', args })
            if (failJsonMode && (args as { response_format?: unknown }).response_format) {
              throw new Error('endpoint does not support json_object')
            }
            const reply = planReplies[Math.min(planIdx++, planReplies.length - 1)]
            return { choices: [{ message: { content: reply } }] }
          },
          createVision: async (args: Record<string, unknown>) => {
            calls.push({ kind: 'vision', args })
            return { choices: [{ message: { content: visionReply } }] }
          },
        },
      },
    },
  }
}

function ctxOf(zai: unknown, model?: string): ProviderContext {
  return { zai: zai as ProviderContext['zai'], model, label: 'stub', source: 'user' }
}

const PROMPT = 'Create a poster. Must show "Launch Week 2026". Use #123456. Size 1080x1350.'

describe('byokDesignAgentModel · the plan seam', () => {
  it('sends the planner system + brief prompt with JSON mode and returns the model text', async () => {
    const specReply = '{"version":"v2"}'
    const { zai, calls } = stubZai([specReply])
    const model = byokDesignAgentModel(ctxOf(zai, 'glm-4-plus'))
    const brief = extractBrief(PROMPT)

    const raw = await model.plan({ brief, toolbox: 'toolbox' })

    expect(raw).toBe(specReply)
    const chat = calls.find((c) => c.kind === 'chat')
    expect(chat).toBeTruthy()
    const messages = chat!.args.messages as { role: string; content: string }[]
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain(PLANNER_SYSTEM.slice(0, 40))
    expect(messages[1].content).toContain('Launch Week 2026')
    expect(chat!.args.model).toBe('glm-4-plus')
    expect(chat!.args.response_format).toEqual({ type: 'json_object' })
  })

  it('a revision round sends the Reflexion-style feedback prompt', async () => {
    const { zai, calls } = stubZai(['{"version":"v2"}'])
    const model = byokDesignAgentModel(ctxOf(zai))
    const brief = extractBrief(PROMPT)
    const feedback: RevisionFeedback = {
      round: 1,
      failures: ['required text missing from the spec — add it as ONE user-required slot with exactly this text: "Launch Week 2026"'],
      warnings: [],
      priorSpec: { version: 'v2', name: 'x', format: { width: 1080, height: 1350 }, palette: { seeds: ['#123456'], mood: 'cool' }, typography: {}, blocks: [] } as unknown as DesignSpec,
      origin: 'checks',
    }

    await model.plan({ brief, toolbox: 'toolbox', feedback })

    const chat = calls.find((c) => c.kind === 'chat')!
    const messages = chat.args.messages as { role: string; content: string }[]
    expect(messages[1].content).toContain(revisionUserPrompt(feedback).slice(0, 30))
    expect(messages[1].content).toContain('required text missing from the spec')
    expect(messages[1].content).toContain('"version": "v2"') // the prior spec JSON rides along
  })

  it('falls back to plain completion when the endpoint rejects JSON mode', async () => {
    const { zai, calls } = stubZai(['{"ok":true}'], '', true)
    const model = byokDesignAgentModel(ctxOf(zai))

    const raw = await model.plan({ brief: extractBrief(PROMPT), toolbox: 't' })

    expect(raw).toBe('{"ok":true}')
    // two chat calls: the failed JSON-mode one, then the fallback
    const chatCalls = calls.filter((c) => c.kind === 'chat')
    expect(chatCalls).toHaveLength(2)
    expect(chatCalls[0].args.response_format).toEqual({ type: 'json_object' })
    expect(chatCalls[1].args.response_format).toBeUndefined()
  })
})

describe('byokDesignAgentModel · the critique seam', () => {
  it('sends the calibrated critique system + image to the vision model', async () => {
    const visionReply = '{"summary":"s","issues":[{"severity":"P2","issue":"gappy"}]}'
    const { zai, calls } = stubZai(['{}'], visionReply)
    const text = stubZai(['{}'])
    const model = byokDesignAgentModel(ctxOf(text.zai), ctxOf(zai, 'glm-4.5v'))
    const brief = extractBrief(PROMPT)

    const raw = await model.critique!({ brief, image: 'data:image/svg+xml;base64,AAA' })

    expect(raw).toBe(visionReply)
    const vision = calls.find((c) => c.kind === 'vision')
    expect(vision).toBeTruthy()
    expect(vision!.args.model).toBe('glm-4.5v')
    const messages = vision!.args.messages as { role: string; content: unknown }[]
    expect(messages[0].content).toContain(CRITIQUE_SYSTEM.slice(0, 30))
    const userContent = messages[1].content as { type: string; text?: string; image_url?: { url: string } }[]
    expect(userContent[1].image_url?.url).toBe('data:image/svg+xml;base64,AAA')
    expect(String(userContent[0].text)).toContain(critiqueUserPrompt(brief).slice(0, 20))
  })

  it('no vision context → no critique capability (the pipeline discloses unavailable)', async () => {
    const { zai } = stubZai(['{}'])
    const model = byokDesignAgentModel(ctxOf(zai), null)
    expect(model.critique).toBeUndefined()
  })

  it('the vision model falls back to DEFAULT_VISION_MODEL when ctx has none', async () => {
    const { zai, calls } = stubZai(['{}'], '{}')
    const text = stubZai(['{}'])
    const model = byokDesignAgentModel(ctxOf(text.zai), ctxOf(zai))
    await model.critique!({ brief: extractBrief(PROMPT), image: 'x' })
    expect(calls.find((c) => c.kind === 'vision')!.args.model).toBe('glm-4.5v')
  })
})
