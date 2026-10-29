// ─────────────────────────────────────────────────────────────
// v0.10 offline merge — offline-store arbitration logic
//
// The IndexedDB wrapper itself is thin and browser-bound; what MUST be
// correct is the restore decision (which copy wins when the editor opens)
// and the queue record round-trip shape.
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { decideRestore, MAX_QUEUE, type OfflineDoc } from './offline-store'

function doc(over: Partial<OfflineDoc> = {}): OfflineDoc {
  return {
    designId: 'd1',
    name: 'Offline work',
    width: 1080,
    height: 1080,
    pages: [{ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements: [] }],
    baseUpdatedAt: '2026-10-29T00:00:00.000Z',
    seq: 42,
    savedAt: Date.parse('2026-10-29T12:00:00.000Z'),
    ...over,
  }
}

describe('decideRestore (offline restore arbitration)', () => {
  it('restores when the persisted queue holds unsynced ops', () => {
    const d = decideRestore(doc(), '2026-10-29T13:00:00.000Z', 7)
    expect(d.restore).toBe(true)
    expect(d.reason).toBe('queue')
  })

  it('restores when the local doc is newer than the server save (failed autosave)', () => {
    // server last saved at 10:00, local mirror persisted at 12:00
    const d = decideRestore(doc(), '2026-10-29T10:00:00.000Z', 0)
    expect(d.restore).toBe(true)
    expect(d.reason).toBe('newer-doc')
  })

  it('does NOT restore when the server copy is current and queue is empty', () => {
    // server saved at 12:00:05 — newer than our mirror at 12:00:00
    const d = decideRestore(doc(), '2026-10-29T12:00:05.000Z', 0)
    expect(d.restore).toBe(false)
    expect(d.reason).toBe('none')
  })

  it('tolerates clock jitter (2s grace window)', () => {
    const d = decideRestore(doc(), '2026-10-29T12:00:01.500Z', 0)
    expect(d.restore).toBe(false)
  })

  it('no local doc → never restore', () => {
    expect(decideRestore(null, '2026-10-29T10:00:00.000Z', 0).restore).toBe(false)
    // even a queue without a doc cannot restore the document (the session
    // still flushes the ops themselves — that path is independent)
    expect(decideRestore(null, undefined, 5).restore).toBe(false)
  })

  it('missing server timestamp → only a non-empty queue restores (conservative)', () => {
    expect(decideRestore(doc(), undefined, 0).restore).toBe(false)
    expect(decideRestore(doc(), undefined, 1).restore).toBe(true)
  })

  it('queue cap is a hard bound', () => {
    expect(MAX_QUEUE).toBeGreaterThanOrEqual(200)
  })
})
