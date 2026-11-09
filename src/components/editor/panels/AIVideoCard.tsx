'use client'

import { useEffect, useRef, useState } from 'react'
import { Clapperboard, Loader2, Plus, Sparkles, TriangleAlert } from 'lucide-react'
import { addGeneratedVideo } from '../add-element'
import { toast } from '@/hooks/use-toast'

/** Poll cadence and patience for async video generation. */
const POLL_MS = 3000
const MAX_POLLS = 100 // ~5 minutes

interface VideoStatus {
  id: string
  status: 'queued' | 'in_progress' | 'completed' | 'failed'
  progress: number
  videos: { index: number; url: string }[]
  error?: string
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** The poll loop — module scope (no self-referential hooks). `token`
 *  invalidates the loop when a newer generation starts; setters are
 *  safe no-ops after unmount on React 18+. */
async function pollVideo(
  id: string,
  token: { current: number },
  myToken: number,
  onStatus: (s: VideoStatus) => void,
  onDone: (s: VideoStatus) => void,
  onFail: (msg: string) => void,
) {
  for (let i = 0; i < MAX_POLLS; i++) {
    await delay(POLL_MS)
    if (token.current !== myToken) return
    try {
      const res = await fetch(`/api/ai/video?id=${encodeURIComponent(id)}`)
      const data = (await res.json()) as VideoStatus & { error?: string }
      if (token.current !== myToken) return
      if (!res.ok) throw new Error(data.error ?? 'Polling failed')
      if (data.status === 'completed') {
        onDone(data)
        return
      }
      if (data.status === 'failed') {
        onFail(data.error ?? 'Generation failed')
        return
      }
      onStatus(data)
    } catch (e) {
      // transient network blips keep the loop going (3 strikes out)
      if (i >= 2 || token.current !== myToken) {
        onFail(e instanceof Error ? e.message : 'Polling failed')
        return
      }
    }
  }
  onFail('Timed out waiting for the video.')
}

/**
 * v0.19 (Wave 4) — AI video generation card for the Videos panel.
 *
 * Prompt → POST /api/ai/video (video slot, admin-switchable) → poll the
 * async generation → preview → insert via addGeneratedVideo (chunked
 * media store, real probe, first-frame poster). Renders nothing when
 * the server reports no videoGeneration capability.
 */
export function AIVideoCard() {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState<VideoStatus | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  /** bump to invalidate any running poll loop (new generate / reset / unmount) */
  const runToken = useRef(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/ai/capabilities')
      .then((r) => r.json())
      .then((d: { capabilities?: Record<string, boolean> }) => {
        if (!cancelled) setAvailable(Boolean(d.capabilities?.videoGeneration))
      })
      .catch(() => {
        if (!cancelled) setAvailable(false)
      })
    return () => {
      cancelled = true
      runToken.current += 1
    }
  }, [])

  const generate = async () => {
    if (!prompt.trim() || status?.status === 'completed') return
    setFailed(null)
    setStatus({ id: 'starting', status: 'queued', progress: 2, videos: [] })
    try {
      const res = await fetch('/api/ai/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), size: '1024x576' }),
      })
      const data = (await res.json()) as { id?: string; error?: string; detail?: string }
      if (!res.ok || !data.id) throw new Error(data.detail ?? data.error ?? 'Generation failed')
      const myToken = ++runToken.current
      void pollVideo(
        data.id,
        runToken,
        myToken,
        setStatus,
        (s) => {
          setStatus(s)
          setFailed(null)
        },
        (msg) => {
          setFailed(msg)
          setStatus(null)
        },
      )
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'Generation failed')
      setStatus(null)
    }
  }

  const add = async (url: string) => {
    if (adding) return
    setAdding(true)
    try {
      await addGeneratedVideo(url)
      toast({ title: 'AI video added', description: 'Downloaded into your media library.' })
      // reset for the next generation
      setPrompt('')
      runToken.current += 1
      setStatus(null)
      setFailed(null)
    } catch (e) {
      toast({
        title: 'Could not add the video',
        description: e instanceof Error ? e.message : 'Try again.',
        variant: 'destructive',
      })
    } finally {
      setAdding(false)
    }
  }

  if (available === false) return null

  const done = status?.status === 'completed'
  const running = Boolean(status) && !done && !failed

  return (
    <div className="rounded-xl border border-[#7630D7]/40 bg-[#7630D7]/[0.08] p-3 mb-3" data-testid="ai-video-card">
      <div className="flex items-center gap-1.5 mb-2">
        <Clapperboard size={12} className="text-[#B79AFF]" />
        <span className="text-[10.5px] font-bold text-white/60 uppercase tracking-wide">Generate with AI</span>
      </div>

      <div className="flex gap-1.5">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !running && !done && void generate()}
          placeholder="Describe a video — e.g. slow pan over misty mountains at dawn"
          className="flex-1 h-9 rounded-lg bg-white/[0.06] border border-white/10 text-white text-[12px] px-2.5 focus:outline-none focus:border-[#7630D7]"
          aria-label="Video prompt"
          maxLength={1000}
          disabled={running}
          data-testid="ai-video-prompt"
        />
        <button
          className="h-9 px-3 shrink-0 rounded-lg bg-[#7630D7] hover:bg-[#8a49e8] text-white text-[11.5px] font-bold flex items-center gap-1.5 disabled:opacity-60 transition-colors"
          onClick={() => void generate()}
          disabled={running || !prompt.trim()}
          aria-label="Generate video"
          data-testid="ai-video-generate"
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {running ? `${status?.progress ?? 0}%` : 'Generate'}
        </button>
      </div>

      {running && (
        <div className="mt-2.5">
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#7630D7] to-[#02C0CC] transition-all duration-500"
              style={{ width: `${Math.max(4, status?.progress ?? 0)}%` }}
            />
          </div>
          <p className="text-[10.5px] text-white/45 mt-1.5">
            Videos take a few minutes — keep this panel open. You can keep editing meanwhile.
          </p>
        </div>
      )}

      {failed && (
        <div className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-red-400/30 bg-red-400/10 px-2.5 py-2 text-[11px] text-red-200">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          <span className="leading-snug">{failed}</span>
        </div>
      )}

      {done && status?.videos[0] && (
        <div className="mt-2.5">
          <video
            src={status.videos[0].url}
            controls
            muted
            loop
            playsInline
            className="w-full aspect-video rounded-lg bg-black border border-white/10"
            data-testid="ai-video-preview"
          />
          <div className="flex gap-1.5 mt-2">
            <button
              className="flex-1 h-9 rounded-lg bg-[#7630D7] hover:bg-[#8a49e8] text-white text-[11.5px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-60 transition-colors"
              onClick={() => void add(status.videos[0]!.url)}
              disabled={adding}
              aria-label="Add video to design"
            >
              {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              {adding ? 'Adding…' : 'Add to design'}
            </button>
            <button
              className="h-9 px-3 rounded-lg border border-white/15 text-white/70 hover:text-white text-[11.5px] font-semibold transition-colors"
              onClick={() => {
                runToken.current += 1
                setStatus(null)
                setFailed(null)
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {!running && !done && !failed && (
        <p className="text-[10.5px] text-white/35 mt-2 leading-snug">
          Text-to-video via the server&apos;s video provider slot (admin-configurable). Generated videos land in
          your media library like uploads.
        </p>
      )}
    </div>
  )
}
