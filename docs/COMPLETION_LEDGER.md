# Ninerr completion ledger

This is the persistent record of what is complete, what remains and what blocks it, with the evidence for each. Every pull request that changes the state below updates it. The program's phases and criteria are in `docs/MASTER_PLAN.md`; the founder's 2026-11-13 directive is in `docs/provenance/FOUNDER_DIRECTIVE_2026-11-13_COMPLETE_PRODUCT.md`.

**Founder decision, 2026-11-14 (agent-first, latest):** v0.1.0 is a headless design engine for agents over MCP and a CLI (`docs/provenance/FOUNDER_DECISION_2026-11-14_AGENT_FIRST_HEADLESS.md`). The audit, design, increments and reclassified gates are in `docs/HEADLESS.md`. The Desktop-first ownership update below is superseded for release scope, and kept as history.

**Founder update, 2026-11-14:** The target for the **first public release** is now **v0.1.0** (superseding v1.0.0), and all Desktop/UI implementation and visual/user-facing acceptance are reserved to the founder. Engineering owns the remaining non-UI core, CI, testing infrastructure, security, release provenance, docs and safe packaging qualification, without altering the Desktop/UI surface. This is a division of labor, not a waiver of P10, accessibility, clean-install, third-party-source or human-approval gates. See `docs/provenance/FOUNDER_DECISION_2026-11-14_V0_1_0_DESKTOP_UI_OWNERSHIP.md`. Historical references below to `1.0` are the prior plan and must not be mistaken for the next tag.


Last updated: 2026-11-14. Canonical main: `bdb99ba`.

## Completed since P09 (with evidence)

| Capability | PRs | Merge | Evidence |
| --- | --- | --- | --- |
| The headless engine: Ninerr as a stdio MCP server, with no editor (HEADLESS increment 2) | #470 | `53a445a` | `tests/headless-engine.test.mjs` on three platforms; post-merge CI success |
| History, own undo and redo, exports and previews into `exports/` (increment 3) | #472 | `f219260` | the same tests, with dry-run, link and replace guards |
| The engine package, `ninerr doctor`, install guide (increment 4) | #473 | `7d7b86f` | `tests/engine-package.test.mjs`: a real `npm install -g` and `doctor` on three platforms |
| The release is the engine, not desktop archives (increment 5, release) | #474 | `baef171` | Release Evidence `collect` checks the engine tarball |
| Client setup for the engine; OpenCode in real sessions | #468, #473 | `bdb99ba` | `docs/evidence/HEADLESS_CLIENTS_2026-11-14.md` |
| Release manifests and the MCP server name the version; reproducible desktop archives; dependency audit; MCP label and approval-prompt hardening (#64) | #462, #466, #464, #463, #467 | `2c6e730`, `99153eb` | exact-head CI on each |
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
| Token drift: the design system against a stylesheet in the connected codebase (#79's drift requirement) | #452 | `87d434c` | seven exact-head checks pass |
| P10 dogfooding on main `0723851`: seven projects, no failed check | #453 | `c081b16` | `docs/evidence/P10_DOGFOODING_2026-11-13.md` |
| Windows trusted write renamed through its own handle (#349, closed; founder decision 2026-11-13) | #456 | `63912b7` | seven exact-head checks pass |

Each row's PR has its full check results, its fresh-context review findings and fixes, and its mutation results.

## In review

Nothing is in review.

## Remaining requirements

**Release-candidate criteria (P10, `docs/MASTER_PLAN.md`).** The latest P10 run was on `079631a`, a test candidate and not the release candidate: every check it could run passed, with no defect (`docs/evidence/P10_CANDIDATE_TEST_079631a_2026-11-14.md`). Evidence for one commit is not evidence for another, so the v0.1.0 candidate is qualified again on its own commit.

| ID | What remains |
| --- | --- |
| P10-1 | Full qualification on the exact candidate: `npm run check` on three platforms, smoke, gate-13 budgets by the reference protocol (needs the reference machine), the P08-G4 criteria remeasured, and the seven-project dogfooding rerun. Schema v2 scale workloads are merged (#426). | The seven-project dogfooding passed on main `0723851` (`docs/evidence/P10_DOGFOODING_2026-11-13.md`) as evidence; the candidate needs its own run.
| P10-2 | Desktop packages smoke-tested and journeyed on each platform for the candidate. No clean-machine install has been done; its protocol is in `docs/ACCEPTANCE.md`. |
| P10-3 | Artifacts bound to the candidate. The Electron LGPL corresponding source is checked but not carried alongside the artifacts (route to be confirmed: see Blockers). |
| P10-4 | Security, offline, crash recovery and migration (including v1 to v2) on the candidate. #349 is fixed (#456). |
| P10-5 | Dispositioned by the founder on 2026-11-13: #79's remainder covered (aliases; drift built in #452), #78 superseded by ADR-0005. Both closed. |
| P10-6 | Every open issue has a recorded disposition (`docs/evidence/P10_ISSUE_DISPOSITIONS_2026-11-13.md`); none is critical. #382, #94 and #351 are closed. Judged again on the exact candidate. |

**Product scope** (founder directive, 2026-11-13):

| Capability | State |
| --- | --- |
| Align and distribute | done (#419) |
| Auto layout (flex) editing | done (#423) |
| Constraints | done (#432) |
| Responsive breakpoints | ADR-0008 accepted; built after 1.0 (founder, 2026-11-13) |
| Snapping and guides | done (#430) |
| Typography: font picker and text styles | done (#424, #446) |
| Pages: add and switch | done (#422) |
| Export: standalone HTML | done (#418) |
| Export: Tailwind | done (#434) |
| Export: PNG, SVG | done (#439). PDF: not in 1.0; after it, exports written into the project folder (founder, 2026-11-13) |
| Prototyping and interactions | missing |
| RTL editing | done (#433, and MCP `set_attributes` #443): a layer's text direction |
| Reduced motion | no motion in the editor; the canvas ends a design's motion when the system asks (#444) |
| Component sources | |
| ↳ three-way update of an imported item | missing |
| ↳ preview, beyond static HTML | not in 1.0: previews stay the canvas's static rendering (founder, 2026-11-13) |
| ↳ registry fetching | not in 1.0: items come from files the person chooses (founder, 2026-11-13) |
| Agents: dry-run and baseRevision (ADR-0006) | done (#425) |
| Windows installer, upgrade, uninstall | packages are archives (founder, 2026-10-13); upgrade and uninstall documented (#441) |
| Screen-reader pass (#376) | not done with a real screen reader; its protocol is in `docs/ACCEPTANCE.md` |

## Open blockers (founder or third party)

Under the agent-first decision (`docs/provenance/FOUNDER_DECISION_2026-11-14_AGENT_FIRST_HEADLESS.md`):
1. **Real Claude Code and Codex sessions** (the decision's minimum): Claude Code's sign-in has expired (the person signs in again), and Codex's usage limit is reached until 2026-11-17. Gemini CLI's tier no longer supports that client. OpenCode passed (`docs/evidence/HEADLESS_CLIENTS_2026-11-14.md`).
2. **The written offer (#457):** needed only if Electron binaries are distributed. The release workflow now publishes none (#474), so the founder confirms whether #457 is still needed for v0.1.0.
3. **The candidate:** the founder names the commit; engineering then qualifies it (the full suite and the engine install on three platforms, the engine's offline guarantee, the client sessions, the release evidence).
4. **Owner-only actions:** the `v0.1.0` tag, publishing the draft release or an npm package, enabling Dependabot alerts, and removing the unused `TYPESAFE_API_KEY` secret.
5. **PR #471** (the desktop restyle) is open against the UI freeze; the founder decides whether it stays.

The clean-machine desktop install and the editor's screen-reader pass (#376) are not v0.1.0 gates under the decision (`docs/HEADLESS.md`).

## Tests executed (latest, with exact heads)

| Head | Run | Result |
| --- | --- | --- |
| `ci/release-engine-artifact` at `f4f7d9e` (every headless increment) | `npm run check`, Windows | 1,400 tests: 1,390 pass, 0 fail, 10 skipped |
| `f73bfbc` (#470), #472, #473 (`7d7b86f` parent), #474 | CI: Foundation and Desktop on three platforms, Release Evidence, Dependency Audit, Open Code Review | all pass |
| `1ebdc52` (#461, v0.1.0) | CI: Foundation and Desktop on three platforms, Release Evidence build, desktop and collect, Open Code Review | all pass |
| `079631a` (P10 test candidate) | `npm run check`, smoke, gate 13 by the reference protocol, packaged smoke, journey and resilience on Windows; Release Evidence in CI | all pass (`docs/evidence/P10_CANDIDATE_TEST_079631a_2026-11-14.md`) |
| `9aa1248` (Astryx A to E plus C combined) | `npm run check`, Windows | 1,310 tests: 1,299 pass, 0 fail, 11 skipped |
| `f8a4b03` (#415) | CI: Foundation on three platforms, Desktop on three platforms, Open Code Review | all pass |
| `2bff107` (#417) | CI: the same seven checks | all pass |

## Release ownership for v0.1.0 (2026-11-14)

| Owner | Remaining work | Release acceptance |
| --- | --- | --- |
| Engineering (not Desktop/UI) | Non-UI correctness and security fixes, offline/egress and regression gates, provenance and SBOM validation, three-platform CI and release-artifact reproducibility, exact-head evidence | Automated evidence must pass on the final candidate; no source, UI, or security gate can be guessed or bypassed |
| Founder (Desktop/UI) | Desktop product UX and UI changes; clean-machine installation; actual NVDA/JAWS/VoiceOver session; visual and interaction acceptance | Human evidence is recorded with the exact candidate; automated tests do not substitute for screen-reader testing |
| Founder (legal and release) | Adopt lawful corresponding-source distribution method and valid contact details; ratify final candidate; approve tag and publishing | The written offer draft (#457) is **not** yet a legal commitment; no `v0.1.0` tag or public release until explicit final authorization |

## Next engineering actions

1. When the person has signed in to Claude Code and Codex's limit has reset: run the acceptance check of `docs/MCP_CLIENTS.md` in real Claude Code and Codex sessions, and record it.
2. Run the same client sessions on macOS and Linux.
3. When the founder names the candidate: qualify it as the open blockers say.
4. After v0.1.0: validation and accessibility reports as engine tools, PNG previews where a local browser exists, and code-to-design from a connected codebase over MCP.
