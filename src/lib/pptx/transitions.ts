// ─────────────────────────────────────────────────────────────
// pptx transitions, sounds and entrance timing (v0.22 — the
// "PPTX limits" wave: text re-wrap safety, font embedding, and
// animations/transitions/SFX carrying into the file format).
//
// Three builders, all pure string functions (the house style):
//   transitionXml()  a page's <p:transition> — the kind/direction/
//                    speed map, plus the page's SFX wired as the
//                    transition sound (<p:sndAc><p:stSnd><p:snd>)
//   timingXml()      the <p:timing> tree — entrance animations as
//                    one click group: first element clickEffect,
//                    the rest withEffect at their delays
//   buildLstXml()    the <p:bldLst> companions
//
// Honest mapping (docs/PPTX-EXPORT.md):
//   fade    → <p:fade/>                     (native)
//   slide   → <p:push dir="…"/>             (native, directional)
//   morph   → <p:fade/>  (nearest universal; PowerPoint's own Morph
//             needs object-matching extensions)
//   fade/rise element animation  → Fade entrance  (presetID 10)
//   pan/wipe                     → Wipe entrance  (presetID 22)
//   zoom/pop                     → Fade entrance  (Zoom needs
//                                  anim-scale trees PowerPoint
//                                  repair-prompts on when hand-built)
//   rotate/breathe (emphasis/loops) → dropped, documented
// ─────────────────────────────────────────────────────────────

import type { AnimationDirection, ElementAnimation, PageTransition } from '@/lib/types'

/** one animated element the mapper saw (native or raster — both are
 *  real OOXML shapes and can carry an entrance). */
export interface AnimatedShape {
  spid: number
  animation: ElementAnimation
}

/** duration (seconds) → the coarse speed attribute PowerPoint's
 *  non-extended transition element accepts. */
function speedOf(seconds: number): 'slow' | 'med' | 'fast' {
  if (seconds < 0.6) return 'fast'
  if (seconds < 1.4) return 'med'
  return 'slow'
}

const PUSH_DIR: Record<AnimationDirection, 'u' | 'd' | 'l' | 'r'> = {
  up: 'u',
  down: 'd',
  left: 'l',
  right: 'r',
}

/** The page transition element, or '' when the page has none.
 *  `sndRid` (optional) wires the page's SFX as the transition sound. */
export function transitionXml(t: PageTransition | undefined, sndRid?: string): string {
  if (!t || t.kind === 'none') return ''
  const spd = speedOf(t.duration)
  const effect =
    t.kind === 'slide'
      ? `<p:push dir="${PUSH_DIR[t.direction ?? 'left']}"/>`
      : `<p:fade/>` // fade AND morph (documented nearest-universal)
  const sound = sndRid
    ? `<p:sndAc><p:stSnd><p:snd r:embed="${sndRid}"/></p:stSnd></p:sndAc>`
    : ''
  return `<p:transition spd="${spd}">${effect}${sound}</p:transition>`
}

// ── entrance timing ──────────────────────────────────────────

/** our kinds → (presetID, animEffect filter). null = not carried. */
function entranceOf(a: ElementAnimation): { presetId: number; filter: string } | null {
  switch (a.kind) {
    case 'fade':
    case 'rise':
      return { presetId: 10, filter: 'fade' }
    case 'pan':
    case 'wipe': {
      // the wipe travels the direction the content pans; PowerPoint
      // names the filter by the travel direction
      const d = a.direction ?? 'left'
      const filter = d === 'up' ? 'wipeUp' : d === 'down' ? 'wipeDown' : d === 'left' ? 'wipeLeft' : 'wipeRight'
      return { presetId: 22, filter }
    }
    case 'zoom':
    case 'pop':
      return { presetId: 10, filter: 'fade' } // documented approximation
    default:
      return null // rotate/breathe: emphasis/loops, not carried
  }
}

/** The <p:timing> tree for a slide's entrance animations, or ''.
 *  Schema: one mainSeq with ONE click group — the first animated
 *  element is the clickEffect, the rest fire withEffect at their
 *  own delays (our present-mode semantics: one advance, then the
 *  sequence plays itself). */
export function timingXml(animated: AnimatedShape[]): string {
  const carried = animated.filter((a) => entranceOf(a.animation) !== null)
  if (!carried.length) return ''
  let id = 1
  const nid = () => ++id

  const effects = carried
    .map((entry, i) => {
      const e = entranceOf(entry.animation)!
      const delay = Math.max(0, Math.round(entry.animation.delay * 1000))
      const dur = Math.max(200, Math.round(entry.animation.duration * 1000))
      const nodeType = i === 0 ? 'clickEffect' : 'withEffect'
      const sid = nid() // the effect cTn
      const setId = nid()
      const animId = nid()
      return (
        `<p:par>` +
        `<p:cTn id="${sid}" presetID="${e.presetId}" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="${nodeType}">` +
        `<p:stCondLst><p:cond delay="${delay}"/></p:stCondLst>` +
        `<p:childTnLst>` +
        // style.visibility → visible (entrances need the initial hide+show)
        `<p:set>` +
        `<p:cBhvr>` +
        `<p:cTn id="${setId}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>` +
        `<p:tgtEl><p:spTgt spid="${entry.spid}"/></p:tgtEl>` +
        `<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>` +
        `</p:cBhvr>` +
        `<p:to><p:strVal val="visible"/></p:to>` +
        `</p:set>` +
        `<p:animEffect transition="in" filter="${e.filter}">` +
        `<p:cBhvr>` +
        `<p:cTn id="${animId}" dur="${dur}"/>` +
        `<p:tgtEl><p:spTgt spid="${entry.spid}"/></p:tgtEl>` +
        `</p:cBhvr>` +
        `</p:animEffect>` +
        `</p:childTnLst>` +
        `</p:cTn>` +
        `</p:par>`
      )
    })
    .join('')

  const rootId = nid()
  const seqId = nid()
  const clickId = nid()
  const withId = nid()
  return (
    `<p:timing>` +
    `<p:tnLst>` +
    `<p:par>` +
    `<p:cTn id="${rootId}" dur="indefinite" restart="never" nodeType="tmRoot">` +
    `<p:childTnLst>` +
    `<p:seq concurrent="1" nextAc="seek">` +
    `<p:cTn id="${seqId}" dur="indefinite" nodeType="mainSeq">` +
    `<p:childTnLst>` +
    // the single click group
    `<p:par>` +
    `<p:cTn id="${clickId}" fill="hold">` +
    `<p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>` +
    `<p:childTnLst>` +
    `<p:par>` +
    `<p:cTn id="${withId}" fill="hold">` +
    `<p:stCondLst><p:cond delay="0"/></p:stCondLst>` +
    `<p:childTnLst>${effects}</p:childTnLst>` +
    `</p:cTn>` +
    `</p:par>` +
    `</p:childTnLst>` +
    `</p:cTn>` +
    `</p:par>` +
    `</p:childTnLst>` +
    `</p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>` +
    `</p:seq>` +
    `</p:childTnLst>` +
    `</p:cTn>` +
    `</p:par>` +
    `</p:tnLst>` +
    `<p:bldLst>${carried.map((a) => `<p:bldP spid="${a.spid}" grpId="0"/>`).join('')}</p:bldLst>` +
    `</p:timing>`
  )
}
