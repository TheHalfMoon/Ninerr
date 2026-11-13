# Ninerr completion ledger

This is the persistent record of what is complete, what remains and what blocks it, with the evidence for each. Every pull request that changes the state below updates it. The program's phases and criteria are in `docs/MASTER_PLAN.md`; the founder's 2026-11-13 directive is in `docs/provenance/FOUNDER_DIRECTIVE_2026-11-13_COMPLETE_PRODUCT.md`.

Last updated: 2026-11-13. Canonical main: `f1bacae`.

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
| Align and distribute layers | #419 | `273c597` | seven exact-head checks pass |
| Agents dry-run any change and base it on the revision they read (ADR-0006) | #425 | `e5827f4` | seven exact-head checks pass |
| Export a layer as a standalone HTML page | #418 | `752ceba` | seven exact-head checks pass |
| Pages: add a page and pick one to show | #422 | `2b6e606` | seven exact-head checks pass |
| Style values with an open quote or bracket are never drawn, written or exported (#382, closed) | #427 | `4dbe09c` | seven exact-head checks pass |
| Tailwind export; MCP `layer_code` in JSX, Tailwind or HTML | #434 | `d449e78` | seven exact-head checks pass |
| Schema v2 at scale (P10-1 workloads) | #426 | `94c6f59` | seven exact-head checks pass |
| Escaped style property names (#383, case 2) | #436 | `5fc04bf` | seven exact-head checks pass |
| CI: a wider ephemeral port range on Windows | #438 | `4f2806c` | seven exact-head checks pass |
| Open Code Review records a documentation-only pull request | #437 | `d763701` | seven exact-head checks pass |
| Typography in the inspector (font with tokens, weight, line height, letter spacing, alignment) | #424 | `c455f38` | seven exact-head checks pass |
| Tests name a request or evaluation that hangs (#300) | #440 | `5492954` | seven exact-head checks pass |
| Agents search and read the Astryx component records through MCP (milestone E) | #429 | `97aa9b5` | seven exact-head checks pass |
| Astryx pages render on the canvas as Astryx renders them; three canvas fixes for every imported page (milestone C) | #435 | `9663ea9` | seven exact-head checks pass |
| Desktop upgrade and uninstall docs; ADR-0008 (proposed) for breakpoints | #441 | `6251a7c` | seven exact-head checks pass |
| Copy a layer as PNG or SVG | #439 | `8239ecf` | seven exact-head checks pass |
| CI: on main, a run in progress finishes and only the latest waiting push runs | #442 | `d895bc6` | seven exact-head checks pass, and the release workflow's dry run |
| This ledger | #421 | `87d43ca` | seven exact-head checks pass |
| MCP `set_attributes` (classes, text direction, lang, aria) | #443 | `eabc628` | seven exact-head checks pass |
| Auto layout panel | #423 | `1179cbd` | seven exact-head checks pass |
| Snapping and guides | #430 | `187943b` | seven exact-head checks pass |
| Constraints | #432 | `e5682e5` | seven exact-head checks pass |
| Right-to-left editing: a layer's text direction | #433 | `b14b831` | seven exact-head checks pass; a full local `npm run check` at its head: 1,356 tests, 0 fail, 11 skipped |
| Reduced motion on the canvas | #444 | `d184b15` | seven exact-head checks pass |
| Text styles: a layer's typography as a marked class rule of its page, checked against the page's cascade | #446 | `5892562` | seven exact-head checks pass |
| MCP `set_layout` (row, column, free; gap, padding, alignment, wrap) | #447 | `abf48b4` | seven exact-head checks pass |
| Soak test: one slow window is not drift (#351, closed) | #448 | `b657d31` | seven exact-head checks pass |
| Import refusals name no resolved address (#94, closed) | #449 | `f1bacae` | seven exact-head checks pass |
| P10-6: a recorded disposition for every open issue | #450 | `182d696` | `docs/evidence/P10_ISSUE_DISPOSITIONS_2026-11-13.md` |

Each row's PR has its full check results, its fresh-context review findings and fixes, and its mutation results.

## In review

Nothing is in review.

## Remaining requirements

**Release-candidate criteria (P10, `docs/MASTER_PLAN.md`).** None has a P10 record yet.

| ID | What remains |
| --- | --- |
| P10-1 | Full qualification on the exact candidate: `npm run check` on three platforms, smoke, gate-13 budgets by the reference protocol (needs the reference machine), the P08-G4 criteria remeasured, and the seven-project dogfooding rerun. Schema v2 scale workloads are merged (#426). |
| P10-2 | Desktop packages smoke-tested and journeyed on each platform for the candidate. No clean-machine install has been done. |
| P10-3 | Artifacts bound to the candidate. The Electron LGPL corresponding source is checked but not carried alongside the artifacts (route to be confirmed: see Blockers). |
| P10-4 | Security, offline, crash recovery and migration (including v1 to v2) on the candidate. #349 is open. |
| P10-5 | Parity dispositions. For #79 (tokens), drift detection remains. #78 (component states bound to code) is not built. |
| P10-6 | Every open issue has a recorded disposition (`docs/evidence/P10_ISSUE_DISPOSITIONS_2026-11-13.md`); none is critical. #382, #94 and #351 are closed. Judged again on the exact candidate. |

**Product scope** (founder directive, 2026-11-13):

| Capability | State |
| --- | --- |
| Align and distribute | done (#419) |
| Auto layout (flex) editing | done (#423) |
| Constraints | done (#432) |
| Responsive breakpoints | design proposed (ADR-0008, #441), for the founder |
| Snapping and guides | done (#430) |
| Typography: font picker and text styles | done (#424, #446) |
| Pages: add and switch | done (#422) |
| Export: standalone HTML | done (#418) |
| Export: Tailwind | done (#434) |
| Export: PNG, SVG | done (#439). PDF: needs the founder (where an exported file is written; see blockers) |
| Prototyping and interactions | missing |
| RTL editing | done (#433, and MCP `set_attributes` #443): a layer's text direction |
| Reduced motion | no motion in the editor; the canvas ends a design's motion when the system asks (#444) |
| Component sources | |
| ↳ three-way update of an imported item | missing |
| ↳ preview, beyond static HTML | needs a decision (live React preview runner) |
| ↳ registry fetching | needs a decision (network access) |
| Agents: dry-run and baseRevision (ADR-0006) | done (#425) |
| Windows installer, upgrade, uninstall | packages are archives (founder, 2026-10-13); upgrade and uninstall documented (#441) |
| Screen-reader pass (#376) | not done with a real screen reader |

## Open blockers (founder or third party)

1. **The LGPL corresponding source route in practice.** The route ("alongside the artifacts") is decided, but Chromium and Electron source is many gigabytes, past a single release asset. Choose a scoped mirror, a separate mirror, or the LGPL §6 written offer.
2. **Host network access**, for registry fetching (#405) and optional model providers.
3. **A live React preview runner** (#405).
4. **Aceternity UI and 21st.dev:** the publishers' written permission.
5. **Reference-machine performance runs and clean-machine installs** need the founder's hardware.
6. **Owner-only actions:** the `v1.0.0` tag, publishing the draft release, and removing the unused `TYPESAFE_API_KEY` secret.
7. **#349 (Windows trusted write):** the fix renames the private replacement through its handle, which adds `SetFileInformationByHandle` to the pinned kernel32 boundary. The alternative refuses a projects folder that is not private to the user. Either changes an established security boundary, so it waits for the founder's choice.
8. **PDF export:** the clipboard cannot hold a PDF and the desktop app refuses downloads by design, so a PDF needs either a host route that writes export files into the project folder or printing. Either crosses an established boundary, so it waits for the founder.

## Tests executed (latest, with exact heads)

| Head | Run | Result |
| --- | --- | --- |
| `9aa1248` (Astryx A to E plus C combined) | `npm run check`, Windows | 1,310 tests: 1,299 pass, 0 fail, 11 skipped |
| `f8a4b03` (#415) | CI: Foundation on three platforms, Desktop on three platforms, Open Code Review | all pass |
| `2bff107` (#417) | CI: the same seven checks | all pass |

## Next engineering actions

Every product item that needs no decision is built and merged. What remains:
1. The founder's decisions above (ADR-0008 breakpoints, #349, PDF, network access, preview runner, corresponding source, publishers' permission) and the P10-5 parity dispositions (#78, #79).
2. P10 qualification on the exact candidate, once the founder names it: the full suite on three platforms, smoke, gate-13 budgets on the reference machine, P08-G4 remeasured, the seven-project dogfooding (which also answers #377), packaged journeys, a clean-machine install, and a real screen-reader pass (#376).
3. The release gate: the `v1.0.0` tag and publishing are the owner's.
