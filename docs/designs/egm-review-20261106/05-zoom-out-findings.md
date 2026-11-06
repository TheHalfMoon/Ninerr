## 1. [Blocker] J1ΓÇÖs export acceptance cannot pass at W3; PNG/SVG/PDF export is scheduled for W5

**Evidence**
- `D:\Ninerr-EGM-Plan\docs\designs\NINERR_DESKTOP_AGENT_NATIVE_EGM_SPEC_2026-11-06.md:27` ΓÇö J1 requires ΓÇ£export SVG/PNG/PDFΓÇ¥.
- `:124` ΓÇö W3 exit says J1 passes.
- `:137` ΓÇö W5.2 is where ΓÇ£exact exports SVG/PNG/PDFΓÇ¥ are delivered.
- `D:\Ninerr-EGM-Plan\packages\architecture\src\catalog.ts:114` ΓÇö ΓÇ£Export to images, PDF and other file formats is planned.ΓÇ¥
- `D:\Ninerr-EGM-Plan\packages\studio-host\src\server.ts:298` ΓÇö the only export route is `POST /api/code/export`; it calls `exportJsx` (`packages\studio-host\src\index.ts:11`).
- `D:\Ninerr-EGM-Plan\packages\design-platform\PLAN.md` at commit `16f9d0f` places image/PDF/SVG export in T16.1, after P15.

**Simplicity rationale**
The first desktop acceptance journey is written against a capability that is explicitly ΓÇ£plannedΓÇ¥ and scheduled two phases later. Either W3 silently expands into P16, or J1 fails at the gate that claims it.

**Fix**
Move T16.1 (offline PNG/SVG/PDF export) before J1 and update the dependency graph, or remove PDF/SVG/PNG from J1/A-01/W3 exit and make them an explicit W5 acceptance test. Add a deterministic export fixture to A-07.

---

## 2. [Blocker] ΓÇ£Local MCP exposed by the installed appΓÇ¥ cannot satisfy J2ΓÇÖs stdio path: the packaged app ships no relay and no Node

**Evidence**
- `D:\Ninerr-EGM-Plan\docs\designs\NINERR_DESKTOP_AGENT_NATIVE_EGM_SPEC_2026-11-06.md:28` ΓÇö J2 says ΓÇ£configure local stdio MCPΓÇ¥.
- `:164` ΓÇö A-01 requires a production package to ΓÇ£start local MCP with zero account/API keyΓÇ¥.
- `D:\Ninerr-EGM-Plan\scripts\package-desktop.mjs:158-170` ΓÇö the package copies only workspace packages reachable from `bootstrap.mjs`, runtime dependencies, and three root documents. It does **not** include `scripts/ninerr-mcp.mjs` or a Node runtime.
- `D:\Ninerr-EGM-Plan\scripts\ninerr-mcp.mjs:1-9,30` ΓÇö the relay is a Node CLI requiring `NINERR_MCP_TOKEN` and a projects folder or URL.
- `D:\Ninerr-EGM-Plan\docs\DESKTOP.md:38-42` ΓÇö the packaged fuses make `ELECTRON_RUN_AS_NODE` ineffective, so the packaged Electron binary cannot run the relay as Node.
- `D:\Ninerr-EGM-Plan\docs\DESKTOP.md:78` ΓÇö the documented relay path is `npm run mcp`, i.e. a checkout, not an installed app.

**Simplicity rationale**
The installed app exposes authenticated loopback HTTP MCP, but the acceptance test names a checkout-only stdio helper. A fresh user without Node cannot perform the test. This is a packaging/distribution problem, not an MCP protocol problem.

**Fix**
Choose one supported installed-app transport and make it the acceptance path:
- use the existing `mcpUrl` + agent credential over loopback HTTP in J2/A-01; or
- ship a small signed relay helper inside the package (or an Electron utility process) and a UI to configure `NINERR_MCP_TOKEN`.

Add a packaged E2E test from a fresh OS account for whichever transport is chosen.

---

## 3. [Blocker] ΓÇ£Every exposed GUI editing command has an MCP equivalentΓÇ¥ is undefined and far larger than W2

**Evidence**
- `D:\Ninerr-EGM-Plan\docs\designs\NINERR_DESKTOP_AGENT_NATIVE_EGM_SPEC_2026-11-06.md:14` ΓÇö ΓÇ£Agents are first-class users with parity to visible app functions.ΓÇ¥
- `:118` ΓÇö W2 exit requires ΓÇ£every exposed GUI editing command has documented MCP equivalent or explicit reason for omission.ΓÇ¥
- `D:\Ninerr-EGM-Plan\packages\mcp-protocol\src\tools.mjs:9-26` ΓÇö the entire MCP catalog is 16 tools: 9 reads, 6 writes, 1 consequential delete.
- `D:\Ninerr-EGM-Plan\packages\studio-host\src\server.ts:281-392` ΓÇö GUI/host commands include import/commit/discard, code import/export, codebase connect/import/preview/write/resolve, project create/open/close, undo/redo/revert, checkpoint, selection, and agent management. Most have no MCP equivalent.

**Simplicity rationale**
There is no command inventory and no agreed boundary between ΓÇ£document editingΓÇ¥ and ΓÇ£application management.ΓÇ¥ As written, W2 either fails or absorbs import, codebase, export, project, and history work into a phase that only budgets `edit` and a proposal panel.

**Fix**
Create a formal command inventory (`GUI command ΓåÆ MCP tool / explicit omission`) and scope W2 parity to document mutation commands. Put import/codebase/export/history parity in explicit later grains, or narrow founder contract #4. Use that inventory as the A-04 oracle.

---

## 4. [Blocker] The installed desktopΓÇÖs offline guarantee is not enforced or observable at the main-process boundary

**Evidence**
- `D:\Ninerr-EGM-Plan\docs\designs\NINERR_DESKTOP_AGENT_NATIVE_EGM_SPEC_2026-11-06.md:12` ΓÇö all non-loopback network access must be blocked.
- `:16` ΓÇö in strict Offline Mode, all non-loopback traffic must be blocked, including optional providers, update checks, analytics, and web fonts.
- `:165` ΓÇö A-02 claims a network trap on J1/J2/J4/J5/J7 and ΓÇ£zero non-loopback packetsΓÇ¥.
- `D:\Ninerr-EGM-Plan\packages\desktop\src\main.mjs:44-73` ΓÇö the desktop hardening blocks the **rendererΓÇÖs** requests via `session.defaultSession.webRequest`.
- `D:\Ninerr-EGM-Plan\docs\DESKTOP.md:64` ΓÇö explicitly: ΓÇ£the desktop smoke test does not watch the main processΓÇÖs own connections.ΓÇ¥
- `D:\Ninerr-EGM-Plan\packages\network-policy\src\policy.ts:33-35` ΓÇö the default policy is offline, but there is no global Offline Mode setting or single main-process egress gate.
- The host, imports, providers, and any future updater run in the main process, outside the renderer filter.

**Simplicity rationale**
The strongest founder promise ΓÇö ΓÇ£all non-loopback traffic blockedΓÇ¥ ΓÇö is tested exactly where it is easiest, in the renderer, and not where the privileged code lives. A source-level policy that each caller must remember to invoke is not an offline guarantee.

**Fix**
Add one main-process egress chokepoint: every `fetch`/`net`/provider/import/update call goes through `network-policy`, with an explicit Offline Mode that denies everything but loopback. Add A-02 proof at the OS/firewall level on the packaged app, including main-process connections, with a negative control that a provider call is denied.

---

## 5. [Blocker] J2ΓÇÖs ΓÇ£undo ΓåÆ redoΓÇ¥ of an agent transaction is not supported by current history semantics

**Evidence**
- `D:\Ninerr-EGM-Plan\docs\designs\NINERR_DESKTOP_AGENT_NATIVE_EGM_SPEC_2026-11-06.md:28` ΓÇö J2: apply one agent transaction, then ΓÇ£undo -> redo -> reopenΓÇ¥.
- `D:\Ninerr-EGM-Plan\packages\studio-host\src\session.ts:334-347` ΓÇö a person can only `revert` an agentΓÇÖs **latest** change; `revert` commits the inverse as the personΓÇÖs change, pushes it onto the personΓÇÖs undo stack, and deletes the personΓÇÖs redo stack.
- `D:\Ninerr-EGM-Plan\packages\studio-host\src\session.ts:317-325` ΓÇö `redo` re-applies the entryΓÇÖs `operations`, which after a revert is the agentΓÇÖs inverse, not the agentΓÇÖs original change.
- `D:\Ninerr-EGM-Plan\packages\mcp-protocol\src\tools.mjs:9-26` ΓÇö there is no MCP undo/redo tool.

**Simplicity rationale**
The acceptance test assumes a reversible agent transaction with person-visible redo. Current semantics offer ΓÇ£Undo agent changeΓÇ¥ (a revert) and no way to redo that agent change. The plan needs a concrete reapply/redo model rather than relying on existing undo stacks.

**Fix**
Define the expected sequence explicitly. Either add a reapply/redo path for a reverted agent transaction, or change J2 to ΓÇ£revert, then reapplyΓÇ¥ and name the control. Add tests for human/agent interleavings, including a later human edit inside the reverted range.

---

## 6. [Major] Skilit has no defined offline data path; the plan forbids the only stated source of Skilit data

**Evidence**
- `D:\Ninerr-EGM-Plan\docs\designs\NINERR_DESKTOP_AGENT_NATIVE_EGM_SPEC_2026-11-06.md:127-132` ΓÇö W4 assumes imported read-only reference packs, rights metadata, and golden migration tests.
- `:74` ΓÇö ADR-D3 forbids requiring PostgreSQL, Redis, pgvector, S3/R2, a hosted crawler, or login.
- `D:\Ninerr-EGM-Plan\docs\strategy\NINERR_SKILIT_FOUNDATION_2026-11-06.md:40` ΓÇö SkilitΓÇÖs existing PostgreSQL and object storage ΓÇ£may remain as internal backing providers during migration.ΓÇ¥
- `:172` ΓÇö A-09 requires a pack with 1,000 rights-varied references and four research flows.
- W4 never says who produces/exports a pack, from which pinned Skilit schema, how updates arrive offline, or how a packΓÇÖs rights are verified. The Skilit repository is not in this checkout.

**Simplicity rationale**
ΓÇ£Read-only local packsΓÇ¥ is a new ETL and distribution product. Without a producer and a pinned schema, W4 is speculative and can either force a hosted Skilit dependency or create a second local store. A-09 cannot be assessed from the available evidence.

**Fix**
Add an M0/M1 deliverable: a versioned pack schema, a build-time exporter from a pinned Skilit commit, a fixture pack with rights/provenance, an update/verification policy, and a runtime contract that never contacts Skilit. Reconcile ADR-D3 with strategy line 40. Defer A-09 until a real pack and fixture exist.

---

## 7. [Major] Two plans now claim authority, and they disagree on MCP, migration, and ordering

**Evidence**
- `D:\Ninerr-EGM-Plan\docs\designs\NINERR_DESKTOP_AGENT_NATIVE_EGM_SPEC_2026-11-06.md:115` ΓÇö W2.1 describes a new MCP `edit` tool with `baseRevision`, idempotency, `dryRun`, warnings, and operation hashes.
- `D:\Ninerr-EGM-Plan\packages\studio-host\src\session.ts:280-302` ΓÇö the existing `session.edit` already enforces `baseRevision` and `stale-revision`.
- `D:\Ninerr-EGM-Plan\packages\studio-host\src\mcp.ts:592` ΓÇö MCP currently overwrites the agentΓÇÖs revision with `session.revision`; the fix is to pass/validate the agentΓÇÖs `baseRevision`, not to invent a new tool.
- `D:\Ninerr-EGM-Plan\docs\design-platform\AGENT_CONTRACT.md:33-80` ΓÇö already defines per-write-tool fields plus `apply_operations`, `propose_change`, `outline`, `computed_styles`, and argument-aware classification.
- `D:\Ninerr-EGM-Plan\docs\design-platform\adr\0003-schema-v2.md:6-9` ΓÇö v2 is a lazy upgrade; a v1 build refuses a v2 project.
- Target `:71` ΓÇö ADR-D2 demands ΓÇ£reversible migration testing,ΓÇ¥ which conflicts with ADR-0003 unless ΓÇ£reversibleΓÇ¥ means only undoing the first v2 edit.
- Target `:151-156` ΓÇö the dependency graph has no `W3.2/W3.3 ΓåÆ W4.5` edge, although W4.5 applies tokens/components that W3.2/W3.3 build.
- Target `:2` says founder direction is ΓÇ£binding,ΓÇ¥ while `NINERR_SKILIT_FOUNDATION_2026-11-06.md:3` says ΓÇ£implementation proposal pending exact-head reviewΓÇ¥ and `docs/design-platform/adr/0001-extension-is-a-proposal.md:6-8` says none starts before founder approval.

**Simplicity rationale**
A generic `edit` tool would duplicate or bypass the static per-tool authorization classes and the detailed contract already reviewed in `AGENT_CONTRACT.md`. ΓÇ£Reversible migrationΓÇ¥ is not testable as written against a forward-only v2 design. Duplicate plan authority makes it unclear which document an implementer must follow.

**Fix**
Make `AGENT_CONTRACT.md` + `PLAN.md` + ADR-0003 the single implementation source. Rewrite W2.1 as ΓÇ£extend the seven existing write tools and add `apply_operations`/`propose_change`ΓÇ¥; do not add a generic `edit` tool. Remove ΓÇ£reversibleΓÇ¥ or define downgrade semantics and tests. Add `W3.2/W3.3 ΓåÆ W4.5` edges. Record an explicit founder approval for W2ΓÇôW6, or label the target as a proposal.

---

## 8. [Major] J4/A-08 require Astro round-trip, but there is no Astro adapter

**Evidence**
- `D:\Ninerr-EGM-Plan\docs\designs\NINERR_DESKTOP_AGENT_NATIVE_EGM_SPEC_2026-11-06.md:30` ΓÇö J4: ΓÇ£link authorized local React/JSX or Astro project.ΓÇ¥
- `:171` ΓÇö A-08: ΓÇ£JSX + Astro and external edit.ΓÇ¥
- `:121` ΓÇö W3.1: ΓÇ£preserve CSS/React/Astro unsupported source unchanged.ΓÇ¥
- `D:\Ninerr-EGM-Plan\packages\architecture\src\catalog.ts:118-130` ΓÇö code IR and round-trip sync are bounded to JSX/TSX, CSS, and Tailwind.
- `D:\Ninerr-EGM-Plan\packages\design-assurance\src\index.mjs:49` ΓÇö `.astro` appears only as an allowlisted file extension, not as an import/edit adapter.

**Simplicity rationale**
ΓÇ£Preserve unsupported Astro sourceΓÇ¥ is not the same as ΓÇ£import an Astro component, edit it, and write it back.ΓÇ¥ The acceptance test assumes a parser and patch path that do not exist.

**Fix**
Add an explicit Astro adapter grain with fixtures and write-back tests, or narrow J4/A-08 to JSX/TSX and mark Astro as UNKNOWN/deferred. Do not claim Astro round-trip until a source diff is demonstrated.

---

## 9. [Major] W3ΓÇôW6 over-scope the plan and have no estimates, release vehicle, or assigned Build Kits/Design Intelligence work

**Evidence**
- `D:\Ninerr-EGM-Plan\docs\designs\NINERR_DESKTOP_AGENT_NATIVE_EGM_SPEC_2026-11-06.md:120-147` ΓÇö W3 bundles P12ΓÇôP14 (layout, tokens, components); W5 bundles P15ΓÇôP16 (AI creation, vectors, prototyping, export); W6 adds polished UI and a 24-task benchmark.
- `D:\Ninerr-EGM-Plan\docs\design-platform\PLAN.md` at `16f9d0f` estimates P11ΓÇôP16 alone at roughly **139ΓÇô204 engineer-days** for one engineer and agent pair, with task-level dependencies.
- Target `:112` preserves the v1.0.0 release gate after W1; W2ΓÇôW6 then have no version/milestone, even though target `:14` calls agent parity and Skilit hard requirements.
- Target `:18` requires ΓÇ£Research, Lens, Assets, Design Intelligence and Build KitsΓÇ¥; W4 (`:126-133`) covers Research/Assets/Flow/Patterns/Lens but has **no Build Kits task**, and ΓÇ£Design IntelligenceΓÇ¥ is never defined. W6.1ΓÇÖs UI list (`:143`) also omits Build Kits.

**Simplicity rationale**
A professional editor, Skilit intelligence, vector/prototyping, a polished UI, and a 24-task competitive benchmark are presented as a handful of bullets. The detailed plan shows they are 30ΓÇô40 tasks. Without estimates or a release vehicle, the ΓÇ£delivery planΓÇ¥ cannot be scheduled or reviewed for feasibility, and the desktop/MCP core is at risk of being buried.

**Fix**
Adopt the task-level breakdown and estimates from `PLAN.md`; define a v2 milestone after v1.0.0. Split W3 and W5 into the P12ΓÇôP16 tasks. Explicitly defer vectors/prototyping/benchmark or gate them by founder approval. Add Build Kits and Design Intelligence grains, or mark them deferred with a recorded decision.

---

## 10. [Major] The plan ignores existing reusable machinery and proposes new capture, storage, search, and provider stacks

**Evidence**
- Target `:128` proposes ΓÇ£manifest + local content-addressed filesΓÇ¥ and optional SQLite FTS5; `:130`/`:83` propose a sandboxed local capture worker; `:74` proposes `ninerr-ref://` URIs.
- Existing reuse candidates:
  - `D:\Ninerr-EGM-Plan\packages\import-stack\src\network.ts:32-77` ΓÇö URL validation, private/loopback rejection, DNS-rebinding checks.
  - `D:\Ninerr-EGM-Plan\packages\import-stack\src\security.ts` ΓÇö sanitization and URL/authority rules.
  - `D:\Ninerr-EGM-Plan\packages\import-stack\src\assets.ts:6-30` and `ledger.ts` ΓÇö content-addressed assets and request/import ledgers.
  - `D:\Ninerr-EGM-Plan\packages\persistence\src\store.ts:1026-1038` ΓÇö existing `putObject`/`getObject` content-addressed store.
  - `D:\Ninerr-EGM-Plan\packages\network-policy\src\providers.ts:130-152` ΓÇö existing provider registry and offline/loopback/remote resolution.
  - `D:\Ninerr-EGM-Plan\packages\agent-supervisor\README.md:50-54` ΓÇö existing local-process supervision.
  - `D:\Ninerr-EGM-Plan\tests\web-mode.test.mjs:108` and `scripts\smoke.mjs` ΓÇö existing offline smoke including an agent over stdio.
  - `D:\Ninerr-EGM-Plan\docs\design-platform\REUSE.md:14-30` ΓÇö already maps P11ΓÇôP16 reuse in detail.
- Target `:106` proposes a new deterministic offline smoke for core desktop without citing the existing `tests/offline-guarantee.test.mjs` / web-mode smoke.

**Simplicity rationale**
The plan reinvents SSRF protection, content addressing, provenance ledgers, provider selection, and offline smoke that already exist and have tests. A new capture worker also adds a second browser/process and packaging burden, and SQLite FTS5 is unnecessary at the 1,000-reference scale until measured. This is exactly the ΓÇ£new machinery before reuseΓÇ¥ failure the Zoom-Out standard warns about.

**Fix**
Map each W4 component to an existing module: import-stack for capture/SSRF/provenance, `store.putObject` for packs, `resolveProvider` for local providers, and existing offline tests for W0.3. Reuse `REUSE.md` as the starting map. Defer SQLite/FTS5 and embeddings until a measured bottleneck exists, and make `ninerr-ref://` a pure identifier rather than a new transport. Remove the new capture worker unless a concrete gap in import-stack is demonstrated.

---

**Overall gate view:** findings 1ΓÇô5 are release/acceptance blockers; findings 6ΓÇô10 are plan-authority, feasibility, and scope issues. The first four should be resolved before any W2/W3 implementation is scheduled: they determine whether the installed-app offline/MCP promise and the J1/J2 acceptance tests are real.
