// scripts/patch-prisma-wasm.mjs — make the generated Prisma client's
// WASM loading workerd-safe (Canvix v0.9.3).
//
// PROBLEM
//   The `prisma-client` generator (engineType="client") loads the query
//   compiler WASM like this in src/generated/prisma/internal/class.ts:
//
//     async function decodeBase64AsWasm(wasmBase64) {
//       const { Buffer } = await import('node:buffer')
//       const wasmArray = Buffer.from(wasmBase64, 'base64')
//       return new WebAssembly.Module(wasmArray)        // ← sync compile
//     }
//
//   workerd (Cloudflare Workers) forbids ALL runtime wasm compilation —
//   both `new WebAssembly.Module()` and `WebAssembly.compile()` throw
//   "Wasm code generation disallowed by embedder". A wasm module can
//   only enter a Worker as an ESM-imported .wasm file, which wrangler
//   compiles and validates at deploy time.
//
// FIX (three coordinated pieces, all applied here)
//   1. class.ts: sync compile → async WebAssembly.compile (works on
//      Node / Bun / browsers; already returns a promise the caller
//      awaits).
//   2. node_modules/@prisma/client/runtime/
//        query_compiler_bg.postgresql.raw.wasm        (extracted bytes)
//        query_compiler_bg.postgresql.wasm-module.mjs (relative loader)
//      The loader's RELATIVE .wasm import is what makes the whole
//      pipeline work: Next externalizes the @prisma/client package
//      (default serverExternalPackages), OpenNext's wrangler-external
//      esbuild plugin externalizes relative .wasm imports (converting
//      them to valid absolute paths), and wrangler's CompiledModule
//      rule turns the file into a real WebAssembly.Module at deploy.
//   3. class.ts: getQueryCompilerWasmModule branches on runtime —
//      workerd imports the loader from step 2, everything else keeps
//      the base64 path. The workerd branch never executes on Node, so
//      Vercel/self-host behaviour is byte-identical.
//
// This script runs from postinstall / db:generate and is idempotent.
// It FAILS LOUDLY when an expected pattern is missing, so a future
// Prisma upgrade that changes the generator template surfaces here in
// CI instead of silently regressing on Workers.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const classTs = join(root, 'src/generated/prisma/internal/class.ts')
const runtimeDir = join(root, 'node_modules/@prisma/client/runtime')
const base64Mjs = join(runtimeDir, 'query_compiler_bg.postgresql.wasm-base64.mjs')
const rawWasm = join(runtimeDir, 'query_compiler_bg.postgresql.raw.wasm')
const loaderMjs = join(runtimeDir, 'query_compiler_bg.postgresql.wasm-module.mjs')
const ambientDts = join(root, 'src/generated/prisma/internal/wasm-module.d.ts')

function fail(msg) {
  console.error(`✗ patch-prisma-wasm: ${msg}`)
  process.exit(1)
}

// ── 1. patch class.ts: sync compile → async compile ──────────

let source
try {
  source = readFileSync(classTs, 'utf8')
} catch (err) {
  fail(`cannot read ${classTs} — run \`prisma generate\` first. (${err.message})`)
}

const SYNC_COMPILE = 'return new WebAssembly.Module(wasmArray)'
const ASYNC_COMPILE = 'return WebAssembly.compile(wasmArray)'

if (!source.includes(ASYNC_COMPILE)) {
  const count = source.split(SYNC_COMPILE).length - 1
  if (count === 0) {
    fail(`expected pattern not found in generated class.ts:\n    ${SYNC_COMPILE}\n  Prisma likely changed the generator template — re-check the Prisma upgrade notes, then update this patch.`)
  }
  if (count > 1) fail(`"${SYNC_COMPILE}" found ${count} times (expected 1) — refusing to patch.`)
  source = source.replace(SYNC_COMPILE, ASYNC_COMPILE)
  console.log('✓ patch-prisma-wasm: new WebAssembly.Module → WebAssembly.compile (async, runtime-portable)')
}

// ── 2. extract the wasm + write the workerd loader ───────────

let wasmBase64
try {
  const mjs = readFileSync(base64Mjs, 'utf8')
  const m = /const wasm = "([A-Za-z0-9+/=]+)"/.exec(mjs)
  if (!m) fail('could not extract the base64 wasm from query_compiler_bg.postgresql.wasm-base64.mjs — did Prisma change the file format?')
  wasmBase64 = m[1]
} catch (err) {
  if (err.code !== 'ENOENT') throw err
  fail(`cannot read ${base64Mjs} — is @prisma/client installed?`)
}

writeFileSync(rawWasm, Buffer.from(wasmBase64, 'base64'))
console.log(`✓ patch-prisma-wasm: extracted query compiler wasm → ${rawWasm.replace(root + '/', '')} (${Math.round(wasmBase64.length * 0.75 / 1024)} KB)`)

writeFileSync(
  loaderMjs,
  `// Injected by scripts/patch-prisma-wasm.mjs (Canvix v0.9.3) — DO NOT EDIT.
//
// workerd forbids runtime wasm compilation, so the Prisma query compiler
// module must be an ESM-imported .wasm file: wrangler's CompiledModule
// rule compiles and validates it when the Worker is uploaded, and
// OpenNext's wrangler-external esbuild plugin keeps this RELATIVE import
// intact for exactly that purpose. (Next itself externalizes the whole
// @prisma/client package, so Node builds never execute this file.)
import wasmModule from './query_compiler_bg.postgresql.raw.wasm'
export default wasmModule
`
)
console.log(`✓ patch-prisma-wasm: wrote workerd wasm loader → ${loaderMjs.replace(root + '/', '')}`)

// ── 3. patch class.ts: workerd branch in getQueryCompilerWasmModule ──

const OLD_GETTER = `  getQueryCompilerWasmModule: async () => {
    const { wasm } = await import("@prisma/client/runtime/query_compiler_bg.postgresql.wasm-base64.mjs")
    return await decodeBase64AsWasm(wasm)
  }`

const NEW_GETTER = `  getQueryCompilerWasmModule: async () => {
    // workerd (Cloudflare Workers): runtime wasm compilation is forbidden
    // ("Wasm code generation disallowed by embedder"). Import the wasm as
    // an ESM module instead — wrangler compiles it at deploy time. The
    // loader lives inside the @prisma/client package so every bundler in
    // the chain treats it uniformly; this branch never executes on Node.
    if (typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers") {
      const mod = await import("@prisma/client/runtime/query_compiler_bg.postgresql.wasm-module.mjs")
      return mod.default
    }
    // Node / Bun: read the raw wasm from disk and compile it. The patch
    // script (scripts/patch-prisma-wasm.mjs) extracts the bytes next to
    // the runtime. The file is located by walking UP from this module
    // until a node_modules copy is found — createRequire.resolve cannot
    // be used because bundlers rewrite it (Turbopack returns numeric
    // module ids). The walk works in dev, in the standalone build (the
    // chunk layout mirrors the source depth) and under tsx. Crucially
    // there is NO import() of the 2.6 MB base64 module anywhere —
    // bundlers trace dynamic imports relentlessly (Turbopack resolves
    // even env-conditional specifiers), and shipping base64 alongside
    // the raw .wasm would blow the worker past Cloudflare's 3 MB
    // free-plan limit.
    const { existsSync } = await import("node:fs")
    const { readFile } = await import("node:fs/promises")
    const { dirname, join } = await import("node:path")
    const { fileURLToPath } = await import("node:url")
    const REL = join(
      "node_modules",
      "@prisma",
      "client",
      "runtime",
      "query_compiler_bg.postgresql.raw.wasm"
    )
    let dir = dirname(fileURLToPath(import.meta.url))
    let wasmPath: string | null = null
    for (let i = 0; i < 10; i++) {
      const candidate = join(dir, REL)
      if (existsSync(candidate)) {
        wasmPath = candidate
        break
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    if (!wasmPath) {
      throw new Error(
        "Prisma query-compiler wasm not found — run 'npm install' (postinstall extracts it)."
      )
    }
    const bytes = await readFile(wasmPath)
    return WebAssembly.compile(new Uint8Array(bytes))
  }`

if (!source.includes(NEW_GETTER)) {
  if (!source.includes(OLD_GETTER)) {
    fail('expected getQueryCompilerWasmModule block not found in generated class.ts — Prisma likely changed the generator template. Re-check the Prisma upgrade notes, then update this patch.')
  }
  source = source.replace(OLD_GETTER, NEW_GETTER)
  console.log('✓ patch-prisma-wasm: getQueryCompilerWasmModule now branches on workerd (ESM wasm import)')
}

writeFileSync(classTs, source)

// ── 4. ambient types for the injected loader ─────────────────

writeFileSync(
  ambientDts,
  `// Injected by scripts/patch-prisma-wasm.mjs (Canvix v0.9.3) — DO NOT EDIT.
// Types for the workerd-safe query-compiler wasm loader injected into
// node_modules/@prisma/client/runtime (see that script for the why).
declare module '@prisma/client/runtime/query_compiler_bg.postgresql.wasm-module.mjs' {
  const wasmModule: WebAssembly.Module
  export default wasmModule
}
`
)
console.log(`✓ patch-prisma-wasm: wrote ambient loader types → ${ambientDts.replace(root + '/', '')}`)
console.log('✓ patch-prisma-wasm: complete — client is Node + Bun + workerd safe')
