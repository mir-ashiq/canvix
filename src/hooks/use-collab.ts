'use client'

import { useEffect, useRef } from 'react'
import { useEditorStore, setOpEmitter } from '@/store/editor-store'
import { CollabSession } from '@/lib/collab/client'
import { getIdentity } from '@/lib/collab/identity'

/**
 * Active session hub — CanvasStage cursor tracking needs to reach the
 * session without prop-drilling through the component tree.
 */
let activeSession: CollabSession | null = null

export function getActiveCollabSession(): CollabSession | null {
  return activeSession
}

/**
 * useCollab — mounts a CollabSession for the open design.
 *
 * Wire-up:
 *   store local mutations → session.emit (batched POST)
 *   session SSE frames → store.applyRemoteOp / setCollaborators / setCollabStatus
 *
 * Remote ops apply WITHOUT pushing undo history (history stays local) and
 * never re-emit (no feedback loop). Local input is never blocked.
 */
export function useCollab(): void {
  const designId = useEditorStore((s) => s.designId)
  const sessionRef = useRef<CollabSession | null>(null)

  useEffect(() => {
    if (!designId || typeof window === 'undefined') return

    const identity = getIdentity()
    const session = new CollabSession(designId, identity.id, identity.name, identity.color)
    sessionRef.current = session
    activeSession = session

    session.onStatus = (s) => useEditorStore.getState().setCollabStatus(s)
    session.onEvents = (events) => {
      const store = useEditorStore.getState()
      for (const ev of events) store.applyRemoteOp(ev)
      // comment mutations ride the event log as inert activity markers →
      // the comments layer refetches (own events are SSE-filtered, but the
      // author's own posts apply optimistically in the UI)
      if (events.some((e) => e.kind === 'comment:activity')) {
        window.dispatchEvent(new CustomEvent('canvix:comments-changed'))
      }
    }
    session.onPresence = (collaborators) => useEditorStore.getState().setCollaborators(collaborators)

    setOpEmitter((op) => session.emit(op, `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`))
    session.start()

    return () => {
      setOpEmitter(null)
      session.dispose()
      if (sessionRef.current === session) sessionRef.current = null
      if (activeSession === session) activeSession = null
      useEditorStore.getState().setCollaborators([])
      useEditorStore.getState().setCollabStatus('offline')
    }
  }, [designId])
}
