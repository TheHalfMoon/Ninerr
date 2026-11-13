# Ninerr completion ledger

This is the persistent record of what is complete, what remains and what blocks it, with the evidence for each. Every pull request that changes the state below updates it. The program's phases and criteria are in `docs/MASTER_PLAN.md`; the founder's 2026-11-13 directive is in `docs/provenance/FOUNDER_DIRECTIVE_2026-11-13_COMPLETE_PRODUCT.md`.

Last updated: 2026-11-13. Canonical main: `36d5a85`.

## Completed since P09 (with evidence)

| Capability | PRs | Merge | Evidence |
| --- | --- | --- | --- |
| Whole-process egress policy (R04) | #394, #396, #397 | `3c2fa83` | desktop egress runs in CI on three platforms |
| Hardened gates; sealed release artifacts | #401, #402, #403 | `682c666` | release workflow tests |
| React style objects survive the code round trip | #399, #400 | `616bafa` | `tests/code-roundtrip*` |
| Component-source catalog, license policy and registry items | #404, #406 | `916111a` | `tests/ui-component-sources.test.mjs`, `tests/component-sources.test.mjs` |
| Reviewed import of a registry item into a connected codebase | #407 | `5d4b64b` | `tests/component-import*.test.mjs` |
| Schema v2; design tokens; an item's tokens (ADR-0003, ADR-0004) | #408, #409, #410 | `b8229a9` | `tests/schema-v2*`, `tests/design-tokens*` |
| Components and instances; editing inside instances (ADR-0005) | #411, #412 | `b0829e3` | `tests/component-instances*`, `tests/instance-editing*` |
| MCP tools for tokens and components | #413 | `c1f3a49` | `tests/mcp-design-tools.test.mjs` |
| Instance-swap and slot properties | #414 | `ed086cc` | `tests/component-instances.test.mjs`, `tests/renderer-browser.test.mjs` |
| Meta Astryx as a first-class source: audit, records of 189 components, own primitive family, editor search | #415 | `a10fa82` | `docs/provenance/ASTRYX_SOURCE_AUDIT.md`, `tests/astryx-source.test.mjs` |
| Generated records checked as data, pinned by sha256 | #416, #417 | `4d0c031` | `scripts/check-generated-records.mjs`, `tests/generated-records.test.mjs` |
| Jev retired as a gate | #417 | `4d0c031` | `docs/provenance/FOUNDER_DECISION_2026-11-13_RETIRE_JEV.md` |
| Astryx tokens (or any `:root` custom properties) from a CSS file into the design system (milestone D) | #420 | `df55b47` | seven exact-head checks pass |
| The census summary changes only when a finding does (pull requests stop conflicting on it) | #431 | `3800a54` | seven exact-head checks pass |
| CI: a newer push to a pull request cancels its older runs | #428 | `36d5a85` | seven exact-head checks pass, and the release workflow's dry run |

Each row's PR has its full check results, its fresh-context review findings and fixes, and its mutation results.

## In review

Each is built, tested, mutation-checked and reviewed by a fresh-context reviewer, with the findings fixed, before its PR opens. Each merges after its seven exact-head checks pass.

| Capability | PR |
| --- | --- |
| Agents search and read the Astryx component records through MCP (milestone E) | #429 |
| Astryx pages render on the canvas as Astryx renders them; three canvas fixes for every imported page (milestone C) | #435 (contains #429) |
| Export a layer as a standalone HTML page | #418 |
| Align and distribute layers | #419 |
| This ledger | #421 |
| Pages: add and switch | #422 |
| Auto layout panel (row, column, gap, padding, alignment) | #423 (contains #419, #422, #424) |
| Typography: font (with font tokens), weight, line height, letter spacing, alignment | #424 |
| Agents: dry-run and `baseRevision` on MCP writes (ADR-0006) | #425 |
| Schema v2 at scale (P10-1 workloads) | #426 |
| Style values with an open quote or bracket are never drawn, written or exported (#382; #383's `image(`/`src(`) | #427 |
| Snapping and guides | #430 (contains #423) |
| Constraints (pin to left, right, both edges or centre) | #432 (contains #430) |
| Right-to-left editing: a layer's text direction | #433 (contains #432) |
| Tailwind export, and MCP `layer_code` in JSX, Tailwind or HTML | #434 (contains #418) |
| Escaped style property names read as a browser reads them (#383, case 2) | #436 |
| Open Code Review: a documentation-only pull request is recorded, not failed | #437 |

## Remaining requirements

**Release-candidate criteria (P10, `docs/MASTER_PLAN.md`).** None has a P10 record yet.

| ID | What remains |
| --- | --- |
| P10-1 | Full qualification on the exact candidate: `npm run check` on three platforms, smoke, gate-13 budgets by the reference protocol (needs the reference machine), the P08-G4 criteria remeasured, and the seven-project dogfooding rerun. Schema v2 scale workloads are in review (#426). |
| P10-2 | Desktop packages smoke-tested and journeyed on each platform for the candidate. No clean-machine install has been done. |
| P10-3 | Artifacts bound to the candidate. The Electron LGPL corresponding source is checked but not carried alongside the artifacts (route to be confirmed: see Blockers). |
| P10-4 | Security, offline, crash recovery and migration (including v1 to v2) on the candidate. #349 is open. |
| P10-5 | Parity dispositions. For #79 (tokens), drift detection remains. #78 (component states bound to code) is not built. |
| P10-6 | Every open issue resolved or dispositioned (22 open on 2026-11-13; #382 in review in #427). `CURRENT.md` agrees with this ledger. |

**Product scope** (founder directive, 2026-11-13):

| Capability | State |
| --- | --- |
| Align and distribute | in review (#419) |
| Auto layout (flex) editing | in review (#423) |
| Constraints | in review (#432) |
| Responsive breakpoints | missing |
| Snapping and guides | in review (#430) |
| Typography: font picker | in review (#424); text styles (named, reusable) missing |
| Pages: add and switch | in review (#422) |
| Export: standalone HTML | in review (#418) |
| Export: Tailwind | in review (#434) |
| Export: PNG, SVG, PDF | missing |
| Prototyping and interactions | missing |
| RTL editing | in review (#433): a layer's text direction |
| Reduced motion | no motion in the editor; the canvas's imported content is not handled |
| Component sources | |
| ↳ three-way update of an imported item | missing |
| ↳ preview, beyond static HTML | needs a decision (live React preview runner) |
| ↳ registry fetching | needs a decision (network access) |
| Agents: dry-run and baseRevision (ADR-0006) | in review (#425) |
| Windows installer, upgrade, uninstall | missing: packages are archives |
| Screen-reader pass (#376) | not done with a real screen reader |

## Open blockers (founder or third party)

1. **The LGPL corresponding source route in practice.** The route ("alongside the artifacts") is decided, but Chromium and Electron source is many gigabytes, past a single release asset. Choose a scoped mirror, a separate mirror, or the LGPL §6 written offer.
2. **Host network access**, for registry fetching (#405) and optional model providers.
3. **A live React preview runner** (#405).
4. **Aceternity UI and 21st.dev:** the publishers' written permission.
5. **Reference-machine performance runs and clean-machine installs** need the founder's hardware.
6. **Owner-only actions:** the `v1.0.0` tag, publishing the draft release, and removing the unused `TYPESAFE_API_KEY` secret.
7. **#349 (Windows trusted write):** the fix renames the private replacement through its handle, which adds `SetFileInformationByHandle` to the pinned kernel32 boundary. The alternative refuses a projects folder that is not private to the user. Either changes an established security boundary, so it waits for the founder's choice.

## Tests executed (latest, with exact heads)

| Head | Run | Result |
| --- | --- | --- |
| `9aa1248` (Astryx A to E plus C combined) | `npm run check`, Windows | 1,310 tests: 1,299 pass, 0 fail, 11 skipped |
| `f8a4b03` (#415) | CI: Foundation on three platforms, Desktop on three platforms, Open Code Review | all pass |
| `2bff107` (#417) | CI: the same seven checks | all pass |

## Next engineering actions

1. Merge the open pull requests as their exact-head checks pass, in the order their chains need (#419, #422, #424 before #423, then #430, #432, #433; #418 before #434; #429 before #435). Verify the Astryx integration together on main.
2. MCP tools for align, layout and pages.
3. Responsive breakpoints (needs a design: a viewport per page, and media queries drawn per viewport), text styles, and image export (PNG and SVG) by clipboard.
4. Issue dispositions (#349, #383, #377, #300, #252, #108 and the rest) toward P10-6.
5. Keep `docs/CURRENT.md` and this ledger current with each merge.
