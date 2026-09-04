'use client'

import { create } from 'zustand'

/**
 * Comments runtime state — a dedicated lightweight store (separate from
 * editor-store) so comment updates never re-render the editor chrome.
 */

export interface CommentRecord {
  id: string
  designId: string
  pageId: string
  /** anchor as fraction of page size (0..1) — survives resizes */
  x: number
  y: number
  elementId: string | null
  authorId: string
  authorName: string
  authorColor: string
  body: string
  parentId: string | null
  resolved: boolean
  createdAt: string
  updatedAt: string
}

export interface CommentThread {
  root: CommentRecord
  replies: CommentRecord[]
}

interface CommentsState {
  loaded: boolean
  comments: CommentRecord[]
  /** open thread pin id (panel focus) */
  openThreadId: string | null
  /** unread comments authored by others (id set) */
  unreadIds: Set<string>
  setComments: (list: CommentRecord[], markUnreadFrom: string | null) => void
  upsertComment: (c: CommentRecord) => void
  removeComment: (id: string) => void
  setOpenThreadId: (id: string | null) => void
  markAllRead: () => void
}

export const useCommentsStore = create<CommentsState>((set, get) => ({
  loaded: false,
  comments: [],
  openThreadId: null,
  unreadIds: new Set<string>(),

  setComments: (list, markUnreadFrom) => {
    const prev = get().comments
    const prevIds = new Set(prev.map((c) => c.id))
    const unread = new Set(get().unreadIds)
    if (markUnreadFrom) {
      for (const c of list) {
        if (!prevIds.has(c.id) && c.authorId !== markUnreadFrom && !c.parentId) unread.add(c.id)
      }
    }
    set({ comments: list, loaded: true, unreadIds: unread })
  },

  upsertComment: (c) => {
    const { comments, unreadIds } = get()
    const exists = comments.some((x) => x.id === c.id)
    const next = exists ? comments.map((x) => (x.id === c.id ? c : x)) : [...comments, c]
    const unread = new Set(unreadIds)
    unread.delete(c.id)
    set({ comments: next, unreadIds: unread })
  },

  removeComment: (id) => {
    const { comments, unreadIds } = get()
    const unread = new Set(unreadIds)
    unread.delete(id)
    set({
      comments: comments.filter((c) => c.id !== id && c.parentId !== id),
      unreadIds: unread,
    })
  },

  setOpenThreadId: (id) => set({ openThreadId: id }),

  markAllRead: () => set({ unreadIds: new Set() }),
}))

/** Build reply-threaded view of root comments (sorted newest-first). */
export function buildThreads(comments: CommentRecord[]): CommentThread[] {
  const roots = comments.filter((c) => !c.parentId)
  const byParent = new Map<string, CommentRecord[]>()
  for (const c of comments) {
    if (c.parentId) {
      const list = byParent.get(c.parentId) ?? []
      list.push(c)
      byParent.set(c.parentId, list)
    }
  }
  for (const list of byParent.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return roots
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((root) => ({ root, replies: byParent.get(root.id) ?? [] }))
}

/** track per-design last-read timestamp (localStorage) */
const LAST_READ = (designId: string) => `canvix-comments-read-${designId}`

export function readLastReadAt(designId: string): number {
  try {
    return Number(localStorage.getItem(LAST_READ(designId))) || 0
  } catch {
    return 0
  }
}

export function writeLastReadAt(designId: string, at: number): void {
  try {
    localStorage.setItem(LAST_READ(designId), String(at))
  } catch {
    /* ignore */
  }
}
