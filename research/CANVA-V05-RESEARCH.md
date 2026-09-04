# Canva v0.5 Research — Fresh Pass (September 2026)

> Sources: live stealth-browser pass over canva.com (captures in `research/fresh-capture-v05/` — `magic-layers.json`, `page-transitions-help.json`, `comments-help2.json`, `video-help.json`, `canva-ai.json` + screenshots), plus the v0.4 capture archive (`research/fresh-capture/`). Focus: the four v0.5 pillars — Magic Layers, animations, collaboration/comments, video export.

## 1. Magic Layers (canva.com/magic-layers — "Let there be layers")

Fresh capture confirms the current product positioning and workflow:

- **Tagline**: "Turn your flat design into an editable layout with Magic Layers" (Beta, premium AI tool, usage-counted per month, shared with other premium AI tools).
- **Primary use case** explicitly called out: *"Finally, the freedom to edit and control your **AI-generated designs**"* — i.e., the #1 input is a generated flat image that the user then wants to tweak.
- **Steps shown on the page**: ① "Start with your flat design — Upload your flat design, and Magic Layers instantly transforms it into a layout you can **select, move, and edit**." ② Edit your design elements → "Polish, then publish anywhere". ③ "Fine-tune the details — **Fix any element**: move and tweak them however you like; **Change colors** — go from off-white to on-brand in seconds; **Edit text directly** — fix the typo, change the font." ④ "No more do-overs — don't regenerate your design to change one element."
- **FAQ facts**: works on flat images (file-type guidance in FAQ); tied to their AI image generators; also reachable through the AI assistant; metered per use.
- **UI language**: outcomes are always expressed as *native editing capabilities* (select / move / recolor / retype), never "regions". The promise is a real layer stack.

### Realistic reproduction in Canvix (what we build)
A vision-model pipeline that produces **native editable elements**, honestly graded:
1. **Upload** (or pick an AI-generated image) → normalize size, cap at 1280px longest edge for analysis.
2. **Analyze** server-side with the vision model: return strict JSON — `background` (color/gradient or photo), `text regions` (content, approx color, approx font size weight, bounds), `image/photo regions` (bounds, subject), `shape/decoration regions` (bounds, approx color, shape kind), each with **confidence** 0–1 and layer order.
3. **Reconstruct** client-side into real Canvix elements: text → `TextElement` (measured to fit bounds, color from region); photo regions → `ImageElement` cropped from the source bitmap (canvas crop); shapes → `ShapeElement` with classified kind; background → page background (solid/gradient) or full-bleed image.
4. **Confidence UX**: low-confidence regions are inserted but flagged (amber outline in a review step) and can be discarded; the pipeline never *claims* perfect parity — the source image is preserved, and a "swap to original region" affordance exists via element metadata.

This is a genuinely editable output — not a fake. Limitations (documented in-product): complex illustrations are approximated by cropped image regions; exact fonts can't be recovered (mapped to closest family from our 63-font library); overlapped text may merge into one region.

## 2. Animations & page transitions (help: "Use page transitions", "Apply, change, or remove animations")

- **Entry points**: toolbar **Animate** button opens a side panel with **tabs: Page / Element / Text** (text boxes get a dedicated tab). Page **transitions** are applied from *between* page thumbnails ("hover between page thumbnails → Add transition"), and the chosen transition shows as an **icon between pages**.
- **Element animations**: hover to preview, click to apply; **speed presets Slow / Medium / Fast**; premium library tagged "Try Canva Pro"; `None` removes. "Create an Animation" = custom drag-to-path (out of scope for Canvix v0.5 — documented as limitation).
- **Page transitions**: duration **0.1–2.5 s** slider (+ number field), **direction** options depending on style; changing = click the icon between pages.
- **Sharing animated designs**: "download as **videos or GIFs**" — animations and transitions must both survive into video export.
- **Magic Animate**: one-click "instantly enhances your designs with sleek animations and seamless transitions" — a per-page auto-assign pass we can reproduce deterministically (headline → Rise, body → Fade, images → Pan/Zoom, background stays; page transition → Fade).
- **Reduce motion** accessibility setting — playback-only, doesn't affect export. Worth copying (cheap, inclusive).
- Element animation ordering ("appear on click", click-order list) is presentation-specific; Canvix v0.5 keeps time-based ordering (delay) — documented difference.

**Canvix v0.5 model** (independent of Konva, pure functions of time):
`element.animation = { kind: fade|rise|pan|pop|wipe|zoom|rotate|breathe, duration, delay, easing, direction? }`
`page.transition = { kind: none|fade|slide|morph, duration }`
Playback + video export both consume `animateElement(el, t)` / transition timing. Static exports (PNG/JPG/PDF/SVG) ignore it entirely.

## 3. Comments (help: "Add, delete, and resolve comments")

- **Anchoring**: comments attach to **elements, text, or the page itself**; while collaborating they appear as **floating badges with the commenter's initials or profile photo** (docs highlight instead).
- **Adding**: select element/page → **Add comment** icon in the floating toolbar → type → Send.
- **Threads**: formatting (bold/italic/strike/quote/list/hyperlink), **replies**, **resolve / unresolve**, edit/delete own, **react** to a comment, **share links to a comment**, hide/unhide all.
- **Panel**: comment icon at the top of the editor → filter **All / For you (tagged)** / **Current page**; unread state and sorting.
- Anchors keep their position when the design is resized (Canva remaps to the element anchor; free-floating pins track page coords).

**Canvix v0.5**: pins anchored to page coords + optional `elementId`; when the anchored element moves, the pin follows (element-relative anchor offset); panel with All/Resolved filters + unread badge; initials avatar with the participant color; resolve/reopen/reply/delete-own. Markdown formatting limited to plain text v1 (documented).

## 4. Collaboration / multiplayer

From the v0.4 pass + known Canva behavior (canva.com collaboration pages redirect internationally, so summarized from editor behavior):
- Presence = **stacked avatars in the top bar** (click → collaborator list), live **colored cursors with name tags** on canvas, live selection outlines in the collaborator's color, element "being dragged by X" state.
- No-refresh propagation of every edit (moves, text typing, adds/deletes, page changes); offline indicator + auto-reconnect; comments are the review layer on top.
- Canva links: "anyone with the link can view/edit" — no login wall for basic collab.

## 5. Video export (help: "Download videos")

- MP4 is the headline download format for animated designs (also GIF for animations); export dialog communicates **render progress** and where the file renders (Canva renders server-side; Canvix renders locally in-browser).
- Animated designs export with their **element animations and page transitions baked into the timeline**.

## 6. AI Assistant 2.0 (canva.com/canva-ai — "Canva AI 2.0")

Fresh capture of `/canva-ai/`: positioned as one assistant that **acts on the design** ("design, writing, and creative tools" in one place); deep-linked from Magic Layers FAQ as the host surface for Magic Layers ("Can I access Magic Layers through my AI assistant tool?" → yes). Confirms the v0.5 direction: assistant = design-aware operator returning **structured actions**, not just chat.

## 7. Conclusions for the Canvix v0.5 build

| Canva capability | Canvix v0.5 scope | Honest gap |
|---|---|---|
| Magic Layers | VLM region pipeline → native editable elements + confidence flags | no exact font recovery; illustration → cropped image regions |
| Animate (panel, presets, speed) | 8 element kinds, durations/delay/easing, Magic-Animate auto pass, reduce-motion | no custom drag-path animations |
| Page transitions | none/fade/slide/morph, 0.1–2.5 s, icon between thumbnails | no 3D/overlay transitions |
| Comments | full threads, resolve, unread, anchored pins | no rich-text formatting, no @-mentions |
| Collaboration | live presence, cursors, selections, ops sync, reconnect | ~1 s SSE latency vs Canva's ws; no offline merge (last-write-wins per element) |
| Video/MP4 export | real in-browser frame renderer + MediaRecorder (MP4 where the browser can, else WebM) | server-side MP4/Ffmpeg not available on the deploy target; format depends on browser codecs |
| SVG export | full vector document export | text wrapping is measured (font metrics), not layout-identical in exotic fonts |
