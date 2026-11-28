import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const node = process.execPath
const prisma = join(root, 'node_modules', 'prisma', 'build', 'index.js')
const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')

function run(label, args) {
  const result = spawnSync(node, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`)
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set.')
}

run('Prisma migrations', [prisma, 'migrate', 'deploy'])
run('Canvix template seed', [tsx, 'prisma/seed.ts'])
