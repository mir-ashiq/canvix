import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

// GET /api/designs/[id]/versions — list server-side version snapshots (newest first)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const versions = await db.designVersion.findMany({
      where: { designId: id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    })
    return NextResponse.json(
      versions.map((v) => ({
        id: v.id,
        label: v.label,
        name: v.name,
        width: v.width,
        height: v.height,
        pages: v.pages ?? [],
        createdAt: v.createdAt.toISOString(),
        server: true,
      }))
    )
  } catch (error) {
    console.error('GET /api/designs/[id]/versions failed', error)
    return NextResponse.json({ error: 'Failed to list versions' }, { status: 500 })
  }
}

// POST /api/designs/[id]/versions — save a new version snapshot
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    const exists = await db.design.findUnique({ where: { id }, select: { id: true } })
    if (!exists) return NextResponse.json({ error: 'Design not found' }, { status: 404 })

    const version = await db.designVersion.create({
      data: {
        designId: id,
        label: typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 120) : 'Version',
        name: typeof body.name === 'string' ? body.name.slice(0, 120) : 'Untitled design',
        width: Number.isFinite(body.width) ? Math.round(body.width) : 1080,
        height: Number.isFinite(body.height) ? Math.round(body.height) : 1080,
        pages: (body.pages ?? []) as Prisma.InputJsonValue,
      },
    })

    // prune: keep the 30 most recent per design
    const keep = await db.designVersion.findMany({
      where: { designId: id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true },
    })
    if (keep.length === 30) {
      await db.designVersion.deleteMany({
        where: { designId: id, id: { notIn: keep.map((k) => k.id) } },
      })
    }

    return NextResponse.json(
      {
        id: version.id,
        label: version.label,
        name: version.name,
        width: version.width,
        height: version.height,
        pages: version.pages ?? [],
        createdAt: version.createdAt.toISOString(),
        server: true,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('POST /api/designs/[id]/versions failed', error)
    return NextResponse.json({ error: 'Failed to save version' }, { status: 500 })
  }
}
