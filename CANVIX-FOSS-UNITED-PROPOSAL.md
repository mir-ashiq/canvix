# Canvix — FOSS United Project Grant Proposal

**Applicant:** Ashiq Hussain Mir (individual maintainer) — Jammu & Kashmir, India
**Email:** imseldrith@gmail.com · **GitHub:** https://github.com/mir-ashiq
**Project:** Canvix — https://canvix.app · https://github.com/mir-ashiq/canvix
**License:** MIT · **Manifest:** `funding.json` (fundingjson.org v1.1.0)
**Requested amount:** ₹5,00,000 INR, one-time, six-month milestone-based program
**Status of this application:** Submitted via the funding.json mechanism (directory entry dated 12 November 2026); this document is the substantive proposal that the updated manifest points to. **This is an application, not an award — no grant has been approved, rejected or disbursed as of 24 November 2026.**

---

## 1. Executive summary

Canvix is a live, free, open-source graphic design platform — a browser-based editor with 366 templates, real-time collaboration, exports to PNG/JPG/SVG/vector-PDF/PPTX/GIF/video, a provider-independent AI layer, and one-command Docker self-hosting. It is maintained by one final-year CS student in India, has shipped 160+ commits since September 2026, and serves real users at canvix.app today.

The platform's hardest remaining problem is **AI design-output correctness**: when a user asks for "the exact text HEADLINE in these exact colors," the result must contain exactly that text and those colors, with no clipping, no invented elements, and honest reporting of what was really built. This proposal requests **₹5,00,000 over six months** to (A) make design generation measurably correct, (B) build a reproducible, public design-quality evaluation harness, and (C) turn the results into open creator education. The scope is deliberately disjoint from the pending NLnet application (deployment trust, collaboration scaling, mobile editing, sharing, v1.0 stabilization), so **no hour or deliverable is funded twice**.

## 2. Applicant background

I am Ashiq Hussain Mir, a final-year computer-science student in Jammu & Kashmir, India, and the sole maintainer of Canvix. I have built the entire platform — editor, collaboration, export pipelines, AI architecture, plugin system, MCP integration, test infrastructure — over 160+ commits since September 2026, alongside a full academic load. The engineering is verifiable in the open: 156 test files (1,575 unit tests) and a 39-file Playwright end-to-end suite gate every release; CI (typecheck, lint, unit, e2e, Docker image build) runs on every pull request. I am seeking a six-month development runway so I can keep building Canvix at this pace through my final year instead of trading development hours for part-time work.

## 3. Project introduction

Canvix exists because graphic design tools split into two unsatisfying camps: capable proprietary editors that gate features behind subscriptions and accounts, and open tools that trail on the export/collaboration/self-hosting axis that real teams need. Canvix is a working third option: a genuinely free (MIT, no watermarks, no paywalls, try-without-account) design platform with the features people actually ship work with — and it runs on infrastructure you control.

## 4. Current technical capabilities

All verifiable in the repository and at canvix.app:

- **Editor:** browser-based canvas editor — text (rich text, spans, RTL, lists), shapes (parametric polygons/stars), images (masks, filters, adjustment), tables, charts, QR codes, icons, illustrations, stickers, video and audio elements, multi-page documents with per-page sizes and speaker notes, presenter view, rulers/guides/snap, grids, layers, animation and page transitions.
- **Templates:** 366 seeded templates across poster/social/presentation/print categories, including smart templates with fill-in dialogs.
- **Collaboration:** real-time multi-user editing with presence, last-write-wins merges with deletion tombstones; an HLC-based op pipeline.
- **Exports:** local browser-side export to PNG, JPG, SVG, vector-text PDF, native editable PPTX, animated GIF, and video (WebM/MP4 with audio), plus WebP.
- **AI layer (provider-independent):** modular capability slots (text, vision, image, video, sound) with bring-your-own-key; instance-level providers plus per-user BYOK; an agentic design loop with a tool bridge, design-skills engine, and brief-contract validation; MCP (Model Context Protocol) server integration.
- **Self-hosting:** three-stage Docker image, migrate-on-boot entrypoint, compose file (Postgres 17 + app), scoped API keys (`designs:read`/`designs:write`), REST API, backup/restore tooling — the one-command self-host.
- **Extensibility:** first-party plugin rail with manifest validation and sha256-pinned bundles; stock photo/video connectors (Pexels/Pixabay) with license-safe fail-closed gates.
- **Quality infrastructure:** 1,575 unit tests, 39 e2e Playwright spec files, CI on every PR (typecheck, lint, unit, production build, Docker job with container-level health checks), weekly grouped Dependabot, security policy, governance docs.

## 5. Public deployment and repository evidence

- **Live site:** https://canvix.app (health endpoint `GET /api/health` reports version, database status and the 366-template count).
- **Repository:** https://github.com/mir-ashiq/canvix — MIT license, 160+ commits by the maintainer since 2026-09-03, full CHANGELOG (v0.1.0 → v0.29.x), ROADMAP, SECURITY.md, GOVERNANCE.md, CODE_OF_CONDUCT.md, CONTRIBUTING.md, RELEASE-CHECKLIST.md, per-subsystem docs (17 files under `docs/`).
- **Releases:** tagged v0.22.1, v0.23.0, v0.23.1 with release notes; continuous minor-version shipping since.
- **Self-hosting proof:** `docs/DOCKER.md` + a CI job that boots the real containers and checks health, registration and the landing page through them.

## 6. Community problem being addressed

Design capability is a basic literacy — for students, educators, small nonprofits, community organizers and independent creators — and in India it is gated by cost, accounts, data-export friction and vendor lock-in. Free tiers watermark or limit exports; cloud-only tools take the work with them. An MIT-licensed, self-hostable, watermark-free design platform with real collaboration and real exports removes those gates for exactly the audience FOSS United serves. The specific gap this grant addresses: **AI-assisted design is only trustworthy when its output is verifiably correct** — exact text, exact colors, honest reporting. Today that bar is rarely met even by commercial tools; Canvix's v0.29.4 agent fixes (brief contract, rendered compliance, vision-before-completion) are the foundation, and this proposal turns them into a public, reproducible engineering standard.

## 7. Comparison with alternatives

Canvix differs from Canva, Adobe Express and Microsoft Designer in license and freedom (MIT vs proprietary; self-hostable vs cloud-only; no account required vs mandatory). It differs from most "AI design" tools in keeping designs as **native editable elements** rather than flattened generated images, and in being **provider-independent** (any OpenAI-compatible provider, BYOK) rather than locked to one vendor. Against Figma, it targets a different job (document/poster/presentation design with local export breadth, not UI design) at a fraction of the deployment footprint. This is a claim of *different positioning*, not superiority: the commercial tools are far more mature and feature-complete, and Canvix's competitive matrix (in-repo, `docs/COMPETITIVE-ANALYSIS.md`) scores them honestly.

## 8. Differentiation and open-source value

- **Free as in freedom AND as in beer:** MIT license, no watermarks, no paywalls, no forced accounts — permanent, by design.
- **Self-hosting as sovereignty:** a school, nonprofit or community can run the full platform (editor, templates, collaboration, exports) on one small server with `docker compose up`; data never leaves their infrastructure.
- **Editable-native AI:** the AI layer composes native elements, so AI-assisted work remains real, editable design work — and every AI feature is optional (the platform is fully usable with zero AI keys configured).
- **Provider independence:** the AI slots are BYOK and pluggable; no vendor relationship is load-bearing.
- **Public engineering standard:** the proposed evaluation harness publishes what "correct design output" means and measures it in CI — usable by other FOSS design tools, not just Canvix.

## 9. Current users and adoption evidence

**Sourcing note (explicit):** the following are historical, self-reported, maintainer-observed statistics from the production admin console, observed around early–mid November 2026. They are **not** independently audited analytics; anonymous designs and possible automated traffic cannot be fully separated from the totals, and current counts may differ.

- ~161 registered accounts
- ~5,300 saved designs (including anonymous/unauthenticated designs)
- 366 seeded templates (verifiable via the public health endpoint)
- ~71 active users on the observation day

Repository-side evidence (independently verifiable): 160+ commits, 168 pull requests/issues activity, CI runs on every PR, public releases. No revenue, testimonials, retention or download figures are claimed — none exist.

## 10. Development history and maintainer experience

Canvix started September 2026 and shipped continuously: v0.1.0 (editor foundations) → v0.10.x (real-time collaboration, offline sync) → v0.14–0.16 (assets, uploads, sound, the trust layer: SECURITY/GOVERNANCE/funding.json) → v0.21–0.24 (native PPTX export, vector PDF, BYOK AI providers, scoped API keys, Docker self-hosting = NLnet-track WP1) → v0.27–0.29 (the agentic design loop: tool bridge, skills engine, brief contract, rendered-compliance audit, planning, vision-before-completion, fail-closed acknowledgments — shipped as v0.29.4 after root-causing a failed production design run). The maintainer's track record is the commit history: 100% of product commits authored by Ashiq Hussain Mir, with Dependabot handling dependency updates.

## 11. Funding justification

**₹5,00,000 for six months.** This is a cost-recovery runway, not a salary: it lets a proven, full-time-capable maintainer spend ~25 h/week on a public-interest FOSS project through the final year of study, in exchange for specific, verifiable, public deliverables. Every rupee maps to either committed engineering time with published acceptance criteria, a test bench that CI alone cannot replace, or community/education output. The amount sits inside FOSS United's median project-grant band (₹3–7 lakh disbursed over about a year). The original draft (₹5,40,000) was revised downward after auditing the weakest line — hardware — against what the deliverables actually require; the comparison is recorded in §12.

## 12. Detailed budget

| Category | INR | Justification (estimate — costs are labeled, not quoted) |
|---|---:|---|
| Maintainer support, 6 months | ₹3,60,000 | ~25 h/week × 26 weeks ≈ 650 h ≈ **₹554/h** cost-recovery — below entry-level market rate for the skill set (frontend + distributed systems + AI integration). Replaces the part-time income that would otherwise take those hours. Milestone-linked: hours are committed against the M1–M4 acceptance criteria. |
| Dedicated cross-browser test bench | ₹70,000 | One mid-range desktop (Ryzen 5/i5-class, 32 GB RAM, 1 TB NVMe) plus one mid-range Android device for the M1 baseline matrix. CI (GitHub-hosted) covers per-PR checks, but the inner loop — iterating on the 39-file e2e suite, 1080p export encodes, Docker builds, real-device browser testing — needs local hardware. **Market estimate, not a quotation**; final configuration confirmed with real quotations before purchase. Original draft had ₹1,10,000 (high-end personal machine); trimmed to the configuration the funded deliverables actually need — a test bench, not a workstation upgrade. |
| Testing, documentation & community | ₹70,000 | Itemized: two public community engagements (India FOSS meetups/devsprints, travel + materials) ₹30,000; tutorial/education production hardware (USB microphone, headphones) ₹15,000; real-device cross-browser testing service credits for the published evaluation matrix ₹15,000; domain/static-report hosting ₹5,000; contingency (≤10%) ₹5,000. No proprietary AI API credits are budgeted — the evaluation harness uses local/self-hosted and BYOK resources. |
| **Total** | **₹5,00,000** | Tranche schedule: M1 ₹1,30,000 · M2 ₹1,20,000 · M3 ₹1,20,000 · M4 ₹1,30,000 (mirrored 1:1 in the funding.json plans). |

**Recorded comparison — ₹5,40,000 (original draft) → ₹5,00,000 (this proposal):** the original hardware line (₹1,10,000) was not defensible without a quotation and overlapped what funders commonly treat as basic workstation IT. It was cut to ₹70,000 (a purpose-scoped test bench + test device), and the total lowered rather than silently reallocating the difference. Maintainer support and community/education lines were unchanged. **All amounts are estimates pending FOSS United feedback and real quotations; none is presented as verified expenditure.**

## 13. Six-month work plan

**Already shipped (not billed to this grant):** brief-contract extraction, rendered-compliance audit (effective backdrops, obscuring detection, measured text widths), layout planning, vision-critique-before-completion, fail-closed acks, the design-skills engine, and the greeting/chitchat guard — all in v0.29.4 (PR #85, merged 24 Nov 2026). This grant funds the **next** layer: turning those internals into a public, reproducible standard and education program.

- **Month 1 (M1) — Baseline & harness.** Publish the evaluation plan; assemble 20+ diverse briefs (posters, social, presentations, print — varying text lengths, scripts incl. Devanagari, palettes); run the current agent against each; record rendered screenshots, exact-text/color diffs, geometry/clipping analysis; stand up the test bench; open the public issue tracker; publish progress report #1.
- **Months 2–3 (M2) — Design-output correctness.** Fix what the baseline exposed: constraint extraction edge cases, exact text/color preservation, native-element generation reliability, deterministic geometry checks; move the brief-contract corpus into CI as reproducible browser tests; publish before/after evidence per fix.
- **Months 4–5 (M3) — Grounded visual review.** Requested-vs-actual comparison reports; screenshot-based inspection where a vision model is available; explicit, honest fallback when it is not; no invented-element claims (verification statements only from captured evidence); publish full-corpus before/after results and remaining limitations.
- **Month 6 (M4) — Community, release, final report.** Open-source the evaluation toolkit (briefs, harness, report generator); user documentation and tutorials; contributor onboarding; two public community engagements across the period; final milestone evidence, expenditure summary, public final report.

## 14. Milestone acceptance criteria

| Milestone | Tranche | Pass condition (all public) | Fail condition |
|---|---:|---|---|
| M1 — Baseline & harness | ₹1,30,000 | Evaluation plan + 20+ brief corpus + baseline report (screenshots, text/color diffs, geometry analysis) + issue tracker live; progress report #1 published | Any artifact missing or unpublished |
| M2 — Design-output correctness | ₹1,20,000 | Brief-contract suite runs in CI; every baseline failure has a fix with before/after evidence; exact-text/color checks pass on the corpus | Corpus not in CI, or any unfixed baseline failure without a documented reason |
| M3 — Grounded visual review | ₹1,20,000 | Before/after results across the corpus; every verification claim backed by captured evidence; fallback behavior documented and demonstrated | Any claim without captured evidence, or no published results |
| M4 — Community & final report | ₹1,30,000 | Toolkit, docs, onboarding material merged; ≥2 linked public engagements; expenditure summary + final report published | Any deliverable unpublished |

## 15. Deliverables and expected impact

Public artifacts, all MIT-licensed: (1) the design-quality evaluation plan and brief corpus; (2) the evaluation harness with screenshot diffing, text/color comparison and geometry checks — reusable by any FOSS design tool; (3) the fixed-then-verified correctness improvements in Canvix itself; (4) before/after evaluation reports; (5) user tutorials, contributor onboarding docs; (6) community engagement records; (7) the final report and expenditure summary. Impact: a reproducible public standard for "the AI actually built what was asked," a more trustworthy free design platform for Indian creators and educators, and an on-ramp for contributors.

## 16. Community engagement plan

At least one public engagement per quarter (FOSS United's stated expectation) — concretely: two engagements across the six months (an India FOSS meetup/devsprint talk showing the evaluation harness, and an online session/tutorial walkthrough with published materials), plus monthly written progress reports in the repository and responsive issue triage. All materials CC-BY-SA/MIT dual-licensed where the repo's licenses allow.

## 17. Sustainability strategy

Canvix's costs are structurally low: the app runs on a small VPS (donated-by-maintainer time on Oracle's free tier today), exports are browser-side (no render farm), the AI layer is BYOK (no AI bill for the project), and self-hosters pay their own hosting. The maintainer's post-grant plan: v1.0 (stabilization gate, NLnet-track WP5 scope), a contributor community grown via the education material, and — only if the community wants it — optional managed hosting as a separate, clearly-bounded service that never paywalls the self-hostable core. The MIT core stays free regardless of any future funding outcome.

## 18. Risks and mitigation

| Risk | Mitigation |
|---|---|
| Final-year academic load compresses the schedule | 25 h/week average was chosen against the actual academic calendar; milestones are scoped to month-level, tranche-gated, and FOSS United can hold any tranche |
| Vision-model availability varies | M3's design *requires* explicit fallback behavior — the evaluation harness never depends on a paid vision API (BYOK/local only) and reports "unverified" rather than guessing |
| Solo-maintainer bus factor | M4's contributor onboarding + public docs reduce key-person risk; the repo's governance docs already define the project's continuity posture |
| Correctness fixes expose deeper architecture issues | That is the point of the baseline: failures are documented publicly and fixed within the milestone, or reported honestly as remaining limitations |
| Budget estimates drift | All costs are estimates labeled as such; the final report reconciles actuals; contingency is capped at 10% of the community line |

## 19. Licensing and development transparency

Everything shipped under this grant is MIT-licensed (evaluation materials CC-BY-SA where a doc license fits better). Canvix's public [AI & Development Disclosure](README.md#-ai--development-disclosure) states the project's standard: the codebase was built with AI-assisted development disclosed openly, and **grant-funded milestones are human-authored engineering with AI tools restricted to read-only review** (the same standard adopted for the NLnet-track work: AI costs €0/₹0 — no AI subscriptions or API credits in any budget line). Commits for grant work will carry a `Grant: FOSSUnited M#` trailer, mirroring the existing `Grant: NLnet WP#` convention, so the funding boundary is auditable with `git log --grep='Grant: FOSSUnited'`.

## 20. Concurrent funding disclosure

- **NLnet (application, not approved):** a work program covering WP2–WP5 — collaboration scaling, mobile/touch editing, sharing roles & portability, v1.0 stabilization — 420 h ≈ €12,600 labour-only (WP1 already completed unfunded). See ROADMAP.md §3. **No hour, deliverable or expense in this FOSS United proposal overlaps it** — the boundary is documented line-by-line in [FUNDING-SCOPE-MATRIX.md](FUNDING-SCOPE-MATRIX.md).
- **FOSS United directory listing (12 Nov 2026):** the earlier manifest submission (USD 7,000, three plans) is registered in the grants directory; this proposal **supersedes** it via the manifest's weekly auto-refresh (no duplicate application is being submitted — the "funding json must be unique" constraint is respected by updating the existing manifest URL).
- No other pending grant applications; no corporate sponsorship.

## 21. Verification and reporting commitments

- Milestone evidence published in-repo as it lands (reports, screenshots, diffs, CI logs).
- Monthly written progress reports; at least one community engagement per quarter.
- `Grant: FOSSUnited M#` commit trailers for every funded change — auditable funding boundary.
- Final report with a transparent expenditure summary reconciling the §12 estimates against actuals.
- Maintainer available for scheduled FOSS United check-ins at any tranche boundary.

## 22. Official website and project links

- Website: https://canvix.app
- Repository: https://github.com/mir-ashiq/canvix
- Funding manifest: https://raw.githubusercontent.com/mir-ashiq/canvix/refs/heads/main/funding.json
- Grants-directory profile: https://fossunited.org/grants/directory/ashiq_hussain_mir
- Proposal (this document): `CANVIX-FOSS-UNITED-PROPOSAL.md` in the repository
- Contact: imseldrith@gmail.com

---

*Prepared 24 November 2026. Every factual claim above is either independently verifiable via the linked public sources or explicitly labeled as a self-reported estimate. This proposal does not claim any grant has been awarded.*
