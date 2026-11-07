'use client'

import { useEffect, useState } from 'react'
import { Zap } from 'lucide-react'
import { getJson, sendJson } from './fetch'
import { Card, Toggle, Chip } from './bits'

interface ConfigView {
  provider: {
    configured: boolean
    source: string | null
    activeBaseUrl: string | null
    stored: { baseUrl: string; keyMasked: string } | null
    env: { urlSet: boolean; keySet: boolean }
  }
  models: { text?: string; vision?: string; image?: string }
  features: Record<string, boolean>
  settings: { signupsOpen: boolean; anonymousEditing: boolean }
}

const FEATURE_INFO: { key: string; label: string; hint: string }[] = [
  { key: 'magicWrite', label: 'Magic Write', hint: 'AI copy suggestions in the text toolbar' },
  { key: 'imageGeneration', label: 'Image generation', hint: 'Text-to-image in the Photos panel' },
  { key: 'imageEditing', label: 'Image editing', hint: 'Magic Eraser / Enhance on selected images' },
  { key: 'vision', label: 'Magic Layers', hint: 'Image understanding that rebuilds layered designs' },
  { key: 'translation', label: 'Translate', hint: 'Text translation in the text toolbar' },
  { key: 'assistant', label: 'Assistant', hint: 'The chat assistant that edits designs' },
  { key: 'photoSearch', label: 'Photo search', hint: 'Stock photo search in the Photos panel' },
]

const SOURCE_LABEL: Record<string, string> = { db: 'console override', env: 'environment variables', file: '.z-ai-config file' }

export function AdminAiConfig() {
  const [view, setView] = useState<ConfigView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<{ text: string; vision: string; image: string }>({ text: '', vision: '', image: '' })
  const [features, setFeatures] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    getJson<ConfigView>('/api/admin/config').then((res) => {
      if (res.ok) {
        setView(res.data)
        setBaseUrl(res.data.provider.stored?.baseUrl ?? '')
        setModels({
          text: res.data.models.text ?? '',
          vision: res.data.models.vision ?? '',
          image: res.data.models.image ?? '',
        })
        setFeatures(res.data.features)
        setError(null)
      } else {
        setError(res.data?.error ?? `Request failed (${res.status})`)
      }
    })
  }, [])

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
    setView(res.data)
    setApiKey('')
    setTimeout(() => setNotice(null), 4000)
  }

  async function testProvider() {
    setBusy(true)
    setTest(null)
    const res = await sendJson<{ ok: boolean; model?: string; reply?: string; error?: string }>('/api/admin/config/ai-test', 'POST', {})
    setBusy(false)
    if (res.ok && res.data.ok) {
      setTest({ ok: true, message: `Provider answered (model ${res.data.model}): “${res.data.reply}”` })
    } else {
      setTest({ ok: false, message: (res.data.error as string) ?? `Test failed (${res.status})` })
    }
  }

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

  return (
    <>
      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700">{notice}</div>}

      <Card
        title="AI provider"
        right={
          view.provider.configured ? (
            <Chip tone="good">configured · {SOURCE_LABEL[view.provider.source ?? ''] ?? view.provider.source}</Chip>
          ) : (
            <Chip tone="bad">not configured</Chip>
          )
        }
      >
        <p className="mb-4 text-sm text-muted-foreground">
          Canvix runs its AI features through one provider. An override set here wins over the{' '}
          <code className="rounded bg-muted px-1">ZAI_BASE_URL</code> /{' '}
          <code className="rounded bg-muted px-1">ZAI_API_KEY</code> environment variables; clear it to fall back. The key
          is write-only — it is stored, never displayed again.
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
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            env: {view.provider.env.urlSet ? 'base URL set' : 'no base URL'} · {view.provider.env.keySet ? 'key set' : 'no key'}
          </span>
          {view.provider.activeBaseUrl && <span className="break-all">active: {view.provider.activeBaseUrl}</span>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() =>
              baseUrl.trim() && apiKey.trim()
                ? void put({ provider: { baseUrl, apiKey } }, 'Provider override saved.')
                : void put({ provider: null }, 'Provider override cleared — env/file fallback restored.')
            }
            disabled={busy || !providerSectionReady}
            className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {baseUrl.trim() && apiKey.trim() ? 'Save override' : 'Clear override'}
          </button>
          <button
            onClick={() => void testProvider()}
            disabled={busy || !view.provider.configured}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            <Zap size={14} /> Test connection
          </button>
        </div>
        {test && (
          <p className={`mt-3 text-sm ${test.ok ? 'text-emerald-600' : 'text-destructive'}`}>{test.message}</p>
        )}
      </Card>

      <Card title="Models">
        <p className="mb-4 text-sm text-muted-foreground">
          Which model ids the AI features request. Leave a field empty to use the SDK default — exactly the pre-console
          behaviour.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(['text', 'vision', 'image'] as const).map((key) => (
            <label key={key} className="text-sm">
              <span className="mb-1 block font-medium capitalize">
                {key} {key === 'text' && <span className="text-muted-foreground">(write · translate · assistant)</span>}
                {key === 'vision' && <span className="text-muted-foreground">(Magic Layers)</span>}
              </span>
              <input
                value={models[key]}
                onChange={(e) => setModels((m) => ({ ...m, [key]: e.target.value }))}
                placeholder={key === 'vision' ? 'glm-4.5v (default)' : 'SDK default'}
                className="h-9 w-full rounded-lg border bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          ))}
        </div>
        <button
          onClick={() => void put({ models }, 'Models saved.')}
          disabled={busy}
          className="mt-4 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Save models
        </button>
      </Card>

      <Card title="AI features">
        <p className="mb-4 text-sm text-muted-foreground">
          Kill switches per feature. A switched-off feature reports as unavailable everywhere (panels grey out, the
          capabilities endpoint says no) and its API route refuses work — even with a provider configured.
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
