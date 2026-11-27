# EGM Goldfish Stage 5 — Zoom-Out Review Dispositions for Ninerr
Date: 2026-11-06
Reviewer: independent **OpenCode + DeepSeek** session following installed Google Elephant-Goldfish Model `zoom_out.md` persona.
Target reviewed: `docs/designs/NINERR_DESKTOP_AGENT_NATIVE_EGM_SPEC_2026-11-06.md`, local owner Windows worktree. Source-specific checks included Ninerr main `8cba15c4e4af40b12476433a49e20a1696cfc0f8`, existing P11–P16 proposal and application code.
Status: **Stage 5 completed with blockers. Not an approved full EGM review.** The original raw output is stored locally under `D:\Ninerr-EGM-Plan\docs\designs\egm-review-20261106\05-zoom-out.txt`. Its large raw tool-read trace remains local, not added to GitHub.

## Decision register (all 10 Goldfish findings)

| ID | Severity | Verified problem | Resolution / owner | Current disposition |
|---|---|---|---|---|
| G05-1 | Blocker | J1 demands PNG/SVG/PDF before W5 export delivers them; today export path is JSX | Move image/PDF export gate to the milestone that implements it; v1 P09/P10 only promises current qualified outputs. Add reference export tests when feature is built | PLAN corrected below, implementation pending |
| G05-2 | Blocker | Installed Electron bundle does **not** contain a runnable Node stdio relay; J2/A-01 incorrectly presumes it | v1 uses documented authenticated loopback MCP where packaged-tested; add separately packaged helper or native stdio host in #364 with fresh-user tests. Do not claim installed stdio parity until tested | PLAN corrected; #364 open |
| G05-3 | Blocker | Plan requires all GUI functions via MCP while 16 MCP tools omit app management/import/codebase/history | Establish bounded command inventory: document editing parity first, project/research/import/export/history later, with explicit exceptions and independent tests | PLAN corrected; inventory not yet complete |
| G05-4 | Blocker | Renderer request filter is not a main-process egress guarantee; offline product promise could be false in privileged paths | Use existing `network-policy` for import/providers/main-process; independently measure **whole-process** egress in native packaged OS firewall/packet sink, include a failing negative control | implementation + security qualification pending |
| G05-5 | Blocker | Current agent `revert` is not ordinary undo→redo; no MCP undo/redo tools | Specify “revert, then explicitly reapply if still safe,” or implement a reviewed redo equivalent. Block silent overwrite of later human edits; test interleavings | plan corrected; feature pending |
| G05-6 | Major | Skilit had no versioned local export/data source path despite refusing cloud runtime | First shipped read-only converter and rights-aware local pack in Draft PR #365; remaining actor-filtered export, rights ledger, trusted local storage, UI/MCP integration #366 | partially addressed in code |
| G05-7 | Major | Draft plans conflict with canonical P09/P10 and proposed P11–P16 agent/DDL decisions | Keep `docs/MASTER_PLAN.md` authoritative for v1, P11–P16 `AGENT_CONTRACT.md`/ADRs authoritative only after approval; create v2 implementation plan after explicit review | plan corrected, approval pending |
| G05-8 | Major | JSX/TSX source integration exists, Astro import and write-back do not; J4 falsely assumes both | V1 tests JSX/TSX only; Astro is a later independently scoped parser/fallback and patch grain with byte-diff tests | plan corrected, implementation pending |
| G05-9 | Major | W3–W6 aggregate 139–204 estimated engineer-days from separate prior proposal without a release vehicle; Build Kits missing | Separate v1 release from post-v1 professional features. Adopt task-level P11–P16 plan; add named Build Kits grain and product milestone after review | plan corrected, backlog pending |
| G05-10 | Major | Draft reinvents capture, content-addressed storage, provider routing, vector index and offline smoke | Reuse existing `import-stack`, `persistence/store.ts`, `network-policy`, `agent-supervisor`, `tests/offline-guarantee.test.mjs`; defer SQLite and additional capture worker until real demand | plan corrected; reuse qualification pending |

## Corrected interpretation of founder contract

### Release track R: v1 candidate
- v1 is **the existing installed Electron desktop editor**, stable source round-trip with actually supported JSX/TSX, local host/MCP through its currently packaged transport, no mandatory hosted model/cloud, existing tested native/document operations.
- v1 release requires full P09 and P10 exact-candidate gates from `docs/MASTER_PLAN.md`: native packages, all supported OS journeys, security and end-to-end tests, source provenance, checksum/SBOM, and current-state consistency.
- **No unsupported claims** that v1 includes a packaged stdio helper without Node, Astro source editing, PNG/PDF/SVG export, offline Skilit search UI, or native automated undo/redo of all agent changes.
- If a requirement is truly founder-mandated for v1, explicitly move its tested implementation before the release gate and acknowledge the schedule impact; never silently widen existing gates.

### Platform track W: subsequent milestone
- P11 + headless MCP local bridge **#364**, proposal + dry-run + reviewable agent transaction contract, recorded GUI↔MCP command inventory.
- P12–P14 responsive layout, token/variant/component model with additive/forward-only migration per existing ADR-0003.
- Offline Skilit source export + verified reference packs **#365** + read-only import/store/Research UI/MCP **#366** + native review/undoable apply flow. **No PostgreSQL/Next.js/cloud runtime required for users**.
- P15–P16 native creative vectors, PNG/SVG/PDF, prototypes, advanced export, batch design checks, optional external user model providers.
- Build Kits are defined as machine-readable source-aware bundles of rights-qualified tokens, screenshots where permitted, component specs and generation context, indexed by stable reference URNs. This is a separate implementation grain under local Research, NOT a hosted inference product.
- Broad Deep REA continues using OpenCode+DeepSeek+Craft Anything; its 24-task corpus is a starter, not an artificial research limit.

## Explicitly deferred engineering choices
1. Installed MCP when desktop is closed: choose signed helper, packaged utility, or direct local HTTP based on tested native permissions and process ownership. Current source is a **relay to a running host**; no claim of headless support.
2. Existing application `revert` vs future `redo` semantics: forbid “undo then redo” in acceptance until actual implementation.
3. Main-process egress: do not certify by inspecting source alone. Capture actual packet/block logs from all app processes on each supported OS.
4. Local reference lookup: start with bounded in-process manifests and verified content-addressed storage. No standalone service, SQLite/FTS5 or embeddings requirement until performance need is proved.
5. Astro: ensure unsupported source is preserved, but no round-trip parity claims until an Astro-specific parser/patch/test grain passes.

## Detailed blocked acceptance replacements
- **J1 (current v1):** install -> offline -> create/edit -> save/undo -> reopen -> export the **currently implemented qualified JSX source**. SVG/PNG/PDF moves to post-v1 W5 unless separately implemented/qualified.
- **J2 (current v1):** connect an authorized local agent through the *actual packaged-supported* MCP transport while the host runs; read then apply supported operation; inspect attribution and use existing supported **revert**. Headless stdio, idempotent `dryRun` and reapply are follow-up gates, not assumed.
- **J4 (current v1):** JSX/TSX source round-trip only, fail-closed unsupported transformations. Astro is a v2 separate test.
- **A-02 offline:** distinguish zero-network-packet *test target* from a proven implementation guarantee. Test whole process including Electron main/service/worker and routes, not renderer alone.
- **A-04 parity:** maintain a machine-readable `GUI command → MCP tool + tested equivalence OR explicit exclusion` matrix. Completion of supported **document mutation** parity is the first measurable target.

## Reuse map for the offline integration
| New product need | Current Ninerr reusable code | Additional work |
|---|---|---|
| URL import safety | `@ninerr/import-stack/network.ts`, `security.ts` | explicit user consent, whole-process egress tests |
| Local asset integrity | `@ninerr/import-stack/assets.ts`, `persistence/store.ts` | rights/provenance gate, stable source URI |
| Trusted reference file reads | `@ninerr/import-stack/filesystem.ts`, `studio-host/trusted-file.ts` | owner-chosen root, path race/ACL review and native tests |
| Search & rights | Draft #365 bounded pure reference pack | source-specific export permission, UI/MCP parity |
| Design transactions | `StudioSession`, `history`, `mcp.ts` | baseRevision from MCP caller, no-side-effect dry run |
| Local models | `network-policy/providers.ts` | optional BYO configuration; never mandatory |
| Agent process lifecycle | `agent-supervisor`, studio-host | packaging-only and local authorization checks |
| Static and network tests | `tests/offline-guarantee.test.mjs`, `scripts/smoke.mjs` | native main-process packet check and negative control |

## EGM remainder and actual status
- Stage 5 Zoom-Out Goldfish: **COMPLETED, 10 issues (5 Blocker, 5 Major)**. Issues now have explicit proposed dispositions; not all fixes are implemented.
- Stage 6 fresh-context comprehension, Stage 7 design critique, Stage 8 second zoom-out, Stage 9 implementation readiness: **pending at ledger time**. Each must be performed independently with OpenCode/DeepSeek, with source SHA and unchanged output. Do not call the entire EGM cycle passed before all issues are resolved.
- Program roadmap remains **unapproved for merging as a whole** until full fresh-context review, source checks and exact-head gates succeed.

This file documents issues and decisions, not completion of P09/P10, professional UI parity or the user release.
