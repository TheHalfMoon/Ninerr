Stage 08, second Zoom-Out. Reviewer: `opencode/pulse-alpha-free`, agent `explore`, fresh read-only context, persona `egm/agents/zoom_out.md`, 2026-11-06, against head ee3318d of this branch. Text below is the model's report, unedited. It is not execution evidence. Dispositions are in `EGM_08_09_DISPOSITIONS_2026-11-06.md`.

## Blocker

**B1 — R01/board R01 name a regression test file that does not exist. CONFIRMED.**
Affected: master plan §3 R01; board task `R01`.
The plan says: "Modify `tests/text-layers.test.mjs` and existing code workflow tests." The board lists `tests/text-layers.test.mjs` as the first gate test. That file does not exist in the worktree (glob `tests/*.md`/`tests/*.mjs` returns no `text-layers`). The actual existing carrier of the expression bug is `tests/code-workflow.test.mjs`, whose line 92 asserts a dynamic `{label}` becomes the literal text `"{label}"` — the exact defect R01 must fix. An engineer cannot "modify" a file that is absent, and creating a new file contradicts the instruction's verb. **Exact correction:** either change R01 to "modify `tests/code-workflow.test.mjs` and add `tests/text-layers.test.mjs`" (state which is new), or drop the phantom filename and name only `tests/code-workflow.test.mjs`.

**B2 — M01/M02 name implementation and test files that do not exist at the named paths. CONFIRMED.**
Affected: master plan §3 M01/M02, §4, §6, §8; board tasks `M01`, `M02`.
The plan states M01's implementation is `packages/import-stack/src/reference-packs.mjs` and `design-graph-reference-adapter.mjs`, with tests `tests/reference-packs.test.mjs` and `tests/design-graph-reference-adapter.test.mjs`; M02 is `packages/import-stack/src/reference-pack-file.ts` with `tests/reference-pack-file.test.mjs`. None of these five files exist in this worktree (glob of `packages/import-stack/src/` and `tests/` confirms absence). The plan itself concedes at line 134 that "All three file-level targeted test files do not exist on plain main" and §8.2 says they are on Draft PRs #365/#367. So the plan is internally aware, but the task descriptions still read as if the owners already exist. An engineer starting M01 from this worktree has no source file to extend and must first retrieve two unmerged branches — a decision the task text does not instruct. **Exact correction:** prefix M01/M02 with "check out PR #365 head (M01) / #367 head (M02) before starting; the files below exist only there," and give the exact branch names (`feat/local-reference-file-reader-20261106`, `test/offline-reference-packs-20261106` are named in matrix §5 but not in the plan).

**B3 — R04/M02/R05 name tests that do not exist and are not marked as to-be-created. CONFIRMED.**
Affected: master plan §3 R04 ("a packaged whole-process network trap"), board `R04` tests list (`tests/main-process-egress.test.mjs`), board `M02` tests (`native symlink/ACL tests`), board `M05` (`tests/research-ui.test.mjs`), `M03` (`tests/reference-catalog.test.mjs`). These are proposed filenames. The master plan header §3 says "newly proposed filenames must be created only in that task," which licenses creation — but the board presents several of them in the accepted-`tests` array without a marker distinguishing existing from proposed (compare board `R01`, which lists an existing-sounding file that is in fact absent). A reader cannot tell, from the board alone, which test files are runnable today and which are greenfield. **Exact correction:** in the board, split each `tests` array into `"tests_existing"` and `"tests_proposed"`, or suffix proposed entries with `" (new)"`.

## Major

**M1 — Identity-census gate uses two different modes across the two governing documents. CONFIRMED.**
Affected: master plan §6 (line 129, `node scripts/identity-census.mjs --verify`) vs. board `R05` (`"identity census --check"`) and board `M02` (same).
`scripts/identity-census.mjs` distinguishes the modes: `--verify` "fail[s] when that summary does not match this tree"; `--check` "fail[s] on any finding in a gated category." These are different pass conditions. An engineer following R05 (`--check`) can pass while a summary-drift failure that §6 exists to catch goes undetected, and vice versa. **Exact correction:** state one canonical invocation in the master plan §6 and make the board reference it verbatim; if both are intended, list both with their distinct purposes.

**M2 — M05 dependency edge contradicts the master plan's safe-parallelism statement. CONFIRMED.**
Affected: board task `M05` (`deps: ["M03","M04"]`) vs. master plan §5 line 115 ("M03 → M04/M05").
The plan's arrow notation means M04 and M05 both depend only on M03 and can proceed in parallel; the board serializes M05 behind M04, lengthening the critical path and removing the parallelism the plan explicitly claims ("Independent local pack path"). The board's own `M04` gate concerns MCP path-safety, which M05 (a UI panel) does not require. **Exact correction:** change board `M05.deps` to `["M03"]` to match §5, or state in the plan that M05 also requires M04 and delete the parallel claim.

**M3 — M06 task is assigned to a separate repository but the board gives no cross-repo execution boundary or gate runner. CONFIRMED.**
Affected: board task `M06` (`repo: "TheHalfMoon/Skilit"`, `deps:["M01"]`), master plan §3 M06.
The task requires "the exact Ninerr v1 manifest using the M01 adapter" — i.e., a Ninerr-package artifact — inside the Skilit repo, while M01 lives in the Ninerr repo. The board's `deps` model is single-repo; it does not state how the Skilit-side task consumes the Ninerr v1 contract (published package version, vendored file, or pinned SHA). Master plan §8.1 S0 says "a pinned Skilit commit," and §3 M06 says "using the M01 adapter," but neither binds the two. An engineer cannot pick the integration mechanism without an architectural decision. **Exact correction:** add to M06 (plan and board) the exact M01 artifact identity (package name + version, or the pinned Ninerr SHA whose `reference-packs.mjs` the exporter imports) and where the cross-repo gate runs.

**M4 — "Reference apply" is stated to depend on M06, but M06 is defined as inventory-only. CONFIRMED.**
Affected: board `W08` (`deps: [...,"M06",...]`), board `M06` status (`"ready_for_inventory_not_redistribution"`), master plan §3 M06 / §5.
M06's own title says "Owner-authorized Skilit source exporter and rights ledger," yet its board status is `ready_for_inventory_not_redistribution` and master plan §8 says M06 "runs as a separate rights-filtered source PR once exact wire format is frozen." W08 (apply approved references at runtime) depends on M06, but if M06 is scoped to inventory + ledger and explicitly *not* redistribution, it is unclear whether W08's dependency is satisfied by M06's inventory output or requires a further producer step. Matrix cluster C05 lists "plan owner-filtered exporter" as future work while the board treats M06 as the dependency. **Exact correction:** state whether the object of W08's `M06` dependency is the rights ledger, the inventory, or generated packs, and if packs, name the concrete producer deliverable and its task id.

**M5 — M02's reuse targets are confirmed to exist, but its own source file is not; the reuse instruction is therefore unreachable as written. CONFIRMED.**
Affected: master plan §3 M02.
M02 says "Reuse `canonicalDirectory`, `canonicalFileWithinRoots` and `readSingleLinkFile`." I confirmed all three exist in `packages/import-stack/src/filesystem.ts`. However, M02 also states the implementation file is `packages/import-stack/src/reference-pack-file.ts`, which does not exist here — it is on the draft branch. So the task mixes a present reuse target with an absent consumer. This compounds B2 but is separable: even a reader who accepts the draft branch must be told the three helpers are on `main` while the consumer is on the branch. **Exact correction:** note in M02 which symbols are on `main` (the three helpers) and which are introduced by the PR.

## Nit

**N1 — Resolution-matrix §5 cites evidence files by bare filename while they live under `docs/strategy/`. CONFIRMED.**
Affected: matrix §5 ("Evidence inspected").
The list names e.g. `EGM_GOLDFISH_05_DISPOSITIONS_2026-11-06.md`, `GUI_MCP_COMMAND_PARITY_2026-11-06.md`, `REA_COMPETITORS_AND_CRAFT_ANYTHING_2026-11-06.md` with no directory. All exist, but under `docs/strategy/` (I confirmed). A reader cannot locate them from the matrix alone. **Exact correction:** prefix each with `docs/strategy/`.

**N2 — Master plan §4 wire-contract field list omits the `confidence` and `visibility` value domains that spec §8.2 supplies, and the object-kind enum is not in the same order. CONFIRMED.**
Affected: master plan §4 vs. spec §8.2.
Master plan §4 lists `Object: id, kind, title, tags, sourceId, assetSha256 (nullable), confidence, visibility, rights` but never enumerates allowed `confidence` (`observed|documented|inferred|unknown`) or `visibility` (`public|workspace|private`) values, or `kind` value spellings. Spec §8.2 provides them. An implementer of M01 reading only the master plan (§4 is declared "Exact ... wire contract") lacks the closed value sets needed to validate "unknown fields refuse." **Exact correction:** inline the `confidence`, `visibility`, and `kind` enums into master plan §4, or point §4 to spec §8.2 as the value-domain authority.

## Categories with no findings

- **Reinventing the wheel / codebase-reuse (Zoom-Out vector).** I searched for the utilities the plan says to reuse. Confirmed present: `canonicalDirectory`/`canonicalFileWithinRoots`/`readSingleLinkFile` (`packages/import-stack/src/filesystem.ts`), `CORE_FEATURES`/`evaluateOfflineReadiness` (`packages/network-policy/src/readiness.ts`), network modes `offline`/`local-only`/`allowlist` (`packages/network-policy/src/types.ts`). The reuse directives in R04, M02, ADR-D6/D8 are backed by real symbols. No finding.
- **Architectural dead-ends introduced by the plan itself.** The plan's refusals of a second layout engine (W04), a duplicate document store (W06/ADR-D2), a new capture service (ADR-D6), and SQLite/FTS5 (ADR-D3) are explicit and consistent. No finding.
- **Product-rule contradiction.** All four documents consistently state desktop-only, local MCP, no Ninerr cloud, no founder inference, separate source/object rights. No document contradicts the master plan's frozen contract. No finding.

## Cross-document internal-consistency checks that passed (CONFIRMED)

- 16 MCP tools: `packages/mcp-protocol/src/tools.mjs` CLASSES has exactly 16 names (9 read, 6 write, 1 consequential), matching spec §6.1 and matrix C03.
- `baseRevision` overwrite: `packages/studio-host/src/mcp.ts` line 592 sets `baseRevision: session.revision`, matching spec §6.1 and matrix §5.
- Revert deletes redo: `packages/studio-host/src/session.ts` line 344 `this.#redo.delete(...)` inside `revert`, matching spec §6.4 and matrix 05-5/07-5.
- Offline/local-only semantics: `packages/network-policy/src/policy.ts` treats `offline` as denying loopback and `local-only` as permitting it, matching spec §7.2 and matrix 07-3.
- ADRs 0001–0007 exist under `docs/design-platform/adr/`, matching spec §0.2.
- `docs/design-platform/PLAN.md` is absent, matching spec §0.2/§12 ("absent at base").
- Stage 08 quota block: `docs/designs/egm-review-20261106/08-zoom-out-recheck.txt` is an OpenCode session log ending in "Free usage limit reached," matching the stage-08-pending claim.

## Files I actually opened

- C:\Users\Shehr\.claude\plugins\cache\egm\egm\0.1.0\agents\zoom_out.md
- D:\Ninerr-EGM-Round2-20261106\docs\designs\NINERR_EXECUTION_READY_MASTER_PLAN_2026-11-06.md
- D:\Ninerr-EGM-Round2-20261106\docs\designs\NINERR_EXECUTION_BOARD_2026-11-06.json
- D:\Ninerr-EGM-Round2-20261106\docs\designs\NINERR_DESKTOP_AGENT_NATIVE_EGM_SPEC_2026-11-06.md
- D:\Ninerr-EGM-Round2-20261106\docs\designs\EGM_05_07_RESOLUTION_MATRIX_2026-11-06.md
- D:\Ninerr-EGM-Round2-20261106\packages\mcp-protocol\src\tools.mjs
- D:\Ninerr-EGM-Round2-20261106\packages\studio-host\src\mcp.ts (grep)
- D:\Ninerr-EGM-Round2-20261106\packages\studio-host\src\session.ts (grep)
- D:\Ninerr-EGM-Round2-20261106\packages\studio-host\src\server.ts (grep)
- D:\Ninerr-EGM-Round2-20261106\packages\import-stack\src\filesystem.ts (grep)
- D:\Ninerr-EGM-Round2-20261106\packages\network-policy\src\policy.ts, types.ts, readiness.ts, index.ts (grep)
- D:\Ninerr-EGM-Round2-20261106\tests\code-workflow.test.mjs (grep)
- D:\Ninerr-EGM-Round2-20261106\scripts\identity-census.mjs (grep)
- D:\Ninerr-EGM-Round2-20261106\scripts\package-desktop.mjs (grep)
- D:\Ninerr-EGM-Round2-20261106\package.json (grep)
- D:\Ninerr-EGM-Round2-20261106\docs\MASTER_PLAN.md (grep)
- D:\Ninerr-EGM-Round2-20261106\docs\designs\egm-review-20261106\08-zoom-out-recheck.txt (partial, via shell)
- Directory listings: `packages/import-stack/src/`, `packages/code-ir/`, `packages/studio-host/src/`, `packages/mcp-protocol/src/`, `packages/network-policy/`, `tests/`, `docs/`, `docs/designs/`, `docs/designs/egm-review-20261106/`, `docs/design-platform/`, `docs/design-platform/adr/`, `docs/strategy/`.
