## Findings

### 1. Blocker ΓÇö Authorization and exact-head ambiguity
**Scope:** `D:\Ninerr-EGM-Plan\docs\designs\NINERR_DESKTOP_AGENT_NATIVE_EGM_SPEC_2026-11-06.md` lines 5ΓÇô6, 101, 114ΓÇô140, 183ΓÇô186; `D:\Ninerr-EGM-Plan\docs\design-platform\README.md` lines 3, 7; `D:\Ninerr-EGM-Plan\docs\design-platform\adr\0001-extension-is-a-proposal.md` line 6; `D:\Ninerr-EGM-Plan\docs\CURRENT.md` line 50.

**Finding:** The spec cites `docs/design-platform/PLAN.md` ΓÇ£from unmerged PR #359ΓÇ¥ (line 6), but that file is absent at HEAD; `README.md` line 14 still links to it. The spec names base `25145f2` (line 5), ΓÇ£Ninerr main `8cba15c`ΓÇ¥ (line 183), while `CURRENT.md` names canonical main `1987c77` (line 50). I verified `8cba15c` is an ancestor of `25145f2`, so these are different review bases. More importantly, `README.md` lines 3/7 and ADR-0001 line 6 say P11ΓÇôP16 are unapproved and ΓÇ£nothing here is authorized for implementation,ΓÇ¥ while W2ΓÇôW5 treat them as scheduled work. Line 185 admits the skill review has not run.

**Required change:** Add one `baseSha`, one `designHeadSha`, and the merge/rebase rule. Inline the missing PLAN.md task detail or attach its exact reviewed revision. Record explicit founder approval for each of P11ΓÇôP16, or mark W2ΓÇôW5 conditional and stop at W0/W1. Add per-grain file lists and PR bases so an implementer does not choose scope.

### 2. Blocker ΓÇö J1/J4 exit criteria are scheduled before their enabling work
**Scope:** Spec lines 27, 30, 121, 124, 137; `D:\Ninerr-EGM-Plan\packages\studio-host\src\server.ts` line 298; `D:\Ninerr-EGM-Plan\packages\studio-web\src\app.mjs` lines 465ΓÇô521; `D:\Ninerr-EGM-Plan\packages\studio-host\src\codebase.ts` lines 216, 1002.

**Finding:** J1 requires SVG/PNG/PDF export (line 27), and W3 exit requires J1 to pass (line 124), but the only item delivering those exports is W5.2 (line 137). The current host exposes only `/api/code/export` for JSX (`server.ts` line 298), and the UI shows only JSX/CSS (`app.mjs` lines 465ΓÇô521); no PDF/SVG/PNG exporter exists. J4 requires an Astro project (line 30), but W3.1 only says to preserve Astro source unchanged (line 121), and the codebase scanner accepts only `.js`, `.jsx`, `.tsx` (`codebase.ts` lines 216, 1002). There is no Astro adapter.

**Required change:** Move image/vector export into W3 or W1, with a named export module, exact renderer API, font/color/page rules, and tests. Add an Astro adapter and fixtures to W3, or change J4 to JSX-only and move Astro to a separately gated later item. Update the dependency graph so no exit gate depends on a later work item.

### 3. Blocker ΓÇö ΓÇ£Offline ModeΓÇ¥ has no enforcement design
**Scope:** Spec lines 12, 16, 27, 31ΓÇô33, 95, 165; `D:\Ninerr-EGM-Plan\packages\desktop\src\main.mjs` lines 44ΓÇô61; `D:\Ninerr-EGM-Plan\packages\desktop\src\policy.mjs` lines 31ΓÇô41; `D:\Ninerr-EGM-Plan\packages\network-policy\src\types.ts` lines 13ΓÇô14; `D:\Ninerr-EGM-Plan\packages\network-policy\src\readiness.ts` lines 11ΓÇô23; `D:\Ninerr-EGM-Plan\tests\offline-guarantee.test.mjs` lines 12ΓÇô61, 83ΓÇô120.

**Finding:** The desktop hardens only ElectronΓÇÖs `defaultSession` (`main.mjs` lines 44ΓÇô61; `policy.mjs` lines 31ΓÇô41); main-process `fetch`, provider calls, Lens work, or any new session are outside that guard. `@ninerr/network-policy` defines `offline` as ΓÇ£no network and no loopbackΓÇ¥ and `local-only` as loopback-only (`types.ts` line 13), but the spec never maps ΓÇ£Offline ModeΓÇ¥ to `local-only` or states that the studio host/MCP are the intended loopback exception. `CORE_FEATURES` omits local MCP, and its comment says MCP is not implemented (`readiness.ts` lines 11ΓÇô12), while `docs/MCP.md` says it is. `offline-guarantee.test.mjs` traps Node primitives but never runs the studio host, MCP, desktop shell, or export.

**Required change:** Define one egress broker used by every main-process network path. Explicitly map Offline Mode to `local-only` (or equivalent) with MCP/host exceptions. Add `mcp.local`, `export.local`, and `lens.offline` to `CORE_FEATURES`. Add Electron-main and packaged-app tests with a packet sink, plus mode-state persistence, UI indication, transition tests, and tests proving no updater, telemetry, font, provider, or analytics request occurs.

### 4. Blocker ΓÇö MCP credential model contradicts founder requirement 4 and existing code
**Scope:** Spec lines 14, 77; `D:\Ninerr-EGM-Plan\scripts\ninerr-mcp.mjs` lines 2ΓÇô9, 25ΓÇô30; `D:\Ninerr-EGM-Plan\docs\MCP.md` lines 17ΓÇô20, 49; `D:\Ninerr-EGM-Plan\packages\studio-host\src\agents.ts` lines 9ΓÇô13, 131ΓÇô160; `D:\Ninerr-EGM-Plan\packages\studio-host\src\relay.ts` lines 7ΓÇô11, 57ΓÇô68.

**Finding:** Requirement 4 says a local agent must work ΓÇ£without copying secretsΓÇ¥ (line 14), and ADR-D4 requires ΓÇ£short-lived, per-workspaceΓÇ¥ tokens (line 77). The current stdio relay requires the user to set `NINERR_MCP_TOKEN` in the MCP client configuration (`scripts/ninerr-mcp.mjs` lines 2ΓÇô9, 25ΓÇô30; `MCP.md` lines 17ΓÇô20). Agent credentials are long-lived, persisted across launches by hash (`agents.ts` lines 9ΓÇô13, 131ΓÇô160), and multiple clients may share one agent credential (`MCP.md` line 49). Loopback binding itself is already correct (`server.ts` lines 401ΓÇô403, 507; `relay.ts` lines 57ΓÇô68); the gap is identity and secret handling.

**Required change:** Choose one model and write it down: either an OS-keychain credential plus a local handshake that mints a short-lived per-session token, or amend requirement 4/ADR-D4 to permit the current long-lived per-agent bearer. Add per-client identity, rotation, revocation, refresh/offline behavior, and a test proving stdio works without pasting a secret.

### 5. Blocker ΓÇö J2ΓÇÖs undoΓåÆredo of an agent change cannot work as written
**Scope:** Spec lines 28, 116, 167, 173; `D:\Ninerr-EGM-Plan\packages\studio-host\src\session.ts` lines 299ΓÇô325, 334ΓÇô347; `D:\Ninerr-EGM-Plan\packages\studio-web\src\app.mjs` lines 1106ΓÇô1115, 1810ΓÇô1819.

**Finding:** Undo and redo stacks are per actor (`session.ts` lines 299ΓÇô325). ΓÇ£Undo agent changeΓÇ¥ calls `/api/revert` (`app.mjs` lines 1106ΓÇô1109), and `revert` commits an inverse transaction but never pushes a redo entry (`session.ts` lines 334ΓÇô347). Therefore J2ΓÇÖs sequence ΓÇ£apply as one attributed transaction ΓåÆ undo ΓåÆ redoΓÇ¥ cannot be satisfied for an agent transaction as specified.

**Required change:** Either define J2 as ΓÇ£Undo agent changeΓÇ¥ followed by re-application from history, or implement redo of a revert as a linked transaction. Specify stack behavior, conflict rules, and tests for human/agent interleavings; align A-04 and A-10 with the chosen semantics.

### 6. Blocker ΓÇö W2 contract is underspecified and names a tool that does not exist
**Scope:** Spec lines 115ΓÇô118; `D:\Ninerr-EGM-Plan\packages\mcp-protocol\src\tools.mjs` lines 9ΓÇô26; `D:\Ninerr-EGM-Plan\docs\MCP.md` lines 26ΓÇô35; `D:\Ninerr-EGM-Plan\docs\design-platform\AGENT_CONTRACT.md` lines 35ΓÇô66, 68ΓÇô79.

**Finding:** W2.1 says ΓÇ£MCP `edit`ΓÇ¥ (line 115), but the catalog has 16 tools and no `edit` (`tools.mjs` lines 9ΓÇô26; `MCP.md` lines 26ΓÇô35). `AGENT_CONTRACT.md` proposes `apply_operations`, `propose_change`, `outline`, `computed_styles`, `layer_image`, `align_layers`, `design_system`, and `search_design_system` (lines 68ΓÇô79), and fixes `fromDryRun`, a 5-minute `dryRunToken`, 10-minute/1,000-entry `requestId` retention, typed errors, and unknown-argument behavior (lines 35ΓÇô66). The spec omits these and leaves operation hashing, accept semantics, and retention to the implementer.

**Required change:** Name the exact tools. Make AGENT_CONTRACT v2 normative or inline its schema, limits, and error codes into the spec. Add a GUI-commandΓåÆMCP-tool parity matrix. Define the dry-run/accept/commit protocol, canonical operation hash, and tests for stale revisions, idempotency, unknown arguments, and approval binding.

### 7. Blocker ΓÇö Skilit reference-pack storage is a sketch, not an implementable format
**Scope:** Spec lines 73ΓÇô74, 128, 172; `D:\Ninerr-EGM-Plan\docs\strategy\NINERR_SKILIT_FOUNDATION_2026-11-06.md` lines 30ΓÇô48.

**Finding:** ADR-D3 says ΓÇ£manifest + local content-addressed files,ΓÇ¥ with SQLite/FTS5 ΓÇ£optional ΓÇª if measured need justifies itΓÇ¥ (line 74), repeated at W4.2 (line 128). There is no manifest schema, hash algorithm, URI grammar, directory layout, pack version, entry/size limit, atomic install/rollback, integrity verification, garbage collection, or decision on the index. A-09 assumes a 1,000-rights-varied-ref fixture (line 172) that does not exist. No Skilit source or schema is present in this workspace; only the strategy document is available.

**Required change:** Freeze a v1 pack manifest JSON schema and a `ninerr-ref://<namespace>/<type>/<id>` grammar. Specify SHA-256 content addressing, path layout, size/entry limits, traversal/symlink/zip-bomb rules, atomic install and rollback, integrity checks, and GC. Decide FTS5 in or out now; do not leave it to ΓÇ£measured need.ΓÇ¥ Add fixtures and integrity tests, plus the exact Skilit export contract from issue #189.

### 8. Blocker ΓÇö Rights and source permissions have no enforcement gate
**Scope:** Spec lines 19, 94, 104, 127, 172, 176; `D:\Ninerr-EGM-Plan\docs\strategy\FOUNDER_SOURCE_AUTHORIZATION_2026-11-06.md` lines 8, 14, 31; `D:\Ninerr-EGM-Plan\packages\design-method\src\types.ts` lines 95ΓÇô103.

**Finding:** Requirement 9 and the threat list require a rights ledger, but W0.1 uses the placeholder `docs/evidence/.../SOURCE_LEDGER.md` (line 104), W4.1 only says ΓÇ£code rightsΓÇ¥ (line 127), and A-13 covers packaging license, not per-asset export/redistribution. The founder authorization document itself says the permission is an assertion, not independently verified, and proprietary copies must stay private until written scope is verified (`FOUNDER_SOURCE_AUTHORIZATION...` lines 8, 14, 31). Existing `ResourceEntry.license` is a free-form string (`design-method/src/types.ts` lines 95ΓÇô103), insufficient for a gate.

**Required change:** Define `RIGHTS_LEDGER.json` with source, SPDX/license expression, scope, evidence URL, `verifiedBy`/`verifiedAt`, and explicit `allowedLocal`, `allowedExport`, `allowedRedistribute` flags. Make export and sample-bundle builds fail closed without a decision. Add a test that restricted IDs never export. Require W0.1 ledger evidence before W4.2 starts.

### 9. Blocker ΓÇö The threat model is a category list; the no-founder-compute gate is a grep
**Scope:** Spec lines 88ΓÇô97, 166, 168; `D:\Ninerr-EGM-Plan\docs\MASTER_PLAN.md` line 31; `D:\Ninerr-EGM-Plan\packages\import-stack\src\docling.ts` lines 1, 36ΓÇô42; `D:\Ninerr-EGM-Plan\docs\evidence\P08_G5_SOAK_2026-10-10.md` line 101; `D:\Ninerr-EGM-Plan\packages\network-policy\src\types.ts` lines 68ΓÇô83.

**Finding:** ┬º3 lists attack categories but no assets, actors, trust boundaries, controls, residual risks, or test mapping. Missing from the model: pack traversal/zip bombs/symlinks; prompt injection from pack text or tool output; provider credential storage and redaction; the Lens process model; update checks; and export path policy. ADR-D6 says a ΓÇ£local capture worker must be sandboxedΓÇ¥ (line 83), but no process model is chosen; any child process conflicts with `MASTER_PLAN.md` line 31 (ΓÇ£no-child-process rule standsΓÇ¥). `import-stack` already spawns Docling (`docling.ts` lines 1, 36ΓÇô42), though the host does not reach it (`P08_G5` line 101). A-03 relies on ΓÇ£source grepΓÇ¥ and a ΓÇ£deployment manifestΓÇ¥ (line 166) that does not exist. The no-founder-cloud intent is correct, but the proof is not a gate.

**Required change:** Add a threat table with asset, actor, boundary, control, test, and residual risk per row. Decide the Lens process model (utility process, separate app, or worker) and record any founder exception to the no-child-process rule. Specify pack parser limits, prompt-injection handling, and secret storage via `CREDENTIAL_STORES` (`network-policy/src/types.ts` lines 68ΓÇô83). Replace A-03 with a dependency/endpoint allowlist scan plus a packaged blocked-network E2E test proving J1/J2 need no account, API key, or founder service.

### 10. Major ΓÇö J3 has no model-provider work item or contract
**Scope:** Spec lines 29, 79ΓÇô80, 136; `D:\Ninerr-EGM-Plan\packages\network-policy\src\types.ts` lines 62ΓÇô83; `D:\Ninerr-EGM-Plan\packages\network-policy\src\providers.ts` lines 138ΓÇô152.

**Finding:** ADR-D5 says Ninerr ΓÇ£may control a userΓÇÖs local model processΓÇ¥ (line 80), and W5.1 says prompt-driven editing runs through an external MCP caller or user-local LLM (line 136). There is no provider interface, endpoint validation, consent/egress list, request/token/time limit, cancellation, streaming/tool-call schema, or data-scope rule. J3 is an acceptance test (line 29) with no implementing task. `@ninerr/network-policy` already has `ProviderDescriptor`, `credentialRef`, `local-process`, and `loopback-http` (`types.ts` lines 62ΓÇô83; `providers.ts` lines 138ΓÇô152), but the spec does not bind to it.

**Required change:** Add a W-item using that provider registry. Allow only loopback endpoints, or an explicit allowlisted remote endpoint with consent and an egress list. Define request limits, cancellation, data scope, and secret storage. Test J3 with a stub local endpoint and with a refused connection, and state whether Ninerr ever spawns a model process.

### 11. Blocker ΓÇö Migration is version-confused and ΓÇ£reversibleΓÇ¥ is undefined
**Scope:** Spec lines 71, 122, 169; `D:\Ninerr-EGM-Plan\packages\document-model\src\index.mjs` line 1; `D:\Ninerr-EGM-Plan\packages\persistence\src\types.ts` line 3; `D:\Ninerr-EGM-Plan\packages\persistence\src\migrations.ts` lines 12ΓÇô17; `D:\Ninerr-EGM-Plan\packages\persistence\src\store.ts` lines 137ΓÇô142; `D:\Ninerr-EGM-Plan\tests\migration-compatibility.test.mjs` lines 24ΓÇô32.

**Finding:** ADR-D2 and W3.2 speak of ΓÇ£schema v2 tokens and instancesΓÇ¥ and ΓÇ£reversible migration testingΓÇ¥ (lines 71, 122), and A-06 says ΓÇ£bitwise or semantic equality according to declared fieldsΓÇ¥ (line 169). But there are three versions: document schema `1` (`document-model/src/index.mjs` line 1), project schema `3` (`persistence/src/types.ts` line 3), and journal format/segments (`migrations.ts` lines 12ΓÇô17). `store.ts` lines 137ΓÇô142 rejects newer document schemas. The spec never says which version changes, how v1 and v2 documents coexist, how an older build refuses a v2 document without modifying it, or whether ΓÇ£reversibleΓÇ¥ means an undoable upgrade transaction or a downgrade. Existing migration tests cover schema 2ΓåÆ3 and newer-version refusal (`migration-compatibility.test.mjs` lines 24ΓÇô32), not v2 tokens/instances.

**Required change:** Add a version matrix covering document, project, journal, and renderer schema. Give exact per-file migration steps, the lazy-upgrade transaction, downgrade refusal/no-write rules, backup/recovery behavior, and new corpus fixtures for v2 tokens/instances. Define a per-field semantic-equivalence oracle and state precisely what ΓÇ£reversibleΓÇ¥ means.

### 12. Major ΓÇö Performance and test gates are not executable as written
**Scope:** Spec lines 162ΓÇô176, 124, 186; `D:\Ninerr-EGM-Plan\docs\design-platform\ARCHITECTURE.md` lines 142ΓÇô161; `D:\Ninerr-EGM-Plan\docs\evidence\P08_G4_SCALE_2026-10-10.md` lines 9ΓÇô23, 77ΓÇô93; `D:\Ninerr-EGM-Plan\docs\evidence\P08_G4_REMEASURE_2026-10-13.md` lines 18ΓÇô21; `D:\Ninerr-EGM-Plan\docs\strategy\REA_TOOL_PREFLIGHT_2026-11-06.md` lines 28ΓÇô31.

**Finding:** A-11 says ΓÇ£existing P08/P10 reference budgets or document strictly supported limitsΓÇ¥ (line 174), and W3 exit says ΓÇ£stated reference budgetsΓÇ¥ (line 124), but the spec does not state the new-feature budgets. `ARCHITECTURE.md` proposes six budgets (lines 152ΓÇô161) and says none is measured. The existing scale fixture is flat cards (`P08_G4_SCALE` lines 9ΓÇô23), not components, tokens, instances, or Skilit packs. A-02, A-05, A-07, A-12, and A-13 use undefined tools, tolerances, or fixtures; A-12 depends on the blocked REA preflight (`REA_TOOL_PREFLIGHT` lines 28ΓÇô31). Line 186 admits tests are planning text only.

**Required change:** Copy the six architecture budgets into W3/W4 and A-11, and add Skilit pack/index plus v2 reopen/migration budgets. Name fixture generators, test files, and pass conditions. Use the #275 reference-machine five-run protocol (`MASTER_PLAN.md` line 30). Define pixel tolerance and the adversarial suite. Make A-03 a real dependency/endpoint test rather than a grep. Mark A-12 evidence-blocked and off the critical path until the REA blocker is cleared.

## Readiness verdict

**NOT READY FOR IMPLEMENTATION.** The direction is architecturally credible and correctly rejects a founder-operated cloud, but this document does not meet the implementation-readiness standardΓÇÖs zero-decision rule: it leaves authorization scope, offline enforcement, MCP identity, export/Astro capability, migration versioning, rights enforcement, Skilit pack format, and performance/test oracles unresolved. Ten blockers and two majors require revision before any W2ΓÇôW6 implementation grain is opened. W0.1/W0.3 preflight may continue only as evidence gathering, not as implementation authorization.
