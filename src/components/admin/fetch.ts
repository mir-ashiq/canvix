// Admin console shared fetch helpers (v0.16 A1). Tiny on purpose —
// the console has four pages, not a framework.

export interface ApiResult<T> {
  ok: boolean
  status: number
  data: T & { error?: string }
}

async function parse<T>(res: Response): Promise<ApiResult<T>> {
  let data: T & { error?: string }
  try {
    data = (await res.json()) as T & { error?: string }
  } catch {
    data = {} as T & { error?: string }
  }
  return { ok: res.ok, status: res.status, data }
}

export async function getJson<T>(url: string): Promise<ApiResult<T>> {
  try {
    return parse<T>(await fetch(url, { cache: 'no-store' }))
  } catch {
    return { ok: false, status: 0, data: {} as T & { error?: string } }
  }
}

export async function sendJson<T>(url: string, method: 'POST' | 'PUT', body: unknown): Promise<ApiResult<T>> {
  try {
    return parse<T>(
      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )
  } catch {
    return { ok: false, status: 0, data: {} as T & { error?: string } }
  }
}
