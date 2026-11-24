# Canvix adoption evidence — publication methodology

**Why this exists:** the funded-grantee comparison (`FOSS-UNITED-GRANTEE-COMPARISON.md`) found
that every funded FOSS United project leads with evidence a third party can verify, while
Canvix's current usage numbers (≈173 registered users, 5,700 designs, 366 templates) are
maintainer-observed admin-dashboard figures. FOSS United's Grants Thesis asks directly:
"How many users does the project have? What is the impact of this project on those limited
users?" This document is the plan for answering that publicly, honestly, and without
inflating anything. It is **unfunded application work** — no grant trailer.

## 1. The public statistics page (target: /stats, linked from the footer)

Publish a dated, auto-generated page — not a screenshot — from the live database, so the
numbers are checkable by anyone at any time. `GET /api/health` already reports version and
template count publicly; the stats page extends the same trust pattern.

| Metric | Definition (published on the page) | Source |
|---|---|---|
| Registered accounts | Rows in `User` | DB count |
| Active accounts (30d) | Distinct users with a session in the last 30 days | Session store |
| Designs created (all time / 30d) | Rows in `Design` | DB count |
| Designs created by anonymous sessions | Designs owned by anon local storage identities vs accounts | Ownership field |
| Exports run (30d) | Export API invocations | Usage log |
| Templates available | Published template count | DB count |
| Uptime (30d) | External uptime monitor | status badge |

**Methodology labels (mandatory, on the page):** "Registered accounts are not active
humans — one person can hold several accounts, and most visitors never register
(try-without-account is a feature, not a leak). Anonymous designs are counted from local
identities and understate total use. No third-party analytics is used; these are direct
database counts, generated at page render time." The point is the opposite of vanity
metrics: the numbers are small, honestly labeled, and therefore credible.

## 2. What the page must NOT do

No growth-hacking framing ("5,000+ designs created!" with no denominator), no percentage
claims without base counts, no sampling or estimation — direct counts only, each with its
definition. If a metric cannot be computed exactly, it is not published.

## 3. Testimonials and case studies (voluntary, attributed)

- Collect 3–5 voluntary user quotes (name/handle + permission on file; anonymous allowed).
- One written mini case study (~300 words) of a real workflow: what the user tried to do,
  what worked, what did not. Negative detail included — a case study with no friction is
  not believable and helps nobody.
- Publish under `docs/USER-STORIES.md` (or `/stats` page), dated.

## 4. Completion-rate evidence (the honest hard part)

"5,700 designs" says nothing about whether designs get finished. When export events carry
a design id, publish: designs with ≥1 export (share of all designs) — a proxy for
completed work. Label it as a proxy. This is the metric that answers "impact on those
limited users" with something better than volume.

## 5. Sequence

1. `/stats` page + `GET /api/stats` (counts + definitions; no PII, no per-user data).
2. Methodology labels and definitions as above (content is the deliverable, not just the endpoint).
3. Testimonial collection begins (requires real users replying — start the ask early).
4. Completion-rate proxy once export events are reliably attributable.

**Rule:** every number published must be reproducible from the repository + deployment by
any reviewer, or it does not get published.
