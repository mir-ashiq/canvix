# Canva v0.3.2 Research — fresh canva.com visit (2026-09-03, session 2)

> Method: stealth Playwright (chromium, automation flags stripped) on Xvfb; public
> pages only this session (login cookies unavailable after sandbox reset).
> Captures in `research/canvix-v032-capture/`.

## 1. canva.com landing (2026 re-design)
- New brand palette (measured): **#8B3DFF** (bright violet, primary CTA),
  **#9E9EFF** (light periwinkle), ink **#0F1015**, classic link blue `rgb(0,0,238)`.
- The marketing site moved to a dark, high-contrast aesthetic with violet gradients.
- Editor chrome (from v0.3.0 research) remains the purple #7630D7 / cyan #02C0CC system.

## 2. Official **Design Trends 2026** (canva.com/design-trends)
Ten named trends — great template/effect inspiration:
| Trend | Essence |
|---|---|
| Prompt Playground | fun productivity-software aesthetic |
| Reality Warp | warped visuals, otherworldly photography |
| Explorecore | layered storytelling, purposeful motion |
| Texture Check | tactile, feel-able design |
| Notes App Chic | raw, honest, human "notes app" look |
| Opt Out Era | structured simplicity, decluttered |
| Drama Club | dramatic, theatrical breaks from reality |
| Granny Wave | maximalist remix of heritage + modern design |
| Zinegeist | texture, touch, analog zine effects |
| Block Party | cinematic regional stylization |

## 3. Feature taxonomy (canva.com/create mega-nav, 2026)
- Digital design: Sheets, Docs, **Whiteboards**, Presentations, Social, Photo Editor, Videos, Print, Websites, **PDF Editor**
- Images & photos: Background remover, Photo collages, Mockups, Image enhancer, **AI image generator**, AI photo editor, AI art generator, Draw, Logos
- Product nav: **Canva AI**, **Magic Layers**, Canva AI assistant, **Canva Code**, **Magic Resize**, **Magic Animate**, **Magic Write**, Translate, Magic Insights, Magic Formulas
- AI is now the flagship surface → Canvix answer: Magic Write + AI image generation apps (z-ai sdk, server-side).

## 4. Fonts
- `canva.com/fonts/` now 404s; the directory moved into the editor + learn articles.
- `canva.com/learn/50-free-commercial-fonts` yielded 135 specimen fonts (niche
  freebies: RM Almanack, Bona Nova, Alegreya, Old Standard TT, Didonesque, Lavigne,
  Coolvetica, Phantomonia, Kong Quest, Plexifont, Don Graffiti, Eddie, Shagadelic,
  Fanzine, Brushstroke, Impact Label, Mr Bedfort…).
- Strategy: Canva's picker is dominated by Google-Fonts-class families. Canvix v0.3.2
  expands 15 → **60 families** (sans/serif/display/handwriting + mono pill) with
  search + category pills, matching the Canva font-dropdown UX measured in v0.3.0.

## 5. Gaps → v0.3.2 feature list (this release)
1. **Font library 15 → 60** with categories + search (Canva-style).
2. **Gradient fills for shapes & text** (linear + radial, angle, 2-stop) — Canva
   colour menu "Gradient" tab. (v0.3 had gradients only on page background.)
3. **PDF export** (multi-page, client-side jsPDF) — Canva download dialog parity.
4. **Photos panel** — full rail tab with curated free stock library (search +
   categories), click-to-place. Canvix previously had no Photos tab at all.
5. **Per-page guides** (v0.3.1 guides were design-scoped).
6. **AI apps**: Magic Write (text generation) + AI Images (image generation) via
   server routes + z-ai sdk — mirrors Canva AI / Magic Write flagship.
7. **Trend templates 2026**: Prompt Playground, Notes App Chic, Texture Check,
   Opt Out Era, Granny Wave inspired templates.

## 6. Rejected / deferred
- Real-time collaboration & comments (needs presence backend) → v0.5.
- Whiteboards/Docs/Sheets editors (separate apps, huge scope) → out of scope.
- Video/MP4 export (encoder + codec licensing) → later.
- SVG export (Konva has no toSVG; hand-rolled exporter is error-prone) → later.
- Justify alignment (Konva limitation, kept in UI).
