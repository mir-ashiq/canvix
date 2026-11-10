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

  // ── v0.22: the z-ai async-result dialect ────────────────────

  it('maps the z-ai PROCESSING envelope to in_progress with zero videos', () => {
    const s = normalizeVideoStatus(
      { id: 'abc', model: 'cogvideox-3', task_status: 'PROCESSING' },
      'z:abc',
    )
    expect(s.status).toBe('in_progress')
    expect(s.progress).toBe(50)
    expect(s.videos).toEqual([])
  })

  it('maps the z-ai SUCCESS envelope to completed with proxy URLs (prefix preserved)', () => {
    const s = normalizeVideoStatus(
      {
        task_status: 'SUCCESS',
        video_result: [
          { url: 'https://cdn.example/a.mp4', cover_image_url: 'https://cdn.example/a.png' },
        ],
      },
      'z:abc123',
    )
    expect(s.status).toBe('completed')
    expect(s.progress).toBe(100)
    // the "z:" prefix rides along — the next poll and the video element
    // src keep routing to the z-ai dialect
    expect(s.videos).toEqual([{ index: 0, url: '/api/ai/video?id=z%3Aabc123&content=1&index=0' }])
  })

  it('maps z-ai FAIL statuses to failed and caps video_result at 4', () => {
    const s = normalizeVideoStatus({ task_status: 'FAIL' }, 'z:x')
    expect(s.status).toBe('failed')
    expect(s.progress).toBe(0)
    const many = normalizeVideoStatus(
      { task_status: 'SUCCESS', video_result: Array.from({ length: 7 }, (_, i) => ({ url: `u${i}` })) },
      'z:y',
    )
    expect(many.videos).toHaveLength(4)
    expect(many.videos.map((v) => v.index)).toEqual([0, 1, 2, 3])
  })

  it('z-ai error strings ride the error field (200-char cap)', () => {
    const s = normalizeVideoStatus({ task_status: 'FAIL', error: 'x'.repeat(400) }, 'z:e')
    expect(s.error).toHaveLength(200)
  })
})
