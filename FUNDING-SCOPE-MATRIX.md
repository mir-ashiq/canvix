# Canvix Funding Scope Matrix — FOSS United × NLnet × Unfunded × Shipped

**Purpose:** prove, line by line, that the FOSS United proposal funds work that no other funder is being billed for, and that nothing already completed is billed to anyone. Companion to [CANVIX-FOSS-UNITED-PROPOSAL.md](CANVIX-FOSS-UNITED-PROPOSAL.md).

**Statuses:** ✅ shipped (unbilled) · 🔜 FOSS United application (this proposal) · 🔜 NLnet application (pending, not approved) · ⚪ unfunded project work (own cadence)

| Work stream | Status | Funder | Evidence / notes |
|---|---|---|---|
| Docker self-hosting + compose + scoped API keys (**NLnet WP1**) | ✅ shipped | — (unfunded) | PR #77 (v0.24), `docs/DOCKER.md`, CI docker job — completed before any funding decision |
| Brief-contract extraction, rendered-compliance audit, layout planning, vision-critique-before-completion, fail-closed acks, skills engine (v0.29.4) | ✅ shipped | — (unfunded) | PR #85, merged 2026-11-24 — the *foundation* this proposal builds on; the grant funds the next layer, not these commits |
| **A. Design-output correctness** — constraint edge cases, exact text/color preservation, native-element reliability, deterministic geometry checks, corpus in CI | 🔜 FOSS United (M2, ₹1,20,000) | FOSS United only | Extends the shipped v0.29.4 internals into a public, reproducible corpus; no NLnet WP covers design-output correctness |
| **B. Design evaluation** — 20+ brief corpus, screenshot baseline, before/after harness, grounded review reports, fallback behavior | 🔜 FOSS United (M1+M3, ₹2,50,000) | FOSS United only | Evaluation/QA infrastructure; orthogonal to every NLnet WP (which are feature + stability work) |
| **C. Creator education & community** — tutorials, onboarding, 2 engagements, open toolkit | 🔜 FOSS United (M4, ₹1,30,000) | FOSS United only | Education/community output; not in NLnet scope anywhere |
| Test bench hardware (desktop + Android device) | 🔜 FOSS United (M1, within ₹70,000 line) | FOSS United only | NLnet explicitly excludes workstation purchases; FOSS United line is a purpose-scoped test bench |
| Real-time collaboration scaling — LISTEN/NOTIFY hub, op-level undo broadcast (**NLnet WP2**) | 🔜 NLnet | NLnet only | ROADMAP §3, ~120 h — zero overlap with A/B/C |
| Mobile/touch accessible editing (**NLnet WP3**) | 🔜 NLnet | NLnet only | ROADMAP §3, ~60 h |
| Share roles + `.canvix` portability (**NLnet WP4**) | 🔜 NLnet | NLnet only | ROADMAP §3, ~80 h |
| v1.0 stabilization gate — CI perf budgets, WCAG audit, self-hoster handbook, 1.0 tag (**NLnet WP5 S1–S4**) | 🔜 NLnet | NLnet only | ROADMAP §3, ~60 h — note: M3's *design* fallback/verification work is agent correctness, not WCAG accessibility; no double billing |
| AI-provider track — z-ai-web-dev-sdk removal, provider-neutral adapter | ⚪ unfunded | — | ~65 h, deliberately outside both applications (NLnet policy excludes AI connectors; FOSS United scope has no AI connector work) |
| Media GC, misc debt, release checklist upkeep | ⚪ unfunded | — | Own cadence per ROADMAP §5 |

**Double-funding audit (maintainer's commitment):** funded commits carry distinguishing trailers — `Grant: FOSSUnited M#` vs `Grant: NLnet WP#` — and `git log --grep='Grant: '` lists every billed commit. An auditor can reconstruct which funder paid for which hour from the public history alone. If either application is approved, the maintainer maintains a timesheet mapping hours to trailers; if **both** are approved, hours are allocated strictly along the matrix above (A/B/C + test bench to FOSS United; WP2–WP5 to NLnet; nothing billed twice).

**If neither is funded:** A/B/C proceed on the project's own cadence in ROADMAP's recommended order; the matrix still holds (the scope simply ships slower).
