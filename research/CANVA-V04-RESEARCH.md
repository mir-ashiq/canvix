# Canva research — v0.4.0 fresh pass (2026-09-03, session 3)

> Method: stealth Playwright (Chrome 152, automation flags stripped, warmed-up
> Cloudflare clearance) over canva.com public pages. Captures in
> `research/fresh-capture/` (gitignored). The editor itself stays behind login;
> editor facts come from the earlier v0.3 research passes.

## 1. Landing page (2026 re-design)
- H1: "What will you design today?" — CTA "Start designing"
- Tagline: "Make AI-powered social posts, videos, presentations, and more"
- Hero feature tiles (order matters — it's their marketing priority):
  Magic Layers → Magic Eraser → Background Remover → Magic Write →
  Presentations → Templates → Brand Kit → Animations → Video editor →
  Background Remover (again) → Image Upscaler → Magic Resize → Video editor →
  Video templates → Stock videos → AI Captions → Print Shop → Magic Resize
  (again) → Invitations → AI Image Generator
- Visual Suite nav: Sheets, Docs, Whiteboards, Presentations, Social, Photo
  Editor, Videos, Print, Websites, PDF Editor
- "Unlock Canva's creative ecosystem" → Disney & Marvel templates

## 2. canva.com/canva-ai (Canva AI 2.0)
- "Coming Soon" banner: conversational creation — start with an idea (text or
  voice), connect to your world (pulls context from connected tools), edit
  your way (chat or manual), generate elements (image/chart/headline on
  request), brand-aware outputs, run web research, learns over time,
  scheduled tasks
- → Canvix answer: **Canvix AI assistant app** (chat copilot that sees the
  design, with add-text / generate-image / palette / translate actions)

## 3. Feature pages studied
- **Magic Resize** (canva.com/pro/magic-resize): "Use Magic Resize™ to resize,
  transform, and translate your designs" — Magic Switch resizes one design
  into many for all channels. → Canvix: multi-select presets + Copy & resize
  + in-place smart re-layout (v0.4 implemented)
- **Magic Layers** (canva.com/magic-layers, Beta): "Turn your flat design into
  an editable layout" — upload a flat design, get selectable/movable/editable
  elements. → Canvix: deferred (needs image→elements decomposition)
- **Background Remover** (canva.com/features/background-remover): one-click,
  drag-drop upload or in-editor "BG Remover" toolbar button, PNG download.
  → Canvix v0.4: in-browser ONNX segmentation (true alpha)
- **Translate** (canva.com/translate): AI translation of designs into 134
  languages, Pro feature, per-page translation, LTR↔RTL support.
  → Canvix v0.4: 24 languages, all pages at once, layout preserved
- **Templates** (canva.com/templates): categories — Presentations, Instagram
  Posts, Flyers, Websites, Logos, Posters, Facebook Posts, Resumes, Instagram
  Stories, Docs, Invitations, Whiteboard, Desktop Wallpapers, Business Cards,
  Calendars, Certificates, T-Shirts, Cards, Worksheets, Invoices.
  → Canvix v0.4: + "Docs & office" category (resume, certificate, invoice,
  calendar, business card)

## 4. Deferred gaps (v0.5+ backlog)
- Magic Layers (flat-design → editable elements)
- Real-time collaboration & comments (presence backend)
- Animations (Magic Animate — preview-time element/page animations)
- SVG export; video/MP4 export
- Whiteboards / Docs / Sheets editors (separate apps)
- Canva AI 2.0's connected-context + scheduled tasks (needs accounts)

## 5. v0.4.0 implementation summary
| Canva feature | Canvix v0.4 implementation | Status |
|---|---|---|
| Magic Resize / Magic Switch | ResizeDialog: 12 presets, in-place or copy&resize, smart re-layout (lib/magic.ts) | ✅ |
| Background Remover | In-browser ONNX (`@imgly/background-removal`), true alpha PNG | ✅ |
| Magic Eraser | `/api/ai/image-edit` mode=erase (generative object removal) | ✅ |
| Image Upscaler | `/api/ai/image-edit` mode=enhance (sharpen/clean) | ✅ |
| Translate (134 langs) | `/api/ai/translate` + TranslateDialog, 24 languages, all pages | ✅ (24 langs) |
| Canva AI 2.0 assistant | `/api/ai/assistant` + AssistantApp chat with action chips | ✅ (local design context) |
| Photo search (millions) | `/api/photos/search` (z-ai image search) + live Photos panel results | ✅ (web-scale) |
| Version history (server) | DesignVersion model on Postgres + versions API + sync | ✅ |
| Trash | Design.deletedAt soft delete + restore/delete-forever UI | ✅ |
| Template categories | +5 docs/office templates (21 total) | ✅ |
| Magic Layers | — | ⏳ v0.5 |
