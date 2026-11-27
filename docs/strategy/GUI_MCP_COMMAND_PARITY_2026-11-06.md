# Ninerr GUI ↔ Local MCP Command Parity Inventory
Date: 2026-11-06
Status: source-inspected design-contract audit, **not all features implemented**.
Baselines: Ninerr main `8cba15c4e4af40b12476433a49e20a1696cfc0f8`; `packages/studio-host/src/server.ts` route map (~lines 230–393); `packages/mcp-protocol/src/tools.mjs` tool catalog; `docs/MCP.md`.
Reason: EGM Goldfish G05-3 / G06-12 found that “every GUI command available via MCP” was undefined and contradicted by source.

## Source-verified MCP surface on current main
16 tools: **9 read** (`project_info`, `layer_tree`, `layer_details`, `layer_children`, `find_layers`, `selection`, `layer_code`, `guide`, `finish_task`), **6 write** (`create_frame`, `set_text`, `rename_layers`, `set_styles`, `move_layers`, `duplicate_layers`) and **1 consequential** (`delete_layers` with confirmation).

`packages/studio-host/src/mcp.ts` shares `StudioSession.edit` with the local UI but not its entire route surface. It requires a valid agent, access policy, prior reading of the open project, and confirmation for consequential operations. The `stdio` relay `scripts/ninerr-mcp.mjs` currently forwards to a running loopback host; **this relay is not bundled as a standalone Node CLI in released Electron installers**. The installed app's loopback HTTP is a separate, credentialed transport.

## Actual GUI operations vs today’s MCP equivalents

| GUI/host function | HTTP route(s) | Closest MCP | Actual parity on main | Post-v1 decision |
|---|---|---|---|---|
| Read current document/layers | `GET /api/document` | `project_info`, `layer_tree`, `layer_details`, `layer_children`, `find_layers` | PARTIAL (different summary shape and fields) | stable ID and read-schema parity fixture |
| Show selected layers | `POST /api/selection` | `selection` (read) | READ ONLY | write selection via explicit intent or documented exclusion |
| Create frame | `POST /api/edit` typed create op | `create_frame` | IMPLEMENTED for supported schema | same-operation document hash oracle |
| Change text/style/name | `POST /api/edit` | `set_text`, `set_styles`, `rename_layers` | IMPLEMENTED for supported subset | class/variant/constraints coverage separate |
| Move/duplicate/delete layers | `POST /api/edit` | `move_layers`, `duplicate_layers`, `delete_layers` | IMPLEMENTED for supported subset; confirmation differs | grouping/reparent/keyboard parity to qualify |
| Undo, redo, agent revert | `POST /api/undo`, `/api/redo`, `/api/revert` | NONE | GAP | design new reversible transaction semantics; do not claim agent redo |
| History/checkpoint | `GET /api/history`, `POST /api/checkpoint` | NONE | GAP | read-only history view to MCP; checkpoint owner-only if consequential |
| HTML review/import | `POST /api/import`, `/api/import/commit`, `/api/import/discard` | NONE | GAP | MCP read/preview only at first; commit with human review |
| JSX read/export | `POST /api/code/export` | `layer_code` | PARTIAL (layer representation only) | explicit export scope and file handling |
| JSX import | `POST /api/code/import` | NONE | GAP | isolated proposed import + review/commit |
| Codebase linked import | `POST /api/codebase/connect`, `/disconnect`, `/import` | NONE | GAP | human-owned authorization; agent may request a proposal, not grant arbitrary path |
| Codebase write-back | `/api/codebase/preview`, `/resolve`, `/write` | NONE | INTENTIONAL HUMAN-ONLY until source writes have a separate policy | gate production file write-back by explicit human approval and trusted root |
| Create/revoke agents | `GET /api/agents`, `POST /api/agents/create`, `/revoke` | NONE | INTENTIONAL ADMIN-ONLY | no agent self-grant/revoke through ordinary MCP |
| Review consequential requests | `GET /api/confirmations`, `POST /api/confirmations/decide` | NONE | INTENTIONAL HUMAN-ONLY | an agent must not approve its own write |
| Project create/open/close | `/api/projects/create`, `/open`, `/close` | `project_info` only | GAP (requires an already-open project) | headless local host + project read/select gated by #364 |
| Project Research/Assets/Lens | not yet wired | NONE | NOT IMPLEMENTED | rights-gated local pack catalog + MCP query under #365/#367/#366 |

Status `IMPLEMENTED` refers to the presence of a source path, **not proof that identical UI and MCP document/history outputs passed an exact-head test**.

## Versioned interface goals

### v1 production contract
- One installed Electron document editor + local MCP *as actually packaged*, where available.
- Expose exactly the existing 16 tool names with user grants; do not advertise missing project management, history, codebase writes, Research or packaged headless stdio.
- `docs/MASTER_PLAN.md` P09 and P10 are the canonical release gates. Human controls like Undo and codebase writes need not magically be MCP tools in v1 if not in the current approved surface; disclose exclusions.
- No cloud services or account required; validate no non-loopback egress from privileged main and child processes before marking offline assurance complete.

### P11+ agent-native contract (requires approval + implementation)
- `apply_operations` and `propose_change` under existing `docs/design-platform/AGENT_CONTRACT.md` and ADR-0006 rather than an unbounded generic `edit` tool.
- Typed `baseRevision` supplied by the **caller** rather than silently rewritten with server's current revision.
- Unique request ID/idempotency, bounded proposal diff and no-side-effect `dryRun`; independent confirmation; atomic one-transaction commit; stale revision error and safe retry.
- Explicit `history`, `revert` and `reapply` operations with human/agent interleavings, not unqualified Undo/Redo claims.
- Installed stdio helper (or authenticated local HTTP alternative) works without requiring a development checkout or installed Node, with per-user root selection and token-safe setup.
- Read-only `search_design_references` / `get_design_reference` operating on user-approved project packs, followed by rights-verified `propose_reference_apply`.

## Required parity acceptance tests
1. For each command that is advertised as `parity supported`, execute the equivalent human route and MCP intent independently on identical fixture projects; compare normalized **document state**, history/revision and reference IDs, not raw HTTP schema equality.
2. Denied or stale MCP requests leave document and on-disk journal untouched; UI confirmation must not be spoofed by the agent.
3. A user may close/reopen the editor without accidentally granting an agent access to a different project; require re-read when project identity changes.
4. Verify installed packaging of chosen local transport on all supported OS targets, with a user account without Node/npm.
5. Record all excluded GUI commands and never advertise “all features accessible by agents” until the matrix and tests prove the claim.

## Non-actions
No code changes, permission escalation, deployment, private file access, agent credential generation or release is performed by this inventory. It is a corrective specification prompted by independent Google EGM review.
