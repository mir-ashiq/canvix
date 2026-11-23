// ─────────────────────────────────────────────────────────────
// Design Skills Engine (v0.28, Phase 2).
//
// Progressive disclosure, Canvix-native (research/DESIGN-SKILLS-
// ENGINE-RESEARCH.md): the router matches a brief against skill
// METADATA only (id/name/description/whenToUse — a few tokens
// each); the winning skill's full PLAYBOOK (principles, planning
// steps, validation checklist) is injected into that run's system
// prompt. Nothing is preloaded wholesale, and skills are pure
// data — they steer the model; execution still rides the same
// validated tool bridge.
//
// Skill content is original Canvix work informed by public
// design-craft standards (WCAG contrast numbers, type-scale
// ratios, grid practice) — no third-party skill text copied.
// ─────────────────────────────────────────────────────────────

import type { AgentMode } from './protocol'

export interface DesignSkill {
  id: string
  name: string
  /** one line for the router — what this skill covers */
  description: string
  /** activation hints matched against the user message (lowercased) */
  whenToUse: string[]
  /** which modes benefit (create/improve/plan/review/edit) */
  modes: AgentMode[]
  version: string
  /** the full playbook — injected ONLY when this skill is selected */
  playbook: {
    /** core principles, imperative, short */
    principles: string[]
    /** ordered planning guidance for this kind of work */
    planning: string[]
    /** deterministic checks the model should run before done */
    validation: string[]
  }
}

export const DESIGN_SKILLS: DesignSkill[] = [
  {
    id: 'poster-design',
    name: 'Poster & Advertisement Design',
    description: 'Posters, flyers, ads, banners, promo graphics — one focal point, loud hierarchy, complete compositions.',
    whenToUse: ['poster', 'flyer', 'ad', 'advert', 'banner', 'promo', 'campaign', 'launch', 'sale', 'event graphic', 'grand opening', 'marketing'],
    modes: ['create', 'improve', 'plan', 'review'],
    version: '1.0.0',
    playbook: {
      principles: [
        'ONE focal point: the headline dominates (40–60% of the vertical rhythm); everything else supports it.',
        'Type scale: headline ≥ 3× the body size; subheadline sits between. Two font families maximum — a display/heading face + a workhorse body face.',
        'Color discipline: ≤ 3 core colors (60% dominant, 30% secondary, 10% accent). The accent color is for the CTA and the single most important detail ONLY.',
        'Contrast: text over image needs a scrim (dark overlay ≥ 35% opacity) or a solid plate. WCAG ≥ 4.5:1 for body, ≥ 3:1 for large headline.',
        'Safe margins: ≥ 6% of the shortest page edge on every side; nothing touches the edge unless it is a deliberate full-bleed background.',
        'Whitespace is structure: group related items (headline + sub + CTA), separate groups by at least the height of one body line.',
        'A poster is 90% visual: 3–7 text elements maximum. Every word must earn its place.',
      ],
      planning: [
        'Read the Design Brief Contract; list every mandatory text and color before placing anything.',
        'Pick the composition archetype: centered hero (classic, confident), asymmetric split (modern, editorial), or full-bleed image with plate (photographic).',
        'Place in order: background → headline block → subhead → CTA → supporting details (date/place/price) → one decorative element max.',
        'For the CTA use the accent color; make it a filled shape or pill, not naked text.',
        'End with fix_overlaps or get_page_state + manual geometry check; then validate_brief.',
      ],
      validation: [
        'Every brief-required text exists VERBATIM on the page.',
        'Every brief-required hex color appears on the page.',
        'No text overlaps other text; text-on-image has a scrim.',
        'Headline is readable at thumbnail size (fontSize ≥ 8% of page height for the main headline on a 1080 canvas).',
        'Margins respected; CTA visually distinct.',
      ],
    },
  },
  {
    id: 'typography',
    name: 'Typography Intelligence',
    description: 'Font pairing, hierarchy, scale, spacing, line height, fitting, readability — the type system for any design.',
    whenToUse: ['font', 'typography', 'type', 'headline', 'title', 'heading', 'pairing', 'kerning', 'letter spacing', 'line height', 'text size', 'readab'],
    modes: ['create', 'improve', 'plan', 'review', 'edit'],
    version: '1.0.0',
    playbook: {
      principles: [
        'Pairing: contrast, not conflict — pair a display face (geometric sans or high-contrast serif) for headings with a neutral workhorse (Inter, Poppins, Work Sans) for body. Never pair two display faces.',
        'Safest pair is ONE family at 2–3 weights; add a second family only when the design needs a voice shift.',
        'Modular scale: pick a ratio (1.2 subtle, 1.25 standard, 1.333 bold, 1.618 dramatic) and derive every size from the body size. Avoid off-scale arbitrary sizes.',
        'Measure: 45–75 characters per line (≈65 ideal). Wider → break the text or narrow the box.',
        'Line height: 1.1–1.3 for headings, 1.4–1.6 for body. Letter spacing: slightly negative (−2%) for huge headlines, 0 for body, +5–10% for ALL-CAPS labels.',
        'Never rely on the 0.6×fontSize width estimate for final placement: call measure_text for anything that must fit a box.',
        'Hierarchy has 3 levels max: headline / subhead / body. If a fourth size appears, demote it to weight or color instead.',
        'Uppercase only for short labels (≤ 5 words); sentence case for everything else.',
      ],
      planning: [
        'Inventory the text roles in the brief (headline, sub, body, CTA, captions).',
        'Choose the pairing from the catalog (respect brand kit fonts when set).',
        'Derive the scale from the format: body ≥ 16px on 1080-wide canvases; headline 3–6× body.',
        'measure_text every heading before finalizing its box; if it clips, reduce size or wrap — never let it overflow.',
      ],
      validation: [
        'No text element overflows its box (measure_text confirms).',
        'Exactly 2–3 distinct font families; 3 hierarchy levels.',
        'Line lengths within 45–75ch for body paragraphs.',
      ],
    },
  },
  {
    id: 'color',
    name: 'Color Intelligence',
    description: 'Palettes, harmony, contrast, gradients, backgrounds, accessible text colors, brand color use.',
    whenToUse: ['color', 'palette', 'contrast', 'gradient', 'background', 'harmon', 'accessible', 'wcag', 'shade', 'tint', 'recolor'],
    modes: ['create', 'improve', 'plan', 'review', 'edit'],
    version: '1.0.0',
    playbook: {
      principles: [
        '60/30/10: dominant (background) 60%, secondary (supporting plates/shapes) 30%, accent (CTA/highlight) 10%.',
        'Build on ONE hue relationship: monochrome (shades of one hue — safest), analogous (neighbors), or complementary (opposites, maximum pop). Triads only for playful brands.',
        'Text contrast ≥ 4.5:1 (body) / ≥ 3:1 (≥ 24px bold or 18.66px+ bold = "large text") against ITS ACTUAL BACKGROUND — a gradient background is checked at its lightest point under the text.',
        'Never place mid-gray text on white or dark-gray on navy; when the palette forces it, darken/lighten the TEXT (keep brand colors on shapes, adjust the text shade).',
        'One gradient per design: linear, ≤ 25° from a cardinal direction, hues within 60° of each other. Gradients are backgrounds or hero fills, not body text fills.',
        'Dark-mode palettes: saturate less, lighten text in steps (gray-100/300/500), never pure #000 or #FFF for large fields — use #090B1A-navy / #F4F5F7-off-white.',
        'The brand kit OUTRANKS your taste but never the brief: brief hexes are verbatim; brand colors fill the unassigned roles.',
      ],
      planning: [
        'List the roles: background, headline, body, accent/CTA, decorative.',
        'Assign brief-mandatory colors first, then brand colors, then derive the rest.',
        'Check every text/background pair for contrast before committing (the vision/geometry validator will re-check).',
      ],
      validation: [
        'Every brief-required hex appears verbatim.',
        'No body text below 4.5:1; no large text below 3:1.',
        'Accent color used on ≤ ~10% of the area (the CTA and one detail).',
      ],
    },
  },
  {
    id: 'layout',
    name: 'Layout & Composition',
    description: 'Grids, alignment, spacing, margins, grouping, balance, focal points, aspect-ratio-aware composition.',
    whenToUse: ['layout', 'align', 'grid', 'spacing', 'margin', 'composition', 'arrange', 'organize', 'balance', 'structure', 'position'],
    modes: ['create', 'improve', 'plan', 'review', 'edit'],
    version: '1.0.0',
    playbook: {
      principles: [
        'Pick ONE grid and stay on it: 12-column (posters/decks), 2-column split (menus/pricing), centered single column (invitations/quotes).',
        'Alignment: every element aligns to something (grid line, another element\'s edge, or the center axis). Random offsets read as mistakes.',
        'Spacing rhythm: use a base unit (≈ 2% of page height) and multiples (1×, 2×, 4×). Same gap = same relationship.',
        'Proximity: things that belong together sit close; separation between groups ≥ 2× the intra-group gap.',
        'Vertical flow: the eye enters top-left (LTR), so the hierarchy cascade reads headline → visual → details → CTA.',
        'Fill the canvas: no dead zones larger than ~20% of the page area unless intentional negative space (which anchors ONE side, never floats random holes).',
        'Deliberate overlap is composition (text on a card, a plate behind a headline); accidental overlap is a bug — fix_overlaps knows the difference for text-on-card, verify the rest with get_page_state.',
        'Aspect awareness: story/reel (9:16) stacks vertically with the CTA in the lower third; 16:9 decks work in rows; 1:1 balances radially or splits.',
      ],
      planning: [
        'Compute the margin (6% of min(w,h)) and the base spacing unit before placing anything.',
        'Sketch the regions: where does the headline block live, the visual, the detail row, the CTA. Give each a bounding box first, then fill.',
        'Place background → large structural shapes → text blocks → small details. Use align_elements to true-up edges as you go.',
      ],
      validation: [
        'All elements inside the safe margins (off-canvas list empty).',
        'Element left edges or centers align on at least one shared axis per group.',
        'Spacing between groups follows the rhythm (no 13px next to 40px gaps without reason).',
      ],
    },
  },
  {
    id: 'brand',
    name: 'Brand Identity',
    description: 'Brand kits, consistency, logo placement, cross-page and cross-format consistency, design tokens.',
    whenToUse: ['brand', 'logo', 'identity', 'consistent', 'style guide', 'rebrand', 'on-brand', 'guidelines'],
    modes: ['create', 'improve', 'plan', 'review'],
    version: '1.0.0',
    playbook: {
      principles: [
        'The brand kit (colors, heading/body fonts) is the DEFAULT palette/typography — deviations need a reason stated in the plan.',
        'Logo placement: consistent corner across every page/format (bottom-right or top-left are conventions), clear space around it = its cap-height, never stretch or recolor it.',
        'Cross-page consistency: same background system, same heading style, same margin grid on every page of a multi-page design; vary the LAYOUT, not the system.',
        'One accent discipline: the accent color is reserved for the key action per page — repeating it everywhere dilutes it.',
        'When no brand kit exists, create a coherent one: pick heading + body fonts, 3 colors, and state them in the plan so every page uses the same values.',
      ],
      planning: [
        'Read the brand kit from the context; if absent, define the system (fonts + 3 colors) BEFORE the first element.',
        'For multi-page work, set page 1 as the style anchor and re-check each later page against it.',
      ],
      validation: [
        'Every page uses the same heading font + accent color.',
        'Logo (if placed) appears exactly once per page, same corner, unmodified.',
      ],
    },
  },
  {
    id: 'critique',
    name: 'Design Critique',
    description: 'Structured review: missing elements, hierarchy, composition, contrast, overflow, overlap, prompt-to-output match. Evidence-based findings.',
    whenToUse: ['review', 'critique', 'feedback', 'wrong with', 'rate', 'score', 'assess', 'evaluate', 'improve this', 'issues', 'problems'],
    modes: ['review', 'improve', 'plan'],
    version: '1.0.0',
    playbook: {
      principles: [
        'Ground EVERY finding in observed state: cite element ids, sizes, colors from get_page_state — never an impression.',
        'Severity ladder: P0 broken (missing required text, unreadable contrast, clipped content) / P1 major (weak hierarchy, misalignment, crowding) / P2 minor (spacing rhythm, color imbalance) / P3 polish (kerning, decorative details).',
        'Compare against the brief FIRST (validate_brief), then craft (typography, color, layout), then polish.',
        'Report only what is present. A missing element is reported as "missing", not described as if it existed.',
        'For every finding, name the fix and the tool that applies it.',
        'In review mode you have NO write tools — findings only; the user (or a follow-up improve run) applies them.',
      ],
      planning: [
        'get_page_state first; if a brief exists, validate_brief and lead with unmet items.',
        'Walk the craft ladder: hierarchy → contrast → alignment → spacing → overflow/overlap → consistency.',
        'Rank findings by severity; cap the report at the top 5–7 — a wall of nitpicks hides the P0s.',
      ],
      validation: [
        'Every finding cites an element id or a measured value.',
        'No finding contradicts the actual state (no phantom elements).',
        'P0s come first and each has a concrete fix.',
      ],
    },
  },
  {
    id: 'presentation',
    name: 'Presentation Design',
    description: 'Slides, decks, speaker-oriented hierarchy, consistent multi-page layouts, charts and diagrams.',
    whenToUse: ['deck', 'presentation', 'slide', 'pitch', 'investor', 'keynote', 'webinar', 'lecture'],
    modes: ['create', 'improve', 'plan', 'review'],
    version: '1.0.0',
    playbook: {
      principles: [
        'One idea per slide: a single claim (the headline) + one proof (visual, chart, or 3 bullets max).',
        '16:9 grid: title zone (top 20%), content zone (middle 60%), footer/brand zone (bottom 12%); margins 5–6% of width.',
        'Deck-wide consistency: identical title style, footer, and margins on every slide; vary content layout across 2–3 slide archetypes (statement, chart, split).',
        'Speaker support, not prose: slides are skimmable in 3 seconds; if a sentence needs reading twice, shorten it.',
        'Charts: one message per chart — title states the takeaway, axis labels legible ≥ 18px on 1920×1080, use the deck palette for series colors.',
        'Numbers large: a key metric slide shows the number at 10–15% of slide height in the accent color.',
      ],
      planning: [
        'Draft the narrative outline first (titles only) — the deck is an argument, then fill slides.',
        'Pick 2–3 slide archetypes and reuse them; every slide states its archetype before placing elements.',
        'Use add_page + goto_page per slide; set the same background system on every page.',
      ],
      validation: [
        'Every slide has exactly one headline in the same style/position.',
        'No slide has more than ~30 words of body text.',
        'Chart text legible; series colors from the palette.',
      ],
    },
  },
  {
    id: 'social',
    name: 'Social Media Design',
    description: 'Platform-specific formats, thumbnail readability, engagement composition, multi-format adaptation.',
    whenToUse: ['instagram', 'story', 'reel', 'tiktok', 'youtube', 'thumbnail', 'social media', 'social post', 'facebook', 'linkedin', 'twitter', 'post'],
    modes: ['create', 'improve', 'plan', 'review'],
    version: '1.0.0',
    playbook: {
      principles: [
        'Platform dims are law: 1080×1080 square post, 1080×1350 portrait, 1080×1920 story/reel, 1280×720 thumbnail. State the format in the plan and resize_design first if needed.',
        'Thumbnail test: headline must be readable at 10% scale (a phone grid) — that means huge type (≥ 8% of canvas height) and ≤ 8 words.',
        'Safe zones: stories keep text out of the top 14% (username) and bottom 20% (CTA bar); thumbnails keep the bottom-right corner clear (duration badge).',
        'One scannable hierarchy: hook (giant) → value line (medium) → brand/handle (small, corner).',
        'Face + text beats text alone for engagement when a photo is available; place text on the quieter third.',
        'Multi-format adaptation: design once in the master format, then adapt per platform by re-flowing the SAME elements to each grid — don\'t redesign.',
      ],
      planning: [
        'Fix the format + dimensions first; note the safe zones.',
        'Hook line from the brief verbatim; compose around it.',
      ],
      validation: [
        'Dimensions match the platform spec.',
        'Headline legible at thumbnail scale (fontSize ≥ 8% of canvas height).',
        'No content in the platform-specific unsafe zones.',
      ],
    },
  },
  {
    id: 'assets',
    name: 'Image & Asset Composition',
    description: 'Stock photo selection, AI image generation, placement, cropping, masks, focal awareness, text-image contrast.',
    whenToUse: ['photo', 'image', 'picture', 'stock', 'illustration', 'icon', 'graphic', 'visual', 'mask', 'crop', 'background image'],
    modes: ['create', 'improve', 'plan', 'edit'],
    version: '1.0.0',
    playbook: {
      principles: [
        'Concrete subject → add_stock_photo (real, licensed, credited). Abstract/stylized or exact-brand art → add_image (generation). Icon-language → add_icon. Decorative scenes → add_illustration.',
        'The photo is a layout region: allocate its bounding box FIRST, then choose orientation (landscape/portrait/square) to match the region.',
        'Focal awareness: keep the subject on the rule-of-thirds intersection; text goes on the calm third (sky, wall, negative space) — else add a scrim.',
        'One hero image per page; more images only as a deliberate grid (3-up gallery) with consistent gaps.',
        'Masks and rounded corners unify photos with the design system (mask_image, radius) — use the SAME treatment on every photo in the design.',
        'Icons: one stroke weight + one color per icon set; icons support labels, they never replace them.',
      ],
      planning: [
        'Decide the image role per region: hero visual, supporting texture, icon row.',
        'Pick the tool per role; write the query/prompt with the composition in mind (orientation, mood, palette-compatible colors).',
      ],
      validation: [
        'Every photo sits fully inside its region with the same corner treatment.',
        'Text over any photo has a scrim or sits on the calm area (contrast check).',
        'Icons consistent (one weight, one color).',
      ],
    },
  },
  {
    id: 'refinement',
    name: 'Design Refinement',
    description: 'Improving existing designs: fix weak layouts, upgrade typography, correct hierarchy, polish — while preserving content and intent.',
    whenToUse: ['improve', 'polish', 'professional', 'clean up', 'better', 'refine', 'fix the design', 'make it pop', 'upgrade'],
    modes: ['improve', 'edit'],
    version: '1.0.0',
    playbook: {
      principles: [
        'Diagnose before touching: get_page_state, run the critique ladder, list the 3 worst problems — fix THOSE, don\'t redecorate.',
        'Preserve content and intent: never delete user copy, never swap their brand colors; adjust execution (size, position, contrast, spacing) not meaning.',
        'The "refine, don\'t add" rule: before adding any new element, exhaust improving what exists. Most weak designs need subtraction (fewer sizes, fewer colors, more whitespace), not more elements.',
        'Order of operations: hierarchy (sizes) → alignment (grid) → spacing (rhythm) → contrast (readability) → color balance → decoration last.',
        'Intentional overlaps (text on cards, plates behind headlines) are composition — check the context\'s overlap analysis and preserve deliberate layering while fixing accidental collisions.',
        'Work in batches: apply one improvement class at a time (all sizes, then all alignments) so each change is verifiable.',
      ],
      planning: [
        'Snapshot the state; identify the 3 highest-severity issues.',
        'For each, name the exact tool calls (element ids included) BEFORE applying.',
        'Re-check with get_page_state after each batch; stop when the validation list passes.',
      ],
      validation: [
        'All original text content still present (nothing lost).',
        'Hierarchy, alignment, spacing checks from the layout skill pass.',
        'No NEW overlaps introduced.',
      ],
    },
  },
]

/** Router: match a user message + mode against skill metadata.
 *  Returns the 1–3 most relevant skills, best first. Pure, cheap,
 *  no model. */
export function selectSkills(message: string, mode: AgentMode, brandKitPresent = false): DesignSkill[] {
  const lower = message.toLowerCase()
  const scored = DESIGN_SKILLS.map((skill) => {
    let score = 0
    // the brand skill's keyword hints only count when a kit EXISTS —
    // "make it on brand" without a kit is a generic refinement ask
    const hintsCount = skill.id === 'brand' && !brandKitPresent ? 0 : 1
    if (hintsCount) {
      for (const hint of skill.whenToUse) {
        if (lower.includes(hint)) score += hint.length >= 6 ? 3 : 2
      }
    }
    if (skill.modes.includes(mode)) score += 2
    if (skill.id === 'brand' && brandKitPresent) score += 2
    // always-relevant craft skills get a small floor in build modes
    if ((skill.id === 'typography' || skill.id === 'color' || skill.id === 'layout') && ['create', 'improve'].includes(mode)) score += 1
    // the critique skill owns review mode
    if (mode === 'review' && skill.id === 'critique') score += 5
    return { skill, score }
  })
  return scored
    .filter((s) => s.score >= 4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => s.skill)
}

/** The prompt section for the selected skills' playbooks (full
 *  disclosure of ONLY the winners). */
export function skillsPromptSection(skills: DesignSkill[]): string {
  if (!skills.length) return ''
  const blocks = skills.map((s) => {
    const p = s.playbook
    return [
      `### Skill: ${s.name} (v${s.version})`,
      'Principles:',
      ...p.principles.map((x) => `· ${x}`),
      'Planning:',
      ...p.planning.map((x, i) => `${i + 1}. ${x}`),
      'Before done, verify:',
      ...p.validation.map((x) => `· ${x}`),
    ].join('\n')
  })
  return ['SELECTED DESIGN SKILLS (follow these playbooks):', ...blocks].join('\n\n')
}
