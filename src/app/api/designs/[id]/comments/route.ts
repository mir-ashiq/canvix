import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 30

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/**
 * GET /api/designs/[id]/comments — all comment threads for a design.
 * POST — add a comment (top-level pin or reply via parentId).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const comments = await db.comment.findMany({
      where: { designId: id },
      orderBy: [{ createdAt: 'asc' }],
      take: 500,
    })
    return NextResponse.json(
      comments.map((c) => ({
        id: c.id,
        designId: c.designId,
        pageId: c.pageId,
        x: c.x,
        y: c.y,
        elementId: c.elementId,
        authorId: c.authorId,
        authorName: c.authorName,
        authorColor: c.authorColor,
        body: c.body,
        parentId: c.parentId,
        resolved: c.resolved,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      }))
    )
  } catch (err) {
    console.error('[comments GET]', err)
    return NextResponse.json({ error: 'Could not load comments.' }, { status: 502 })
  }
}

interface CommentBody {
  pageId?: string
  x?: number
  y?: number
  elementId?: string
  authorId?: string
  authorName?: string
  authorColor?: string
  body?: string
  parentId?: string
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: designId } = await params
  try {
    const body = (await req.json().catch(() => ({}))) as CommentBody

    const text = (body.body ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, 2000)
    if (!text) return NextResponse.json({ error: 'A comment body is required.' }, { status: 400 })

    const authorId = (body.authorId ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
    if (!authorId) return NextResponse.json({ error: 'An author id is required.' }, { status: 400 })
    const authorName = (body.authorName ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) || 'Guest'
    const authorColor = HEX_COLOR.test(body.authorColor ?? '') ? body.authorColor! : '#7630D7'

    // anchor: page must belong to the design
    const design = await db.design.findUnique({ where: { id: designId }, select: { pages: true } })
    if (!design) return NextResponse.json({ error: 'Design not found.' }, { status: 404 })

    const parentId = body.parentId ? String(body.parentId).slice(0, 40) : null
    let pageId = (body.pageId ?? '').slice(0, 40)
    let x = Number(body.x)
    let y = Number(body.y)
    let elementId = body.elementId ? String(body.elementId).slice(0, 40) : null

    if (parentId) {
      // reply: inherit the thread's anchor
      const parent = await db.comment.findFirst({ where: { id: parentId, designId } })
      if (!parent) return NextResponse.json({ error: 'Parent comment not found.' }, { status: 400 })
      pageId = parent.pageId
      x = parent.x
      y = parent.y
      elementId = parent.elementId
    } else {
      const pages = (design.pages as unknown as { id?: string }[]) ?? []
      if (!pageId || !pages.some((p) => p.id === pageId)) {
        return NextResponse.json({ error: 'A valid pageId is required.' }, { status: 400 })
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return NextResponse.json({ error: 'Valid anchor coordinates are required.' }, { status: 400 })
      }
      // normalized fractions 0..1
      x = Math.min(1, Math.max(0, x))
      y = Math.min(1, Math.max(0, y))
    }

    const created = await db.comment.create({
      data: {
        designId,
        pageId,
        x,
        y,
        elementId,
        authorId,
        authorName,
        authorColor,
        body: text,
        parentId,
      },
    })

    // broadcast comment activity through the collab event log so live
    // sessions refetch (kind is inert to the document model)
    await db.designEvent
      .create({ data: { designId, actorId: authorId, kind: 'comment:activity', payload: { commentId: created.id } } })
      .catch(() => { /* best-effort */ })

    return NextResponse.json({
      id: created.id,
      designId: created.designId,
      pageId: created.pageId,
      x: created.x,
      y: created.y,
      elementId: created.elementId,
      authorId: created.authorId,
      authorName: created.authorName,
      authorColor: created.authorColor,
      body: created.body,
      parentId: created.parentId,
      resolved: created.resolved,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    })
  } catch (err) {
    console.error('[comments POST]', err)
    return NextResponse.json({ error: 'Could not create the comment.' }, { status: 502 })
  }
}
