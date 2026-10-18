# Agent and MCP contract, version 2 (proposal)

Status: proposal, not approved ([README](README.md)). It extends the MCP server at `packages/studio-host/src/mcp.ts`, which today has 16 tools, with the catalog in `packages/mcp-protocol/src/tools.mjs`. The rules in `docs/MCP.md` stay as they are:

- every tool authorized per document;
- each write one attributed transaction;
- `delete_layers` approved by the person in the editor.

## Why

Evidence:
- **One studied product** applies a batch partly and reports per-item errors (E-PD-12). It drops styles, sometimes silently (E-PD-06). Its only version stamp covers tokens (E-PD-03).
- **Another** writes through arbitrary plugin code and documents no atomicity or undo, advising a backup instead (E-FG-05).
- **The Design artifact type** published on claude.ai, whose link to the Claude Design product is unknown, refuses a stale file write and has the agent re-read and retry (E-CD-06).

Ninerr already applies each agent write atomically, with an inverse and attribution. What it lacks:
- **A precondition:** every write runs at the session's *current* revision (`mcp.ts:592`, `baseRevision: session.revision`). So an agent that read revision 40 can overwrite a change made at revision 41 that it never saw.
- **A dry run.**
- **A person-visible proposal.**
- **A report of what the host normalized.**

## The contract

### Versioning

- The server advertises `ninerr.contract: 2` in its `initialize` result.
- Version 1 calls (no `baseRevision`) keep today's behaviour, and the reply carries `warnings: ["no-base-revision"]`.
- A project setting, `agents.requireBaseRevision`, makes version 2 strict: off by default for one release, then on.

### Every write tool gains

```ts
type WriteCommon = {
  baseRevision?: number;   // the revision the agent last read; refused with "stale-revision" if the document has moved on
  dryRun?: boolean;        // validate and compute everything; commit nothing
  requestId?: string;      // ≤ 64 chars; a retry with the same id and arguments returns the first result, without committing again
  fromDryRun?: string;     // the dryRunToken of an earlier dry run: commit exactly its operations, if the revision is unchanged
};

type WriteResult = {
  committed: boolean;      // false for a dry run
  revision: number;        // the new revision, or for a dry run the revision it was computed against
  transactionId?: string;
  affectedNodeIds: string[];
  operations: Operation[]; // the exact history operations, in the journal's form
  dryRunToken?: string;    // dry runs only: valid for 5 minutes, for this actor, at this revision
  normalized: Array<{ nodeId: string; field: string; from: string; to: string; reason: string }>;
  ignored: Array<{ nodeId: string; field: string; reason: string }>;  // nothing is ever dropped silently
  warnings: string[];
};
```

- **New IDs and dry runs:** tools that mint IDs (`create_frame`, `duplicate_layers`) mint them again on each call. So a later commit is compared with its dry run by passing `fromDryRun`, which commits the dry run's own operations, IDs included.
- **Stale writes:** refused with `{ code: "stale-revision", currentRevision, changedSince: [{ revision, actor, actorKind, intent, affectedNodeIds }], truncated }`, so the agent can re-read only what changed.
  - `changedSince` comes from the session's history log, which holds at most 500 entries. Entries loaded from the journal on reopen carry no affected IDs.
  - When either applies, `truncated: true`, or `affectedNodeIds: null`, tells the agent to re-read everything it depends on.
- **Errors** are typed, with codes from a closed set: `stale-revision`, `invalid-operation`, `not-found`, `refused-by-person`, `limit`, `conflict`, `forbidden`. Each carries the operation index that failed. Nothing is applied when any operation fails: the batch is atomic, as today.
- **Idempotency:** a `requestId` is remembered with its result for 10 minutes, or 1,000 entries, keyed by actor, document, tool and arguments hash.
  - A repeated `requestId` with *different* arguments is refused with `conflict`.
  - Before a cached result is returned, authorization is checked again.
  - Errors (`stale-revision` and others) are not cached.
  - A replay never reuses a person's approval.
- **Dry runs and approval:** a dry run of a destructive tool never asks the person, because it commits nothing. The approval is bound to the operations hash of the call that commits.

### New tools

| Tool | Class | What it does |
|---|---|---|
| `apply_operations` | write | A typed batch of history operations (`insert-node`, `remove-node`, `restore-subtree`, `set-props`, `move-node`), validated and committed as one transaction. Limits: 5,000 operations or 1 MiB. Removing a node keeps the person's approval as today. |
| `propose_change` | write | The same input as `apply_operations`, plus an `intent` and an optional `rationale`. It is not committed: the editor shows it as a proposal with a preview overlay and the list of changes. The person accepts or rejects it, and the agent waits, as `delete_layers` does today. An accepted proposal commits as the agent's transaction (so Undo agent change reverts it). A rejected one is reported to the agent. |
| `outline` | read | A sparse tree for a node (id, type, name, tag, size, child count) to a depth limit, with the revision. Cheaper than `layer_tree` for large documents (compare E-FG-04 `get_metadata`, E-PD-01 `get_tree_summary`). |
| `computed_styles` | read | Each node's style as the canvas draws it, with token bindings shown as `var(--…)` and their resolved values. |
| `layer_image` | read | A PNG of a layer, drawn by the open editor's renderer. Unavailable, and saying so, when no editor is open. Nothing leaves the computer. (T11.8) |
| `align_layers` | write | Align or distribute layers, with the same pure function as the canvas (T12.5) |
| `design_system` | read | Tokens (per collection and mode), components with their properties, and where each is used. |
| `search_design_system` | read | Find tokens and components by name, value or use (compare E-PD-10 `find_nodes`, E-FG-04). |

The existing `guide` tool gains a section on version 2, telling agents:
- read first;
- pass `baseRevision`;
- use `dryRun` or `propose_change` for anything larger than a few layers.

### Proposals: integrity

- **Who accepts:** only the project's owner, in the editor, can accept.
- **What is accepted:** the accept names the proposal ID *and* the hash of its operations, so the agent cannot change the content after the preview.
- **Staleness:** the revision is checked again at accept time.
- **Removes:** listed explicitly in the preview.
- **Limits:** at most 5 pending proposals per agent, and 8 MiB of them.

### Permissions

| Class | Permission |
|---|---|
| Reads | the existing per-document authorization |
| Writes | the existing write permission |
| `propose_change` | the write permission; its effect waits for the person |
| `apply_operations` | its class depends on its arguments: `consequential` when the batch removes nodes, otherwise `write`. `packages/mcp-protocol`'s static per-name classes (`tools.mjs`) gain an argument-aware classifier for this one tool (T11.3). |
| Destructive operations inside a batch or proposal | the person's approval, as `delete_layers` |

A future project setting may require proposals for every agent write ("review mode").

### Audit receipts

- Every committed agent transaction is already attributed in the journal: actor, tool, intent.
- Version 2 adds `requestId`, `baseRevision` and, for proposals, the proposal ID and the person's decision time, all to the transaction's provenance.
- The history panel shows them.

## Prompt to canvas: Ninerr's flow (proposed; not observed in any product)

1. The person describes a change, optionally with a selection or comment as context.
2. The agent (built-in or external) reads `outline`, `design_system` and `computed_styles` for the context, at revision R.
3. The agent forms a structured intent, for example *add a pricing section with three tiers using the Card component and the brand tokens*. It compiles the intent into operations against the design system: components, tokens, layout CSS.
4. `apply_operations` with `dryRun: true, baseRevision: R` validates the batch and returns `normalized` and `ignored`. The agent fixes what was ignored.
5. `propose_change` with `baseRevision: R` shows the preview. The person accepts, rejects, or asks for changes, which repeats from step 3.
   - A stale `R` returns `changedSince`, and the agent recomputes against it.
6. An accepted proposal commits one attributed transaction. Undo agent change reverses it.
7. Typed levers, as in E-CD-05: a proposal may declare up to 8 levers (`{ name, kind: "color" | "length" | "number" | "choice", bindsTo: { nodeId, field } }`). The person adjusts them in the preview before accepting, and the final values are part of the transaction.

## Tests the contract requires

- **Equivalence:** for every write tool, the operations a dry run returns equal the operations the commit records, and the document after the commit equals the dry run's predicted document.
- **Staleness:** a write at an old `baseRevision` is refused after any other actor's change, and `changedSince` lists exactly those changes.
- **Atomicity:** a batch whose last operation is invalid changes nothing, and names the index (contrast E-PD-12).
- **Idempotency:** a retried `requestId` commits once. The same `requestId` with other arguments is refused.
- **Proposals:** accept commits exactly the proposed operations, attributed to the agent. Reject commits nothing. Undo agent change reverts an accepted proposal.
- **No silent drops:** a style the renderer would drop appears in `ignored`.
- **Negative controls:**
  - a tool call with a node from another project;
  - a 1 MiB plus one byte batch;
  - a cycle-creating move;
  - a `requestId` reused by another agent, which is not shared across actors.
