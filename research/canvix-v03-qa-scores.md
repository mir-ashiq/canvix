# Canvix v0.3.1 — VLM visual QA scores (2026-09-03)

Scores per key E2E screenshot vs canva.com reference behavior. Prompt asked for a
strict 0-10 fidelity rating with up to 3 defects. Run after the 40-checkpoint E2E pass.

| Screenshot | Score | Noted defects |
|---|---|---|
| 01-dashboard | 8.5 | Topbar height is ~56px but lacks the signature Canva gradient; icon rail is ~72px but uses solid dark instead of the subtle translucent glass effect; template cards lack the slight rounded-corner shadow and hover-state depth of real Canva. |
| 04-editor-blank | 8.5 | Topbar gradient is too linear and lacks the specific Canva purple-to-cyan transition. Left sidebar icons are slightly too small (approx 60px vs 72px). Context toolbar is missing from the top of the canvas area. |
| 07-context-toolbar | 8.2 | Topbar gradient and height slightly off; context toolbar missing; icon rail width is ~60px instead of 72px |
| 08-colour-menu | 8.2 | Topbar height is ~48px instead of ~56px; context toolbar width is ~960px instead of ~885px; left rail icons are ~56px instead of ~72px |
| 12-font-dropdown | 8.4 | Topbar gradient is too linear; sidebar icons are ~60px instead of 72px; missing floating context toolbar for selected text. |
| 13-context-menu | 8.7 | Topbar height is ~48px instead of the required ~56px; Context toolbar is missing (should appear above selection); Left rail icons are ~60px instead of the standard 72px width. |
| 14-zoom-menu | 8.5 | Topbar gradient is too linear and lacks the specific Canva blue-to-purple transition; Context toolbar (885x40) is missing above the canvas; Zoom menu styling and bottom-right controls lack the precise rounded-rectangle aesthetic of the real editor. |
| 25-neon-effect | 8.2 | Topbar gradient is flat purple instead of a blue-to-purple transition; left sidebar icon rail is ~60px instead of the standard 72px; font combinations lack the specific visual weight and spacing of Canva's native type system. |
| 30-rulers | 8.5 | Topbar height is ~48px instead of the required ~56px; Left sidebar icons are ~56px instead of the standard 72px rail; Missing the 885x40 context toolbar above the canvas. |
| 33-layers-panel | 8.5 | Topbar height is ~48px instead of ~56px; Left rail width is ~64px instead of ~72px; Zoom menu lacks the specific rounded-28px dialog styling and precise padding of Canva's context menus. |
| 34-version-history | 8.5 | Topbar gradient and height slightly off; Icon rail width is ~60px instead of 72px; Dialog border radius is ~20px instead of 28-32px. |
| 37-crop-dialog | 8.7 | Top bar height is ~48px instead of the standard ~56px; dialog border radius is slightly sharper than the typical 28-32px Canva spec; left sidebar icon rail is narrower than the standard 72px. |
| 39-cropped | 8.5 | Topbar gradient is flat purple instead of a smooth cyan-to-purple transition; Context toolbar is missing above the selected element; Sidebar width and icon rail sizing appear slightly undersized compared to the 72px standard. |

**Average score: 8.5 / 10 across 13 screenshots**
