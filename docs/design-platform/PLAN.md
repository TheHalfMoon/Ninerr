# Design-platform implementation plan (proposal)

Status: **proposal, not approved** (ADR-0001).

- **Position:** phases P11 to P16 follow P10 and the release gate (`docs/MASTER_PLAN.md`), and none starts without the founder's approval.
- **Justification:** each task names the evidence that justifies it (E-… in [the study records](../research/rea-design-platforms/EVIDENCE_2026-10-18.md)).
- **Estimates:** engineer-days for one engineer and agent pair. They include tests and review, and exclude CI waits.

## How every task is delivered

This is Ninerr's existing process, unchanged:
- one PR per task, under about 65 KB of diff;
- exact-head CI on Linux, macOS and Windows, including desktop packages;
- the Jev exact-head check;
- the OCR delegate review, and a fresh-context review;
- a regression test that fails first;
- the identity census;
- a normal merge commit;
- post-merge CI before the issue is closed.

**Definition of done for every task:**
- **Behaviour and tests:** the behaviour is in the product, with an end-to-end test that drives it where a person uses it, and a negative control.
- **Accessibility:** `auditAccessibility` is clean on every new UI state, and every new action works from the keyboard.
- **Performance:** the scale workloads are unchanged, or within the stated budget.
- **Documentation:** `docs/MCP.md`, `docs/ARCHITECTURE.md` or `docs/MIGRATION.md` are updated where the task changes them.

## P11: trustworthy agent editing

Agent contract v2 ([AGENT_CONTRACT.md](AGENT_CONTRACT.md), ADR-0006). It is justified by E-PD-03, E-PD-04, E-PD-06, E-PD-12, E-FG-05 and E-CD-06, and needs no schema change.

| ID | Task | Integration points | Depends on | Tests | Estimate |
|---|---|---|---|---|---|
| **T11.1** | Write tools take `baseRevision`, `dryRun` and `fromDryRun`; results carry `committed`, `operations`, `dryRunToken`, `normalized` and `ignored` (empty until T11.5); stale writes return `changedSince` with `truncated` | `mcp.ts` (the `edit` helper at line 592 passes the agent's revision through; `inputSchema` of each write tool via one shared fragment; dry runs skip the person's confirmation); `session.ts` (`#commit` split into `#prepare`, which runs the collaboration room's authorization, the stylesheet budget and the transaction, and the store commit; `preview` runs `#prepare` only; `changedSince(revision)` from the history log, with `truncated` past its 500 entries) | — | `tests/mcp-server.test.mjs`: a stale write refused with `changedSince`; for each write tool, committing with `fromDryRun` records exactly the dry run's operations; v1 calls unchanged, with a warning | 4–6 |
| T11.2 | `requestId` idempotency per actor | `mcp.ts`: a per-actor LRU map (1,000 entries, 10 minutes) of requestId to arguments hash and result | T11.1 | a retry commits once; other arguments are refused; not shared across agents | 1–2 |
| T11.3 | `apply_operations`: a typed batch with an atomic commit; removes keep the person's approval | `mcp.ts`; `mcp-protocol/src/tools.mjs` gains an argument-aware classifier for this tool: `consequential` when the batch removes, else `write`. Classes are static per name today | T11.1 | an invalid last operation names its index and changes nothing; a 1 MiB plus one byte batch is refused; a cycle move is refused | 3–4 |
| T11.4 | `propose_change`, with the editor's preview, accept and reject | `mcp.ts` (pending proposals beside the confirmations); `server.ts` (`GET /api/proposals`, `POST /api/proposals/decide`); `app.mjs` (a proposal panel; preview by drawing the dry run's document in the canvas, read-only) | T11.1, T11.3 | browser e2e: accept commits exactly what was proposed, attributed to the agent, and Undo agent change reverts it; reject commits nothing; stale-on-accept is refused and re-proposed | 6–9 |
| T11.5 | `normalized` and `ignored` filled from the renderer's sanitizer and the browser's refusals | `renderer` (`planElement` reports dropped keys by name, not only a count); `mcp.ts` | T11.1 | a style the renderer drops is listed; nothing is dropped silently (contrast E-PD-06) | 2–3 |
| T11.6 | Reads: `outline` and `computed_styles`; a version 2 section for `guide` | `mcp.ts`; `computed_styles` from `planElement` (the drawn plan) | — | `outline` at 50,000 layers within 200 ms; equivalence with `layer_tree` on small trees | 2–3 |
| T11.7 | Strict mode (`agents.requireBaseRevision`) and the docs | project settings in `server.ts`; `docs/MCP.md` | T11.1–T11.6 | strict mode refuses a write without a revision | 1 |
| T11.8 | `layer_image`: a PNG of a layer, drawn by the open editor | a request from the host to the connected editor over its event stream; the editor renders it offline and answers | T11.6 | the image matches the canvas within a pixel tolerance; with no editor open, it says so; no network | 3–4 |

**P11 exit:**
- every write tool honours `baseRevision`, `dryRun` and `requestId`;
- proposals are accepted and rejected end to end;
- the dogfood journey E is extended with a stale write and a proposal.

## P12: layout and canvas precision

ADR-0002, justified by E-FG-02 and E-PD-09. It can run in parallel with P11.

| ID | Task | Integration points | Depends on | Tests | Estimate |
|---|---|---|---|---|---|
| T12.1 | `readLayout(style)` and `writeLayout(...)` as pure functions: flex mode, gap, padding, alignment, wrap; hug, fill and fixed; constraints from insets | new `packages/canvas/src/layout.mjs`, exported from `index.mjs` | — | property tests: write then read returns the same view for every view value; CSS outside the vocabulary reads as "custom" and is left alone | 3–4 |
| T12.2 | Layout panel in the inspector | `app.mjs` `renderInspector`; `STYLE_FIELDS` stays for raw fields | T12.1 | browser e2e: each control writes the CSS of §2.1 as one change; undo; accessibility audit | 4–6 |
| T12.3 | Constraints panel for absolutely placed layers | `app.mjs`, `layout.mjs` | T12.1 | resizing the parent keeps each constraint, checked by drawn geometry | 2–3 |
| T12.4 | Snapping and smart guides | `packages/canvas` (`snap(rects, moving, threshold)`, a pure function; an overlay during drag and resize); a project setting for the grid | — | unit tests of `snap`; e2e: a drag snaps to a sibling's edge, and the guide is shown; pointer-move budget of 4 ms at 1,000 siblings | 4–6 |
| T12.5 | Align and distribute; rotation handle | canvas, toolbar; MCP `align_layers` uses the same function | T12.4 | e2e for each command as one transaction; rotation writes `rotate` | 3–4 |
| T12.6 | Font family control with a read-only local font lookup | `app.mjs`; the host lists system font families (read-only) | — | e2e: choose a family; an unavailable family is marked | 2–3 |

**P12 exit:**
- layout, constraints, snapping, alignment and rotation all work by keyboard and pointer;
- the dogfood journey B is extended with layout edits.

## P13: design tokens and design systems

ADRs 0003 and 0004, justified by E-PD-10, E-FG-02, E-CD-03 and E-CD-05.

| ID | Task | Integration points | Depends on | Tests | Estimate |
|---|---|---|---|---|---|
| **T13.1** | Schema v2: the `design-system` and `component-instance` types, with a lazy upgrade (a project becomes v2 only when the first v2 node or prop is added) | `document-model` (`NODE_TYPES`, `DOCUMENT_SCHEMA_VERSION`, `validateDocument` accepts 1 and 2); `persistence` (v1 journal and snapshots replay under v2); `docs/MIGRATION.md` | — | migration corpus: every v1 case opens, edits and saves as v1; adding a v2 node makes it v2 in that transaction, and undo returns it to v1; a v2 file in a v1 build is refused with the version message | 4–6 |
| T13.2 | Token validation and compilation to custom properties per mode; applied in the canvas and in code export | `document-model` (`validateNodes`: unique names, known types, aliases resolve, no cycles); `renderer` (compile; mode attribute); `code.ts` export | T13.1 | unit tests for each refusal; e2e: a bound fill changes when its token or mode changes; export includes the sheet | 4–6 |
| T13.3 | Tokens panel: collections, modes, tokens; bind and unbind a field; rename as one transaction across uses; find uses | `app.mjs` (new panel), `canvas` `setStyle` | T13.2 | e2e with keyboard; a rename with 10,000 bound values within 300 ms p95 (new scale workload) | 6–8 |
| T13.4 | MCP `design_system` and `search_design_system` | `mcp.ts` | T13.2, T11.6 | results match the panel; search by name, value and use | 2 |
| T13.5 | Design system from the connected codebase: CSS custom properties, a Tailwind theme and a tokens JSON, read from the codebase folder into a proposal | `codebase.ts` (scan); the import review UI; arrives as a `propose_change` | T13.2, T11.4 | the dogfood projects (shadcn-ui, taxonomy) produce their real tokens; nothing outside the folder is read | 5–8 |

**P13 exit:**
- tokens are created, bound, renamed, moded and exported;
- a codebase's tokens come in through review.

## P14: components

ADR-0005, justified by E-PD-11, E-FG-02, E-FG-07 and E-CD-05.

| ID | Task | Integration points | Depends on | Tests | Estimate |
|---|---|---|---|---|---|
| T14.1 | `component-definition` props; `component-instance` validation (no self-nesting; overrides inside the definition; stale overrides reported) | `document-model` | T13.1 | unit tests for each refusal | 3–4 |
| T14.2 | Render-time expansion; drawn IDs `instance/definitionNode`; selection inside instances | `renderer`, `canvas` | T14.1 | e2e: a definition edit updates every instance in one transaction; 1,000 instances of 20 nodes expand within 50 ms p95 (new scale workload) | 6–9 |
| T14.3 | Create a component from a selection; insert an instance; overrides with reset; detach; edit main component | `app.mjs`, layers tree | T14.2 | e2e for each, by keyboard and pointer; one undo each | 6–8 |
| T14.4 | Properties (boolean, text, variant, instance swap, slot) and variants | `document-model`, `renderer`, inspector | T14.3 | e2e: switch a variant; a text property; an instance swap | 6–9 |
| T14.5 | Code components: bind a definition to a code component (`design-components` `bindContract`, `detectDrift`); export instances as component usage; drift reported | `design-components`, `code.ts`, `codebase.ts` | T14.3 | a dogfood component round-trips; drift appears when the code changes | 5–8 |

**P14 exit:**
- components, instances, properties and variants work end to end, and code-bound components export as usage;
- the dogfood journeys A and D are extended.

## P15: AI-native creation

ADR-0007, justified by E-CD-01, E-CD-02 and E-CD-05.

| ID | Task | Integration points | Depends on | Tests | Estimate |
|---|---|---|---|---|---|
| T15.1 | Provider settings, off by default; network policy allows only the configured endpoint while enabled | settings UI, `packages/network-policy` | — | with no provider, no outbound request (web-mode trap test); with one, only its origin | 3–4 |
| T15.2 | Built-in agent loop: prompt with selection context, then read tools, then operations, then a dry run, then `propose_change` | new `packages/studio-agent` (a client of contract v2 only) | T11.4, T13.4 | a recorded-provider fixture (no live model in CI): proposals are valid, atomic and attributed; a stale revision is recomputed | 8–12 |
| T15.3 | Layer-anchored comments; an agent reads them and may propose fixes | host records outside the document; a comments panel; MCP read | T11.4 | e2e: a comment, then a proposal, then accept | 5–7 |
| T15.4 | Typed levers in proposals | `propose_change` `levers`; proposal panel | T11.4 | e2e: adjusting a lever before accepting; the values are in the transaction | 3–5 |
| T15.5 | Alternatives: up to 3 proposals compared side by side | proposal panel | T15.2 | e2e: accept one, and the others are discarded | 3–4 |

**P15 exit:**
- a person creates and refines a design by prompt, comment and lever;
- every result is a proposal they accept;
- generation off means no network.

## P16: vectors, export, prototyping, collaboration decision

| ID | Task | Integration points | Depends on | Tests | Estimate |
|---|---|---|---|---|---|
| T16.1 | Export a layer as PNG, SVG or PDF, offline, to a place the person chooses | the editor's renderer; desktop save dialog | — | output matches the canvas (pixel tolerance); no network; no fixed folder | 3–5 |
| T16.2 | Pen and path editing on `vector` nodes | `canvas` (path handles), `renderer` | — | e2e: draw, edit points, undo; path limits refused | 8–12 |
| T16.3 | Boolean operations | an adopted library (REUSE.md: `polybooljs` or `clipper2-js`) | T16.2 | known-shape fixtures; license entry | 4–6 |
| T16.4 | Interactions and preview: `interaction` nodes for navigation and state change; a preview mode | `document-model`, `renderer`, editor | T14.4 | e2e: click-through preview; no scripts in the canvas | 8–12 |
| T16.5 | ADR on live multi-user editing: property-level merge and fractional child order (E-FG-01) versus the single writer | `docs/design-platform/adr/` | — | — (a decision only) | 2 |

## Critical path

```
T11.1 ─┬─ T11.2
       ├─ T11.3 ── T11.4 ──┬─ T15.2 ── T15.5
       ├─ T11.5            ├─ T15.3
       └─ T11.6 ─┐         └─ T15.4
T13.1 ── T13.2 ──┴─ T13.4 ─┘
          ├─ T13.3
          └─ T13.5 (also needs T11.4)
T13.1 ── T14.1 ── T14.2 ── T14.3 ── T14.4 ── T16.4
                              └─ T14.5
T12.1 ── T12.2, T12.3        T12.4 ── T12.5        (P12 runs in parallel)
```

**The longest chain** is T13.1 → T14.1 → T14.2 → T14.3 → T14.4 → T16.4. Its estimated range is 33–48 days.

**Order:**
1. P11 (T11.1 first);
2. P12 alongside;
3. P13;
4. P14;
5. P15;
6. P16.

**Total:**
| Phase | Estimate |
|---|---|
| P11 | 22–32 days |
| P12 | 18–26 days |
| P13 | 21–30 days |
| P14 | 26–38 days |
| P15 | 22–32 days |
| P16 | 25–37 days |

## Qualification strategy

- **In CI on every PR (Linux, macOS, Windows):**
  - unit and property tests for the pure functions (`readLayout`, `snap`, token compilation, instance expansion);
  - browser end-to-end tests in Chromium or Edge for every new UI;
  - MCP contract tests: dry run equals commit, staleness, atomicity, idempotency, proposals;
  - the migration corpus with v1 cases;
  - the accessibility audit;
  - the scale report with the new workloads.
- **Windows-specific:** the desktop package smoke test and journeys on win32-x64 (already in CI), and the gate-13 reference protocol on the reference machine (#275).
- **Real desktop and browser runs:** the seven-project dogfooding (`scripts/dogfood/run.mjs`), extended per phase. It runs after each phase on the phase's final main.
- **Negative controls, required in every phase:**
  - stale revisions;
  - over-limit batches;
  - token alias cycles;
  - an instance containing its own definition;
  - malformed paths (NaN, over-long);
  - hostile imports (scripts, `javascript:` URLs, remote URLs: never fetched);
  - a request reused by another agent.
- **Budgets:** each proposed budget in ARCHITECTURE.md §6 is unmeasured until its scale workload exists. The phase closes only when it is measured on the reference machine and within budget.

## Risks and rollback

| Risk | Phase | Mitigation | Rollback |
|---|---|---|---|
| Strict revisions break existing agents | P11 | one release of warnings before strict mode; the setting | turn the setting off |
| Layout view misreads CSS | P12 | "custom" for anything outside the vocabulary; property tests | the panel hides; CSS is untouched |
| Schema v2 migration | P13 | version-only migration; corpus; refusal in old builds | v2 files are not opened by old builds; no data rewritten beyond the version |
| Instance expansion cost | P14 | budgets; invalidation by dependency | detach-all as one transaction |
| Model provider and privacy | P15 | off by default; network policy names the one origin | disable the provider |
| Library licenses | P16 | license policy and register entries before adoption | remove the dependency |

## Open decisions for the founder

1. Approve P11 alone, or P11 to P16. Approval of P11 alone lets T11.1 start right after the release gate.
2. Strict revisions in the release after P11 (proposed), or later.
3. Model providers to support in P15. The proposal is the person's choice, off by default.
4. Whether live multi-user editing is in scope at all. T16.5 only decides.

## First PR

**T11.1, "MCP writes take the agent's base revision, and can be dry-run".** It contains:

- **`mcp.ts`:**
  - a shared `writeCommon` input-schema fragment (`baseRevision`, `dryRun`, `fromDryRun`), added to `create_frame`, `set_text`, `rename_layers`, `set_styles`, `move_layers`, `duplicate_layers` and `delete_layers`;
  - the `edit` helper (around line 592) passes `args.baseRevision ?? session.revision`. With `dryRun`, it calls `session.preview(...)` and returns a `dryRunToken`, and `delete_layers` asks no confirmation. With `fromDryRun`, it commits the token's stored operations if the revision is unchanged;
  - results gain `committed`, `operations`, `normalized: []`, `ignored: []` and `warnings` (`no-base-revision` when it was omitted).
- **`session.ts`:**
  - `#commit` is split so that `preview(actor, input)` runs exactly what a commit runs before the store write: revision, limits, authorization through the collaboration room, the stylesheet budget and the transaction. It returns `{ revision, operations, affectedNodeIds }` and commits nothing.
  - `changedSince(revision)` lists the history summaries after `revision`, with `truncated` when the log no longer reaches it.
  - The 409 `stale-revision` error carries them.
- **`tests/mcp-server.test.mjs`:**
  - for each write tool, committing with `fromDryRun` records exactly the dry run's operations, and the resulting document equals the dry run's;
  - a `fromDryRun` after another actor's change is refused as stale;
  - a write at a stale revision is refused with `changedSince` naming the other actor's change;
  - a v1 call without `baseRevision` behaves as before and warns;
  - a negative control: a dry run never changes the revision, the journal or the undo stacks.
- **`docs/MCP.md`:** the two new arguments and the warning.
- **Diff size:** estimated at under 30 KB.

**Justification:** E-PD-03, E-PD-12, E-FG-05, E-CD-06; `mcp.ts:592`.
