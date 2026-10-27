// Template library validator — run: npx tsx scripts/validate-templates.ts
import { TEMPLATES } from '../src/lib/templates'

const byCat: Record<string, number> = {}
let problems = 0
const seen = new Set<string>()
for (const t of TEMPLATES) {
  byCat[t.category] = (byCat[t.category] ?? 0) + 1
  if (seen.has(t.slug)) { problems++; console.error('DUPLICATE SLUG:', t.slug) }
  seen.add(t.slug)
  if (!t.pages.length) { problems++; console.error('NO PAGES:', t.slug) }
  for (const p of t.pages) {
    if (!p.background) { problems++; console.error('PAGE WITHOUT BG:', t.slug) }
    for (const el of p.elements as unknown as Array<Record<string, unknown>>) {
      if (typeof el.x !== 'number' || typeof el.y !== 'number') { problems++; console.error('BAD XY:', t.slug, String(el.type)) }
      if (!el.id) { problems++; console.error('NO ID:', t.slug, String(el.type)) }
    }
  }
}
console.log('TOTAL:', TEMPLATES.length)
console.log('by category:', JSON.stringify(byCat, null, 0))
console.log('premium badges:', TEMPLATES.filter((t) => t.badge === 'premium').length)
console.log('problems:', problems)
process.exit(problems ? 1 : 0)
