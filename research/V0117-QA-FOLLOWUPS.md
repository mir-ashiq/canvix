# v0.11.7 — QA follow-ups: F1 (deselect), F5 (render-phase writes), F6 (share docs)

Closes out the three findings that stayed open after the v0.11.4–v0.11.6
QA sweep (§5.2 of `research/V0114-QA-PASS.md`). All three were reproduced
before fixing; the reproduction method is documented below because F5 in
particular rewards it.

## F1 — no deselect on empty-canvas click

**Finding.** Clicking empty canvas kept the current selection; only
Escape (and touch, via `handleStageTouchStart`) deselected. Canva
deselects on empty click.

**Mechanism.** A left click on empty canvas (`target === stage` or the
`page-bg` rect) starts a marquee. On mouse-up, `selectInMarquee` treats a
drag smaller than 4×4 page-pixels as "not a marquee" and early-returns —
before ever reaching `clearSelection()`. A real drag that selects nothing
*did* clear; only the bare click was left out.

**Fix.** The zero-size branch now clears the selection — one honest line
at the top of the branch (`CanvasStage.selectInMarquee`):

```ts
if (w < 4 && h < 4) {
  clearSelection()
  return
}
```

Middle-mouse and space+drag panning already cleared (they still do), and
viewing mode is untouched (the marquee never starts there).

## F5 — "Cannot update a component (`X`) while rendering (`CanvasStage`)"

**Finding.** The v0.11.4 QA console showed:

```
Cannot update a component (`MagicLayersDialog`) while rendering a
different component (`CanvasStage`)
```

**Root cause — it was never about MagicLayers.** A Playwright
reproduction with a patched `console.error` (capturing `new Error().stack`
at log time — the warning fires synchronously inside the offending
`setState`) pinned the real call chain:

```
Object.pushHistory      (editor-store)
Object.addElement       (editor-store)
CanvasStage.useEffect.commit   ← window "mouseup" handler
basicStateReducer       ← the setDraft UPDATER running mid-render
```

Three gesture commits wrote the store from *inside* `setState` updaters:

| gesture | updater | store write inside |
| --- | --- | --- |
| draw stroke commit | `setDraft((d) => …)` | `addElement(createStrokeElement(…))` |
| marquee mouse-up | `setMarquee((m) => …)` | `setSelection` / `clearSelection` (via `selectInMarquee`) |
| ruler guide drop | `setDraftGuide((d) => …)` | `addManualGuide(axis, position)` |

React runs state updaters during the render of the component that owns
the state — `CanvasStage`. The store write then synchronously notified
subscribers (`forceStoreRerender` → `scheduleUpdateOnFiber`), i.e. it
re-rendered *other* components while `CanvasStage` was mid-render. Which
component the warning names depends on subscriber processing order — the
QA session saw `MagicLayersDialog` (it is always mounted by `TopBar`),
the reproduction saw `TopBar`. Same bug, different name; that
nondeterminism is why the finding read like a MagicLayers bug.

Notably, the full MagicLayers upload → analyze → review → create flow
runs warning-free — verified directly against a mocked
`/api/ai/magic-layers`.

**Fix — commit at event time, never inside an updater.**

- **Stroke**: the effect keeps a local `points` mirror, updated on every
  mousemove; `commit()` reads it, calls `setDraft(null)` and — only
  then — `addElement(...)`. The local mirror also removes a staleness
  edge the functional updater used to handle (mouseup beating the
  re-render after the last mousemove).
- **Marquee**: a `marqueeShapeRef` mirror is seeded in
  `handleStageMouseDown` and updated on every move; mouse-up reads the
  ref, clears it, calls `setMarquee(null)` and then `selectInMarquee(m)`.
- **Guide**: the axis is fixed for the whole drag, so the effect tracks
  just `position` locally; mouse-up calls `setDraftGuide(null)` and then
  `addManualGuide(axis, position)`.

All three updaters that remain (`setDraft`, `setMarquee`, `setDraftGuide`
during moves) are now pure.

**A bonus interaction:** F1 had been *masking* the marquee variant of
this warning — a bare click early-returned before any store write, so
only drags and strokes could trigger it. Fixing F1 first would have made
every empty-canvas click warn; the two fixes land together on purpose.

## F6 — Share dialog documented the wrong access model

**Finding.** The share URL works for anyone by design (v0.5; the v0.9
README §accounts note). The editor shows an honest view-only banner for
other accounts' designs. Worth documenting on the Share dialog for
self-hosters.

**What the dialog showed instead.** A decorative access selector —
"Only me — Private to you", "Anyone with the link — Can view or edit",
"Public — Listed in the community gallery" — persisted to
`localStorage` and enforced by nothing (no code reads it; the community
gallery does not exist). Documenting the real model next to it would
have made the dialog contradict itself.

**Fix.** The selector is replaced by a "Who can open this link" card
stating the contract the server actually enforces
(`src/lib/auth/design-guard.ts`):

1. Anyone who can reach the instance can open the link — reachability
   is decided by the deployment (LAN, VPN, reverse-proxy auth); Canvix
   has no cloud gatekeeping.
2. Ownerless designs (created while signed out) stay editable by
   everyone with the link — the pre-accounts behaviour, kept on purpose.
3. Designs owned by an account open read-only for everyone else:
   view-only banner in the editor, 403 on every save.

When the open design is read-only for you, the dialog says so (an amber
note driven by the same `readOnly` flag the editor banner uses).

## Two more finds while verifying (both pre-existing)

**The ruler→guide initial position was computed from the wrong axis.**
`rulers.tsx beginGuide()` fed `beginGuideFromRuler` an initial position
from the *swapped* coordinate — mouse **X** for a horizontal guide
(axis `y`), mouse **Y** for a vertical one (axis `x`). Harmless
mid-drag (the first mousemove overwrote the value), but a bare click on
a ruler committed a guide at a nonsense position, and the dashed draft
flashed in the wrong place for one frame. Fixed to match the guide's
axis (mouse Y from the TOP ruler, mouse X from the LEFT ruler).

**`Konva.stages` order is a race — never address the editor by index.**
The first E2E draft counted Konva nodes on `Konva.stages[0]`, which
 intermittently failed: the **PageBar** mounts its page thumbnails
(`design-preview.tsx` → `PreviewStage`) as their own mini Konva stages
*inside the same `<main aria-label="Design canvas">`*, and their mount
order races the editor canvas. (The stroke test passed by accident —
strokes DO render in thumbnails; guides never do, because they are
editor chrome, not document content.) The helper now picks the
**largest** stage on the page, which is always the editor canvas,
regardless of mount order.

## Verification

Reproduced all three before fixing (F5 via the stack-capture method
above; F1 by hand; F6 by inspection of the dialog + guard code).

Post-fix:

- Playwright `tests/e2e/qa-followups.spec.ts` (5 tests, this PR): the F1
  deselect click plus element re-select (no over-deselecting), marquee
  re-select and empty-marquee clear, stroke draw and ruler-guide drop
  each asserting **zero** "Cannot update a component" console errors,
  and the F6 card contents (including the absence of the fake selector).
- Full gates: `tsc --noEmit` clean, `eslint` clean, vitest 302/302,
  Playwright 28/28 (23 + 5 new).
- `research/V0114-QA-PASS.md` §5.2 annotated: F1/F5/F6 → FIXED in
  v0.11.7. With this, all six findings of the v0.11.4 QA pass are
  closed (F2/F3 in v0.11.6, F4 in v0.11.5).
