// Trace the file-layer header extraction precisely.
import { readFileSync, existsSync } from 'node:fs'
import { resolveProviderConfig } from '../src/lib/ai/provider'

const p = '/etc/.z-ai-config'
console.log('exists:', existsSync(p))
const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
console.log('raw keys:', Object.keys(raw).join(','))
console.log('token truthy:', !!raw.token, 'userId truthy:', !!raw.userId)

const cfg = resolveProviderConfig()
console.log('resolved:', cfg ? { baseUrl: cfg.baseUrl, headers: cfg.headers ? Object.keys(cfg.headers) : 'NONE' } : null)
process.exit(0)
