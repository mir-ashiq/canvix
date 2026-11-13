'use client'

// ─────────────────────────────────────────────────────────────
// ProfilePanel (v0.23) — the user's own corner of Canvix.
//
// Opened from the dashboard's account menu. Shows the account
// card (name, member since) and manages BYOK AI providers:
// save / edit / delete / test your own provider credentials,
// routed ahead of the instance-wide slots for every provider-
// backed feature (README → "Bring your own key").
//
// Keys are WRITE-ONLY: the API returns a mask (sk-…last4), never
// the stored key. Editing a provider without re-entering the key
// keeps the saved one.
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import {
  UserRound,
  KeyRound,
  Plus,
  Trash2,
  PlugZap,
  Loader2,
  Pencil,
  Check,
  AlertTriangle,
  Bot,
  Eye,
  ImageIcon,
  Clapperboard,
  PenLine,
} from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

export interface ProfileUser {
  id: string
  username: string
  createdAt: string
  admin?: boolean
}

interface ProviderRow {
  id: string
  label: string
  baseUrl: string
  slots: string[]
  models: Record<string, string>
  keyMask: string
  createdAt: string
  updatedAt: string
}

const SLOT_OPTIONS = [
  { id: 'text', label: 'Text', icon: Bot, hint: 'Magic Write, Assistant, Translate, Plan, Notes, Theme' },
  { id: 'vision', label: 'Vision', icon: Eye, hint: 'Alt text, Magic Layers' },
  { id: 'image', label: 'Image', icon: ImageIcon, hint: 'Image generation' },
  { id: 'imageEdit', label: 'Image edit', icon: PenLine, hint: 'Magic Eraser / Enhance' },
  { id: 'video', label: 'Video', icon: Clapperboard, hint: 'Text-to-video' },
] as const

const EMPTY_FORM = {
  id: '' as string,
  label: '',
  baseUrl: '',
  apiKey: '',
  slots: ['text'] as string[],
  models: { text: '' } as Record<string, string>,
}

export function ProfilePanel({ open, onOpenChange, user }: { open: boolean; onOpenChange: (o: boolean) => void; user: ProfileUser }) {
  const [providers, setProviders] = useState<ProviderRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ProviderRow | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/profile/ai-providers', { cache: 'no-store' })
      if (res.status === 401) {
        setProviders([])
        setLoadError(null)
        return
      }
      const data = (await res.json()) as { providers?: ProviderRow[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not load providers.')
      setProviders(data.providers ?? [])
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load providers.')
      setProviders([])
    }
  }, [])

  // Load when the dialog opens. The fetch is kicked off in a microtask
  // so the effect body itself never calls setState synchronously
  // (react-hooks/set-state-in-effect — same pattern as useDesigns);
  // load() only sets state after its awaits resolve anyway.
  useEffect(() => {
    if (!open) return
    void Promise.resolve().then(() => load())
  }, [open, load])

  const openAdd = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }
  const openEdit = (p: ProviderRow) => {
    setEditing(p)
    setForm({
      id: p.id,
      label: p.label,
      baseUrl: p.baseUrl,
      apiKey: '', // write-only: blank keeps the stored key
      slots: [...p.slots],
      models: Object.fromEntries(p.slots.map((s) => [s, p.models?.[s] ?? ''])),
    })
    setFormOpen(true)
  }

  const toggleSlot = (slot: string) => {
    setForm((f) => {
      const has = f.slots.includes(slot)
      const slots = has ? f.slots.filter((s) => s !== slot) : [...f.slots, slot]
      const models: Record<string, string> = {}
      for (const s of slots) models[s] = f.models[s] ?? ''
      return { ...f, slots, models }
    })
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      const models: Record<string, string> = {}
      for (const [slot, id] of Object.entries(form.models)) if (id.trim()) models[slot] = id.trim()
      const body = editing
        ? { id: form.id, label: form.label, baseUrl: form.baseUrl, apiKey: form.apiKey || undefined, slots: form.slots, models }
        : { label: form.label, baseUrl: form.baseUrl, apiKey: form.apiKey, slots: form.slots, models }
      const res = await fetch('/api/profile/ai-providers', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not save the provider.')
      toast({ title: editing ? 'Provider updated' : 'Provider saved' })
      setFormOpen(false)
      await load()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not save the provider.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (p: ProviderRow) => {
    if (!window.confirm(`Remove provider “${p.label}”? Features it covers fall back to this instance's providers.`)) return
    try {
      const res = await fetch(`/api/profile/ai-providers?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not remove the provider.')
      toast({ title: 'Provider removed' })
      await load()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not remove the provider.', variant: 'destructive' })
    }
  }

  const test = async (p: ProviderRow) => {
    setTestingId(p.id)
    try {
      const res = await fetch('/api/profile/ai-providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string; sample?: string }
      setTestResult((r) => ({
        ...r,
        [p.id]: res.ok && data.ok
          ? { ok: true, msg: `Connection ok — model answered “${(data.sample ?? 'ok').slice(0, 24)}”` }
          : { ok: false, msg: data.error ?? 'Test failed.' },
      }))
    } catch {
      setTestResult((r) => ({ ...r, [p.id]: { ok: false, msg: 'Test failed — network error.' } }))
    } finally {
      setTestingId(null)
    }
  }

  const memberSince = new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-[#16181D] border-white/10 text-white">
        <DialogHeader>
          <DialogTitle>Your profile</DialogTitle>
          <DialogDescription>Your account and your own AI provider keys (used before this instance&apos;s providers).</DialogDescription>
        </DialogHeader>

        {/* ── account card ── */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-gradient-to-br from-[#02C0CC] to-[#7630D7] text-white text-sm font-extrabold flex items-center justify-center shrink-0">
            {user.username.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-[#00C4CC] flex items-center gap-2">
              <UserRound size={14} className="shrink-0" /> @{user.username}
              {user.admin && (
                <span className="text-[10px] font-bold uppercase tracking-wide bg-[#7630D7]/25 text-white/80 border border-[#7630D7]/40 rounded px-1.5 py-0.5">
                  admin
                </span>
              )}
            </div>
            <div className="text-[12px] text-white/45">Member since {memberSince} · designs stay private to your account</div>
          </div>
        </div>

        {/* ── BYOK providers ── */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 font-semibold text-[14px]">
              <KeyRound size={15} className="text-[#00C4CC]" /> Your AI providers
            </div>
            <Button size="sm" className="btn-cv rounded-full px-3 h-8 gap-1.5" onClick={openAdd}>
              <Plus size={14} /> Add provider
            </Button>
          </div>
          <p className="text-[12px] text-white/50 leading-relaxed mb-3">
            Bring your own key: providers you save here answer the AI features <span className="text-white/75 font-medium">before</span> the
            instance-wide ones — your work never spends the operator&apos;s quota. Keys stay on the server and are never shown back.
          </p>

          {providers === null ? (
            <div className="flex items-center justify-center gap-2 py-8 text-white/50 text-sm">
              <Loader2 size={15} className="animate-spin" /> Loading…
            </div>
          ) : loadError ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-200">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {loadError}
            </div>
          ) : providers.length === 0 && !formOpen ? (
            <div className="text-center py-8 text-white/45 text-[13px]">
              No providers yet — add one to power the AI features with your own key.
            </div>
          ) : (
            <div className="space-y-2">
              {providers.map((p) => (
                <div key={p.id} className="rounded-lg border border-white/10 bg-[#0F1115] p-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold truncate">{p.label}</div>
                      <div className="text-[11px] text-white/45 truncate">
                        {p.baseUrl} · <span className="font-mono">{p.keyMask}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-white/70 hover:text-white" title="Test connection" disabled={testingId === p.id} onClick={() => void test(p)}>
                        {testingId === p.id ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-white/70 hover:text-white" title="Edit" onClick={() => openEdit(p)}>
                        <Pencil size={14} />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-white/70 hover:text-red-300" title="Remove" onClick={() => void remove(p)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {p.slots.map((s) => {
                      const opt = SLOT_OPTIONS.find((o) => o.id === s)
                      const model = p.models?.[s]
                      return (
                        <span key={s} className="text-[11px] rounded-full border border-[#00C4CC]/25 bg-[#00C4CC]/10 text-[#8fe8ef] px-2 py-0.5">
                          {opt?.label ?? s}
                          {model ? <span className="text-white/40 font-mono"> · {model}</span> : null}
                        </span>
                      )
                    })}
                  </div>
                  {testResult[p.id] && (
                    <div className={cn('mt-2 flex items-start gap-1.5 text-[12px] rounded-md px-2 py-1.5', testResult[p.id].ok ? 'text-emerald-300 bg-emerald-500/10' : 'text-red-300 bg-red-500/10')}>
                      {testResult[p.id].ok ? <Check size={13} className="shrink-0 mt-0.5" /> : <AlertTriangle size={13} className="shrink-0 mt-0.5" />}
                      {testResult[p.id].msg}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── add / edit form ── */}
          {formOpen && (
            <div className="mt-3 rounded-lg border border-white/10 bg-[#0F1115] p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-white/60 uppercase tracking-wide">Label</label>
                  <Input
                    className="mt-1 bg-white/[0.05] border-white/10 text-white placeholder:text-white/30 h-9 text-[13px]"
                    placeholder="My OpenAI key"
                    value={form.label}
                    maxLength={60}
                    onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-white/60 uppercase tracking-wide">API key</label>
                  <Input
                    className="mt-1 bg-white/[0.05] border-white/10 text-white placeholder:text-white/30 h-9 text-[13px] font-mono"
                    type="password"
                    placeholder={editing ? 'unchanged — leave blank to keep' : 'sk-…'}
                    value={form.apiKey}
                    onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium text-white/60 uppercase tracking-wide">Base URL (OpenAI-compatible)</label>
                <Input
                  className="mt-1 bg-white/[0.05] border-white/10 text-white placeholder:text-white/30 h-9 text-[13px]"
                  placeholder="https://api.openai.com/v1"
                  value={form.baseUrl}
                  onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-white/60 uppercase tracking-wide">Capability slots</label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {SLOT_OPTIONS.map((o) => {
                    const active = form.slots.includes(o.id)
                    const Icon = o.icon
                    return (
                      <button
                        key={o.id}
                        type="button"
                        title={o.hint}
                        onClick={() => toggleSlot(o.id)}
                        className={cn(
                          'text-[12px] rounded-full border px-2.5 py-1 flex items-center gap-1.5 transition-colors',
                          active
                            ? 'border-[#00C4CC]/50 bg-[#00C4CC]/15 text-[#8fe8ef]'
                            : 'border-white/10 bg-white/[0.03] text-white/55 hover:text-white/80'
                        )}
                      >
                        <Icon size={12} /> {o.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              {form.slots.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {form.slots.map((slot) => (
                    <div key={slot}>
                      <label className="text-[11px] font-medium text-white/60 uppercase tracking-wide">
                        {SLOT_OPTIONS.find((o) => o.id === slot)?.label ?? slot} model <span className="text-white/30 normal-case">(optional)</span>
                      </label>
                      <Input
                        className="mt-1 bg-white/[0.05] border-white/10 text-white placeholder:text-white/30 h-9 text-[13px] font-mono"
                        placeholder="provider default"
                        maxLength={120}
                        value={form.models[slot] ?? ''}
                        onChange={(e) => setForm((f) => ({ ...f, models: { ...f.models, [slot]: e.target.value } }))}
                      />
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button size="sm" variant="ghost" className="h-8 text-white/70" onClick={() => setFormOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" className="btn-cv h-8 gap-1.5" disabled={saving || !form.label.trim() || !form.baseUrl.trim() || (!editing && !form.apiKey)} onClick={() => void save()}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {editing ? 'Save changes' : 'Save provider'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
