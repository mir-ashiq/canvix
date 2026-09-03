'use client'

import dynamic from 'next/dynamic'

const PreviewStage = dynamic(() => import('@/components/editor/canvas/preview-stage'), { ssr: false })

interface DesignPreviewProps {
  page: import('@/lib/types').PageData
  width: number
  height: number
}

/**
 * Client-safe thumbnail renderer for a design page.
 * Parent must provide a sized box (e.g. `aspect-[4/5]`).
 */
export function DesignPreview({ page, width, height }: DesignPreviewProps) {
  return <PreviewStage page={page} designWidth={width} designHeight={height} />
}
