# FOSS United Grantee Comparison — profiles and funding.json manifests

**Purpose:** answer "how does Canvix compare to projects FOSS United actually funded" from
primary sources, for the pending Canvix application (INR 5,00,000, M1–M4, submitted
12 Nov 2026 via the funding.json mechanism, decision outstanding).

**Evidence date:** all sources fetched and verified 24 Nov 2026.
**Companion report:** `FOSS-United-Grantee-Analysis.docx` (delivered in the workspace
`download/` folder) carries the full narrative; this file is the repo-side record.

---

## 1. The program in numbers

- 36 project grants disbursed 2020–2026, **INR 2,91,15,000 total** (recomputed from the
  per-grant list; matches the program page exactly).
- **Two official sources conflict on the ceiling** (verified 24 Nov 2026): the grants
  knowledge base says "maximum amount of funding available for each grant is ₹6 lakh",
  while the Grants Thesis states "up to 15L (the highest possible grant amount)", a
  "3L - 7 L (median grant size - disbursed over a year)" band, and <3L as infra grants.
  The proposal's ₹3–7L band claim is therefore **supported by the thesis**. Larger awards
  (Zasper ₹9L, TinkerHub ₹60L) were **co-sponsored**, with industry partners (Zerodha)
  carrying the difference.
- Thesis mechanics that matter for Canvix: ">3L — the funding disbursement will be
  milestone/outcome based" (the M1–M4 structure matches the program's own rule);
  milestones "should be publicised in the funding .json manifest under 'funding plans'"
  (already satisfied); "We do not fund 'ideas' or 'project proposals'" (supports
  Canvix's shipped-first framing); at least one community engagement per quarter is
  expected (M4 commits to this); ~1 project application/month and a 25L grants budget
  as of 2025.
- **2026 cohort:** 11 grants, INR 31,55,000, median **INR 2,50,000**.
- Program page: "32 disbursed, 4 ongoing"; >INR 3 crore disbursed across all tracks
  (projects + events + fellowships).
- Two public surfaces, easy to conflate: the **grantees record** (awards) and the
  **grants directory** (funding.json manifest profiles, ~132 entries). Directory listing
  ≠ award. Canvix is listed while pending.

## 2. The five funded comparables

| Project | Award | Model | funding.json | Directory profile | Evidence that carried it |
|---|---|---|---|---|---|
| Zasper | ₹9,00,000 (2025, co-sponsored w/ Zerodha 50%) | 6 mo full-time maintainer support | Website only (zasper.io); no `$schema`; does **not** mention the grant | No | Measured benchmarks (26.7 MB vs JupyterLab's 104.8 MB RAM), tech-press coverage, AGPL |
| Webminal | ₹8,00,000 (2026) | Infra + maintainer stipends | **Yes** — repo root + website; plans sum to award (6L + 2L); non-schema `milestones` array; `funding.history` (0 income, self-funded ₹1.8L/yr) | **Yes** — but stale (renders 5L + ₹12,500/mo) | 15 years running (since 2011), 500k+ users, 2,700+ universities, 50+ countries, FOSS India award, kernel/Btrfs contributor |
| Scrite | ₹2,50,000 per FOSS United page; **₹3,00,000 per Scrite's own page (discrepancy, unresolved)** | Company-backed cost recovery (hosting, licences, code signing, legal docs through 2027) | No (repo + website 404) | No | Established working product (IEDN Technologies Pvt Ltd) |
| Subtitle Studio | ₹3,00,000 (2026) | Community org, continued development | No | No | Msone (Malayalam subtitles org) + app-store distribution (Google Play / iOS / Mac); v3.0.0; GPL-3.0; GitHub footprint tiny (13 stars, 7 commits) |
| Surge | ₹1,05,000 (2026) | Infra + milestone stipends, 2 maintainers, 3 months | No | No | 3.6k stars, 160 forks, 694 commits, published benchmarks vs aria2c/curl/wget, 12+ packaging channels, Chrome/Firefox extensions; README acknowledges the grant |

**Schema reality (v1.1.0 spec, fundingjson.org):** no `milestones` construct exists;
`frequency` enum is `one-time|weekly|fortnightly|monthly|yearly|other`; channel `address`
is optional. Webminal — a successful ₹8L grantee — ships non-enum frequency values
("Quaterly" repo / "Milestone-based" site) and a non-schema milestones array, and the
directory accepted it. **Schema strictness is not a selection factor.** Canvix's manifest
(schema-valid, CI-validated, `wellKnown` domain verification live) exceeds anything in the
funded cohort.

## 3. Key findings

1. **A funding.json manifest + directory profile is NOT a prerequisite.** 4 of 5 funded
   comparables publish none. The directory is an application/discovery surface FOSS United
   is building out — not a filter grantees passed.
2. **The directory renders a stale snapshot and does not track manifest updates.**
   Webminal's profile shows old amounts; **Canvix's own profile still renders a superseded
   USD version (tuition $4,000 / hardware $2,000 / living $1,000) that contradicts the
   pending INR 5,00,000 M1–M4 application**, even though its "View Source Code" link
   points at main's current manifest. Fix: email `foundation@fossunited.org` (profile
   Report link) and `grants@fossunited.org` to request a re-sync. ~30 minutes.
3. **Every funded project leads with third-party-verifiable evidence** (users, stars,
   app stores, benchmarks, press, longevity). Canvix's usage numbers (≈173 registered
   users, 5,700 designs) are admin-observed — not independently checkable. This is the
   primary gap, and it is closable in weeks (public stats page, published benchmark).
4. **Amount context (corrected 24 Nov after reading the Grants Thesis):** the thesis
   documents a "3L - 7 L median grant size" band and "up to 15L" as the highest
   possible grant — the proposal's ₹3–7 lakh median-band claim is **defensible**, and
   ₹5L sits inside it. The knowledge base's ₹6L cap conflicts with the thesis ceiling;
   cite the thesis tiers, not either cap. 2026's actual median was ₹2.5L, and ₹5L for
   a project ~2.5 months old is top-quartile for its age — the amount is justified by
   the itemized budget and milestone acceptance criteria, not by the median. The
   thesis's ">3L → milestone/outcome based" disbursement rule validates the M1–M4
   structure, and its requirement to publicise milestones as funding.json plans is
   already satisfied.
5. **Students do get funded — at small, precisely-scoped scale** (Surge: 2 CS students,
   ₹1.05L, 3 months). Large asks paired demonstrated longevity (Webminal) or
   co-sponsorship (Zasper).
6. Payment-channel wording: Webminal's "details shared on request" (no address) is the
   cleanest pattern. Canvix's description should drop any implication that bank details
   might later be published ("updated in the open") — payment details are exchanged
   securely with the administrator and never committed to the public repo.

## 4. Canvix vs the cohort

**Already stronger:** engineering discipline (1,575 tests + 39-file e2e at application,
CI, 160+ commits — best in cohort), manifest rigor (only Canvix has a schema-valid,
CI-validated, wellKnown-verified manifest), milestone acceptance criteria, budget
transparency, scope hygiene (NLnet non-overlap), live deployment + self-hosting.

**Weaker:** no third-party-verifiable adoption evidence (primary gap); project age
~2.5 months at application; no external contributors/community footprint (100%
maintainer-authored commits); stale directory profile; no `funding.history` block;
M2 reads as "fix every failure found" (unbounded — the cohort's funded milestones
never commit to that); AI-assisted-development pledge may be stricter than the
actual workflow. (The earlier "band claim conflicts with the ₹6L cap" weakness is
withdrawn — see finding 4: the thesis documents the ₹3–7L median band.)

## 5. 30-day credibility plan (execution order)

1. **Re-sync the directory profile** (Report link / grants@fossunited.org) — removes an
   active contradiction a reviewer can see. 30 min.
2. **Reword the payment channel** (drop "updated in the open"; keep no-address pattern).
3. **Cite the thesis tiers in the proposal** — "inside the Grants Thesis median band
   (₹3–7L), disbursed milestone/outcome-based exactly as the M1–M4 plans encode"; note
   the knowledge-base ₹6L cap vs thesis ₹15L discrepancy only if asked. 15 min.
4. **Publish a dated stats page** (registered users, designs, uptime) with methodology
   labels (registered ≠ active humans). 1–2 days.
5. **Ship the poster compile proof + first public benchmark** (real-model end-to-end run,
   rendered + screenshotted, exact-text/color correctness scored) — mirrors the
   benchmark-led evidence of Zasper/Surge. **DONE 24 Nov** on
   `feat/design-spec-foundation` (64742db): both paths rendered in real Chromium through
   the app's SVG export pipeline, exact texts and required colors verified at pixel
   level, a real seed-guarantee bug found/fixed/tested (47/47), and the M2 baseline
   failure named — see `docs/DESIGNSPEC-ACCEPTANCE-REPORT.md`.
6. **Add `funding.history`** (self-funded infra costs, zero income) once real figures are
   tallied. 1 h.
7. **Open community surfaces** (GitHub Discussions, good-first-issues, merge one external
   contribution).
8. **Bound M2** to a named failure-mode set ranked by corpus frequency; align the
   AI-assisted-dev wording with the actual workflow.

**Discipline:** none of these may be represented as grant-funded work; if the grant is
approved, `Grant: FOSSUnited M#` trailers keep the boundary auditable (these changes
carry none deliberately).

## 6. Sources (all fetched 24 Nov 2026)

- https://fossunited.org/grants · /grants/projects · /grants/grantees · /grants/directory
- https://fossunited.org/grants/thesis (amount tiers up to 15L, ₹3–7L median band,
  milestone-based disbursement >3L, evaluation criteria, funding.json application mechanism)
- https://docs.fossunited.org/grants (knowledge-base ₹6L cap, eligibility — conflicts with thesis)
- https://fossunited.org/blog/organization/supporting-zasper (Zasper award, Zerodha 50%)
- https://fundingjson.org/ (v1.1.0 spec)
- Manifests: raw.githubusercontent.com/Blender3D/Webminal/master/funding.json ·
  webminal.org/funding.json · zasper.io/funding.json
- Grantee pages: scrite.io/fossunited-grants · github.com/SurgeDM/Surge ·
  github.com/Msoneofficial/SubtitleStudio
- Directory profiles (probed directly): /grants/directory/lakshmipathi_ganapathi (200) ·
  /grants/directory/ashiq_hussain_mir (200, stale) · zasper/scrite/surge/msone slugs (404)
- Canvix baseline: repo `funding.json` + `CANVIX-FOSS-UNITED-PROPOSAL.md` @ 1e3a200

**Known discrepancies:** Scrite ₹2.5L (official) vs ₹3L (own page) — unresolved, both
recorded. The thesis publishes evaluation questions (person before project; users and
impact; differentiation in a crowded space; comparison with FOSS alternatives;
salary-vs-infra framing; 5-year sustainability) — decision cadence and per-application
outcomes are not published, so correlation observations in §3/§4 remain interpretation,
labeled as such.
