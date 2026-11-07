// Unit tests for per-slot provider probing (v0.16.3 A3) — the
// classification that turns a provider's answer into the verdict the
// admin acts on. The production incident this encodes: NVIDIA NIM
// (chat-only) pinned to every slot — text tests passed while image
// generation 404'd with no explanation anywhere the admin could see.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const chatCreate = vi.fn(async () => ({ choices: [{ message: { content: 'ok' } }] }))
const generationsCreate = vi.fn(async () => ({ data: [{ base64: 'aGk=' }] }))
const generationsEdit = vi.fn(async () => ({ data: [{ base64: 'aGk=' }] }))
const searchCreate = vi.fn(async () => ({ results: [{ original_url: 'https://x/y.jpg' }] }))

vi.mock('z-ai-web-dev-sdk', () => ({
  default: class MockZAI {
    chat: unknown
    images: unknown
    constructor(_config: { baseUrl?: string; apiKey?: string }) {
      this.chat = { completions: { create: chatCreate } }
      this.images = {
        generations: { create: generationsCreate, edit: generationsEdit },
        search: { create: searchCreate },
      }
    }
  },
}))

import { classifyProbeError, probeSlot, SLOT_ENDPOINT } from './probe'

const TARGET = { baseUrl: 'https://provider.test/v1', apiKey: 'k', label: 'Test Provider', source: 'multi' }

beforeEach(() => {
  vi.clearAllMocks()
  chatCreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] })
  generationsCreate.mockResolvedValue({ data: [{ base64: 'aGk=' }] })
  generationsEdit.mockResolvedValue({ data: [{ base64: 'aGk=' }] })
  searchCreate.mockResolvedValue({ results: [{ original_url: 'https://x/y.jpg' }] })
})

describe('classifyProbeError (A3)', () => {
  it('a 404 from the image endpoint is a NOT-SERVED verdict that names the fix', () => {
    const v = classifyProbeError('image', new Error('API request failed with status 404: 404 page not found'))
    expect(v.ok).toBe(false)
    expect(v.httpStatus).toBe(404)
    expect(v.endpoint).toBe(SLOT_ENDPOINT.image)
    expect(v.message).toContain('does not serve this endpoint')
    expect(v.message).toContain('cannot generate images')
  })

  it('a 401 is a credentials verdict', () => {
    const v = classifyProbeError('text', new Error('API request failed with status 401: bad key'))
    expect(v.ok).toBe(false)
    expect(v.httpStatus).toBe(401)
    expect(v.message).toContain('credentials')
  })

  it('a 400-class answer to a deliberately-empty probe PROVES the endpoint exists', () => {
    const v = classifyProbeError('imageEdit', new Error('API request failed with status 400: must provide images'))
    expect(v.ok).toBe(true) // reachable — that is the signal
    expect(v.httpStatus).toBe(400)
    expect(v.message).toContain('reachable')
  })

  it('5xx and unknown errors are failures with the scrubbed reason', () => {
    const v = classifyProbeError('image', new Error('API request failed with status 502: upstream nvapi-SecretSecret99 blew up'))
    expect(v.ok).toBe(false)
    expect(v.httpStatus).toBe(502)
    expect(v.message).toContain('nvapi-***')
    expect(v.message).not.toContain('SecretSecret99')
  })
})

describe('probeSlot (A3)', () => {
  it('image success is a full end-to-end verdict', async () => {
    const out = await probeSlot('image', TARGET)
    expect(out.verdict.ok).toBe(true)
    expect(out.verdict.httpStatus).toBe(200)
    expect(out.verdict.message).toContain('end-to-end')
    expect(generationsCreate).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.any(String) }))
  })

  it('image 404 becomes a classified verdict, never a thrown error', async () => {
    generationsCreate.mockRejectedValueOnce(new Error('API request failed with status 404: 404 page not found'))
    const out = await probeSlot('image', TARGET)
    expect(out.verdict.ok).toBe(false)
    expect(out.verdict.httpStatus).toBe(404)
  })

  it('imageEdit probe sends no image (400-class = exists) and classifies the rejection', async () => {
    generationsEdit.mockRejectedValueOnce(new Error('API request failed with status 422: images required'))
    const out = await probeSlot('imageEdit', TARGET)
    expect(generationsEdit).toHaveBeenCalledWith(expect.not.objectContaining({ images: expect.anything() }))
    expect(out.verdict.ok).toBe(true) // endpoint reachable
    expect(out.verdict.message).toContain('reachable')
  })

  it('imageSearch reports the result count', async () => {
    const out = await probeSlot('imageSearch', TARGET)
    expect(out.verdict.ok).toBe(true)
    expect(out.verdict.message).toContain('1 result')
  })

  it('text slot goes through chat completions and returns the reply', async () => {
    const out = await probeSlot('text', TARGET)
    expect(out.verdict.ok).toBe(true)
    expect(out.reply).toBe('ok')
    expect(chatCreate).toHaveBeenCalled()
  })
})
