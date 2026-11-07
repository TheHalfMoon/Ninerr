# Framer → Ninerr: Verified API-Gap and Port Contract
**2026-11-07 · Corrected after OpenCode/Nemotron source review**

**Status:** RESEARCH ONLY. A working `opencode/nemotron-3.5-lightning-free` build agent inspected source and produced an initial ten-API map. Independent validation found that several entries were **not feature-equivalent**. This corrected contract distinguishes existing partial capabilities from **missing functionality**. No product functionality or tests are claimed as implemented.

## Evidence and permissions

- Framer plugin source: https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27 (public MIT repository; inspect per-file dependencies/assets).
- Framer agent client descriptors: https://github.com/framer/agent-plugins/tree/2fb4aa5d8030b6dcda7f33ffd4791388b356f7d8 and its `.mcp.json`, which identifies `https://mcp.framer.com/mcp` as a **remote** endpoint. The separate `framer/plugin-oauth` repo is an OAuth worker example; **do not describe it as the source implementation of the remote MCP service**.
- Ninerr source inspected: `packages/studio-host/src/mcp.ts` (tools and authorization) and `packages/renderer/src/index.mjs` (sandboxed **document** rendering). Ninerr's repository `LICENSE` is **Apache-2.0**, NOT MIT.
- Founder states direct permission to copy Framer materials, but this audit did not receive Framer's private editor source/grant text; public plugin code is not the complete internal editor. Motion's MIT license is independent.
- Evidence class: **S** public source inspected; **P** current Ninerr partial analogous behavior; **G** material feature gap; **U** behavior unverified without running signed-in Framer editor or native Ninerr acceptance journeys.

## Exact ten-API review — existing behavior versus required feature

| Framer documented/plugin call | Current Ninerr behavior observed | Parity classification | Correct next implementation / test |
|---|---|---|---|
| `getColorStyles()` (design-system `src/App.tsx`) | `layer_details` / `project_info` may show individual node style data; **not a named global color style registry** | **G** | Define canonical token/color-style read operations; test stable IDs, aliases, references and persistence |
| `createColorStyle()` (design-system `src/App.tsx`) | `create_frame` and style operations edit nodes, **not reusable named color styles** | **G** | Add a typed, undoable design token create/update operation, test instance propagation |
| `getCanvasRoot()` (global-search `utils/indexer/indexer.ts`) | `project_info` returns root layer summaries; `layer_tree` traverses root/node tree (max 500 nodes) | **P** | Confirm root identity and ordered children, project-switch isolation, truncation semantics via UI and local MCP |
| `getNodesWithType()` (global-search indexer) | `find_layers` filters document node types/tags and substring queries, with result cap 500 | **P** | Exact type mapping; >500 pagination/indexing; stable IDs and performance, unlike limited result retrieval |
| `getCodeFiles()` (code-link `src/api.ts`) | `layer_code` exports a *selected layer subtree* to JSX; **does not list Framer-style code files** | **G** | Introduce safe source-file inventory/metadata and ownership model, preserve expressions and no-op bytes |
| `subscribeToCodeFiles()` (code-link `src/App.tsx`) | `requireMCPToolCall`, confirmations and edit history authorize **individual calls**; they are **not a change subscription** | **G** | Design revision-scoped local code-file event stream; test add/edit/delete notifications, resubscribe, stale conflicts |
| `subscribeToCanvasRoot()` / `subscribeToSelection()` (tidyup `src/App.tsx`) | `layer_tree` and `selection` return **snapshots** only, not live subscription events | **P+G** | Add bounded session-scoped events, cancel and project-switch handling; no cross-workspace leakage |
| `getCodeFile()` (code-versions `hooks/useSelectedCodeFile.ts`) | `layer_code` provides rendered JSX for a node, **not the original CodeFile bytes/metadata/version history** | **G** | Read actual project code file through trusted root, version/history, byte-accurate source-preservation tests |
| `subscribeToIsAllowedTo()` (code-link `src/App.tsx`) | `requireMCPToolCall` checks access for an operation; **does not subscribe to permission changes** | **P+G** | Permission-change notifications or invalidate-on-revoke; test denial without leaked data or stale approvals |
| `showUI()` (design-system/global-search `src/App.tsx`) | `mountSandboxedRenderer` renders **design document output in an iframe**, not a plugin dialog/panel | **G** | Separate scoped extension UI host with focus, dismiss, size, CSP, permissions and native accessibility tests |

**Critical distinction:** An analogous read tool or CSS style is not an API-compatible drop-in replacement. CodeFile, design token, event subscription and plugin UI are **gaps** even when Ninerr has relevant infrastructure.

## Source-driven implementation contracts, not yet executed

1. **F01 — Core local read parity:** `getCanvasRoot`, `getNodesWithType`, selection. Validate exact IDs, 500+ record behavior, project switch and scope against current `mcp.ts`. Add bounded indexing/pagination where required.
2. **F02 — Named design styles:** persist stable named color/design tokens and references in the **existing canonical document**; expose authorized read/create/update via UI and local MCP with undo/reopen tests.
3. **F03 — CodeFile parity:** inventory files, read original bytes, source-safe minimal diffs, file revisions, owner-approved write and live subscriptions. Do not conflate `layer_code` with source file APIs. Re-test JSX/TSX expression preservation and stale conflicts.
4. **F04 — Live project/permission subscriptions:** bounded typed events plus cancellation, version IDs, revocation, replay and cross-project non-disclosure. `selection()` is a snapshot until this exists.
5. **F05 — Extension UI host:** a plugin panel is not a user design frame. Build separate trusted UI surface and scoped capabilities; verify keyboard focus, unmount/cleanup, CSP and permission changes.
6. **F06 — Motion effects:** independently evaluate MIT Motion packages for spring/drag/layout previews **without** replacing Ninerr document model or requiring Framer servers; deterministic export and reduced motion are gates.

For each contract, include unit, integration, permission, offline/e2e and installed native desktop tests before claiming Framer-equivalent behavior. The 12-task benchmark fixture plan is in `docs/evidence/FRAMER_REPRODUCIBLE_BENCHMARKS_2026-11-06.md`. **None of these new tests was run by this report.**

## What the Nemotron execution established

- OpenCode successfully ran `opencode/nemotron-3.5-lightning-free`, first producing the expected `READY`, then completing a **build agent read/write** job with exit code 0 on the authorized Windows computer.
- It read Framer's public local checkouts plus existing Ninerr files and created this report file. This document has been independently corrected to remove false one-to-one equivalence claims and the incorrect Ninerr MIT license assertion.
- No proprietary Framer source, logged-in Framer project data, private endpoint, paid inference or Codex was used. No Ninerr production source was changed.
- Implementation and benchmark work remains pending; this is an engineering **port contract and risk register**, not a feature completion receipt.

### Source and prior evidence
- `docs/evidence/FRAMER_REA_INDEX_2026-11-06.md`
- `docs/evidence/FRAMER_PLUGIN_SOURCE_AUDIT_2026-11-06.md`
- `docs/evidence/FRAMER_MOTION_SOURCE_AUDIT_2026-11-06.md`
- `docs/evidence/FRAMER_API_CAPABILITY_MAP_2026-11-06.md`
- `docs/evidence/FRAMER_RIGHTS_AND_ACCESS_LEDGER_2026-11-06.md`

**Review gate:** Keep PR #375 in Draft, run the identity and exact-head CI checks, confirm license/provenance and prioritize F01/F02/F03 separately. Do not merge or release on the strength of this research alone.
