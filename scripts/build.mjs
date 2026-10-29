// scripts/build.mjs — one build entrypoint for every deploy target
// (Canvix v0.11.2).
//
// WHY
//   `npm run build` used to be `next build` + the standalone copy steps
//   — the output Vercel / self-hosted Node / Netlify's Next runtime
//   need. But a Cloudflare Workers git-connected build (Workers Builds)
//   runs `npm run build` and then `npx wrangler deploy`, and wrangler
//   detects the OpenNext project and delegates to
//   `opennextjs-cloudflare deploy`, which requires the compiled
//   `.open-next/` output — output that plain `next build` never
//   produces. Result: "Could not find compiled Open Next config, did
//   you run the build command?" (production incident 2026-10-29).
//
//   Wrangler's own `build.command` config cannot fix this: the OpenNext
//   delegation check runs BEFORE wrangler would execute a configured
//   build command, so the only place to produce `.open-next/` in that
//   pipeline is the dashboard's build command itself — this script.
//
// HOW
//   Workers Builds documents `WORKERS_CI=1` in its build environment
//   (developers.cloudflare.com/workers/ci-cd/builds/configuration/);
//   Vercel, Netlify and local shells never set it. So:
//
//     WORKERS_CI=1  →  opennextjs-cloudflare build
//                      (runs `next build` internally, emits .open-next/ —
//                       exactly what `wrangler deploy` → the OpenNext
//                       delegation expects; the standalone copy steps
//                       are pointless for Workers and are skipped)
//     otherwise     →  next build && copy static+public into
//                      .next/standalone (unchanged behavior for every
//                       other target)
//
//   The manual Cloudflare scripts (`npm run preview` / `deploy` /
//   `upload`) already run opennextjs-cloudflare themselves and are
//   unaffected.

import { execSync } from 'node:child_process'

/** run a shell command, inheriting stdio so CI logs stream normally */
function run(cmd) {
  execSync(cmd, { stdio: 'inherit' })
}

const isWorkersBuildsCi = process.env.WORKERS_CI === '1'

if (isWorkersBuildsCi) {
  console.log('[build] Cloudflare Workers Builds detected (WORKERS_CI=1) → building the OpenNext worker (.open-next/)')
  // wrangler.jsonc exists, so the "no wrangler config" prompt cannot fire;
  // the build itself is non-interactive in CI either way.
  run('opennextjs-cloudflare build')
} else {
  run('next build')
  // standalone server layout (Vercel / self-hosted `npm start` / Netlify)
  run('cp -r .next/static .next/standalone/.next/')
  run('cp -r public .next/standalone/')
}
