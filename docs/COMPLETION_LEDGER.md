# Ninerr completion ledger

This is the persistent record of what is complete, what remains and what blocks it, with the evidence for each. Every pull request that changes the state below updates it. The program's phases and criteria are in `docs/MASTER_PLAN.md`; the founder's 2026-11-13 directive is in `docs/provenance/FOUNDER_DIRECTIVE_2026-11-13_COMPLETE_PRODUCT.md`.

Last updated: 2026-11-13. Canonical main: `4d0c031`.

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

Each row's PR has its full check results, its fresh-context review findings and fixes, and its mutation results.

## In review

| Capability | PR | State |
| --- | --- | --- |
| Astryx tokens (or any `:root` custom properties) from a CSS file into the design system (milestone D) | #420 | open; CI running |
| Agents search and read component records through MCP (milestone E) | stacked on #420 | built and reviewed; opens after #420 |
| Astryx pages render on the canvas as Astryx renders them; three canvas fixes for every imported page (milestone C) | stacked on E | built and reviewed; opens after E |
| Align and distribute layers | #419 | open; CI running |
| Export a layer as a standalone HTML page | #418 | open; CI running |

## Remaining requirements

**Release-candidate criteria (P10, `docs/MASTER_PLAN.md`).** None has a P10 record yet.

| ID | What remains |
| --- | --- |
| P10-1 | Full qualification on the exact candidate: `npm run check` on three platforms, smoke, gate-13 budgets by the reference protocol (needs the reference machine), the P08-G4 criteria remeasured, and the seven-project dogfooding rerun. Schema v2 needs scale workloads: 10,000 instances, and token rename across 10,000 values. |
| P10-2 | Desktop packages smoke-tested and journeyed on each platform for the candidate. No clean-machine install has been done. |
| P10-3 | Artifacts bound to the candidate. The Electron LGPL corresponding source is checked but not carried alongside the artifacts (route to be confirmed: see Blockers). |
| P10-4 | Security, offline, crash recovery and migration (including v1 to v2) on the candidate. #349 is open. |
| P10-5 | Parity dispositions. For #79 (tokens), drift detection remains. #78 (component states bound to code) is not built. |
| P10-6 | Every open issue resolved or dispositioned (22 open on 2026-11-13). `CURRENT.md` agrees with this ledger. |

**Product scope** (founder directive, 2026-11-13):

| Capability | State |
| --- | --- |
| Align and distribute | in review (#419) |
| Auto layout (flex) editing | missing: no layout panel. Flex is drawn and editable as classes, styles or MCP `set_styles`. |
| Constraints and responsive breakpoints | missing |
| Snapping and guides | missing |
| Typography: font picker, text styles | partial: size and colour fields; font token types exist |
| Pages: add and switch | partial: a `page` type and root frames, but no add-page control |
| Export: standalone HTML | in review (#418) |
| Export: Tailwind | missing |
| Export: PNG, SVG, PDF | missing |
| Prototyping and interactions | missing |
| RTL editing | missing |
| Reduced motion | no motion in the editor; the canvas's imported content is not handled |
| Component sources | |
| ↳ three-way update of an imported item | missing |
| ↳ preview, beyond static HTML | needs a decision (live React preview runner) |
| ↳ registry fetching | needs a decision (network access) |
| Agents: dry-run and baseRevision (ADR-0006) | missing |
| Windows installer, upgrade, uninstall | missing: packages are archives |
| Screen-reader pass (#376) | not done with a real screen reader |

## Open blockers (founder or third party)

1. **The LGPL corresponding source route in practice.** The route ("alongside the artifacts") is decided, but Chromium and Electron source is many gigabytes, past a single release asset. Choose a scoped mirror, a separate mirror, or the LGPL §6 written offer.
2. **Host network access**, for registry fetching (#405) and optional model providers.
3. **A live React preview runner** (#405).
4. **Aceternity UI and 21st.dev:** the publishers' written permission.
5. **Reference-machine performance runs and clean-machine installs** need the founder's hardware.
6. **Owner-only actions:** the `v1.0.0` tag, publishing the draft release, and removing the unused `TYPESAFE_API_KEY` secret.

## Tests executed (latest, with exact heads)

| Head | Run | Result |
| --- | --- | --- |
| `9aa1248` (Astryx A to E plus C combined) | `npm run check`, Windows | 1,310 tests: 1,299 pass, 0 fail, 11 skipped |
| `f8a4b03` (#415) | CI: Foundation on three platforms, Desktop on three platforms, Open Code Review | all pass |
| `2bff107` (#417) | CI: the same seven checks | all pass |

## Next engineering actions

1. Merge #418, #419 and #420, then open and merge milestones E and C. Verify the Astryx integration together on main.
2. Refresh `docs/CURRENT.md` to this ledger (done in this PR) and keep both current.
3. Scale workloads for schema v2 (P10-1), and a CI smoke of the dogfooding driver.
4. Core editor gaps, in small PRs: pages (add and switch), the layout panel (flex direction, gap, alignment, padding), the font picker and text styles, then constraints.
5. Agent contract: dry-run and `baseRevision` on MCP writes (ADR-0006), with confirmation for imports.
6. Issue dispositions (#349, #382, #383, #377, #300, #252, #108 and the rest) toward P10-6.
