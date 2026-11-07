Stage 09, Implementation Readiness. Reviewer: `opencode/pulse-alpha-free`, agent `explore`, fresh read-only context, persona `egm/agents/implementation_readiness.md`, 2026-11-06, against head ee3318d of this branch. Text below is the model's report, unedited. It is not execution evidence. Dispositions are in `EGM_08_09_DISPOSITIONS_2026-11-06.md`.

## Findings, ranked by severity

### 1. BLOCKER — R01 orders work on a test file that does not exist (CONFIRMED)
**Document:** `NINERR_EXECUTION_READY_MASTER_PLAN_2026-11-06.md`, §3 Track R, task **R01**; and board task id **R01** (`tests: ["tests/text-layers.test.mjs", "tests/code-workflow.test.mjs"]`).
**Problem:** R01 says "Modify tests/text-layers.test.mjs and existing code workflow tests." `tests/text-layers.test.mjs` does not exist in the repository. The board repeats the same path as a named test. The engineer cannot "modify" a file that is absent, and must decide whether to create it, rename it, or attach the six required regression tests (simple expression, mixed text/children, literal escaped braces, malformed code source, no-op export, edit+reimport) to a different file.
**Exact correction:** Replace `tests/text-layers.test.mjs` with the actual owning test file. R01's regression set belongs with the existing `tests/code-workflow.test.mjs` and the text-layer tests currently in the suite; the plan must name the real file(s) (e.g. `tests/code-workflow.test.mjs` plus the existing text-layer test) and state whether new cases are appended or a new file is created, before R01 is executable.

### 2. BLOCKER — Master plan and board both cite `reference-packs.mjs` / `design-graph-reference-adapter` / `reference-pack-file.ts` as existing ("qualify existing") but none exist in this worktree (CONFIRMED)
**Document:** Master plan §2.6, §4, §7.2, §8 readiness line ("For #365/#367 only, also run the available reference-packs, design-graph-reference-adapter and reference-pack-file Node tests. All three file-level targeted test files do not exist on plain main."); board tasks **M01** (`tests/reference-packs.test.mjs`, `tests/design-graph-reference-adapter.test.mjs`) and **M02** (`tests/reference-pack-file.test.mjs`).
**Problem:** I searched the whole tree: `packages/import-stack/src/reference-packs.mjs`, `packages/import-stack/src/design-graph-reference-adapter.mjs`, `packages/import-stack/src/reference-pack-file.ts`, `tests/reference-packs.test.mjs`, `tests/design-graph-reference-adapter.test.mjs`, `tests/reference-pack-file.test.mjs` — **none exist**. The master plan §4 states "This is fixed by the current Draft #365 source. An implementer MUST NOT create another incompatible v1," and M01 is titled "Qualify **existing** PR #365." A fresh engineer on this worktree cannot qualify code that is not present. The plan never says the engineer must first fetch/check out the PR #365/#367 heads, and the exact wire contract in §4 is the only available source of truth. This is precisely the "new architectural decision" the test forbids: the engineer must decide whether to reconstruct the schema from §4 or wait for the PR branch.
**Exact correction:** Either (a) state explicitly in R/M01/M02 that the owning PR heads for #365/#367 must be checked out at the named SHAs before work begins (the plan already asserts these are drafts), or (b) inline the full field/limit/ID grammar into the task as the authoritative contract and rename M01/M02 from "qualify existing" to "implement to this contract." As written, the paths and test filenames in §4/§8 and the board are non-existent and un-actionable.

### 3. MAJOR — Board and plan disagree on `identity census` command, leaving the exact release command ambiguous (CONFIRMED)
**Document:** Master plan §6 (exact PR worktree commands: `node scripts/identity-census.mjs --verify`); board **R05** (`"identity census --check"`) and **M02** (`"identity census --check"`).
**Problem:** The master plan's exact invocation is `--verify`; the board uses `--check`. An engineer executing R05/M02 has two different flag names for the mandatory gate and no way to know which the gate enforces.
**Exact correction:** Make the flag identical in both documents. If the script supports only one flag, the other is wrong; state the single canonical invocation (per the script's actual argument parsing) in both the board and the plan.

### 4. MAJOR — `@ninerr/network-policy` has no `local-only` **offline feature set** registration described, and the "offline mode" design is left half-converted (CONFIRMED)
**Document:** Spec §3 ADR-D8 and §7.2 ("Strict Offline Mode maps to `local-only` … Add `mcp.local`, `export.local` and `lens.offline` to `CORE_FEATURES` when they exist"); master plan R04 ("Offline mode permits only the explicitly allowed loopback host/MCP").
**Problem:** I read `packages/network-policy/src/policy.ts`, `readiness.ts`, `types.ts`. Modes are `["offline","local-only","allowlist"]` and default policy is `mode: "offline"` (no loopback). `CORE_FEATURES` currently lists only `document.edit`, `history.undo-redo`, `collaboration.agent-edit`, `project.save-reopen`, `design.method-review`, `decision.assurance`, `import.offline-html`, `decision.model-ranking`, and states "the local MCP endpoint is not implemented yet (#82)." The plan tells the implementer to add three named features "when they exist" but gives no ordering constraint tying the Strict-Offline-mode default (currently `offline`, which denies loopback) to the R04 requirement that loopback to the host/MCP must be permitted. An implementer must decide whether to flip the default mode, add a new mode, or require an explicit `local-only` policy per project — a design decision the plan does not make.
**Exact correction:** In R04, state the exact target: which mode the default policy must become, the exact `CORE_FEATURES` entries with their `needs` (the three named features have no `needs` values specified), and the migration behavior for existing projects whose stored policy is `mode: "offline"`. Name the file and function (`packages/network-policy/src/readiness.ts`, `CORE_FEATURES` / `defaultNetworkPolicy` in `policy.ts`).

### 5. MAJOR — `baseRevision` fix instruction (W01/spec §6.1) is correct about the current code but names no replacement semantics for v1 (CONFIRMED)
**Document:** Spec §6.1 ("`baseRevision` is currently overwritten with the session's current revision in `mcp.ts`; v1 must not pretend caller revisions are enforced. Fixing this is W1."); master plan **W01**; board **W01**.
**Problem:** I confirmed line 592 of `packages/studio-host/src/mcp.ts`: `baseRevision: session.revision`. The plan correctly identifies the defect, but W01's remediation is described only as "caller-supplied baseRevision, requestId, typed stale/conflict/refused results and idempotency" — it does not state the exact conflict-detection algorithm, the idempotency key composition (spec §6.2 says "keyed by actor/document/requestId" but master plan W01 says only "Duplicate request IDs cannot double-commit"), nor the typed error schema in the master plan. Two documents give two different idempotency/error specifications (spec §6.2 gives the typed error list and the 10-min/1,000-entry retention; the board gate only says "caller revision, request idempotency, stale conflicts"). The implementer must choose which is normative.
**Exact correction:** Designate `AGENT_CONTRACT.md` v2 (§6.2) as the single normative source in both the master plan W01 and the board W01 gate, and delete or explicitly defer to it the looser wording in the master plan ("typed stale/conflict/refused results"). State the retention rule (10 minutes or 1,000 entries) in the plan text, not only the spec.

### 6. MAJOR — R03 ownership/scope names `packages/studio-web/src/app.mjs` but the task's acceptance ("all P09 journeys pass from exact head") does not name the journey file(s) or the P09 criteria source (CONFIRMED)
**Document:** Master plan **R03** ("Finish the canonical P09 requirements in packages/studio-web/src/app.mjs, document/history and existing browser journeys"); board **R03** (`tests: ["P09 pointer keyboard agent accessibility journeys"]`, gate "all P09 journeys pass from exact head").
**Problem:** `packages/studio-web/src/app.mjs` exists (confirmed), but "the canonical P09 requirements" live in `docs/MASTER_PLAN.md`, not in the task, and no exact test file is named. The board's "tests" field is prose, not a path. The engineer cannot know which browser journey files to extend or which assertions constitute "P09 pass."
**Exact correction:** Name the exact P09 criteria section in `docs/MASTER_PLAN.md`, and name the concrete journey test file(s) (the tree contains `tests/journeys.test.mjs`, `tests/editor-browser.test.mjs`, `tests/editor-accessibility.test.mjs`, `tests/inspector-classes.test.mjs`, `tests/layer-structure.test.mjs`, etc.). Replace the board R03 `tests` prose with those file paths.

### 7. MAJOR — R02 names no test file and no computed-style oracle, though the gate is "computed styles match before and after reimport" (CONFIRMED)
**Document:** Master plan **R02** ("Resolve issue #360 in the existing import-stack/style cascade and relevant renderer tests. Define the result by actual computed styles…"); board **R02** (`tests: ["existing CSS import and renderer suites"]`, gate "computed styles match before and after reimport").
**Problem:** "the existing import-stack/style cascade and relevant renderer tests" names no file. The tree has `tests/style-order.test.mjs`, `tests/css-rules.test.mjs`, `tests/frame-stylesheet.test.mjs`, `tests/stylesheet-budget.test.mjs`, `tests/stylesheet-history.test.mjs`. The gate requires a computed-style comparison but no oracle/fixture is named, so the implementer must invent the comparison harness — a design decision.
**Exact correction:** Name the owning test file(s) and the computed-style comparison mechanism (which renderer produces computed styles, what fixture expresses the shorthand/longhand and margin/padding/border cases), and state whether the oracle is a golden snapshot or a property assertion.

### 8. MAJOR — Board `M06` dependency/repo mismatch (CONFIRMED)
**Document:** Board task **M06** (`"repo": "TheHalfMoon/Skilit"`, `"deps": ["M01"]`, `"issue": 189`); master plan §3 M06 and §5 ("M06 runs as a separate rights-filtered source PR once exact wire format is frozen").
**Problem:** The master plan §5 states M06 depends on the wire format being frozen, i.e. on M01. The board agrees (deps: M01). But the master plan §3 M06 requires producing output "in the exact Ninerr v1 manifest using the M01 adapter," while M01 is only "qualify existing PR #365" (Finding 2). Because the M01 artifacts don't exist in the worktree, M06 cannot "use the M01 adapter" and is not "READY TO START NOW" as §8 claims ("READY TO START NOW: … M06 rights/export inventory"). The board labels M06 `ready_for_inventory_not_redistribution` while listing dep M01 — a task cannot be simultaneously dependency-free-ready and blocked on M01.
**Exact correction:** Either remove M01 from M06's `deps` (if only inventory is in scope now, as the status string implies) or move M06 out of the "READY TO START NOW" set in §8. Align the board `status` with the `deps` array.

### 9. NIT — Master plan "16 defined tools" is accurate, but the plan/spec/board disagree on tool classification counts (CONFIRMED)
**Document:** Spec §6.1 ("16 tools: 9 read … 6 write … 1 consequential"); master plan §2.5 ("16 defined tools").
**Problem:** I read `packages/mcp-protocol/src/tools.mjs`: exactly 16 tools, 9 read / 6 write / 1 consequential. The spec's classification is correct. No defect in the count. Flagging only to record that this claim is verified, so downstream tasks can rely on it.
**Exact correction:** None required for the count; keep as-is.

### 10. NIT — Spec's §0.2 claim that `docs/design-platform/PLAN.md` is "absent at the source base" is consistent with this worktree, but `README/AGENT_CONTRACT/ARCHITECTURE/REUSE.md` do exist (CONFIRMED)
**Document:** Spec §0.2 table ("PLAN.md … Absent at the source base").
**Problem:** I confirmed `docs/design-platform/{README,AGENT_CONTRACT,ARCHITECTURE,REUSE}.md` exist while `PLAN.md` does not. The document's statements are internally consistent. No action.
**Exact correction:** None.

---

## Categories with nothing found

- **No fabricated or contradictory `16 tools` claim:** the tool list, count, and 9/6/1 classification all match `packages/mcp-protocol/src/tools.mjs`.
- **No contradiction in the network modes themselves:** `offline`/`local-only`/`allowlist` and the `local-only` loopback-only behavior are exactly as the spec §7.2 describes (`policy.ts` lines 138–143).
- **No missing persistence/schema version claims:** the spec's document schema 1 / project schema 3 / journal format 1 claims are internally consistent across §2.1 and §9; I did not find a contradicting constant in the files I checked.
- **No missing "evidence status" gate:** the plan and matrix consistently mark P09/P10, stdout, exports, Astro, and OS egress as not run/pending.

---

## Files I actually opened

- `C:\Users\Shehr\.claude\plugins\cache\egm\egm\0.1.0\agents\implementation_readiness.md`
- `docs/designs/NINERR_EXECUTION_READY_MASTER_PLAN_2026-11-06.md`
- `docs/designs/NINERR_EXECUTION_BOARD_2026-11-06.json`
- `docs/designs/NINERR_DESKTOP_AGENT_NATIVE_EGM_SPEC_2026-11-06.md`
- `docs/designs/EGM_05_07_RESOLUTION_MATRIX_2026-11-06.md`
- `packages/mcp-protocol/src/tools.mjs`
- `packages/studio-host/src/mcp.ts` (grep: `baseRevision`)
- `packages/network-policy/src/policy.ts`
- `packages/network-policy/src/types.ts` (grep: `NETWORK_MODES`)
- `packages/network-policy/src/readiness.ts`
- `packages/studio-host/src/session.ts` (grep: `redo|revert`)
- `tests/agent-undo.test.mjs` (grep: `redo|revert`)
- `tests/style-order.test.mjs` (grep: `shorthand|longhand|computed`)
- `tests/identity-census.test.mjs` (grep: `CURRENT.md`)
- `tests/program-state.test.mjs` (grep: `CURRENT.md`)
- `packages/studio-host/src/server.ts` (grep: `/api/code/export`, `/api/code/import`)
- Directory/glob listings confirming presence or absence of: `packages/import-stack/src/*`, `packages/studio-host/src/*`, `packages/document-model/src/*`, `packages/studio-web/src/app.mjs`, `packages/code-ir/src/roundtrip.ts`, `docs/design-platform/*`, `docs/MASTER_PLAN.md`, `tests/*.test.mjs`, and the specific absent files named in Findings 1 and 2.
