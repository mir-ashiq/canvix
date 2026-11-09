// Wave 4 — /api/ai/video status normalizer tests.
import { describe, expect, it } from 'vitest'
import { normalizeVideoStatus } from '@/app/api/ai/video/route'

describe('normalizeVideoStatus', () => {
  it('passes through the Sora-style shape and builds proxy URLs', () => {
    const s = normalizeVideoStatus(
      {
        id: 'batch_123',
        status: 'completed',
        progress: 100,
        videos: [
          { index: 0, id: 'v1', url: 'https://cdn.example/x.mp4', download_path: '/v1/videos/generations/batch_123/content?index=0' },
          { index: 1, id: 'v2', url: 'https://cdn.example/y.mp4' },
        ],
      },
      'batch_123',
    )
    expect(s.status).toBe('completed')
    expect(s.progress).toBe(100)
    expect(s.videos).toEqual([
      { index: 0, url: '/api/ai/video?id=batch_123&content=1&index=0' },
      { index: 1, url: '/api/ai/video?id=batch_123&content=1&index=1' },
    ])
  })

  it('clamps progress and maps unknown statuses to in_progress', () => {
    const s = normalizeVideoStatus({ status: 'weird', progress: 500 }, 'x')
    expect(s.status).toBe('in_progress')
    expect(s.progress).toBe(100)
    const s2 = normalizeVideoStatus({ progress: -3 }, 'x')
    expect(s2.progress).toBe(0)
    expect(s2.status).toBe('in_progress')
  })

  it('carries errors and survives garbage', () => {
    const s = normalizeVideoStatus({ status: 'failed', error: 'boom' }, 'x')
    expect(s.status).toBe('failed')
    expect(s.error).toBe('boom')
    expect(() => normalizeVideoStatus(null, 'x')).not.toThrow()
    expect(normalizeVideoStatus('junk', 'x').videos).toEqual([])
    // non-integer indexes fall back to array position
    const s2 = normalizeVideoStatus({ status: 'completed', videos: [{ index: 'nope' }] }, 'x')
    expect(s2.videos[0].index).toBe(0)
  })

  it('caps the video list at 4', () => {
    const s = normalizeVideoStatus(
      { status: 'completed', videos: Array.from({ length: 9 }, (_, i) => ({ index: i })) },
      'x',
    )
    expect(s.videos).toHaveLength(4)
  })
})
