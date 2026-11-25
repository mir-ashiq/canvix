// Unit tests for the design-agent client (v0.31) — the panel's typed
// seam to POST /api/ai/design-agent. Verifies response parsing for
// every status the route emits (200 / 422 / 499 / 429 / 503) plus the
// post-apply critique helper's honest 503 handling.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { requestDesignAgent, critiqueAppliedCanvas } from './client'

const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

const FULL_BODY = {
  outcome: 'passed',
  pages: [{ id: 'p1', background: { type: 'solid', color: '#fff' }, elements: [] }],
  briefConformance: [],
  warnings: ['vision slot missing'],
  report: {
    stages: [{ name: 'plan', ok: true, detail: 'round 1', modelCall: true }],
    modelCalls: 5,
    revisionRounds: 2,
    cycleGuard: false,
    brief: { requiredTexts: [{ text: '12km' }], requiredColors: [{ hex: '#1B4F9C' }], restrictions: [], notes: [] },
    spec: { format: { width: 1080, height: 1350, preset: 'instagram-portrait' } },
    limits: { maxRevisions: 3, maxVisualPasses: 1 },
    visualPasses: [],
    visualVerification: 'unavailable',
  },
}

describe('requestDesignAgent', () => {
  it('parses a passing run: pages, format from the report, brief, warnings', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, FULL_BODY))
    const r = await requestDesignAgent('a poster', { visual: true, maxRevisions: 3 })
    expect(r.outcome).toBe('passed')
    expect(r.pages).toHaveLength(1)
    expect(r.format).toEqual({ width: 1080, height: 1350 })
    expect(r.briefConformance).toEqual([])
    expect(r.warnings).toEqual(['vision slot missing'])
    expect(r.report?.modelCalls).toBe(5)
    expect(r.error).toBeUndefined()
    // the request body carried the panel options
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(sent).toEqual({ prompt: 'a poster', visual: true, maxRevisions: 3 })
  })

  it('a 422 honest failure is a RESULT (evidence preserved), not an error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, {
      outcome: 'failed-honestly',
      pages: FULL_BODY.pages,
      briefConformance: ['required text "12km" not found in any text slot'],
      warnings: [],
      report: FULL_BODY.report,
    }))
    const r = await requestDesignAgent('a poster')
    expect(r.outcome).toBe('failed-honestly')
    expect(r.pages).toHaveLength(1) // best attempt still reviewable
    expect(r.briefConformance[0]).toContain('12km')
    expect(r.error).toBeUndefined()
  })

  it('a 499 abort maps to the aborted outcome', async () => {
    fetchMock.mockResolvedValue(jsonResponse(499, { outcome: 'aborted', pages: [], briefConformance: [], warnings: [], report: null }))
    const r = await requestDesignAgent('a poster')
    expect(r.outcome).toBe('aborted')
    expect(r.pages).toEqual([])
  })

  it('pre-pipeline rejections (503/429) synthesize a readable error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: 'no provider configured for the text slot' }))
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'Too many requests' }))
    fetchMock.mockResolvedValueOnce(jsonResponse(503, {})) // no body → status hint

    const a = await requestDesignAgent('x')
    expect(a.outcome).toBe('failed-honestly')
    expect(a.error).toBe('no provider configured for the text slot')

    const b = await requestDesignAgent('x')
    expect(b.error).toBe('Too many requests')

    const c = await requestDesignAgent('x')
    expect(c.error).toContain('unavailable')
  })

  it('a body-less 200 degrades safely (empty arrays, null report/format)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}))
    const r = await requestDesignAgent('x')
    expect(r.outcome).toBe('failed-honestly')
    expect(r.pages).toEqual([])
    expect(r.briefConformance).toEqual([])
    expect(r.report).toBeNull()
    expect(r.format).toBeNull()
  })

  it('propagates AbortError so the panel can show its stopped state', async () => {
    const err = new Error('aborted')
    err.name = 'AbortError'
    fetchMock.mockRejectedValue(err)
    await expect(requestDesignAgent('x')).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('critiqueAppliedCanvas', () => {
  it('returns findings on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { findings: [{ severity: 'P1', issue: 'title clipped', fix: 'shrink' }] }))
    const r = await critiqueAppliedCanvas('data:image/jpeg;base64,x', { requiredTexts: [{ text: 'A' }], requiredColors: [] })
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]!.issue).toBe('title clipped')
  })

  it('a 503 is honest availability, not a failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { available: false }))
    const r = await critiqueAppliedCanvas('data:image/jpeg;base64,x', { requiredTexts: [], requiredColors: [] })
    expect(r.findings).toEqual([])
    expect(r.note).toContain('no vision model')
  })

  it('other failures surface the route error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'image must be a data URL from the canvas capture.' }))
    const r = await critiqueAppliedCanvas('not-a-data-url', { requiredTexts: [], requiredColors: [] })
    expect(r.findings).toEqual([])
    expect(r.note).toContain('data URL')
  })
})
