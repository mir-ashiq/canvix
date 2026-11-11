# Governance

## The model, in one line

Canvix is a **solo-maintained project with a BDFL** — a Benevolent Dictator
for Life. **Ashiq Hussain Mir** (imsrenpsycho@gmail.com), the project's
founder, is the sole maintainer and the final decision-maker for every
change, release, and roadmap call.

## Why solo, and why we say so plainly

Honest governance beats aspirational governance. This project is currently
built and run by one person; writing "steering committee" into a file would
not make one exist, and contributors deserve to know exactly who says yes or
no. Stating the model plainly is itself the accountability: every decision
below traces to a named human, in the open, in the git history.

## How decisions are made

| Decision                          | Who decides                                    |
| --------------------------------- | ---------------------------------------------- |
| Bug fixes, refactors, dep bumps   | maintainer, directly on `main`                 |
| Features and roadmap waves        | maintainer plans; community input via issues shapes priorities |
| External pull requests            | maintainer reviews and merges (criteria below) |
| Releases and breaking changes     | maintainer, semver, recorded in `CHANGELOG.md` |
| Security response                 | maintainer, per [`SECURITY.md`](SECURITY.md)  |
| Conduct enforcement               | maintainer, per [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) |

The roadmap is developed in **waves** — each wave is a themed batch of work
(v0.19 "AI Power-Up", v0.20 the Sound wave, v0.21 PPTX export, v0.22 the
limits waves) that ships with a `docs/` companion and a changelog entry, so
the reasoning behind big changes is public before and after they land.

## What a contribution must clear

Pull requests are genuinely welcome (see
[`CONTRIBUTING.md`](CONTRIBUTING.md)) — one human reviews them, and the bar
is the same for everyone:

1. CI green — lint, typecheck, unit tests, build
2. Fits the values below; in particular, no feature-gating, no watermarks,
   no paywalls, no surprise telemetry or background network calls
3. Public API or schema changes come with docs and a changelog note
4. Anything security-sensitive goes through `SECURITY.md`, never a public
   PR or issue

## The values the BDFL answers to

These predate this file and outrank it:

- **Every feature is free, forever.** No Pro tier, no watermarks, no ransom.
- **MIT license** — fork it, build a business on it, no permission needed.
- **Self-hosting is first-class** — your server, your database, your keys.
- **Privacy by architecture** — secrets stay server-side; usage counters
  count, they don't identify.

A change that violates these is rejected no matter who proposes it —
including the maintainer's own ideas, which have been turned back for less.

## Bus factor and succession

Stated plainly: today the bus factor is one. The MIT license is the
community's permanent escape hatch — forking is always allowed, and that is
a feature of the model, not a failure of it. The project's
[`funding.json`](funding.json) exists partly to reduce this risk: sustained
funding keeps development at a pace where contributors can ramp up to
co-maintainership.

If the maintainer becomes unreachable for **six months** with critical
issues outstanding, the community is encouraged — openly and without
animosity — to fork, carry the project forward under the MIT license, and
say so. Continuity of the software matters more than continuity of control.

## Changing this document

By the BDFL, in the open, through a normal commit to this repository — and
a change that weakens the values section above will not be made.
