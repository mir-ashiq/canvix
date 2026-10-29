/**
 * hlc — hybrid logical clock (v0.10 offline merge).
 *
 * Canvix converges concurrent/offline edits with per-element
 * last-write-wins registers. "Last" must be a *causality-aware* total
 * order, not wall-clock arrival: two editors with skewed clocks, or one
 * replaying a queue after hours offline, must agree on which write wins
 * no matter who applies what first.
 *
 * An HLC timestamp is  `walltime-ms : counter : actor`  (strings compare
 * correctly because walltime and counter are zero-padded). It combines
 * Kulkarni et al.'s rules:
 *   - `now()`  = max(local clock, last issued, last observed) + 1 tick
 *   - `observe(h)` absorbs remote stamps so causality always moves forward
 *   - ties break on the actor id — a strict total order
 *
 * Properties we rely on (locked by tests):
 *   - monotonic within an actor across restarts (state persisted)
 *   - a.b ⇒ a < b whenever a happened-before b (absorbed)
 *   - two different actors never issue equal stamps
 */

const STORAGE_KEY = 'canvix-hlc'

export interface HlcState {
  /** last issued/observed walltime (ms) */
  w: number
  /** logical tick within the same walltime */
  c: number
}

/** serialize as "w:c:actor" with zero-padding so plain string compare works */
export function formatHlc(w: number, c: number, actor: string): string {
  return `${w.toString(36).padStart(10, '0')}:${c.toString(36).padStart(5, '0')}:${actor}`
}

export function parseHlc(h: string): { w: number; c: number; actor: string } | null {
  try {
    const i = h.indexOf(':')
    const j = h.indexOf(':', i + 1)
    if (i < 0 || j < 0) return null
    const w = Number.parseInt(h.slice(0, i), 36)
    const c = Number.parseInt(h.slice(i + 1, j), 36)
    const actor = h.slice(j + 1)
    if (!Number.isFinite(w) || !Number.isFinite(c) || !actor) return null
    return { w, c, actor }
  } catch {
    return null
  }
}

/** epoch stamp — the implicit value of unstamped (legacy) data */
export const HLC_EPOCH = '0000000000:00000:'

/** total order on stamps; malformed strings sort as epoch (oldest) */
export function compareHlc(a: string | undefined, b: string | undefined): number {
  const sa = a && a.length ? a : HLC_EPOCH
  const sb = b && b.length ? b : HLC_EPOCH
  if (sa === sb) return 0
  return sa < sb ? -1 : 1
}

export function hlcIsNewer(h: string | undefined, than: string | undefined): boolean {
  return compareHlc(h, than) > 0
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/**
 * One clock per browser tab-cluster. State persists in localStorage under
 * the participant id (see identity.ts) so restarts stay monotonic; when
 * storage is unavailable (SSR, private mode) the clock degrades to
 * walltime + in-memory ticks — still safe within a session.
 */
export class HybridLogicalClock {
  private state: HlcState
  private readonly actor: string
  private readonly storage: StorageLike | null
  private readonly now: () => number

  constructor(actor: string, storage?: StorageLike | null, nowFn?: () => number) {
    this.actor = actor || 'anon'
    this.storage = storage ?? null
    this.now = nowFn ?? (() => Date.now())
    let loaded: HlcState | null = null
    if (this.storage) {
      try {
        const raw = this.storage.getItem(STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<HlcState>
          if (typeof parsed.w === 'number' && typeof parsed.c === 'number') loaded = { w: parsed.w, c: parsed.c }
        }
      } catch {
        /* corrupted state — fall back to walltime */
      }
    }
    this.state = loaded ?? { w: this.now(), c: 0 }
  }

  /** issue a new stamp (monotonic; persists state) */
  nowHlc(): string {
    const wall = this.now()
    if (wall > this.state.w) this.state = { w: wall, c: 0 }
    else this.state = { ...this.state, c: this.state.c + 1 }
    this.persist()
    return formatHlc(this.state.w, this.state.c, this.actor)
  }

  /** absorb a remote stamp (call whenever a remote op is applied) */
  observe(h: string | undefined): void {
    if (!h) return
    const parsed = parseHlc(h)
    if (!parsed) return
    const wall = this.now()
    if (parsed.w > this.state.w || (parsed.w === this.state.w && parsed.c > this.state.c)) {
      // remote is ahead — jump to it, then bias the local tick upward
      this.state = { w: Math.max(parsed.w, wall), c: parsed.c + (parsed.w >= wall ? 1 : 0) }
    } else if (wall > this.state.w) {
      this.state = { w: wall, c: 0 }
    }
    this.persist()
  }

  private persist() {
    if (!this.storage) return
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    } catch {
      /* quota/private mode — in-memory monotonicity only */
    }
  }
}

/** Module singleton — created lazily on first use in the browser. */
let singleton: HybridLogicalClock | null = null

export function getClock(actor?: string): HybridLogicalClock {
  if (!singleton) {
    const storage = typeof localStorage !== 'undefined' ? localStorage : null
    singleton = new HybridLogicalClock(actor ?? 'anon', storage)
  }
  return singleton
}

/** test hook — drop the singleton so a fresh actor/storage can be injected */
export function resetClock(): void {
  singleton = null
}
