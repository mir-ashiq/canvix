// Browser bundle entry for the DesignSpec render proof: exposes the
// app's REAL vector export pipeline on window for in-page evaluation.
import { exportPageToSVG } from '@/lib/svg-export'

;(globalThis as unknown as Record<string, unknown>).__canvixExportPageToSVG =
  exportPageToSVG
