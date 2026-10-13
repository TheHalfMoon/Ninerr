# Ninerr — Canonical Program State

Last updated: 2026-10-13

## Program

**P08 — Deep qualification and dogfooding.** N0, Ninerr independence and migration (umbrella #190), is `CLOSED_CANONICAL`. The founder renamed the product to Ninerr on 2026-10-08 and set the order: N0, P08 deep qualification and dogfooding, P09 Ninerr UI and UX, P10 release candidate hardening, then the release gate (`docs/MASTER_PLAN.md`). The founder authorized the program through the release gate on 2026-10-13; v1.0.0 is created only after the exact candidate passes every P10 criterion.

Status: **P08 CLOSEOUT.** Every engineering exit criterion is met, with stated limits (`docs/evidence/P08_EXIT_QUALIFICATION_2026-10-11.md`). On 2026-10-13 the founder resolved the decisions P08 was waiting on and authorized P09, P10 and the release gate (`docs/provenance/FOUNDER_AUTHORIZATION_2026-10-13_COMPLETION.md`; the decisions and the P09 and P10 acceptance criteria are in `docs/MASTER_PLAN.md`). P08 closes once the gate-13 reference protocol and the P08-G4 budgets are recorded against current measurements (#275), #268 is resolved as decided, and #300 and #329 are resolved or dispositioned. N0 closed on 2026-10-09, with every exit criterion verified (`docs/evidence/N0_CLOSE_2026-10-09.md`). Each N0 grain landed through its own PR with exact-head CI, Jev qualification and review, and its evidence is in the `N0_*` records under docs/evidence. N0 delivered:
- the identity census (G1);
- the persisted-data and host migrations with backward compatibility (G2), and the #185 write-back fix;
- the package scope, product, tooling, runtime and prose identity (G3);
- Ninerr's own MCP surface (G4);
- the retirement of all donor-product recovery tooling and records (G5);
- the coherence audit (G6);
- the A/B source-rights audit, the Apache-2.0 license, the notices and the Electron corresponding source (G7);
- the documentation (G8);
- the independence regression gate in CI, with a narrow, reviewed allowlist (G9);
- the repository rename to `TheHalfMoon/Ninerr`, with its redirects verified (G10);
- the repository cleanup: a contributing guide, issue and PR templates, the repository description and topics, and the public docs (G11).

P08 tests complete end-to-end journeys repeatedly and adds property and state-machine coverage, before any final UI design (P09). Its grains G1 to G11 are merged, each with its own P08 record under docs/evidence. G11 dogfooded Ninerr on seven public open-source projects (`docs/evidence/P08_G11_DOGFOODING_2026-10-11.md`).

Since the exit record, independent P08 follow-ups have landed, each with a regression test that failed first, fresh-context review and exact-head CI:
- the editor is ready only after its change stream has caught up (#302, PR #304);
- a hung browser test fails by its name, and what it opened is closed after it, so the run ends (#305, PRs #307 and #311);
- a page's `#id` rules apply on the canvas (#297, PR #309);
- the import review says when a chosen stylesheet file answers a web address or several links, and an undo or revert that would bring back an unsafe stylesheet is refused (#299, PRs #308 and #313);
- write-back no longer writes over a file style it cannot read exactly, a data-loss fix found in review, and a conflict's choice that fails half-way leaves nothing to act on wrongly (#291, PRs #312, #317 and #318);
- a page's @scope rules with ids apply, code export keeps every id unique in the export, and a guard bounds the cost of many id rules (#310, PRs #316, #319 and #322);
- each frame's @keyframes apply to it alone, and a project's stylesheets have a 16 MiB budget in all (#299, PRs #320 and #321).

Since then, more follow-ups have landed the same way:
- an edit copies and checks only what it changes, not the whole document: at 50,000 layers a property edit went from 1,165 ms to 133 ms at p50 in one session, and measured 95 ms in a later one on the same machine (#252, PRs #324, #325 and #326);
- one edit could hang the host with a restored snapshot whose parents loop; a snapshot must now be one tree (#327, PR #328), and a deep chain inside one transaction no longer overflows the stack (#329 item 1, PR #330);
- a timed-out editor wait now says what the editor showed (#300, PR #331);
- the evidence store refuses other letter case, dangling links, missing drives and NTFS stream names (#270, PR #332);
- the import stack reads no field from a polluted prototype, and its unchecked transport is private (#94, PR #333);
- the SBOM check reports copies of one package with different hashes (#135, PR #334);
- intake records roles that remove native semantics (#89, PR #335), and the import fixpoint covers `<plaintext>` (#132, PR #336);
- Visual Git refuses invisible or hidden-data text and mixed commit formats, and an open removes the staging folders a crashed create left (#64, PRs #337, #338 and #339);
- the Windows CI `ECONNRESET` was reproduced on Node 22 and fixed in the test client (#306, PR #340).

The seven-project dogfooding was run again on `1987c77` with the same outcomes as its record (#230).

#268 (Windows access lists) is decided: a small Windows-only native boundary reads owners and access lists, and the no-process rule stands.

## Canonical main

`1987c771882fd93cdb682c4b3cb301dbf7cf9bd1`

This is the normal merge commit for PR #340 (#306). It is the latest commit whose post-merge run was verified when this page was updated: CI run 38348158607 and Desktop run 38348158627 completed `SUCCESS` on that exact SHA, with the suite on Linux, macOS and Windows and the desktop packages for all three.

## Before the v1 tag
1. **License.** Resolved: Ninerr is Apache-2.0 (`LICENSE`), after the A/B source-rights audit (`docs/evidence/N0_G7A_LICENSE_2026-10-09.md`).
2. **Private vulnerability reporting.** Resolved: it is enabled and verified (`SECURITY.md`).
3. **Publisher signing.** Decided: the release may ship without publisher signing or notarization, stated as such, with checksums and Sigstore build provenance (#139).
4. **LGPL corresponding source.** The binding is done (`docs/provenance/ELECTRON_CORRESPONDING_SOURCE.json`), and the release workflow verifies it live (`docs/evidence/N0_G7B_ELECTRON_SOURCE_2026-10-09.md`). Decided: the release carries that source alongside its artifacts.
5. **The tag.** `v1.0.0` is created only after the exact candidate passes every P10 criterion, and its release is published only after the release gate has checked it (`docs/MASTER_PLAN.md`). No tag exists.

## Canonical facts
- Product: **Ninerr**, licensed under Apache-2.0. The repository is `TheHalfMoon/Ninerr`.
- Ninerr does not depend on any donor product or any donor's identity (`docs/evidence/N0_G6_COHERENCE_AUDIT_2026-10-09.md`). The audited register of every source is `docs/provenance/LICENSE_REGISTER.json`.
- CI runs the full suite on Linux, macOS and Windows (P08-G7). Windows skips 6 tests, each with its reason stated where it runs.

## The program before the rename
The state of every phase, grain and gate up to N0 is recorded unchanged in `docs/evidence/PROGRAM_STATE_2026-10-09.md`. There, grains 1 to 9, P03, P04, the P05 slices, P06 and PC are `CLOSED_CANONICAL`, P07 Release is active, and P00's gates have the states the record gives them.
