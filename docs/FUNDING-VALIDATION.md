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
| File content | ✅ (2026-11-24) `public/.well-known/funding-manifest-urls` contained exactly `https://raw.githubusercontent.com/mir-ashiq/canvix/refs/heads/main/funding.json` (asserted by unit test) — **superseded 2026-11-26** by the six-form list (§8) |
| Dev-server serving | ✅ `curl http://localhost:3000/.well-known/funding-manifest-urls` → 200 + exact content (verified against the running dev server) |
| e2e (dev) | ✅ new smoke spec fetches the route and compares the body — 5/5 passing locally; runs in the CI e2e job |
| Production standalone serving | ✅ CI **docker** job asserts the production container serves the file — green on PR #86 |
| **Live at https://canvix.app** | ✅ **VERIFIED 2026-11-24** — `GET https://canvix.app/.well-known/funding-manifest-urls` → **200**, body exactly `https://raw.githubusercontent.com/mir-ashiq/canvix/refs/heads/main/funding.json` (deploy `52eb8e0`, VPS auto-deploy "DEPLOY OK", service active, health green, 366 templates). **The `wellKnown` property is now ACTIVATED in the manifest** — pointing at the live URL — with the honesty-guard test flipped to assert its presence — **superseded 2026-11-26** by the six-form live check (§8) |

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

1. ~~The live canvix.app well-known verification and the VPS deploy await the SSH key~~ **RESOLVED 2026-11-24**: the VPS deploy ran (auto-deploy of `52eb8e0`, "DEPLOY OK"), the public URL serves the verification file (200 + exact content), and the `wellKnown` claim is activated. The runbook (`docs/VPS-DEPLOY-RUNBOOK.md`) remains the reference for future deploys.
2. The FOSS United review status is unknown — no public signal exists; the inquiry draft is the path.
3. The official directory validator accepted the manifest, but the grants directory's weekly refresh is the update mechanism with a reported (not SLA-backed) weekly cadence.
4. Adoption figures in the proposal are self-reported and dated (labeled as such there).
5. The verification file is served with `Content-Type: application/octet-stream` (Next's static default for extensionless files). The fundingjson.org spec specifies plain text, one URL per line — the body is exactly that; no directory-side content-type requirement is documented, and the official validator accepts the manifest. If a stricter consumer ever appears, add an explicit `text/plain` route.

## 8. 2026-11-26 addendum — the URL-form mismatch fix (v0.32.7)

**The failure:** the verification file listed the manifest URL in exactly one
form — `https://raw.githubusercontent.com/mir-ashiq/canvix/refs/heads/main/funding.json`
— but the fundingjson.org checkers do **exact-string membership**, not
normalization. The directory crawl looked for
`https://github.com/mir-ashiq/canvix/raw/refs/heads/main/funding.json` and the
official validator was handed
`https://github.com/mir-ashiq/canvix/blob/main/funding.json`, so both reported
"manifest URL … was not found in the .well-known list" while the file was live
and byte-correct. The directory listing also kept the repository link flagged
"Unverified URL" — no `wellKnown` was provided for `repositoryUrl`, and
github.com cannot serve `/.well-known` per repository.

**The fix (supersedes the two §4 rows above where they say "exactly" one URL):**

- `public/.well-known/funding-manifest-urls` now lists **every fetchable
  form** of the manifest URL — six lines: the two `raw.githubusercontent.com`
  forms and the `github.com` raw forms (all verified byte-identical to the
  repository manifest, sha256 `c4ca1020…d13fda`), the `github.com` blob form
  (200 — GitHub's file view of the same file) and the domain-hosted copy.
- **`canvix.app/funding.json`** now serves a byte-identical copy of the
  manifest (previously 404) — the manifest lives on the domain itself, listed
  in the well-known file.
- **`.well-known/funding-manifest-urls`** was added at the repository root and
  `repositoryUrl.wellKnown` now points at its blob URL — the official v1.1.0
  schema documents exactly this in-repository pattern for `repositoryUrl`
  ("This url should be a file in the repository … should end with
  /.well-known/funding-manifest-urls").
- Guards: the unit test asserts the six-line list, the repo↔public file
  identity and the byte-identical domain copy; the e2e smoke asserts
  dev-server serving of both routes; the CI docker job diffs the served bytes
  against the committed files.

| Check | Method | Result |
|---|---|---|
| Official schema accepts the manifest (incl. `repositoryUrl.wellKnown`) | `fastjsonschema` against `https://fundingjson.org/schema/v1.1.0.json` | ✅ valid (2026-11-26) |
| All five GitHub URL forms fetchable | `curl -sL` + sha256 per form | ✅ 200 each; raw forms byte-identical (`c4ca1020…d13fda`), blob form = GitHub's HTML file view |
| Repo-root `.well-known` ≡ `public/.well-known` (bytes) | unit test | ✅ |
| `public/funding.json` ≡ `funding.json` (bytes) | unit test | ✅ |
| Dev-server serving of both routes | e2e smoke (CI e2e job) | ⏳ UNVERIFIED until the v0.32.7 CI run |
| Production-container serving of both routes | CI docker job (diff) | ⏳ UNVERIFIED until the v0.32.7 CI run |
| Live `https://canvix.app` serving of both routes | `curl` after the VPS auto-deploy | ⏳ UNVERIFIED until the auto-deploy of this commit |
