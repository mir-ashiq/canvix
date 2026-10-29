/**
 * merge — deterministic offline/concurrent document merge (v0.10).
 *
 * One pure function, used in BOTH places that can see divergent documents:
 *   1. the client applying a remote `pages:replace` (undo / resize /
 *      restore / template) on top of locally-newer state
 *   2. the server merging an autosave PUT whose `baseUpdatedAt` no longer
 *      matches (the tab was offline while others saved)
 *
 * Model: every element is an LWW-register keyed by id, written with an HLC
 * stamp (`_m`); deletes are tombstones (`PageData.tombstones[id] = hlc`).
 * Pages match by id; the page SET is a union (offline page deletions are
 * the documented coarse case). Because both sides run the same rules on
 * the same stamps, CONTENT converges regardless of application order —
 * the property Yjs gives via CRDTs, obtained here without migrating the
 * document model.
 *
 * Array ORDER (element z-order, page order) follows the "ours" side; the
 * server is the canonical convergence point because its merge direction
 * is fixed (the stored document is always "ours" there) — the next
 * autosave persists one canonical order for everyone. Concurrent
 * reorders of the same page may differ transiently per replica until
 * that save lands; content never diverges.
 */

import type { AnyElement, PageData } from '@/lib/types'
import { compareHlc } from './hlc'

/** stamp of an element — undefined (legacy data) reads as epoch */
export function elementHlc(el: AnyElement | undefined): string | undefined {
  return el?._m
}

function tombstonesOf(page: PageData | undefined): Record<string, string> {
  return page?.tombstones ?? {}
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((it) => [it.id, it]))
}

/**
 * Merge two element lists of the SAME page id.
 *
 * Rules (per element id):
 *   - in both  → the copy with the newer `_m` wins (strict >; equal stamps
 *     are impossible across actors, and same-actor equal means identical)
 *   - only ours → keep UNLESS theirs tombstoned it with a newer stamp
 *   - only theirs → add UNLESS ours tombstoned it with a >= stamp
 *
 * Tombstone maps merge pointwise (max stamp), so a delete survives even
 * when the deleted element's side has no element row to contribute.
 */
export function mergeElements(
  ours: AnyElement[],
  theirs: AnyElement[],
  ourTombs: Record<string, string>,
  theirTombs: Record<string, string>,
): { elements: AnyElement[]; tombstones: Record<string, string> } {
  // Defensive dedupe: a well-formed replica holds one element per id, but
  // a malformed/partially-synced document may not. Last occurrence wins
  // (matches Map semantics used below) and keeps the merge total.
  const dedupe = (list: AnyElement[]): AnyElement[] => {
    const seen = new Set<string>()
    const out: AnyElement[] = []
    for (let i = list.length - 1; i >= 0; i--) {
      const el = list[i]
      if (!el?.id || seen.has(el.id)) continue
      seen.add(el.id)
      out.unshift(el)
    }
    return out
  }
  const oursList = dedupe(ours)
  const theirsList = dedupe(theirs)
  const oursMap = byId(oursList)
  const theirsMap = byId(theirsList)

  const tombstones: Record<string, string> = {}
  for (const [id, h] of Object.entries(ourTombs)) tombstones[id] = h
  for (const [id, h] of Object.entries(theirTombs)) {
    if (compareHlc(h, tombstones[id]) > 0) tombstones[id] = h
  }

  const elements: AnyElement[] = []
  // preserve OUR order for elements we keep; theirs-only elements append
  // in their order (stable, deterministic on both sides)
  for (const el of oursList) {
    const their = theirsMap.get(el.id)
    if (their) {
      elements.push(compareHlc(their._m, el._m) > 0 ? their : el)
    } else {
      // deleted by theirs?
      const t = theirTombs[el.id]
      if (t && compareHlc(t, el._m) > 0) {
        // their delete is newer → stays deleted
      } else {
        elements.push(el)
      }
    }
  }
  for (const el of theirsList) {
    if (oursMap.has(el.id)) continue // handled above
    const t = ourTombs[el.id]
    if (t && compareHlc(t, el._m) >= 0) continue // our delete wins (or equal-content re-delete)
    elements.push(el)
  }

  // prune tombstones that no longer beat any live element and refer to
  // nothing on either side (bounded growth hygiene)
  const live = new Set(elements.map((e) => e.id))
  for (const id of Object.keys(tombstones)) {
    if (!live.has(id) && !oursMap.has(id) && !theirsMap.has(id)) {
      // element unknown to both docs — keep the tombstone anyway: it may
      // be racing a third replica's add. Tombstone maps are small.
    }
  }

  return { elements, tombstones }
}

/**
 * Merge page-level scalars. Background & transition are LWW by the page
 * stamp `_pm` (set on page:background / page:replace / pages:replace).
 * Unstamped legacy pages lose against stamped writes; two unstamped pages
 * keep OURS (stability — the server-side merge must not churn on no-ops).
 */
export function mergePageMeta(
  ours: PageData,
  theirs: PageData,
): { background: PageData['background']; transition?: PageData['transition']; _pm?: string } {
  if (compareHlc(theirs._pm, ours._pm) > 0) {
    return { background: theirs.background, transition: theirs.transition, _pm: theirs._pm }
  }
  return { background: ours.background, transition: ours.transition, _pm: ours._pm }
}

/**
 * Merge two full page arrays. Pages match by id; the result is the union
 * (ours-order first, theirs-only pages appended). Element merges run per
 * matched page. The output pages are FRESH objects — inputs are never
 * mutated (safe for structural sharing elsewhere).
 */
export function mergePages(ours: PageData[], theirs: PageData[]): PageData[] {
  const oursMap = byId(ours)
  const theirsMap = byId(theirs)
  const out: PageData[] = []

  for (const page of ours) {
    const their = theirsMap.get(page.id)
    if (!their) {
      out.push(page) // only ours — union keeps it (page deletes are op-level)
      continue
    }
    const { elements, tombstones } = mergeElements(
      page.elements,
      their.elements,
      page.tombstones ?? {},
      their.tombstones ?? {},
    )
    const meta = mergePageMeta(page, their)
    const merged: PageData = { id: page.id, ...meta, elements }
    if (Object.keys(tombstones).length) merged.tombstones = tombstones
    out.push(merged)
  }
  for (const page of theirs) {
    if (oursMap.has(page.id)) continue
    out.push(page)
  }
  return out
}

/** true when a page list carries no stamps/tombstones at all (legacy doc) */
export function isUnstamped(pages: PageData[]): boolean {
  return pages.every((p) => !p._pm && !p.tombstones && p.elements.every((e) => !e._m))
}

/**
 * Stamp every element + the page with `hlc` — used by full-replace ops
 * (undo, redo, resize, restore version, apply template, magic page ops).
 * A stamped replace deterministically WINS against older concurrent edits
 * and LOSES against newer ones, instead of clobbering blindly.
 * Returns fresh page objects (structural sharing preserved per element? —
 * no: a replace redefines every element, so all identities change; that
 * matches today's full-replace rendering behaviour).
 */
export function stampPages(pages: PageData[], hlc: string): PageData[] {
  return pages.map((p) => ({
    ...p,
    _pm: hlc,
    elements: p.elements.map((e) => stampElementDeep(e, hlc)),
  }))
}

/** stamp a single page (page:replace emitters) */
export function stampPage(page: PageData, hlc: string): PageData {
  return { ...page, _pm: hlc, elements: page.elements.map((e) => stampElementDeep(e, hlc)) }
}

/** stamp one element and (recursively) any group children */
export function stampElementDeep<T extends AnyElement>(el: T, hlc: string): T {
  if (el.type === 'group' && Array.isArray((el as unknown as { children?: AnyElement[] }).children)) {
    const g = el as unknown as { children: AnyElement[] } & Record<string, unknown>
    return { ...el, _m: hlc, children: g.children.map((c) => stampElementDeep(c, hlc)) } as T
  }
  return { ...el, _m: hlc }
}

/** stamp a single element (element:add path) */
export function stampElement<T extends AnyElement>(el: T, hlc: string): T {
  return { ...el, _m: hlc }
}
