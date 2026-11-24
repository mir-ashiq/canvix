# Canvix grant accounting — budget evidence and expenditure ledger

**Why this exists:** the review of the pending FOSS United application flagged that commit
trailers alone cannot prove hours worked or money spent, and that the thesis expects
periodic check-ins and milestone/outcome-based disbursement for grants above ₹3 lakh.
If the grant is approved, this ledger is how the money is accounted for. Preparing the
evidence **before** a decision keeps the request auditable and honest. This template is
**unfunded application work** — no grant trailer.

## 1. Ledger (maintained from approval, published monthly)

| Field | Where it comes from | Example row |
|---|---|---|
| Date | — | 2027-01-08 |
| Milestone | M1–M4 plan guid | m1-baseline-and-harness |
| Hours | Dated timesheet (see §2) | 21.5 h |
| Work items | Commit SHAs + issue/PR links | `a1b2c3d`, #92 |
| Expenses | Receipt/invoice number + vendor | INV-2027-004 · test bench RAM |
| Amount claimed | Milestone budget line | ₹0 (M1 = stipend) |
| Funding source | FOSSUnited / NLnet / unfunded | FOSSUnited M1 |
| Scope check | Confirm no overlap with the other application | distinct — evaluation harness |

Stored as `research/grant-ledger.csv` + monthly rendered summary in the progress report.
**Rule:** a row exists for every claimed hour and rupee, or it is not claimed.

## 2. Timesheets (the "hours" column's evidence)

- Daily log: date, milestone, hours, one-line description. Plain dated text files under
  `research/timesheets/YYYY-MM.md` (private identifiers redacted).
- Cross-check: hours claimed per month ≤ realistic capacity (~25 h/week declared in the
  proposal — over-claiming weeks are the first thing an auditor would test).
- Cross-reference: each work block maps to commit SHAs landing in the same window
  (the repo's `Grant: FOSSUnited M#` trailers tie commits to milestones).

## 3. Expense evidence to gather **now** (before approval)

| Budget line | Evidence to obtain | Status |
|---|---|---|
| Test-hardware (₹70,000) | 2–3 dated written quotations (vendor + model + price + validity), the chosen one, and a purchase decision note | **To gather** — quotations age out; refresh within 30 days of any disbursement |
| Evaluation/community (₹70,000) | Itemized expected costs: corpus hosting, domain/tooling, printed material for workshops | **To itemize** |
| Maintainer support (₹3,60,000) | The published milestone acceptance criteria in the proposal §milestones — the "unit of work" definition | **Already published** |

## 4. Double-funding boundary (the standing rule)

- Every commit carries at most one funding trailer (`Grant: FOSSUnited M#` or
  `Grant: NLnet WP#`, never both).
- The scope split: FOSS United = design-output correctness + evaluation + education;
  NLnet (pending, separate) = deployment trust, collaboration scale, mobile editing,
  sharing, v1.0 stabilization. Overlap candidates (e.g. test infrastructure that serves
  both) get an explicit scope note in the ledger when they arise.
- The ledger's "Funding source" column is the audit surface: any reviewer can diff
  trailers vs ledger rows.

## 5. Reporting cadence (matches the thesis's expectations)

- **Monthly:** public progress report (the M1 plan already commits to this) — milestone
  status, hours, spend, artifacts, deviations.
- **Quarterly:** one community engagement (thesis expectation: talk, blog post, or forum
  update — M4 commits to this).
- **On deviation:** a ledger note + report section — an honest miss beats a silent
  rebaseline.
