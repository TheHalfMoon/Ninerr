# EGM Goldfish 05–07 Resolution Matrix — Ninerr Desktop + Agent-Native Spec

Date: 2026-11-06
Status: **plan-level resolution only. No feature implementation is claimed. No full EGM approval.**
Target: `docs/designs/NINERR_DESKTOP_AGENT_NATIVE_EGM_SPEC_2026-11-06.md` (R2)
Source base: `17edb22c283121c1e93bcd76d91f0fb918204ab5`
Prior anchors: `8cba15c4e4af40b12476433a49e20a1696cfc0f8`, `25145f2cf780474ad2cb133c432bcb0bcbbfa2fd`

## 1. Summary

| Measure | Count |
|---|---|
| Raw findings from stages 05/06/07 | **34** (10 + 12 + 12) |
| Unique issue clusters | **14** |
| Raw findings mapped to a plan resolution | **34 / 34** |
| Unique clusters resolved at plan level | **14 / 14** |
| Unresolved plan-level issues | **0** |
| Feature-implementation blockers still open | **16** |
| Approval blockers still open | **2** (stages 08/09; founder approval of W1–W8) |
| New v1 features claimed by this revision | **0** |
| Tests run in this revision | **0** (docs-only) |
| Code/CI/merge/push/commit/sign performed | **0** |

All 34 findings are dispositioned in the revised spec. Disposition means the plan now has an explicit, testable answer; it does **not** mean the feature exists, passes, ships or is approved.

## 2. Resolution clusters

| Cluster | Raw findings | Issue | Plan resolution | Spec location | Feature blockers |
|---|---|---|---|---|---|
| C01 Gate ordering | 05-1, 05-5, 05-8, 06-5, 06-6, 07-2, 07-5 | J1/J4/J2/W4.5 gates depend on later export, Astro, redo or token/component work | Split every journey into v1 (existing subset) and post-v1; no gate depends on a later milestone; add `W3.2/W3.3 → W4.5/S3`; v1 J1 exports JSX only, J2 uses revert only, J4 is JSX/TSX only | §2.2, §4.3, §5.1–5.3, §6.4 | F5, F7, F8, F14 |
| C02 Installed MCP transport and credentials | 05-2, 06-2, 06-3, 07-4 | Installed app has no bundled stdio helper; "without copying secrets" contradicts the bearer flow | v1 installed transport is authenticated loopback HTTP only; stdio is checkout-only and not bundled; v1 honestly uses a copied long-lived per-agent bearer; post-v1 W1 ships a separate signed helper/utility with zero-Node and one reviewed credential handoff | §2.1, §3 ADR-D4, §6.1 | F3 |
| C03 GUI/MCP parity | 05-3, 06-12 | "Every GUI command" claim is undefined and false against 16 tools | Replace with a bounded matrix; v1 exposes only 16 tools and explicit omissions; full parity is a post-v1 program target with tested equivalence or recorded exclusion | §6.3 | F6 |
| C04 Offline/main-process egress | 05-4, 06-11, 07-3 | Renderer filter is not a whole-process offline guarantee; no mode/egress tests | One main-process egress broker; Strict Offline Mode maps to `local-only` with host/MCP exception; add `mcp.local`/`export.local`/`lens.offline`; require OS packet/firewall proof and negative controls; no absolute claim until measured | §3 ADR-D8, §7.2 | F9 |
| C05 Skilit data path/pack/resolver | 05-6, 06-9, 06-10, 07-7 | No producer, schema, URI grammar, rights, storage decision or capability mapping | Add build-time exporter (S0), `ReferencePackV1`, `ninerr-ref://` identifier grammar, hashes/limits/atomic install/rollback/GC, rights/tenant fields, capability map; no runtime PostgreSQL/cloud; no SQLite/FTS5 initially; draft adapters are unmerged | §3 ADR-D3/D6, §8 | F10, F11, F12, F13 |
| C06 Authority/approval/baseline/labels | 05-7, 06-1, 06-7, 06-8, 07-1 | Three bases; PLAN.md absent; P11–P16 scheduled without approval; gate labels undefined | One source base and one review-freeze rule; `CURRENT.md` identified as stale; PLAN pinned at `16f9d0f` and task IDs/estimates inlined; explicit `G-AUTH`; P/M/V/J/A labels defined or inlined | §0.2, §4.2–4.4, §5, §12 | F1, F2 (v1 gates) |
| C07 Scope/estimates/release vehicle | 05-9 | W3–W6 aggregate 139–204 days with no milestone; Build Kits missing | Two tracks; P11–P16 estimates and dependencies; W1–W8 milestones; Build Kits S4; no v1 overscope | §4.2–4.3, §8.3 | F13, F16 |
| C08 Reuse vs new machinery | 05-10 | Plan reinvented capture, content addressing, provider routing, offline smoke; proposed unnecessary SQLite/capture worker | Reuse map: import-stack, persistence putObject/getObject, network-policy, agent-supervisor, existing offline/migration tests; no new capture service; no SQLite unless measured | §3 ADR-D3/D6, §7.1, §8.2 | F10, F11 |
| C09 Agent contract/proposal tools | 06-4, 07-6 | W2 named a nonexistent generic `edit` tool; no proposal store or contract | `AGENT_CONTRACT.md` v2 becomes normative after approval; exact tool list, dry-run/accept/idempotency/error/proposal-integrity semantics; no generic `edit` | §6.2 | F4 |
| C10 Rights/ACL/cross-tenant | 07-8 | Rights metadata is a free-form string; no export/tenancy gate | `RIGHTS_LEDGER.json` with SPDX/scope/evidence/verifier/flags/tenant; export and sample bundles fail closed; ACL and cross-tenant grant rules; restricted-ID tests | §7.3, §8.4 | F12 |
| C11 Threat model/no-founder-compute | 07-9 | Threat list was category-only; A-03 was a source grep; Lens process model undefined | Threat table with asset/actor/boundary/control/test/residual; reuse import-stack; no new capture service; A-03 becomes dependency/endpoint scan + packaged blocked-network E2E | §7.1, §7.4 | F9, F15 |
| C12 J3 model provider | 07-10 | J3 had no provider work item or contract | Post-v1 W5/P15 provider uses existing registry; off by default; loopback/allowlist; consent/limits/cancellation/secret refs; user-owned and user-paid; stub/refused tests | §3 ADR-D5, §5.2, §7.4 | F15 |
| C13 Version/migration | 07-11 | Document/project/journal versions confused; "reversible" undefined | Explicit version matrix; document 1→2 lazy/forward-only; project 3 and journal 1 unchanged for v2; old-build refusal; no downgrade; per-field oracle | §9 | F14 |
| C14 Performance/test gates | 07-12 | Budgets/tolerances/fixtures undefined or unexecutable; A-12 blocked | Existing P08/P10 budgets retained; new feature/pack/v2/export budgets proposed and unmeasured; named fixtures/tests; A-12 marked evidence-blocked | §10 | F16 |

## 3. Raw finding register (all 34)

| ID | Severity | Finding, compressed | Cluster | Plan disposition | Implementation state |
|---|---|---|---|---|---|
| 05-1 | Blocker | J1 needs PNG/SVG/PDF before W5 delivers export | C01 | v1 J1 exports JSX only; PNG/SVG/PDF is W6/P16 | F7 blocked |
| 05-2 | Blocker | Installed app ships no Node/stdio relay; J2/A-01 assume it | C02 | v1 uses loopback HTTP; stdio is checkout-only; helper is W1 | F3 blocked |
| 05-3 | Blocker | "Every GUI command via MCP" undefined vs 16 tools | C03 | Bounded parity matrix; v1 is the 16-tool subset | F6 blocked |
| 05-4 | Blocker | Renderer filter is not main-process egress guarantee | C04 | Egress broker + OS-level proof; no claim until measured | F9 blocked |
| 05-5 | Blocker | Agent undo→redo unsupported; revert deletes redo | C01 | v1 revert only; post-v1 preview + explicit reapply; no redo claim | F5 blocked |
| 05-6 | Major | Skilit has no offline producer/schema/update path | C05 | S0 build-time exporter + pack v1 + no runtime cloud | F10 blocked |
| 05-7 | Major | Two plans claim authority and disagree | C06 | MASTER_PLAN for v1; design-platform only after approval; one base | Resolved at plan level |
| 05-8 | Major | Astro round-trip assumed; no adapter | C01 | J4/A-08 v1 = JSX/TSX only; Astro is W6 separate grain | F8 blocked |
| 05-9 | Major | W3–W6 overscope; no estimates/release vehicle/Build Kits | C07 | P11–P16 estimates/milestones; Build Kits S4; two tracks | F13/F16 blocked |
| 05-10 | Major | Reinvents capture/storage/search/provider/offline smoke | C08 | Reuse map; no new capture service; no SQLite initially | F10/F11 reuse qualification |
| 06-1 | Blocker | P11–P16 scheduled before their own approval | C06 | `G-AUTH`; W1–W8 conditional; no approval claimed | Approval blocker E2 |
| 06-2 | Blocker | Packaged app cannot provide stdio | C02 | Same as 05-2 | F3 blocked |
| 06-3 | Blocker | "Without copying secrets" contradicts bearer flow | C02 | v1 discloses copied bearer; zero-copy is W1 post-v1 | F3 blocked |
| 06-4 | Blocker | W2 proposal path has no tool/store/contract | C09 | Exact v2 tools and proposal integrity in §6.2 | F4 blocked |
| 06-5 | Major | Reference apply precedes token/component schema | C01 | Add W3.2/W3.3 → W4.5/S3 edge | F14 blocked |
| 06-6 | Blocker | W3 cannot exit because J1 needs W5 export | C01 | Split J1-v1/J1-p; v1 has no PDF/SVG/PNG | F7 blocked |
| 06-7 | Major | Three commits presented as source baseline | C06 | One source base; prior anchors/current state clarified | Resolved at plan level |
| 06-8 | Major | PLAN.md absent; P/V/M labels undefined | C06 | Pin `16f9d0f`; inline task IDs/estimates and label glossary | Resolved at plan level |
| 06-9 | Major | Skilit storage specified two incompatible ways | C05 | Runtime never uses PostgreSQL/cloud; exporter may read it at build time | F10 blocked |
| 06-10 | Major | Resolver, rights, Design Intelligence, Build Kits undefined | C05 | URI grammar/rights/capability map/S4 added | F11–F13 blocked |
| 06-11 | Major | No mode-state/egress-list acceptance test; J3/J6 omitted | C04 | Mode/transition/egress tests; J3/J6 post-v1 | F9 blocked |
| 06-12 | Major | Agent parity undefined and contradicted | C03 | Same as 05-3 | F6 blocked |
| 07-1 | Blocker | Authorization/exact-head ambiguity; PLAN absent; CURRENT stale | C06 | One base/freeze rule, pinned PLAN, stale CURRENT noted, `G-AUTH` | Resolved; E1/E2 pending |
| 07-2 | Blocker | J1/J4 exit before enabling export/Astro | C01 | Split v1/post-v1 journeys and gates | F7/F8 blocked |
| 07-3 | Blocker | Offline Mode has no enforcement design | C04 | Egress broker + `local-only` mapping + OS proof | F9 blocked |
| 07-4 | Blocker | MCP credential model contradicts requirement 4 | C02 | Honest v1 bearer; post-v1 keychain/short-lived/rotation | F3 blocked |
| 07-5 | Blocker | J2 undo→redo cannot work | C01 | Same as 05-5 | F5 blocked |
| 07-6 | Blocker | W2 contract underspecified/nonexistent tool | C09 | Same as 06-4 | F4 blocked |
| 07-7 | Blocker | Skilit pack format is a sketch | C05 | Pack v1 fields, hashes, limits, atomic install, GC, tests | F10/F12 blocked |
| 07-8 | Blocker | Rights/source permissions have no enforcement gate | C10 | Rights ledger + export/tenant/ACL gates | F12 blocked |
| 07-9 | Blocker | Threat model is a category list; no-founder gate is a grep | C11 | Threat table; real dependency/endpoint/E2E proof; no new worker | F9 blocked |
| 07-10 | Major | J3 has no provider work item/contract | C12 | P15 provider contract, user-owned/off by default | F15 blocked |
| 07-11 | Blocker | Migration version-confused; "reversible" undefined | C13 | Version matrix; forward-only v2; undo-upgrade only | F14 blocked |
| 07-12 | Major | Performance/test gates not executable | C14 | Budgets/tolerances/fixtures named; A-12 blocked | F16 blocked |

## 4. Feature-implementation blockers (open)

| ID | Blocker | Milestone | Why it is not done | Required evidence before claim |
|---|---|---|---|---|
| F1 | P09 UI/UX completion | R | Existing P09 criteria not passed | Exact-head P09 evidence on the candidate |
| F2 | P10 release qualification/native packages | R | No certificate/packages here | Exact-head P10 + packaged journeys/resilience |
| F3 | Installed stdio/headless + credential handoff | W1/P11 #364 | No bundled helper; no zero-copy handoff | Packaged E2E fresh account without Node; credential/rotation tests |
| F4 | Agent contract v2 (`baseRevision`, dryRun, proposal, idempotency) | W1/P11 | Tools do not exist; caller revision is overwritten | Contract tests: dry-run=commit, stale/duplicate/proposal/atomicity |
| F5 | Revert preview + explicit reapply | W1/P11 | Current revert is latest-only and deletes redo | Interleaving/conflict tests; no redo claim |
| F6 | Parity beyond the 16 tools | W1+ | Import/codebase/project/history/research are GUI-only | Tested oracle per advertised row or exclusion |
| F7 | PNG/SVG/PDF export | W6/P16 T16.1 | No exporter exists | Export fidelity fixtures, no fixed-folder writes |
| F8 | Astro import/edit/write-back | W6 separate | No parser/patch adapter | 54-file corpus, byte identity, minimal diff, fail-closed |
| F9 | Main-process egress broker + OS proof | R/W1 | Renderer-only filter; main process unwatched | OS packet/firewall proof + denied-provider negative control |
| F10 | Skilit build-time pack exporter | W7/S0–S1 | Draft adapters unmerged; no producer | Pinned source SHA, pack fixture, integrity/rights tests |
| F11 | Research/Lens/Assets/Design Intelligence UI+MCP | W7/S2 | No production UI or MCP reads | Offline 1,000-ref fixture, no egress, matching MCP/UI |
| F12 | Rights ledger + cross-tenant export enforcement | W7/S1–S3 | Free-form license string only | Restricted/cross-tenant IDs never export; ACL tests |
| F13 | Build Kits | W7/S4 | No definition implementation | Rights-qualified bundle fixture, stable URN resolution |
| F14 | Document v2 tokens/components migration | W3/W4 | Schema 2 not implemented | Lazy upgrade, undo, old-build refusal, new corpus |
| F15 | User-owned model provider (J3) | W5/P15 | No provider work item implemented | Stub endpoint, refused connection, off-by-default egress |
| F16 | New-feature performance budgets | W2–W7 | Proposed budgets unmeasured | Five-run reference protocol per workload |

**Approval blockers:** **E1** EGM stages 08/09 not run; **E2** founder approval of P11–P16/S0–S4 not recorded. Neither is a feature implementation.

## 5. Evidence inspected for this resolution

- Spec R2 and all three findings files: `05-zoom-out-findings.md`, `06-comprehension-findings.md`, `07-design-critic-findings.md`.
- Strategy: `EGM_GOLDFISH_05_DISPOSITIONS_2026-11-06.md`, `GUI_MCP_COMMAND_PARITY_2026-11-06.md`, `DESKTOP_FIRST_AGENT_NATIVE_BLUEPRINT_2026-11-06.md`, `NINERR_SKILIT_FOUNDATION_2026-11-06.md`, `FOUNDER_SOURCE_AUTHORIZATION_2026-11-06.md`, `REA_COMPETITORS_AND_CRAFT_ANYTHING_2026-11-06.md`.
- Canonical/proposal docs: `docs/MASTER_PLAN.md`, `docs/CURRENT.md`, `docs/MCP.md`, `docs/DESKTOP.md`, `docs/MIGRATION.md`, `docs/design-platform/{README,AGENT_CONTRACT,ARCHITECTURE,REUSE}.md`, ADRs.
- `docs/design-platform/PLAN.md` at `16f9d0f` (absent at base).
- Code: `packages/mcp-protocol/src/tools.mjs` (16 tools), `packages/studio-host/src/mcp.ts` (`baseRevision: session.revision`), `session.ts` (undo/redo/revert, `MAX_LOG` 500), `server.ts` (route map, loopback), `relay.ts`, `scripts/ninerr-mcp.mjs`, `scripts/package-desktop.mjs` (no relay/Node copied), `packages/desktop/src/main.mjs` (renderer hardening only), `packages/network-policy` (modes/providers/readiness), `packages/import-stack` (SSRF/assets), `packages/persistence` (schemas, objects), `packages/document-model` (schema 1), tests (`offline-guarantee`, migration, mcp).
- Draft branches: `feat/local-reference-file-reader-20261106`, `test/offline-reference-packs-20261106` (unmerged reference-pack work; not shipped).

## 6. Non-claims

This matrix does **not** claim: full EGM 5-stage approval; tests passed; release done; P09/P10 completion; installed stdio/headless; PNG/SVG/PDF; Astro; reliable agent redo/reapply; full UI/MCP parity; Skilit packs/Research/Lens/Assets/Design Intelligence/Build Kits; OS-level zero egress; verified third-party rebrand rights. It records plan decisions and open implementation blockers only.

## 7. Handoff

1. Run **Stage 08** with a fresh context on this R2 spec and matrix; then **Stage 09**.
2. Do not start W1–W8 without the recorded founder approval gate.
3. Keep v1 at P09/P10 and the existing supported subset; do not widen gates for the new vision.
4. Resolve F1–F2 through the canonical release process first; F3–F16 are post-v1.
5. Freeze the design commit/tree SHA when a commit is authorized; this worktree has no design commit SHA.
