# Ninerr Master Plan

## Mission

Ninerr is an AI-native, web-semantic design environment where humans, software agents, production code, and design systems operate on one shared model. It is one coherent, independently identifiable product with a stronger architecture for round-trip code synchronization, local/private operation, multi-agent work, visual review, and deterministic export.

## Non-negotiable principles

1. **Evidence before claims.** Every imported donor snapshot, build, test, parity claim, and release must bind to an exact revision and reproducible evidence.
2. **Preserve donor provenance.** Authorized use does not erase third-party notices, dependency licenses, or attribution requirements.
3. **Independent identity.** No donor's names, marks, endpoints, IDs, telemetry, service assumptions or visual branding ship in Ninerr unless an obligation requires attribution.
4. **Web semantics first.** HTML/CSS concepts are the canonical bridge between canvas and production code.
5. **Round-trip safety.** Import/export is not enough. Ninerr must preserve intent when code becomes design and design becomes code again.
6. **Local/private first.** Core creation, agent control, source inspection, and project persistence must work without a paid cloud dependency.
7. **Agents are collaborators, not hidden automation.** Agent mutations are attributable, reviewable, cancellable, and reversible.
8. **No destructive source normalization.** The first authorized-source intake is an immutable snapshot; transformation happens in later commits. (No authorized-source intake ever received source, and N0-G5 retired the intake.)

## Current program

The founder set the order on 2026-10-08, when the product was renamed to Ninerr:
1. **N0: Ninerr independence and migration.** This covers the identity census and migration; backward compatibility for projects and setups from before the rename; independence from every donor's identity; the Apache-2.0 license with its source-rights audit; the Electron corresponding source; the documentation; the CI identity gate; and the repository rename. Issue #190 tracks it, and each grain's evidence is in `docs/evidence/N0_*`.
2. **P08: deep qualification and dogfooding.**
3. **P09: Ninerr UI and UX.**
4. **P10: release candidate hardening.**
5. **The release gate,** then v1.0.0.

On 2026-10-13 the founder authorized the program through P08 closeout, P09, P10 and the release gate, and resolved the decisions P08 was waiting on (`docs/provenance/FOUNDER_AUTHORIZATION_2026-10-13_COMPLETION.md`). The `v1.0.0` tag is created only after the exact candidate passes every P10 criterion below, and the release it produces is published only after the release gate has checked it.

## Founder decisions of 2026-10-13
- **Performance budgets (#275).** Absolute budgets are judged on the stated reference machine (Windows 11, Intel Core i5-13420H with 12 logical cores, 16 GiB, Node 24, Microsoft Edge, plugged in, best performance, nothing else running): `tests/editor-performance.test.mjs` runs five times on the exact candidate commit from a clean checkout, and a budget passes when it holds in at least four runs and the median of the five p95s is within it. A script records all five runs. CI keeps measuring on every PR, as information, and a regression of more than 50% against the last recorded baseline for the same runner OS is investigated. The budgets are unchanged. Editor readiness is measured apart from launching a browser. The P08-G4 budget framework is accepted with these targets: edit, undo and redo p95 at most 100 ms at 1,000 layers and at most 300 ms at 10,000 (100 ms there stays a goal, not claimed until measured); an agent's edit p95 at most 400 ms at 10,000 layers; the documented reopen, close and recovery budgets; the bounded HTML import and code write-back budgets; at most 500 MiB memory growth at 50,000 layers (indicative); the supported-size limits; and the disk model since #290 (one snapshot document plus the journal's archived history segments, kept on purpose).
- **Windows access lists (#268).** A small, pinned, Windows-only native boundary may read the owner and effective access lists of trusted files; Ninerr's no-child-process rule stands. Relay discovery fails closed when ownership and permissions cannot be proven. A warning alone is not a fix, and #268 is reported fixed only when tests show the protection.
- **Release posture.** No paid infrastructure is required. A release may ship unsigned by a publisher, disclosed as such, with checksums, GitHub/Sigstore provenance, per-artifact manifests, and the Electron LGPL corresponding source alongside the artifacts. No other gate is weakened for it.

## P09 — Ninerr UI and UX: acceptance criteria
Each criterion is met through the product itself, with an end-to-end test that drives the editor, and the dogfooding journeys it affects are run again.
1. **An agent's change is undone where a person looks for it.** After an agent edits, the editor offers the way to undo that change where its own Undo is, without the person having to find Revert in the history (P08-G11 finding).
2. **Layers are reordered, grouped and moved to another parent in the editor,** by keyboard and by pointer, each as one history transaction that undo reverses (P08-G11 finding).
3. **The inspector edits an element's classes** (P08-G11 finding).
4. **The editor UI stays accessible:** `auditAccessibility` finds nothing in the new UI, and every new action is keyboard operable.
5. **The design-model questions P08 left open are decided, with tests:** how imported HTML and imported code hold an element's text (#235), and the order in which style shorthands and longhands apply (#294).

## P10 — release candidate hardening: acceptance criteria
1. **The full qualification passes on the exact candidate:** `npm run check`, `npm test` on Linux, macOS and Windows (with the documented Windows skips), `npm run smoke`, the gate-13 budgets by the reference protocol, each P08-G4 criterion against current measurements (passed, or a documented, narrowly scoped supported limit), and the seven-project dogfooding.
2. **Desktop packages** for Linux x64, macOS arm64 and Windows x64 are built, smoke-tested, and pass the packaged journey and resilience runs on their own platforms.
3. **Release artifacts are bound to the candidate:** exact commit and tree, per-artifact manifests, `SHA256SUMS`, the SBOM and attribution bundle, `THIRD_PARTY_NOTICES.md`, the Electron LGPL corresponding source, and Sigstore build provenance; the documentation states that the packages are not publisher-signed or notarized.
4. **Security, privacy and recovery hold:** the security qualification (with #268's protection, resolved in P08), the offline guarantee (nothing leaves loopback), crash recovery and migration of earlier projects pass on the candidate.
5. **Parity is dispositioned:** each required row of the parity record is proven or carries a recorded disposition, including #78 and #79.
6. **Nothing critical is open, and the canonical documents match live state.** No critical correctness, data-loss, security or release-blocking issue remains; every other open issue (among them #252 and #108, #94, #64 and #310) is resolved or carries a recorded disposition; and `docs/CURRENT.md`, the evidence records, the architecture catalog and the issue states agree.

Then the release gate: the candidate's release workflow runs on the `v1.0.0` tag, and the draft release it creates is checked against the candidate's evidence before it is published.

## Definition of genuinely complete

Ninerr is not complete merely because the UI launches. Completion requires:

1. the authorized donor baseline is traceable;
2. the shipped product has independent identity;
3. required parity rows are proven or intentionally dispositioned (the rows are in the parity matrix, retired in N0-G8b to `docs/evidence/PARITY_MATRIX_2026-10-06.md`; the architecture catalog in `packages/architecture` records each subsystem's status);
4. differentiators D1–D7 have acceptance evidence;
5. security, accessibility, performance, persistence, recovery, and license gates pass;
6. a fresh user can install, create/edit, use an agent, connect a codebase, round-trip a component, and export without hidden paid infrastructure.

## The program before the rename
Phases P00 to P07 and PC were planned and delivered before the rename. They are recorded unchanged in `docs/evidence/MASTER_PLAN_2026-10-09.md`. Their quality gates and release artifacts are the ones this program inherits.
