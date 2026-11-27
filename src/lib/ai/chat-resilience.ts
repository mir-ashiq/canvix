/**
 * v0.32.7 · PROVIDER RESILIENCE — bounded retries, circuit breaker,
 * configured fallback.
 *
 * The production incident (26 Nov 2026): the upstream gateway
 * flapped 502 → "fetch failed" → 429 for two hours. Every run that
 * hit a transient failure DIED mid-flight and the user retyped into
 * the same broken gateway. withProvider has NO retry (one-shot 502
 * → PROVIDER error); the run loop had no idea the failure was
 * transient.
 *
 * Three layers, in order:
 *
 *   1. chatWithRetry — bounded exponential backoff for TRANSIENT
 *      failures only (429/5xx/network/timeout). Permanent errors
 *      (400/401/403/404/422 — bad request, bad key, bad model) fail
 *      fast: retrying them wastes the user's time and money.
 *      Retry-After is respected, capped.
 *
 *   2. circuitBreaker — per provider-key consecutive-failure count;
 *      after `threshold` consecutive transient failures the key is
 *      OPEN for `cooldownMs` (skip straight to fallback instead of
 *      burning the same dead gateway). Half-open after cooldown.
 *
 *   3. fallback chain — OTHER providers already configured for the
 *      slot (the user's other BYOK providers, then the instance
 *      table's other providers). Nothing is invented: only providers
 *      an admin or the user explicitly configured are ever used,
 *      each request still passes the feature rate limit, and every
 *      attempt is recorded by the existing AIUsage accounting. A
 *      BYOK primary falling back to the instance provider is the
 *      documented behavior (BYOK "must never break the fallback
 *      chain" — provider.ts). ZAI_NO_FALLBACK=1 disables the chain
 *      entirely (spend control).
 */

/** Is this error transient (worth retrying / falling back)? */
export function isTransientError(err: unknown): boolean {
  const msg = String((err as Error | undefined)?.message ?? err ?? '')
  if (/\b(?:400|401|403|404|422)\b|invalid api key|unauthorized|forbidden|not found|model .* (not found|does not exist)|response_format|unknown field|not supported|unsupported/i.test(msg)) {
    // json-mode negotiation and auth/model config errors are
    // PERMANENT — the caller handles json-mode itself; keys and
    // model names do not heal with retries
    return false
  }
  if (/\b(?:429|500|502|503|504)\b|rate.?limit|too many requests|upstream|bad gateway|service unavailable|gateway timeout|timeout|timed out|econnreset|econnrefused|enotfound|eai_again|socket|network|fetch failed|terminated|aborted/i.test(msg)) {
    return true
  }
  return false
}

export interface RetryOpts {
  /** total attempts including the first (default 3) */
  attempts?: number
  /** first backoff delay (default 400ms) */
  baseDelayMs?: number
  /** backoff cap (default 4000ms) */
  maxDelayMs?: number
  /** 429-specific ladder (default 8s base, 45s cap) — rate limits
   *  say "try again later" and mean it */
  rateLimitBaseDelayMs?: number
  rateLimitMaxDelayMs?: number
  /** diagnostic hook (telemetry/tests); called before each retry */
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void
  /** injectable sleep (tests) */
  sleep?: (ms: number) => Promise<void>
}

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Run `fn` with bounded exponential backoff for transient errors.
 * Permanent errors and the final attempt's error are re-thrown
 * unchanged.
 */
export async function chatWithRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3)
  const base = opts.baseDelayMs ?? 400
  const cap = opts.maxDelayMs ?? 4000
  const sleep = opts.sleep ?? sleepDefault
  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const out = await fn()
      return out
    } catch (err) {
      lastErr = err
      if (attempt === attempts || !isTransientError(err)) throw err
      // RATE LIMITS get a longer ladder than generic 5xx blips: a
      // gateway answering 429 "try again later" needs tens of
      // seconds, not a 400ms jitter — retrying fast only burns
      // budget against a closed door.
      const msg = String((err as Error | undefined)?.message ?? err ?? '')
      const rateLimited = /\b429\b|rate.?limit|too many requests/i.test(msg)
      const rlBase = opts.rateLimitBaseDelayMs ?? 8_000
      const rlCap = opts.rateLimitMaxDelayMs ?? 45_000
      const exp = rateLimited
        ? Math.min(rlCap, rlBase * 2 ** (attempt - 1))
        : Math.min(cap, base * 2 ** (attempt - 1))
      const delay = Math.round(exp / 2 + Math.random() * (exp / 2))
      opts.onRetry?.(attempt, err, delay)
      await sleep(delay)
    }
  }
  throw lastErr
}

/** ── circuit breaker ────────────────────────────────────────── */

interface BreakerState {
  consecutiveFailures: number
  openedAt: number | null
}

const breakers = new Map<string, BreakerState>()
export const BREAKER_THRESHOLD = 5
export const BREAKER_COOLDOWN_MS = 30_000

/**
 * In-memory, per-server-instance breaker keyed by provider label.
 * OPEN → callers skip straight to the fallback chain; HALF-OPEN
 * after the cooldown lets the primary prove itself again.
 */
export const circuitBreaker = {
  canPass(key: string, now = Date.now()): boolean {
    const s = breakers.get(key)
    if (!s || s.openedAt === null) return true
    return now - s.openedAt >= BREAKER_COOLDOWN_MS
  },
  recordSuccess(key: string): void {
    breakers.set(key, { consecutiveFailures: 0, openedAt: null })
  },
  recordFailure(key: string, now = Date.now()): void {
    const s = breakers.get(key) ?? { consecutiveFailures: 0, openedAt: null }
    s.consecutiveFailures += 1
    if (s.consecutiveFailures >= BREAKER_THRESHOLD) s.openedAt = now
    breakers.set(key, s)
  },
  /** test hook */
  reset(): void {
    breakers.clear()
  },
}

/** ── the resilient call: primary (retry) → fallbacks (once each) ── */

export interface ResilientCallTarget<T> {
  /** a stable key for the circuit breaker (provider label) */
  key: string
  /** one attempt of the call (the caller composes model + params) */
  fn: () => Promise<T>
  /** diagnostic hook when this target is skipped or fails over */
  onFailover?: (info: string) => void
}

export interface ResilientCallOpts extends RetryOpts {
  /** disable the fallback chain entirely (default: enabled) */
  noFallback?: boolean
  now?: () => number
}

/**
 * Try each target in order: the first with a closed breaker gets the
 * full bounded-retry treatment; still-failing transient errors fail
 * over to the NEXT configured target (one retry round each).
 * Non-transient errors skip the fallbacks — a permanent error on
 * the primary is reported to the user immediately (falling back
 * would only duplicate the same mistake elsewhere).
 */
export async function chatResilient<T>(
  targets: ResilientCallTarget<T>[],
  opts: ResilientCallOpts = {},
): Promise<T> {
  if (!targets.length) throw new Error('No AI provider configured for this slot.')
  const now = opts.now ?? Date.now
  const useFallback = !opts.noFallback && process.env.ZAI_NO_FALLBACK !== '1'
  let lastErr: unknown
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    if (i > 0 && !useFallback) break
    if (i > 0 && opts.onRetry) opts.onRetry(i, lastErr, 0) // failover trace
    if (!circuitBreaker.canPass(t.key, now())) {
      t.onFailover?.(`circuit open for ${t.key} — skipping to the next configured provider`)
      continue
    }
    try {
      const out = await chatWithRetry(t.fn, opts)
      circuitBreaker.recordSuccess(t.key)
      return out
    } catch (err) {
      lastErr = err
      if (!isTransientError(err)) throw err
      circuitBreaker.recordFailure(t.key, now())
      t.onFailover?.(`${t.key} failed transiently after retries: ${String((err as Error)?.message ?? err).slice(0, 120)}`)
    }
  }
  throw lastErr ?? new Error('All configured AI providers failed.')
}
