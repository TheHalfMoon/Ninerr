# Design-platform implementation plan (proposal)

Status: **proposal, not approved** (ADR-0001).

- **Position:** phases P11 to P16 follow P10 and the release gate (`docs/MASTER_PLAN.md`), and none starts without the founder's approval.
- **Justification:** each phase names its evidence (E-… in [the study records](../research/rea-design-platforms/EVIDENCE_2026-10-18.md)). What the evidence does and does not show is in [COMPARISON](../research/rea-design-platforms/COMPARISON_2026-10-18.md).
- **Estimates:** engineer-days for one engineer and agent pair, including tests and review, excluding CI waits.
- **Integration points** were checked against main `386a247` on 2026-10-18 (file and function names exist as written).

## How every task is delivered

Ninerr's existing process, unchanged: one PR per task, under about 65 KB of diff; exact-head CI on Linux, macOS and Windows with desktop packages; the Jev exact-head check; the OCR delegate review and a fresh-context review; a regression test that fails first; the identity census; a normal merge commit; post-merge CI before the issue is closed.

**Definition of done for every task:** its acceptance criteria below are met and shown by tests in CI; an end-to-end test drives the behaviour where a person uses it, with a negative control; `auditAccessibility` finds nothing in new UI states, and every new action works from the keyboard; the scale workloads stay within budget; `docs/MCP.md`, `docs/ARCHITECTURE.md` or `docs/MIGRATION.md` are updated where the task changes them.

**Shortest safe path.** Each phase reuses what Ninerr has before adding anything (REUSE.md): history transactions for every change, `planElement` for every drawn or reported value, the existing MCP `edit` helper for every agent write, `design-components` for code components. No new store, layout engine or write path is added.

## P11: trustworthy agent editing

Contract v2 (AGENT_CONTRACT.md, ADR-0006). Evidence: E-NX-02, E-NX-03, E-NX-07, E-NX-08; E-PD-03, E-PD-06; E-FG-17, E-FG-18. No schema change.

| ID | Task and approach | Integration points | Depends on | Tests | Acceptance (measurable) | Est. |
|---|---|---|---|---|---|---|
| **T11.1** | Writes take `baseRevision`, `dryRun`, `fromDryRun`; results carry `committed`, `operations`, `dryRunToken`, `normalized`/`ignored` (empty until T11.5), `warnings`; stale writes return `changedSince`; unknown arguments warn. One shared schema fragment and one change to the `edit` helper; `#commit` split so a dry run runs everything but the store write | `mcp.ts` (`edit` helper, line 592; each write tool's `inputSchema`); `session.ts` (`#commit` → `#prepare` + store commit; `preview`; `changedSince` from `#log`, `MAX_LOG` 500) | — | `tests/mcp-server.test.mjs`; rerun of `scripts/research/ninerr-counterparts.mjs` | E-NX-02 rerun: a stale write is refused with code `stale-revision` and `changedSince` naming B's change; for all 7 write tools, `fromDryRun` commits operations byte-equal to the dry run's; a dry run changes neither revision, journal nor undo stacks, and takes ≤ 1.2× the commit's time on the 1,000-layer workload; E-NX-07 rerun warns `unknown-argument` | 4–6 |
| T11.2 | `requestId` idempotency per actor | `mcp.ts`: per-actor LRU (1,000 entries, 10 min) of id → arguments hash and result | T11.1 | same file | a retry with the same id commits once (revision +1, not +2); other arguments → `conflict`; another agent's id is not shared; errors are not cached | 1–2 |
| T11.3 | `apply_operations`: a typed batch, one atomic commit; removes keep the person's approval | `mcp.ts`; `mcp-protocol/src/tools.mjs` gains an argument-aware class for this tool | T11.1 | same file | an invalid last operation names its index and leaves the revision unchanged; 5,001 operations or 1 MiB + 1 byte refused; a batch with a remove waits for approval | 3–4 |
| T11.4 | `propose_change` and the editor's proposal panel (preview, accept, reject); used by review mode and for removals | `mcp.ts`; `server.ts` (`GET /api/proposals`, `POST /api/proposals/decide`); `app.mjs` (panel; read-only preview of the dry run's document); the change list from `@ninerr/visual-git` `diffSnapshots` and `changedFields` (built, not yet wired) | T11.1, T11.3 | browser e2e | accept commits the proposed operations, attributed to the agent; reject commits nothing; a stale accept is refused; accept names the operations hash; a 200-operation preview draws in ≤ 100 ms | 6–9 |
| T11.5 | `normalized` and `ignored` filled: the renderer's dropped keys by name, and properties with no effect in context (`flex-grow` on an absolute layer, `gap` on a non-container) | `renderer` (`planElement` reports dropped keys by name, not a count); a pure `contextEffects(node, parent)` in `renderer`; `mcp.ts` | T11.1 | unit + MCP | E-NX-03 rerun lists `flex-grow` and `gap` in `ignored`; every key the renderer drops in the existing sanitizer tests appears by name | 2–3 |
| T11.6 | Reads: `outline`, `computed_styles`; a version 2 section of `guide` | `mcp.ts`; `computed_styles` from `planElement` | — | MCP | `outline` of 50,000 layers in ≤ 200 ms p95 on the reference machine; equals `layer_tree` on the small-tree fixtures | 2–3 |
| T11.7 | Strict mode `agents.requireBaseRevision`, review mode `agents.reviewMode`; docs | project settings in `server.ts`; `mcp.ts` (review mode routes writes to `propose_change`); `docs/MCP.md` | T11.1–T11.6 | MCP | strict: a write without `baseRevision`, or with an unknown argument, is refused; review mode: every agent write arrives as a proposal and commits nothing until accepted | 1–2 |
| T11.8 | `layer_image`: a PNG of a layer from the open editor | host → editor request over the event stream; offline render in the editor | T11.6 | browser e2e | matches the canvas within the existing pixel tolerance; no editor → a typed error; no non-loopback request | 3–4 |
| T11.9 | Revert preview: the later changes a revert would discard, shown before the person confirms | `session.ts` (`revert`, `revertible`: compute discarded effects from the history log); `@ninerr/visual-git` `changedFields` for the per-layer list; `server.ts` (`GET /api/revert/preview`); `app.mjs` (the Undo agent change control of #350) | — | browser e2e | E-NX-08 rerun: the preview names the person's later rename; with no later edit the revert asks nothing extra; the revert stays one transaction | 2–3 |

**P11 exit:** every write tool honours `baseRevision`, `dryRun` and `requestId`; E-NX-02, E-NX-03, E-NX-07 and E-NX-08 rerun with their new results recorded; proposals work end to end; the dogfood journey E gains a stale write and a revert with a later edit.

## P12: layout and canvas precision

ADR-0002. Evidence: E-FG-11, E-FG-12, E-FG-19, E-PD-09, E-NX-04. Runs alongside P11.

| ID | Task and approach | Integration points | Depends on | Tests | Acceptance (measurable) | Est. |
|---|---|---|---|---|---|---|
| T12.1 | `readLayout(style)` / `writeLayout(view)`: pure functions between CSS and the hug/fill/fixed, gap, padding, alignment, wrap and constraint vocabulary | new `packages/canvas/src/layout.mjs`, exported from `index.mjs` | — | property tests | write → read is identity over the whole vocabulary; CSS outside it reads as `custom` and is left byte-identical; the E-FG-11 row (400 px, padding 12, gap 8, fixed 50, hug 47) draws its fill child at 263 px and at 463 px when widened to 600 | 3–4 |
| T12.2 | Layout panel in the inspector | `app.mjs` `renderInspector`; `STYLE_FIELDS` kept for raw fields | T12.1 | browser e2e | each control writes the CSS of ARCHITECTURE §2.1 as one transaction; undo restores it; keyboard only; audit clean | 4–6 |
| T12.3 | Constraints panel for absolutely placed layers | `app.mjs`, `layout.mjs` | T12.1 | browser e2e | the E-FG-12 case: MAX + STRETCH child at (140, 140) in a 200 px parent grown to 300 px is drawn at x 240, height 150 | 2–3 |
| T12.4 | Snapping and smart guides | `packages/canvas` (`snap(rects, moving, threshold)`, pure; overlay in `mountCanvas`); a grid setting | — | unit + e2e | snaps to sibling edges and centres within 4 px; ≤ 4 ms per pointer move at 1,000 siblings | 4–6 |
| T12.5 | Align and distribute; rotation handle; MCP `align_layers` sharing the function | canvas, toolbar, `mcp.ts` | T12.4 | e2e + MCP | each command is one transaction; rotation writes `rotate`; agent and canvas give identical geometry | 3–4 |
| T12.6 | Font family control with a read-only local font lookup | `app.mjs`; host lists system families | — | e2e | choose a family; an unavailable one is marked; the lookup writes nothing | 2–3 |
| T12.7 | Keep safe link targets on import | `packages/import-stack/src/html.ts` (the `URL_ATTRIBUTES` branch keeps a safe `href` on `a` as an attribute); the renderer already draws it inert (`data-ninerr-href`) | — | import tests | E-NX-04 rerun: the `https:` link keeps its `href`; `javascript:` still removed; still no fetch; images unchanged (still no remote `src`) | 1–2 |

**P12 exit:** layout, constraints, snapping, alignment and rotation by keyboard and pointer; the dogfood journey B gains layout edits.

## P13: design tokens and design systems

ADRs 0003 and 0004. Evidence: E-FG-14, E-PD-10, E-CD-09.

| ID | Task and approach | Integration points | Depends on | Tests | Acceptance (measurable) | Est. |
|---|---|---|---|---|---|---|
| **T13.1** | Schema v2 with a lazy upgrade (`design-system`, `component-instance`) | `document-model` (`NODE_TYPES`, `DOCUMENT_SCHEMA_VERSION`, `validateDocument` accepts 1 and 2); `persistence`; `docs/MIGRATION.md` | — | `tests/migration-corpus.test.mjs` | every v1 corpus case opens, edits and saves as v1; the first v2 node makes it v2 in that transaction and undo returns v1; a v1 build refuses v2 with the version message | 4–6 |
| T13.2 | Token validation and compilation to custom properties per mode | `document-model` (`validateNodes`); `renderer` (compile; `data-ninerr-mode`); `code.ts` export | T13.1 | unit + e2e | a cycle is refused with an error naming it; a type mismatch is refused; deleting a token in use without a replacement is refused; a bound fill changes with its token and mode; export includes the sheet | 4–6 |
| T13.3 | Tokens panel: collections, modes, tokens; bind, unbind, rename across uses, find uses; delete with a replacement | `app.mjs` (panel); `canvas` `setStyle` | T13.2 | e2e | rename with 10,000 bound values ≤ 300 ms p95 (new scale workload); delete offers replace-with-token or literal, one transaction | 6–8 |
| T13.4 | MCP `design_system` and `search_design_system` | `mcp.ts` | T13.2, T11.6 | MCP | results equal the panel's; search by name, value and use | 2 |
| T13.5 | Design system from the connected codebase (CSS custom properties, a Tailwind theme, a tokens JSON), arriving as a proposal | `codebase.ts` scan; import review UI; `propose_change` | T13.2, T11.4 | dogfood | shadcn-ui and taxonomy produce their real token sets (names and values match their source files); nothing outside the folder is read | 5–8 |

**P13 exit:** tokens are created, bound, renamed, moded, deleted safely and exported; a codebase's tokens come in through review.

## P14: components

ADR-0005. Evidence: E-FG-13, E-FG-18, E-PD-11.

| ID | Task and approach | Integration points | Depends on | Tests | Acceptance (measurable) | Est. |
|---|---|---|---|---|---|---|
| T14.1 | `component-definition` props and `component-instance` validation; stable property IDs | `document-model` | T13.1 | unit | self-nesting refused; overrides outside the definition refused; a stale override kept and reported; adding a variant renames no property ID | 3–4 |
| T14.2 | Render-time expansion; drawn identity (`data-ninerr-id` + `data-ninerr-instance`); selection inside instances | `renderer` (`planElement`), `canvas` | T14.1 | e2e + scale | a definition edit updates every instance in one transaction; 1,000 instances of 20 nodes expand in ≤ 50 ms p95 (new workload); scoped stylesheets still match | 6–9 |
| T14.3 | Create from selection; insert instance; overrides with reset; detach; edit main; structure inside an instance locked | `app.mjs`, layers tree | T14.2 | e2e | each is one undo step; reset keeps property values; insert, remove or move inside an instance is refused with the two ways out named | 6–8 |
| T14.4 | Properties (boolean, text, variant, instance swap, slot) and variants | `document-model`, `renderer`, inspector | T14.3 | e2e | a variant swap keeps property values (as E-FG-13); a text property edits the instance's text only | 6–9 |
| T14.5 | Code components: bind a definition with `bindContract`, report `detectDrift`, export instances as usage | `design-components`, `code.ts`, `codebase.ts` | T14.3 | dogfood | a dogfood component round-trips; changing its code shows drift in the editor | 5–8 |

**P14 exit:** components, instances, properties and variants end to end; code-bound components export as usage; dogfood journeys A and D extended.

## P15: AI-native creation

ADR-0007 (revised: turns apply directly as one transaction; proposals in review mode, for removals and for turns started from layer text or a comment). Evidence: E-FG-18, E-CD-01, E-CD-02, E-CD-08, E-CD-09.

| ID | Task and approach | Integration points | Depends on | Tests | Acceptance (measurable) | Est. |
|---|---|---|---|---|---|---|
| T15.1 | Provider settings, off by default; the network policy allows only the configured endpoint while on | settings UI; `packages/network-policy` | — | web-mode trap test | off: zero non-loopback requests in the whole e2e suite; on: only the provider's origin | 3–4 |
| T15.2 | Built-in agent loop: selection context → read tools → operations → dry run at `baseRevision` → one transaction per turn, Undo agent change beside the reply; review mode and removals go through `propose_change` | new `packages/studio-agent` (a contract v2 client only); the working indicator from `@ninerr/collaboration` presence (`locateAgent`) | T11.1, T11.3, T11.4, T11.9, T13.4 | recorded-provider fixture (no live model in CI) | every turn is one attributed transaction; a stale revision is recomputed, never forced; a removal always arrives as a proposal | 8–12 |
| T15.3 | Layer-anchored comments an agent reads and acts on, reusing the comment model that exists unwired | `@ninerr/collaboration` `comments.ts` (`createRootComment`, `replyToComment`, `resolveComment`, `replayComments`; `CommentAnchor.nodeId`), persisted by the host beside the journal; a comments panel; an MCP read | T15.2 | e2e | a comment leads to a turn that changes only the commented layer's subtree, and arrives as a proposal (it was started by untrusted content); resolving it is attributed; comments survive reopen | 4–6 |
| T15.4 | Typed levers on a turn | turn result `levers`; reply panel | T15.2 | e2e | adjusting a lever writes one transaction; values bound to `nodeId` and field | 3–5 |
| T15.5 | Alternatives: up to 3 turns compared before one is kept | reply panel; proposals | T15.2, T11.4 | e2e | keeping one commits it; the others leave no trace in the document or journal | 3–4 |
| T15.6 | Design-system conformance check of a turn's dry run: literal values where a token exists, look-alikes of an existing component | `studio-agent`; `design_system` read | T15.2, T14.2 | unit + fixture | a fixture with 5 seeded bypasses reports all 5; a clean turn reports none | 3–4 |

**P15 exit:** a person creates and refines a design by prompt, comment and lever; every turn is undoable as one change; generation off means no network.

## P16: vectors, export, prototyping, collaboration decision

Evidence: E-FG-19, E-PD-13, E-CD-03 (export); E-FG-08 (prototyping, documented); E-FG-01, E-FG-17 (collaboration). Vectors and booleans rest on professional norms, not on this study.

| ID | Task and approach | Integration points | Depends on | Tests | Acceptance (measurable) | Est. |
|---|---|---|---|---|---|---|
| T16.1 | Export a layer as PNG, SVG or PDF, offline, to a chosen place | the editor's renderer; desktop save dialog | — | e2e | matches the canvas within the pixel tolerance; no non-loopback request; never writes to a fixed folder | 3–5 |
| T16.2 | Pen and path editing on `vector` nodes | `canvas` (path handles), `renderer` | — | e2e | draw, edit points, undo; 200,001 commands and non-finite numbers refused | 8–12 |
| T16.3 | Boolean operations | an adopted library (REUSE.md) | T16.2 | fixtures | known-shape fixtures within 0.01 px; license entries in place | 4–6 |
| T16.4 | Interactions and preview (`interaction` nodes: navigation, state change) | `document-model`, `renderer`, editor | T14.4 | e2e | click-through preview reaches every linked frame; no script runs in the canvas | 8–12 |
| T16.5 | ADR on live multi-user editing (property-level merge and fractional order, E-FG-01, E-FG-17, against the single writer) | `docs/design-platform/adr/` | — | — | a decision record with the founder's choice | 2 |

## Critical path

```
T11.1 ─┬─ T11.2 ──────────────────────┐
       ├─ T11.3 ── T11.4 ─────────┐   │
       ├─ T11.5 ──────────────────┼───┤
       └─ T11.6 ─┬─ T11.8         │   └─ T11.7 (after T11.1–T11.6)
                 │                │
T11.9 ───────────┼────────────────┤
T13.1 ── T13.2 ──┴─ T13.4 ────────┴─ T15.2 ─┬─ T15.3, T15.4
          ├─ T13.3                          ├─ T15.5 (also T11.4)
          └─ T13.5 (also T11.4)             └─ T15.6 (also T14.2)
T13.1 ── T14.1 ── T14.2 ── T14.3 ── T14.4 ── T16.4
                              └─ T14.5
T16.2 ── T16.3
T12.1 ── T12.2, T12.3      T12.4 ── T12.5      T12.6, T12.7      (P12 in parallel)
```

**The longest chain** is still T13.1 → T14.1 → T14.2 → T14.3 → T14.4 → T16.4: 33–48 days. P15's longest chain, T11.1 → T11.3 → T11.4 → T15.2 → T15.3, is 25–37 days.

| Phase | Estimate |
|---|---|
| P11 | 24–36 days |
| P12 | 19–28 days |
| P13 | 21–30 days |
| P14 | 26–38 days |
| P15 | 24–35 days |
| P16 | 25–37 days |

**Order:** P11 (T11.1 first) with P12 alongside; P13; P14; P15; P16.

## Qualification strategy

- **In CI on every PR (Linux, macOS, Windows):** unit and property tests of the pure functions (`readLayout`, `snap`, `contextEffects`, token compilation, instance expansion); browser end-to-end tests for every new UI; MCP contract tests (dry run equals commit, staleness, atomicity, idempotency, proposals, revert preview); the migration corpus; the accessibility audit; the scale report with the new workloads.
- **The study's cases as regression evidence:** `scripts/research/ninerr-counterparts.mjs` is rerun at each phase's exit and its report recorded; a case that changes says why.
- **Windows:** the desktop package smoke test and journeys on win32-x64 (in CI), and the gate-13 reference protocol on the reference machine (#275).
- **Real runs:** the seven-project dogfooding (`scripts/dogfood/run.mjs`), extended per phase, on the phase's final main.
- **Negative controls in every phase:** stale revisions; over-limit batches; token alias cycles; deleting a token in use; an instance containing its own definition; malformed paths; hostile imports (scripts, `javascript:` URLs, remote URLs never fetched); a request ID reused by another agent; unknown arguments.
- **Budgets:** each proposed budget in ARCHITECTURE.md §6 is unmeasured until its workload exists; a phase closes only when it is measured on the reference machine and within budget.

## Risks and rollback

| Risk | Phase | Mitigation | Rollback |
|---|---|---|---|
| Strict revisions break existing agents | P11 | one release of warnings first; the setting | turn the setting off |
| Layout view misreads CSS | P12 | `custom` for anything outside the vocabulary; property tests | hide the panel; CSS untouched |
| Schema v2 migration | P13 | version-only migration; corpus; refusal in old builds | v2 files are not opened by old builds; nothing rewritten beyond the version |
| Instance expansion cost | P14 | budgets; invalidation by dependency | detach-all as one transaction |
| Direct agent turns surprise a person | P15 | one transaction per turn, Undo beside the reply, revert preview, review mode, removals always proposed | turn on review mode |
| Model provider and privacy | P15 | off by default; the network policy names one origin | disable the provider |
| Library licenses | P16 | license policy and register before adoption | remove the dependency |

## Open decisions for the founder

1. Approve P11 alone, or P11 to P16. P11 alone lets T11.1 start right after the release gate.
2. Strict revisions in the release after P11 (proposed), or later.
3. Built-in generation applies turns directly with Undo (proposed, ADR-0007 revised), or proposals for every turn.
4. Model providers for P15. Proposed: the person's choice, off by default.
5. Whether live multi-user editing is in scope. T16.5 only decides.

## First PR

**T11.1, "MCP writes take the agent's base revision, and can be dry-run".**

- **`mcp.ts`:** a shared `writeCommon` input-schema fragment (`baseRevision`, `dryRun`, `fromDryRun`) on `create_frame`, `set_text`, `rename_layers`, `set_styles`, `move_layers`, `duplicate_layers` and `delete_layers`. The `edit` helper (line 592) passes `args.baseRevision ?? session.revision`. With `dryRun` it calls `session.preview(...)`, returns a `dryRunToken`, and `delete_layers` asks no confirmation. With `fromDryRun` it commits the token's stored operations if the revision is unchanged. Results gain `committed`, `operations`, `normalized: []`, `ignored: []`, `warnings` (`no-base-revision` when omitted; `unknown-argument:<name>` for each argument outside the tool's schema).
- **`session.ts`:** `#commit` split so `preview(actor, input)` runs exactly what a commit runs before the store write (revision, limits, collaboration authorization, the stylesheet budget, the transaction) and returns `{ revision, operations, affectedNodeIds }`. `changedSince(revision)` lists the `#log` summaries after it, with `truncated` past `MAX_LOG`. The 409 `stale-revision` error carries them.
- **`tests/mcp-server.test.mjs`:** for each write tool, `fromDryRun` commits exactly the dry run's operations and the resulting document equals the dry run's; `fromDryRun` after another actor's change is refused; a stale write is refused with `changedSince` naming that change; a call without `baseRevision` behaves as before and warns; an unknown argument warns; a dry run never changes the revision, the journal or the undo stacks.
- **Evidence rerun:** `scripts/research/ninerr-counterparts.mjs` — E-NX-02 now refused, E-NX-07 now warned; recorded in the PR.
- **`docs/MCP.md`:** the new arguments and warnings.
- **Size:** under 30 KB of diff.
- **Acceptance:** the T11.1 row above.
