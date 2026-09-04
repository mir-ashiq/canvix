import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * PATCH /api/comments/[id] — resolve / reopen / edit own comment.
 * DELETE /api/comments/[id] — delete own comment (or thread with replies).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const body = (await req.json().catch(() => ({}))) as {
      resolved?: boolean
      body?: string
      actorId?: string
    }
    const actorId = (body.actorId ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)

    const existing = await db.comment.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 })

    // resolve/reopen: anyone in the design can toggle (canva parity)
    if (typeof body.resolved === 'boolean') {
      const updated = await db.comment.update({ where: { id }, data: { resolved: body.resolved } })
      await db.designEvent
        .create({ data: { designId: updated.designId, actorId, kind: 'comment:activity', payload: { commentId: id } } })
        .catch(() => { /* best-effort */ })
      return NextResponse.json({ ok: true, resolved: updated.resolved })
    }

    // body edit: only the author
    if (typeof body.body === 'string') {
      if (!actorId || actorId !== existing.authorId) {
        return NextResponse.json({ error: 'Only the author can edit this comment.' }, { status: 403 })
      }
      const text = body.body.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, 2000)
      if (!text) return NextResponse.json({ error: 'A comment body is required.' }, { status: 400 })
      await db.comment.update({ where: { id }, data: { body: text } })
      await db.designEvent
        .create({ data: { designId: existing.designId, actorId, kind: 'comment:activity', payload: { commentId: id } } })
        .catch(() => { /* best-effort */ })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  } catch (err) {
    console.error('[comments PATCH]', err)
    return NextResponse.json({ error: 'Could not update the comment.' }, { status: 502 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const actorId = req.nextUrl.searchParams.get('actorId')?.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) ?? ''
    const existing = await db.comment.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 })

    // only the author may delete
    if (!actorId || actorId !== existing.authorId) {
      return NextResponse.json({ error: 'Only the author can delete this comment.' }, { status: 403 })
    }

    // delete the whole thread when a root comment goes
    if (existing.parentId) {
      await db.comment.delete({ where: { id } })
    } else {
      await db.comment.deleteMany({ where: { OR: [{ id }, { parentId: id }] } })
    }

    await db.designEvent
      .create({ data: { designId: existing.designId, actorId, kind: 'comment:activity', payload: { commentId: id, deleted: true } } })
      .catch(() => { /* best-effort */ })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[comments DELETE]', err)
    return NextResponse.json({ error: 'Could not delete the comment.' }, { status: 502 })
  }
}
