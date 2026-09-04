'use client'

import { useEffect, useState } from 'react'
import { Check, MessageSquare, Send, X } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { buildThreads, useCommentsStore, type CommentRecord } from '@/lib/comments-store'
import { getIdentity } from '@/lib/collab/identity'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'

/**
 * Comment pins on the canvas (comments mode).
 * - click empty canvas → drop a pin + composer
 * - click a pin → open its thread bubble
 * - pins anchor at page-coordinate fractions; element-anchored pins follow
 *   the element position
 */
export function CommentPins({ pan, zoom }: { pan: { x: number; y: number }; zoom: number }) {
  const pages = useEditorStore((s) => s.pages)
  const currentPage = useEditorStore((s) => s.currentPage)
  const designId = useEditorStore((s) => s.designId)
  const width = useEditorStore((s) => s.width)
  const height = useEditorStore((s) => s.height)
  const comments = useCommentsStore((s) => s.comments)
  const openThreadId = useCommentsStore((s) => s.openThreadId)

  const [draft, setDraft] = useState<{ x: number; y: number; elementId: string | null } | null>(null)
  const [draftText, setDraftText] = useState('')
  const [busy, setBusy] = useState(false)

  const page = pages[currentPage]

  // canvas click → new draft pin (CanvasStage dispatches in comments mode)
  useEffect(() => {
    const onDrop = (e: Event) => {
      const detail = (e as CustomEvent<{ x: number; y: number; elementId?: string | null }>).detail
      if (!detail || !page) return
      setDraft({ x: Math.round(detail.x), y: Math.round(detail.y), elementId: detail.elementId ?? null })
      setDraftText('')
    }
    window.addEventListener('canvix:comment-drop', onDrop)
    return () => window.removeEventListener('canvix:comment-drop', onDrop)
  }, [page])

  if (!page) return null

  const threads = buildThreads(comments).filter((t) => t.root.pageId === page.id)

  // element anchor resolution: pin follows its element
  const resolvePinPos = (thread: (typeof threads)[number]): { x: number; y: number } => {
    const root = thread.root
    if (root.elementId) {
      const el = page.elements.find((e) => e.id === root.elementId)
      if (el) return { x: el.x + el.width, y: el.y } // pin at element's top-right corner
    }
    return { x: root.x * width, y: root.y * height }
  }

  const postDraft = async () => {
    const text = draftText.trim()
    if (!text || !designId || !draft || busy) return
    setBusy(true)
    const identity = getIdentity()
    try {
      const res = await fetch(`/api/designs/${encodeURIComponent(designId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId: page.id,
          x: draft.x / width,
          y: draft.y / height,
          elementId: draft.elementId,
          authorId: identity.id,
          authorName: identity.name,
          authorColor: identity.color,
          body: text,
        }),
      })
      if (!res.ok) throw new Error('failed')
      const created = (await res.json()) as CommentRecord
      // optimistic insert — the author sees the pin immediately
      useCommentsStore.getState().upsertComment(created)
      window.dispatchEvent(new CustomEvent('canvix:comments-changed'))
      setDraft(null)
      setDraftText('')
    } catch {
      toast({ title: 'Could not post the comment.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="absolute inset-0 z-20 pointer-events-none">
      {/* existing pins */}
      {threads.map((t) => {
        const pos = resolvePinPos(t)
        const open = openThreadId === t.root.id
        return (
          <div key={t.root.id} className="pointer-events-auto absolute" style={{ left: pan.x + pos.x * zoom, top: pan.y + pos.y * zoom }}>
            <button
              className={cn(
                'flex items-center gap-1 rounded-full h-8 pl-1.5 pr-2.5 shadow-lg transition-all -translate-y-1/2 cursor-pointer',
                t.root.resolved ? 'bg-emerald-600/90 text-white' : 'bg-[#2A6EF4] text-white hover:bg-[#2A6EF4]/90'
              )}
              style={{ transform: `translate(0, -50%) scale(${Math.max(0.75, Math.min(1.4, zoom))})` }}
              onClick={() => useCommentsStore.getState().setOpenThreadId(open ? null : t.root.id)}
              aria-label={`Comment: ${t.root.body.slice(0, 40)}`}
            >
              <span className="w-6 h-6 rounded-full bg-white/25 flex items-center justify-center text-[10px] font-bold">
                {t.root.authorName.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'}
              </span>
              {t.replies.length > 0 && <span className="text-[10px] font-semibold">{t.replies.length + 1}</span>}
              {t.root.resolved && <Check size={11} />}
            </button>

            {/* thread bubble */}
            {open && (
              <div className="absolute left-0 top-6 w-64 rounded-xl bg-[#16181D] border border-white/15 shadow-2xl p-2.5 z-30" style={{ transform: `scale(${Math.max(0.8, Math.min(1.2, zoom))})`, transformOrigin: 'top left' }}>
                <ThreadBubble thread={t} designId={designId} />
              </div>
            )}
          </div>
        )
      })}

      {/* new-pin composer */}
      {draft && (
        <div
          className="pointer-events-auto absolute w-64 rounded-xl bg-[#16181D] border border-white/15 shadow-2xl p-2.5 z-30"
          style={{ left: pan.x + draft.x * zoom, top: pan.y + draft.y * zoom }}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-white/80">New comment</span>
            <button className="text-white/40 hover:text-white cursor-pointer" onClick={() => setDraft(null)} aria-label="Cancel comment">
              <X size={12} />
            </button>
          </div>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void postDraft()
              }
              e.stopPropagation()
            }}
            autoFocus
            rows={3}
            maxLength={2000}
            placeholder="Type your comment…"
            className="w-full rounded-lg bg-white/[0.06] border border-white/10 px-2.5 py-2 text-[12px] text-white placeholder:text-white/30 outline-none focus:border-[#02C0CC]/50 resize-none"
          />
          <div className="flex justify-end gap-1.5 mt-2">
            <Button size="sm" variant="ghost" className="h-7 text-[11px] text-white/60 hover:bg-white/10 hover:text-white" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 px-3 text-[11px] btn-brand-gradient gap-1" disabled={!draftText.trim() || busy} onClick={() => void postDraft()}>
              <Send size={10} /> Post
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function ThreadBubble({ thread, designId }: { thread: ReturnType<typeof buildThreads>[number]; designId: string | null }) {
  const { root, replies } = thread
  const [replyText, setReplyText] = useState('')
  const [busy, setBusy] = useState(false)
  const me = getIdentity()

  const timeAgo = (iso: string) => {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.floor(s / 60)}m`
    if (s < 86_400) return `${Math.floor(s / 3600)}h`
    return `${Math.floor(s / 86_400)}d`
  }

  const addReply = async () => {
    const text = replyText.trim()
    if (!text || !designId || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/designs/${encodeURIComponent(designId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId: root.pageId,
          x: root.x,
          y: root.y,
          parentId: root.id,
          authorId: me.id,
          authorName: me.name,
          authorColor: me.color,
          body: text,
        }),
      })
      if (!res.ok) throw new Error('failed')
      const created = (await res.json()) as CommentRecord
      useCommentsStore.getState().upsertComment(created) // optimistic
      setReplyText('')
    } catch {
      toast({ title: 'Could not post the reply.' })
    } finally {
      setBusy(false)
    }
  }

  const toggleResolve = async () => {
    if (!designId) return
    try {
      const res = await fetch(`/api/comments/${encodeURIComponent(root.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: !root.resolved, actorId: me.id }),
      })
      if (res.ok) {
        // optimistic update for the author + converge with a fresh fetch
        useCommentsStore.getState().upsertComment({ ...root, resolved: !root.resolved })
        window.dispatchEvent(new CustomEvent('canvix:comments-changed'))
      }
    } catch {
      toast({ title: 'Could not update the comment.' })
    }
  }

  const del = async () => {
    if (!designId) return
    try {
      const res = await fetch(`/api/comments/${encodeURIComponent(root.id)}?actorId=${encodeURIComponent(me.id)}`, { method: 'DELETE' })
      if (res.ok) {
        useCommentsStore.getState().removeComment(root.id) // optimistic
        useCommentsStore.getState().setOpenThreadId(null)
        window.dispatchEvent(new CustomEvent('canvix:comments-changed'))
      }
    } catch {
      toast({ title: 'Could not delete the comment.' })
    }
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0" style={{ background: root.authorColor }}>
          {root.authorName.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'}
        </span>
        <span className="text-[11px] font-semibold text-white/90 truncate">{root.authorName}</span>
        <span className="text-[10px] text-white/35 shrink-0">{timeAgo(root.createdAt)}</span>
      </div>
      <p className="text-[12px] text-white/80 break-words">{root.body}</p>
      {replies.map((r) => (
        <div key={r.id} className="mt-1.5 pl-2 border-l border-white/10">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-white/70">{r.authorName}</span>
            <span className="text-[9px] text-white/30">{timeAgo(r.createdAt)}</span>
          </div>
          <p className="text-[11px] text-white/60 break-words">{r.body}</p>
        </div>
      ))}

      <div className="flex items-center gap-1.5 mt-2">
        <input
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void addReply()}
          placeholder="Reply…"
          maxLength={2000}
          className="flex-1 h-7 rounded-lg bg-white/[0.06] border border-white/10 px-2 text-[11px] text-white placeholder:text-white/30 outline-none focus:border-[#02C0CC]/50"
        />
        <Button size="sm" className="h-7 w-7 p-0 btn-brand-gradient" disabled={!replyText.trim() || busy} onClick={() => void addReply()} aria-label="Send reply">
          <Send size={10} />
        </Button>
      </div>

      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/[0.08]">
        <button className="text-[10px] font-semibold text-white/50 hover:text-white flex items-center gap-1 cursor-pointer" onClick={() => void toggleResolve()}>
          <Check size={10} /> {root.resolved ? 'Reopen' : 'Resolve'}
        </button>
        {root.authorId === me.id && (
          <button className="text-[10px] font-semibold text-white/50 hover:text-red-300 flex items-center gap-1 cursor-pointer" onClick={() => void del()}>
            <X size={10} /> Delete
          </button>
        )}
        <span className="ml-auto text-[9px] text-white/25 flex items-center gap-0.5">
          <MessageSquare size={8} /> {replies.length + 1}
        </span>
      </div>
    </div>
  )
}
