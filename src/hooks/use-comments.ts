'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useEditorStore } from '@/store/editor-store'
import { getIdentity } from '@/lib/collab/identity'
import {
  useCommentsStore,
  writeLastReadAt,
  readLastReadAt,
  type CommentRecord,
} from '@/lib/comments-store'

/**
 * useComments — comment CRUD for the open design + live refresh.
 *
 * Live updates piggyback on the collaboration event stream: the server
 * appends an inert `comment:activity` event on every comment mutation; the
 * collab layer sees it and triggers a refetch. Comments never enter the
 * document model.
 */
export function useComments(): void {
  const designId = useEditorStore((s) => s.designId)
  const setComments = useCommentsStore((s) => s.setComments)
  const refetchRef = useRef<() => void>(() => {})

  const refetch = useCallback(async () => {
    if (!designId) return
    try {
      const res = await fetch(`/api/designs/${encodeURIComponent(designId)}/comments`)
      if (!res.ok) return
      const list = (await res.json()) as CommentRecord[]
      if (Array.isArray(list)) {
        const me = getIdentity().id
        const lastRead = readLastReadAt(designId)
        setComments(list, me)
        // unread = others' comments newer than our last read
        const unread = new Set(
          list.filter((c) => c.authorId !== me && Date.parse(c.createdAt) > lastRead && !c.parentId).map((c) => c.id)
        )
        useCommentsStore.setState({ unreadIds: unread })
      }
    } catch {
      /* offline — keep the current list */
    }
  }, [designId, setComments])

  useEffect(() => {
    refetchRef.current = () => void refetch()
  }, [refetch])

  // initial load on design open
  useEffect(() => {
    if (!designId) return
    useCommentsStore.getState().setComments([], null)
    useCommentsStore.setState({ comments: [], loaded: false, openThreadId: null, unreadIds: new Set() })
    void refetch()
  }, [designId, refetch])

  // live refresh: the collab session dispatches 'canvix:comments-changed' when
  // a comment:activity event arrives (another participant's comment mutation)
  useEffect(() => {
    if (!designId) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const onChanged = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => refetchRef.current(), 250)
    }
    window.addEventListener('canvix:comments-changed', onChanged)
    // light backup poll (works even when the collab stream is proxied away)
    const poll = setInterval(() => refetchRef.current(), 15_000)
    return () => {
      window.removeEventListener('canvix:comments-changed', onChanged)
      clearInterval(poll)
      if (timer) clearTimeout(timer)
      if (designId) writeLastReadAt(designId, Date.now())
    }
  }, [designId])
}

/** mark everything as read (called when the comments panel opens) */
export function markAllCommentsRead(designId: string): void {
  writeLastReadAt(designId, Date.now())
  useCommentsStore.getState().markAllRead()
}
