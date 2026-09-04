'use client'

import { useMemo, useState } from 'react'
import { Check, CheckCircle2, MessageCircle, Reply, Trash2, X, MessageSquare } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import {
  buildThreads,
  useCommentsStore,
  type CommentThread,
} from '@/lib/comments-store'
import { getIdentity } from '@/lib/collab/identity'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

type Filter = 'open' | 'all' | 'resolved'

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

/** Comments side panel — canva-style review threads. */
export function CommentsPanel() {
  const designId = useEditorStore((s) => s.designId)
  const pages = useEditorStore((s) => s.pages)
  const setCurrentPage = useEditorStore((s) => s.setCurrentPage)
  const setCommentsOpen = useEditorStore((s) => s.setCommentsOpen)
  const comments = useCommentsStore((s) => s.comments)
  const openThreadId = useCommentsStore((s) => s.openThreadId)
  const [filter, setFilter] = useState<Filter>('open')
  const me = getIdentity()

  const threads = useMemo(() => buildThreads(comments), [comments])
  const filtered = useMemo(() => {
    if (filter === 'open') return threads.filter((t) => !t.root.resolved)
    if (filter === 'resolved') return threads.filter((t) => t.root.resolved)
    return threads
  }, [threads, filter])

  const findPageIndex = (pageId: string) => pages.findIndex((p) => p.id === pageId)

  const focusThread = (t: CommentThread) => {
    const idx = findPageIndex(t.root.pageId)
    if (idx >= 0 && idx !== useEditorStore.getState().currentPage) setCurrentPage(idx)
    useCommentsStore.getState().setOpenThreadId(t.root.id)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
        <h2 className="font-bold text-sm text-white flex items-center gap-2">
          <MessageSquare size={15} className="text-[#02C0CC]" /> Comments
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full text-white/70 hover:bg-white/10 hover:text-white h-7 w-7"
          onClick={() => setCommentsOpen(false)}
          aria-label="Close comments"
        >
          <X size={14} />
        </Button>
      </div>

      {/* filters */}
      <div className="px-4 pb-3 shrink-0">
        <div className="flex gap-1 rounded-lg bg-white/[0.05] p-0.5">
          {(['open', 'resolved', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold capitalize transition-colors cursor-pointer',
                filter === f ? 'bg-white/[0.12] text-white' : 'text-white/50 hover:text-white/80'
              )}
            >
              {f} {f === 'open' && threads.filter((t) => !t.root.resolved).length > 0 && `(${threads.filter((t) => !t.root.resolved).length})`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-4 space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-10 px-4">
            <MessageCircle size={26} className="mx-auto text-white/20 mb-2" />
            <div className="text-[13px] font-semibold text-white/60">
              {filter === 'open' ? 'No open comments' : filter === 'resolved' ? 'No resolved comments' : 'No comments yet'}
            </div>
            <p className="text-[11px] text-white/40 mt-1">
              In comments mode, click anywhere on the canvas to drop a pin.
            </p>
          </div>
        )}

        {filtered.map((t) => (
          <ThreadCard
            key={t.root.id}
            thread={t}
            designId={designId}
            highlighted={openThreadId === t.root.id}
            onFocus={() => focusThread(t)}
            meId={me.id}
            pageIndex={Math.max(0, findPageIndex(t.root.pageId))}
          />
        ))}
      </div>
    </div>
  )
}

function ThreadCard({
  thread,
  designId,
  highlighted,
  onFocus,
  meId,
  pageIndex,
}: {
  thread: CommentThread
  designId: string | null
  highlighted: boolean
  onFocus: () => void
  meId: string
  pageIndex: number
}) {
  const { root, replies } = thread
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [busy, setBusy] = useState(false)
  const last = replies.length ? replies[replies.length - 1] : root

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
          authorId: getIdentity().id,
          authorName: getIdentity().name,
          authorColor: getIdentity().color,
          body: text,
        }),
      })
      if (!res.ok) throw new Error('failed')
      setReplyText('')
      setReplyOpen(false)
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
        body: JSON.stringify({ resolved: !root.resolved, actorId: getIdentity().id }),
      })
      if (res.ok) {
        // optimistic — the author sees the resolved state immediately,
        // then converge with a fresh fetch (beats any in-flight refetch race)
        useCommentsStore.getState().upsertComment({ ...root, resolved: !root.resolved })
        window.dispatchEvent(new CustomEvent('canvix:comments-changed'))
      }
    } catch {
      toast({ title: 'Could not update the comment.' })
    }
  }

  const deleteComment = async () => {
    if (!designId) return
    try {
      const res = await fetch(
        `/api/comments/${encodeURIComponent(root.id)}?actorId=${encodeURIComponent(getIdentity().id)}`,
        { method: 'DELETE' }
      )
      if (res.ok) {
        useCommentsStore.getState().removeComment(root.id)
        window.dispatchEvent(new CustomEvent('canvix:comments-changed'))
      }
    } catch {
      toast({ title: 'Could not delete the comment.' })
    }
  }

  return (
    <div
      className={cn(
        'rounded-xl border p-2.5 cursor-pointer transition-colors',
        highlighted
          ? 'border-[#02C0CC]/50 bg-[#02C0CC]/[0.07]'
          : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]'
      )}
      onClick={onFocus}
    >
      <div className="flex items-start gap-2">
        <span
          className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 mt-0.5"
          style={{ background: root.authorColor }}
        >
          {initials(root.authorName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-semibold text-white/90 truncate">{root.authorName}</span>
            <span className="text-[10px] text-white/35 shrink-0">{timeAgo(root.createdAt)}</span>
            {root.resolved && (
              <span className="text-[9px] font-semibold text-emerald-300/80 flex items-center gap-0.5 shrink-0">
                <Check size={9} /> resolved
              </span>
            )}
          </div>
          <p className="text-[12px] text-white/75 mt-0.5 break-words">{root.body}</p>

          {replies.length > 0 && (
            <div className="mt-1.5 space-y-1.5 pl-2 border-l border-white/[0.08]">
              {replies.map((r) => (
                <div key={r.id} className="flex items-start gap-1.5">
                  <span
                    className="w-4.5 h-4.5 w-[18px] h-[18px] rounded-full flex items-center justify-center text-[7px] font-bold text-white shrink-0 mt-0.5"
                    style={{ background: r.authorColor }}
                  >
                    {initials(r.authorName)}
                  </span>
                  <div className="min-w-0">
                    <span className="text-[11px] font-semibold text-white/70">{r.authorName}</span>
                    <p className="text-[11px] text-white/60 break-words">{r.body}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* thread actions */}
          <div className="flex items-center gap-1 mt-1.5 -ml-1">
            <button
              className="text-[10px] font-semibold text-white/50 hover:text-white px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                setReplyOpen((v) => !v)
              }}
            >
              <Reply size={10} /> Reply
            </button>
            <button
              className="text-[10px] font-semibold text-white/50 hover:text-white px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                void toggleResolve()
              }}
            >
              <CheckCircle2 size={10} /> {root.resolved ? 'Reopen' : 'Resolve'}
            </button>
            {root.authorId === meId && (
              <button
                className="text-[10px] font-semibold text-white/50 hover:text-red-300 px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  void deleteComment()
                }}
              >
                <Trash2 size={10} /> Delete
              </button>
            )}
            <span className="ml-auto text-[9px] text-white/25 shrink-0">Page {pageIndex + 1}</span>
          </div>

          {replyOpen && (
            <div className="mt-2 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
              <input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addReply()}
                placeholder={`Reply to ${root.authorName}…`}
                maxLength={2000}
                autoFocus
                className="flex-1 h-8 rounded-lg bg-white/[0.06] border border-white/10 px-2.5 text-[12px] text-white placeholder:text-white/30 outline-none focus:border-[#02C0CC]/50"
              />
              <Button
                size="sm"
                className="h-8 px-3 btn-brand-gradient"
                disabled={!replyText.trim() || busy}
                onClick={() => void addReply()}
              >
                Send
              </Button>
            </div>
          )}
        </div>
      </div>
      <span className="hidden">{last.id}</span>
    </div>
  )
}
