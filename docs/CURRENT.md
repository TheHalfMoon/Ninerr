# Ninerr — Canonical Program State

Last updated: 2026-10-11

## Program

**P08 — Deep qualification and dogfooding.** N0, Ninerr independence and migration (umbrella #190), is `CLOSED_CANONICAL`. The founder renamed the product to Ninerr on 2026-10-08 and set the order: N0, P08 deep qualification and dogfooding, P09 Ninerr UI and UX, P10 release candidate hardening, then the founder release gate (`docs/MASTER_PLAN.md`). v1.0.0 is not authorized.

Status: **P08 ACTIVE: every engineering exit criterion is met; one founder decision remains** (`docs/evidence/P08_EXIT_QUALIFICATION_2026-10-11.md`): accepting the P08-G4 stress budgets, and where gate 13 is judged (#275). P09 starts after that decision. N0 closed on 2026-10-09, with every exit criterion verified (`docs/evidence/N0_CLOSE_2026-10-09.md`). Each N0 grain landed through its own PR with exact-head CI, Jev qualification and review, and its evidence is in the `N0_*` records under docs/evidence. N0 delivered:
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

## Canonical main

`1f0ee8e7f2edc45ed65bdf13bf39753e3d0da5c3`

This is the normal merge commit for PR #293 (#172). It is the latest commit whose post-merge run was verified when this page was updated. The CI and Desktop workflows completed `SUCCESS` on that exact SHA, with the suite on Linux, macOS and Windows and the desktop packages for all three. The harness merge that followed, PR #292, changes only `scripts/dogfood/`, the license register, the notices and the identity census.

## Before the v1 tag
1. **License.** Resolved: Ninerr is Apache-2.0 (`LICENSE`), after the A/B source-rights audit (`docs/evidence/N0_G7A_LICENSE_2026-10-09.md`).
2. **Private vulnerability reporting.** Resolved: it is enabled and verified (`SECURITY.md`).
3. **Publisher signing.** Open. This needs an Apple Developer ID with notarization credentials and a Windows code-signing certificate, as Actions secrets (#139).
4. **LGPL corresponding source.** The binding is done (`docs/provenance/ELECTRON_CORRESPONDING_SOURCE.json`), and the release workflow verifies it live. How a binary release offers that source is a founder release-gate decision (`docs/evidence/N0_G7B_ELECTRON_SOURCE_2026-10-09.md`).
5. **The tag.** Not authorized. No release tag is created until the founder release gate passes.

## Canonical facts
- Product: **Ninerr**, licensed under Apache-2.0. The repository is `TheHalfMoon/Ninerr`.
- Ninerr does not depend on any donor product or any donor's identity (`docs/evidence/N0_G6_COHERENCE_AUDIT_2026-10-09.md`). The audited register of every source is `docs/provenance/LICENSE_REGISTER.json`.
- CI runs the full suite on Linux, macOS and Windows (P08-G7). Windows skips 6 tests, each with its reason stated where it runs.

## The program before the rename
The state of every phase, grain and gate up to N0 is recorded unchanged in `docs/evidence/PROGRAM_STATE_2026-10-09.md`. There, grains 1 to 9, P03, P04, the P05 slices, P06 and PC are `CLOSED_CANONICAL`, P07 Release is active, and P00's gates have the states the record gives them.
