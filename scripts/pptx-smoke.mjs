// scripts/pptx-smoke.mjs — generate a real PPTX from synthetic pages
// using the actual export path (vitest import semantics), then let
// soffice convert it to PDF to prove the package parses.
// Run: node --experimental-vm-modules scripts/pptx-smoke.mjs
import { pathToFileURL } from 'node:url'

// vitest aliases '@/…' → src/…; replicate with a tiny loader
import { register } from 'node:module'
import { pathResolve } from 'node:path'

const root = pathResolve('.')

// Use tsx-style loading through vitest's config is overkill here —
// instead import the compiled-through-vite modules via a one-off
// vitest run (see pptx-realfile.test.ts). This script only exists
// to document the manual path; see the test for the generator.
console.log('Use: npx vitest run src/lib/pptx/pptx-realfile.test.ts')
console.log('It writes /tmp/pptx-smoke.pptx for soffice conversion.')
