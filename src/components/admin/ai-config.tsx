'use client'

// AI configuration (v0.16 A1 → v0.16.2 A2 rework).
//
// Four surfaces:
//   1. Providers — the multi-provider table: add any OpenAI-compatible
//      endpoint (NVIDIA NIM, OpenRouter, Z.ai, Groq, …), one key each,
//      write-only credentials, per-provider Test button.
//   2. Model slots — pin each capability (text / vision / image /
//      imageEdit) to a provider + model id, so different features can
//      run on different vendors. (v0.16.4 A4: imageSearch is retired —
//      photo search runs on the stock-provider keys, see the banner.)
//   3. Legacy fallback — the v0.16 A1 single-provider override and model
//      ids, used only by slots that don't resolve through the table.
//   4. Feature kill switches.

import { useEffect, useState } from 'react'
import { Zap, Plus, Trash2, Import } from 'lucide-react'
import { getJson, sendJson } from './fetch'
import { Card, Toggle, Chip } from './bits'

interface ProviderEntryView {
  id: string
  label: string
  baseUrl: string
  keyMasked: string
}
interface SlotEntryView {
  providerId: string
  model?: string
}
interface SlotResolved {
  providerId: string | null
  label: string | null
  baseUrl: string
  model: string | null
  source: string
}
interface ConfigView {
  provider: {
    configured: boolean
    source: string | null
    activeBaseUrl: string | null
    stored: { baseUrl: string; keyMasked: string } | null
    env: { urlSet: boolean; keySet: boolean }
  }
  providers: {
    set: boolean
    list: ProviderEntryView[]
    slots: Record<string, SlotEntryView | undefined>
    resolved: Record<string, SlotResolved | null>
  }
  models: { text?: string; vision?: string; image?: string }
  features: Record<string, boolean>
  settings: { signupsOpen: boolean; anonymousEditing: boolean }
  /** v0.16.4 (A4): where photo search lives now (stock keys) */
  stockPhotos: { available: boolean; providers: string[] }
}

/** Local editing state for one provider row. New rows get a client-generated
 *  id so slots can reference them in the same save (the server accepts any
 *  `p`-prefixed id and keeps it). */
interface ProviderRow {
  id: string | null // null = new, unsaved
  label: string
  baseUrl: string
  apiKey: string // empty = keep stored key on save
}

/** `p` + 10 base36 chars — same shape the server generates. */
function newProviderId(): string {
  return 'p' + Array.from({ length: 10 }, () => Math.floor(Math.random() * 36).toString(36)).join('')
}

const SLOT_INFO: { key: string; label: string; hint: string; placeholder: string }[] = [
  { key: 'text', label: 'Text', hint: 'Magic Write · Translate · Assistant', placeholder: 'e.g. meta/llama-3.1-70b-instruct' },
  { key: 'vision', label: 'Vision', hint: 'Magic Layers — image understanding', placeholder: 'e.g. meta/llama-3.2-90b-vision-instruct' },
  { key: 'image', label: 'Image generation', hint: 'Text-to-image in the Photos panel', placeholder: 'provider default' },
  { key: 'imageEdit', label: 'Image editing', hint: 'Magic Eraser / Enhance', placeholder: 'provider default' },
]

const FEATURE_INFO: { key: string; label: string; hint: string }[] = [
  { key: 'magicWrite', label: 'Magic Write', hint: 'AI copy suggestions in the text toolbar' },
  { key: 'imageGeneration', label: 'Image generation', hint: 'Text-to-image in the Photos panel' },
  { key: 'imageEditing', label: 'Image editing', hint: 'Magic Eraser / Enhance on selected images' },
  { key: 'vision', label: 'Magic Layers', hint: 'Image understanding that rebuilds layered designs' },
  { key: 'translation', label: 'Translate', hint: 'Text translation in the text toolbar' },
  { key: 'assistant', label: 'Assistant', hint: 'The chat assistant that edits designs' },
  { key: 'photoSearch', label: 'Photo search', hint: 'Stock photo search in the Photos panel — Pexels/Pixabay keys, not an AI provider' },
]

const SOURCE_LABEL: Record<string, string> = {
  multi: 'providers table',
  db: 'legacy override',
  env: 'environment variables',
  file: '.z-ai-config file',
}

interface TestState {
  providerId: string | 'default'
  ok: boolean
  message: string
}

/** Per-slot probe result (A3) — the verdict says WHY, not just pass/fail. */
interface SlotTestState {
  slot: string
  ok: boolean
  message: string
  busy?: boolean
}

/** The endpoint each slot exercises — shown next to the slot so the
 * provider-fit question ("can NVIDIA generate images?") answers itself. */
const SLOT_ENDPOINT: Record<string, string> = {
  text: 'chat/completions',
  vision: 'chat/completions',
  image: 'images/generations',
  imageEdit: 'images/generations/edit',
}

export function AdminAiConfig() {
  const [view, setView] = useState<ConfigView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [rows, setRows] = useState<ProviderRow[]>([])
  const [slots, setSlots] = useState<Record<string, { providerId: string; model: string }>>({})
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<{ text: string; vision: string; image: string }>({ text: '', vision: '', image: '' })
  const [features, setFeatures] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<TestState | null>(null)

  function applyView(data: ConfigView) {
    setView(data)
    setRows(
      data.providers.list.map((p) => ({
        id: p.id,
        label: p.label,
        baseUrl: p.baseUrl,
        apiKey: '', // write-only: never prefilled
      }))
    )
    const slotState: Record<string, { providerId: string; model: string }> = {}
    for (const s of SLOT_INFO) {
      const stored = data.providers.slots[s.key]
      slotState[s.key] = { providerId: stored?.providerId ?? '', model: stored?.model ?? '' }
    }
    setSlots(slotState)
    setBaseUrl(data.provider.stored?.baseUrl ?? '')
    setModels({
      text: data.models.text ?? '',
      vision: data.models.vision ?? '',
      image: data.models.image ?? '',
    })
    setFeatures(data.features)
  }

  async function put(body: unknown, message: string) {
    setBusy(true)
    const res = await sendJson<ConfigView & { error?: string }>('/api/admin/config', 'PUT', body)
    setBusy(false)
    if (!res.ok) {
      setNotice(null)
      setError(res.data?.error ?? `Could not save (${res.status}).`)
      return
    }
    setError(null)
    setNotice(message)
    applyView(res.data)
    setApiKey('')
    setTimeout(() => setNotice(null), 4000)
  }

  /** Save the providers table (list full-replace + slots full-replace). */
  async function saveProviders() {
    const list = rows.map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      label: r.label,
      baseUrl: r.baseUrl,
      ...(r.apiKey ? { apiKey: r.apiKey } : {}),
    }))
    const slotBody: Record<string, { providerId: string; model?: string } | null> = {}
    for (const s of SLOT_INFO) {
      const cur = slots[s.key]
      slotBody[s.key] = cur.providerId ? { providerId: cur.providerId, ...(cur.model ? { model: cur.model } : {}) } : null
    }
    await put({ providers: { list, slots: slotBody } }, 'Providers and slots saved.')
  }

  async function importLegacy() {
    await put({ importLegacyProvider: true }, 'Legacy override imported into the providers table.')
  }

  async function testProvider(providerId: string | null) {
    setBusy(true)
    setTest(null)
    const res = await sendJson<{ ok: boolean; providerLabel?: string; model?: string; reply?: string; error?: string }>(
      '/api/admin/config/ai-test',
      'POST',
      providerId ? { providerId } : {}
    )
    setBusy(false)
    if (res.ok && res.data.ok) {
      setTest({
        providerId: providerId ?? 'default',
        ok: true,
        message: `${res.data.providerLabel ?? 'Provider'} answered (model ${res.data.model}): “${res.data.reply}”`,
      })
    } else {
      setTest({ providerId: providerId ?? 'default', ok: false, message: (res.data.error as string) ?? `Test failed (${res.status})` })
    }
  }

  const [slotTest, setSlotTest] = useState<SlotTestState | null>(null)

  /** Probe the ENDPOINT the slot actually uses (A3) — a chat-only
   * provider passes the text test but cannot generate images. */
  async function testSlot(slot: string) {
    setSlotTest({ slot, ok: true, busy: true, message: 'probing…' })
    const res = await sendJson<{ ok: boolean; endpoint?: string; providerLabel?: string; message?: string; reply?: string; error?: string }>(
      '/api/admin/config/ai-test',
      'POST',
      { slot }
    )
    if (res.ok && res.data.ok) {
      setSlotTest({
        slot,
        ok: true,
        message: `${res.data.providerLabel ?? 'Provider'} · ${res.data.message}${res.data.reply ? ` “${res.data.reply.slice(0, 60)}”` : ''}`,
      })
    } else {
      setSlotTest({ slot, ok: false, message: res.data.message ?? res.data.error ?? `Test failed (${res.status})` })
    }
  }

  useEffect(() => {
    getJson<ConfigView>('/api/admin/config').then((res) => {
      if (res.ok) {
        applyView(res.data)
        setError(null)
      } else {
        setError(res.data?.error ?? `Request failed (${res.status})`)
      }
    })
  }, [])

  if (error && !view) {
    return (
      <Card title="AI configuration">
        <p className="text-sm text-destructive">{error}</p>
      </Card>
    )
  }
  if (!view) {
    return <div className="h-40 animate-pulse rounded-xl bg-muted" />
  }

  const providerSectionReady = Boolean(baseUrl.trim()) === Boolean(apiKey.trim()) || (!baseUrl && !apiKey)
  const legacyStored = view.provider.stored !== null
  const tableEmpty = rows.length === 0

  return (
    <>
      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700">{notice}</div>}

      <Card
        title="AI providers"
        right={
          view.providers.set && rows.length > 0 ? (
            <Chip tone="good">{rows.length} stored</Chip>
          ) : (
            <Chip tone={tableEmpty && !legacyStored && !view.provider.configured ? 'bad' : 'neutral'}>empty</Chip>
          )
        }
      >
        <p className="mb-4 text-sm text-muted-foreground">
          Add any OpenAI-compatible endpoint — NVIDIA NIM, OpenRouter, Z.ai, Groq, OpenAI… Each provider keeps its own
          write-only key, and every capability below can run on a different vendor. The key is stored, never displayed
          again; leave the field empty when editing to keep the stored one.
        </p>

        {legacyStored && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <span>
              A legacy single-provider override is stored ({view.provider.stored?.baseUrl}). It only answers slots that
              have no provider above — import it to manage it here.
            </span>
            <button
              onClick={() => void importLegacy()}
              disabled={busy}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-600/40 bg-amber-500/20 px-3 py-1.5 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
            >
              <Import size={14} /> Import into providers
            </button>
          </div>
        )}

        {rows.length === 0 && (
          <p className="mb-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            No providers yet. Add one below — you need its base URL (ending in <code className="rounded bg-muted px-1">/v1</code>{' '}
            for most vendors) and an API key.
          </p>
        )}

        <div className="space-y-3">
          {rows.map((row, i) => {
            const usedBy = SLOT_INFO.filter((s) => slots[s.key]?.providerId === row.id).map((s) => s.label)
            const saved = view.providers.list.some((p) => p.id === row.id)
            return (
              <div key={row.id ?? `new-${i}`} className="rounded-xl border p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_2fr_1fr_auto]">
                  <label className="text-xs">
                    <span className="mb-1 block font-medium">Label</span>
                    <input
                      value={row.label}
                      onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
                      placeholder="NVIDIA NIM"
                      className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block font-medium">Base URL</span>
                    <input
                      value={row.baseUrl}
                      onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, baseUrl: e.target.value } : r)))}
                      placeholder="https://integrate.api.nvidia.com/v1"
                      className="h-9 w-full rounded-lg border bg-background px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block font-medium">API key</span>
                    <input
                      type="password"
                      value={row.apiKey}
                      onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, apiKey: e.target.value } : r)))}
                      placeholder={saved ? `stored: ${view.providers.list.find((p) => p.id === row.id)?.keyMasked ?? '—'}` : 'new key — required'}
                      autoComplete="off"
                      className="h-9 w-full rounded-lg border bg-background px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                  <div className="flex items-end gap-1.5">
                    <button
                      onClick={() => void testProvider(row.id)}
                      disabled={busy || !saved}
                      title={saved ? 'Send a minimal chat completion through this provider' : 'Save first, then test'}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      <Zap size={14} /> Test
                    </button>
                    <button
                      onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                      disabled={busy}
                      title="Remove this provider (saved on Save)"
                      className="inline-flex h-9 items-center rounded-lg border px-2.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {row.id && usedBy.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {saved ? `serves: ${usedBy.join(' · ')}` : 'unsaved — press “Save providers & slots” to activate'}
                  </p>
                )}
                {test && (test.providerId === row.id) && (
                  <p className={`mt-2 text-sm ${test.ok ? 'text-emerald-600' : 'text-destructive'}`}>{test.message}</p>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => setRows((rs) => [...rs, { id: newProviderId(), label: '', baseUrl: '', apiKey: '' }])}
            disabled={busy || rows.length >= 8}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            <Plus size={14} /> Add provider
          </button>
          <button
            onClick={() => void saveProviders()}
            disabled={busy || rows.length === 0}
            className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Save providers & slots
          </button>
        </div>
        {test && test.providerId === 'default' && (
          <p className={`mt-3 text-sm ${test.ok ? 'text-emerald-600' : 'text-destructive'}`}>{test.message}</p>
        )}
      </Card>

      <Card
        title="Model slots"
        right={
          <Chip tone={Object.values(view.providers.resolved).some((r) => r !== null) ? 'good' : 'neutral'}>
            {Object.values(view.providers.resolved).filter((r) => r !== null).length}/4 wired
          </Chip>
        }
      >
        <p className="mb-4 text-sm text-muted-foreground">
          Pin each capability to a provider and model. A slot with no provider falls back to the legacy chain below —
          every feature can run on a different vendor.
        </p>
        {/* v0.16.4 (A4): photo search LEFT the AI table — it runs on the
            free stock-provider keys (same keys as the Videos rail), not on
            a model slot. State where it lives and whether the keys are set,
            so the operator is never sent hunting for a slot that no longer
            exists. */}
        <div className="mb-4 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-sm">
          <p>
            Photo search is no longer a model slot — it runs on free stock-provider keys (Pexels / Pixabay), the same
            keys as the Videos rail:{' '}
            <code className="rounded bg-muted px-1">PEXELS_API_KEY</code> /{' '}
            <code className="rounded bg-muted px-1">PIXABAY_API_KEY</code> (docs/STOCK-PHOTO.md).
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {view.stockPhotos.available
              ? `Active — keyed: ${view.stockPhotos.providers.join(', ')}.`
              : 'No stock key set — the Photos panel keeps only its bundled library.'}
          </p>
        </div>
        <div className="space-y-3">
          {SLOT_INFO.map((s) => {
            const resolved = view.providers.resolved[s.key]
            const current = slots[s.key] ?? { providerId: '', model: '' }
            return (
              <div key={s.key} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1.4fr_1fr_1.4fr]">
                <div>
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-xs text-muted-foreground">{s.hint}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">uses {SLOT_ENDPOINT[s.key]}</p>
                </div>
                <label className="text-xs">
                  <span className="mb-1 block font-medium">Provider</span>
                  <select
                    value={current.providerId}
                    onChange={(e) => setSlots((sl) => ({ ...sl, [s.key]: { ...current, providerId: e.target.value } }))}
                    className="h-9 w-full rounded-lg border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">— fall back —</option>
                    {rows.map((r) => (
                      <option key={r.id ?? r.label} value={r.id ?? ''} disabled={!r.id}>
                        {r.label || r.baseUrl || 'unsaved provider'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-medium">Model id</span>
                  <input
                    value={current.model}
                    onChange={(e) => setSlots((sl) => ({ ...sl, [s.key]: { ...current, model: e.target.value } }))}
                    placeholder={s.placeholder}
                    className="h-9 w-full rounded-lg border bg-background px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                  />
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {resolved
                      ? `→ ${resolved.label ?? resolved.baseUrl} · ${resolved.model ?? 'provider default'} (${SOURCE_LABEL[resolved.source] ?? resolved.source})`
                      : '→ not configured (feature reports unavailable)'}
                  </span>
                </label>
                <div className="flex items-end sm:col-start-3">
                  <button
                    onClick={() => void testSlot(s.key)}
                    disabled={busy || slotTest?.busy === true}
                    title={`Probe the real ${SLOT_ENDPOINT[s.key]} endpoint this slot uses`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <Zap size={14} /> Test {s.label.toLowerCase()}
                  </button>
                </div>
                {slotTest && slotTest.slot === s.key && !slotTest.busy && (
                  <p className={`sm:col-span-3 text-sm ${slotTest.ok ? 'text-emerald-600' : 'text-destructive'}`}>
                    {slotTest.message}
                  </p>
                )}
              </div>
            )
          })}
        </div>
        <button
          onClick={() => void saveProviders()}
          disabled={busy || rows.length === 0}
          className="mt-4 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Save providers & slots
        </button>
      </Card>

      <Card
        title="Fallback — single provider & default models"
        right={
          view.provider.configured ? (
            <Chip tone={view.provider.source === 'db' ? 'good' : 'neutral'}>
              fallback active · {SOURCE_LABEL[view.provider.source ?? ''] ?? view.provider.source}
            </Chip>
          ) : (
            <Chip tone="bad">no fallback</Chip>
          )
        }
      >
        <p className="mb-4 text-sm text-muted-foreground">
          Only used by slots set to “— fall back —” above. The single override wins over the{' '}
          <code className="rounded bg-muted px-1">ZAI_BASE_URL</code> /{' '}
          <code className="rounded bg-muted px-1">ZAI_API_KEY</code> environment variables; model ids apply to the
          matching fallback slot. Keys are write-only — stored, never displayed again.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Base URL</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={view.provider.stored ? `stored: ${view.provider.stored.keyMasked}` : 'provider API key'}
              autoComplete="off"
              className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {(['text', 'vision', 'image'] as const).map((key) => (
            <label key={key} className="text-sm">
              <span className="mb-1 block font-medium capitalize">{key} model</span>
              <input
                value={models[key]}
                onChange={(e) => setModels((m) => ({ ...m, [key]: e.target.value }))}
                placeholder={key === 'vision' ? 'glm-4.5v (default)' : 'SDK default'}
                className="h-9 w-full rounded-lg border bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            env: {view.provider.env.urlSet ? 'base URL set' : 'no base URL'} · {view.provider.env.keySet ? 'key set' : 'no key'}
          </span>
          {view.provider.activeBaseUrl && <span className="break-all">active fallback: {view.provider.activeBaseUrl}</span>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() =>
              baseUrl.trim() && apiKey.trim()
                ? void put({ provider: { baseUrl, apiKey } }, 'Fallback override saved.')
                : void put({ provider: null }, 'Fallback override cleared — env/file fallback restored.')
            }
            disabled={busy || !providerSectionReady}
            className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {baseUrl.trim() && apiKey.trim() ? 'Save fallback override' : 'Clear fallback override'}
          </button>
          <button
            onClick={() => void put({ models }, 'Fallback models saved.')}
            disabled={busy}
            className="rounded-lg border px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            Save fallback models
          </button>
          <button
            onClick={() => void testProvider(null)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            <Zap size={14} /> Test fallback (text slot)
          </button>
        </div>
      </Card>

      <Card title="AI features">
        <p className="mb-4 text-sm text-muted-foreground">
          Kill switches per feature. A switched-off feature reports as unavailable everywhere (panels grey out, the
          capabilities endpoint says no) and its API route refuses work — even with providers configured.
        </p>
        <ul className="divide-y">
          {FEATURE_INFO.map((f) => (
            <li key={f.key} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium">{f.label}</p>
                <p className="text-xs text-muted-foreground">{f.hint}</p>
              </div>
              <Toggle
                label={f.label}
                checked={features[f.key] ?? true}
                onChange={(next) => setFeatures((s) => ({ ...s, [f.key]: next }))}
              />
            </li>
          ))}
        </ul>
        <button
          onClick={() => void put({ features }, 'Feature switches saved.')}
          disabled={busy}
          className="mt-4 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Save features
        </button>
      </Card>
    </>
  )
}
