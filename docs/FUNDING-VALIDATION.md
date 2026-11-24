# Canvix FOSS United Application — Validation Report

**Validated:** 24 November 2026 · **Scope:** every file this funding PR ships.
**Rule:** a check that did not run is marked **UNVERIFIED**, never "passed".

## 1. JSON / schema validation

| Check | Method | Result |
|---|---|---|
| Syntax parsing | `python3 json.load` on `funding.json` | ✅ parses |
| **Official schema validation** | `fastjsonschema` against `https://fundingjson.org/schema/v1.1.0.json` (the official v1.1.0 schema document, fetched and compiled locally) | ✅ **valid** — one violation found and fixed during validation (a plan guid of 34 chars vs the 32-char limit) |
| **Official directory validator** | `https://dir.fundingjson.org/validate` (the same validator FOSS United's grants directory ingests through) — manifest body pasted, hosted-URL field set to the canonical raw GitHub URL | ✅ **"✓ Manifest is valid"** (browser-driven, 2026-11-24) |
| Required properties / enums / max-lengths | the unit test `src/lib/funding-manifest.test.ts` (6 tests: entity shape, project shape, plan enums INR/one-time/active, guid + tag patterns, ≤2000 descriptions, ≤32 guids/tags) | ✅ 6/6 — now permanent CI |
| GUID uniqueness | all four plan guids + channel guid distinct; project guid `canvix` unchanged (stable) | ✅ |
| Channel reference consistency | every `plans[].channels` entry resolves to `funding.channels[].guid` | ✅ (`to-be-confirmed`, type `bank`) |
| Currency / amount / frequency formats | ISO 4217 `INR`; integer amounts; enum `one-time` | ✅ |
| URL formats | `https://canvix.app` (project webpage), `https://github.com/mir-ashiq/canvix` (repo), `https://github.com/mir-ashiq` (entity webpage) | ✅ all https, within 250 chars |
| Budget arithmetic | 130000 + 120000 + 120000 + 130000 = **500000 INR** — matches the proposal §12 total and the README statement | ✅ computed, not eyeballed |

## 2. Repository consistency

| Check | Result |
|---|---|
| Maintainer identity / email | ✅ `Ashiq Hussain Mir` / `imseldrith@gmail.com` (the old manifest's `imsrenpsycho@gmail.com` was a stale commit email — fixed) |
| GitHub repo / website / license | ✅ `mir-ashiq/canvix`, `canvix.app` in `projects[0].webpageUrl` (the old manifest pointed the webpage at the repo), `spdx:MIT` (matches `LICENSE`) |
| No stale grant amounts | ✅ the README's "three milestones, USD 7,000 total" replaced; `grep -rn "7,000\|USD" funding.json README.md` finds only the changelog's historical v0.22.1 entry (accurate history, intentionally kept) |
| No contradicting funding statements | ✅ README, ROADMAP, proposal, manifest and scope matrix all state: FOSS United = application, NLnet = pending application, nothing awarded |
| Test-wall figures | ✅ README updated to 1,575 unit tests / 39 e2e specs (verified: `vitest run` full suite 1575/1575; 39 spec files counted) |
| Commit-trailer convention | ✅ proposal declares `Grant: FOSSUnited M#` mirroring the existing `Grant: NLnet WP#` convention |

## 3. Grant consistency

| Check | Result |
|---|---|
| Budget reconciles | ✅ ₹3,60,000 + ₹70,000 + ₹70,000 = ₹5,00,000 = sum of the four tranches |
| Scope distinct from NLnet | ✅ line-by-line in `FUNDING-SCOPE-MATRIX.md`; zero overlap (A/B/C + test bench vs WP2–WP5) |
| Every milestone has acceptance criteria | ✅ proposal §14 table (pass/fail per milestone) |
| Costs labeled as estimates | ✅ budget table + the recorded ₹5,40,000 → ₹5,00,000 revision (proposal §12) |
| No double-funding claims | ✅ matrix + trailer-audit commitment; shipped v0.29.4 work explicitly marked "not billed to this grant" (proposal §13) |
| No invented approvals | ✅ "application, not an award" stated in the manifest description, proposal header, README and this report |
| No private financial data | ✅ unit test asserts no long digit-runs / IFSC / SWIFT / IBAN in the channel; placeholder channel only |

## 4. Website verification (well-known)

| Check | Result |
|---|---|
| File content | ✅ `public/.well-known/funding-manifest-urls` contains exactly `https://raw.githubusercontent.com/mir-ashiq/canvix/refs/heads/main/funding.json` (asserted by unit test) |
| Dev-server serving | ✅ `curl http://localhost:3000/.well-known/funding-manifest-urls` → 200 + exact content (verified against the running dev server) |
| e2e (dev) | ✅ new smoke spec fetches the route and compares the body — 5/5 passing locally; runs in the CI e2e job |
| Production standalone serving | ✅ new assertion step added to the CI **docker** job (the real production container); will prove it on this PR's CI run |
| **Live at https://canvix.app** | ⏳ **NOT YET VERIFIED — pending VPS deploy** (the deploy is blocked on the SSH key, see `docs/VPS-DEPLOY-RUNBOOK.md` §1). The manifest's `wellKnown` property is **deliberately withheld** until the public URL returns the file; the exact remaining step is runbook §5 |

## 5. Application status (FOSS United)

| Check | Result |
|---|---|
| Directory listing | ✅ verified in-browser: profile `https://fossunited.org/grants/directory/ashiq_hussain_mir`, entry dated **12 Nov 2026**, currently rendering the OLD manifest (pulled from the raw GitHub URL above) |
| Listing semantics | ✅ listing = registration of the manifest; **no status badge exists** (no approved/rejected/under-review marker is shown) — so submission ≠ review ≠ approval; nothing is claimed either way |
| Update mechanism | ✅ the apply page states "The manifest gets auto updated weekly for latest changes" — updating the repo manifest updates the listing **without resubmission**, which is how the "funding json must be unique" constraint is respected (no duplicate application created) |
| Reviewer contact | ⏳ **UNVERIFIED** — whether the revised proposal reaches active reviewers automatically is not documented publicly; the status-inquiry email draft (`docs/FUNDING-INQUIRY-DRAFT.md`) is prepared for the maintainer to send to grants@fossunited.org |

## 6. CI status for this branch

- **lint-unit** (typecheck + lint + 1,575+ unit tests + production build): expected green — unit suite including the 6 new manifest tests passes locally; typecheck/lint clean.
- **e2e**: the ONE failing spec on main (`wave2-assets-templates.spec.ts:171`, broken by v0.26 lazy mounting) is fixed in this PR — verified locally (16.7 s pass). Full local suite re-run in progress at validation time; result recorded in the PR.
- **docker**: gains the well-known assertion (§4); image build unchanged otherwise.

## 7. Honest limitations

1. The live canvix.app well-known verification and the VPS deploy await the SSH key (runbook §1).
2. The FOSS United review status is unknown — no public signal exists; the inquiry draft is the path.
3. The official directory validator accepted the manifest, but the grants directory's weekly refresh is the update mechanism with a reported (not SLA-backed) weekly cadence.
4. Adoption figures in the proposal are self-reported and dated (labeled as such there).
