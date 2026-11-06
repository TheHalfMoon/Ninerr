# Framer official plugin source: specific implementable API patterns
Date: 2026-11-06. Evidence class: SOURCE_INSPECTED. Pinned Framer public repo HEAD df96c6d0b9427b1157aac5c87a37e39d42348a27, https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27.
Owner Windows checkout at .local-evidence/framer-2026-11-06/src/framer-plugins; git ls-tree and git grep used to verify the files and calls below.
Repository metadata license MIT; verify any assets, dependencies and copied example-specific rights before redistributing.

## Verified repository structure and directly observed calls

The public plugins/ directory contains 32 named plugin examples; packages/ contains code-link-cli, code-link-shared, eslint-config, plugin-tools and vite-config.

| Plugin | Inspected source file(s) | Verified API usage / technical pattern | Ninerr target |
|---|---|---|---|
| design-system | plugins/design-system/src/App.tsx | framer.getColorStyles(), framer.createColorStyle(), framer.addDetachedComponentLayers(), framer.showUI() | Design token/color/semantic component library; avoid duplicate editable store |
| global-search | plugins/global-search/src/utils/indexer/indexer.ts and App.tsx | framer.getCanvasRoot(), framer.getNodesWithType(WebPageNode, ComponentNode, DesignPageNode), framer.getCollections(), framer.getCodeFiles(), framer.subscribeToCanvasRoot(), framer.getNode() | Search local layers/components/code/CMS-style records with project scope, incremental updates and same IDs via GUI/MCP |
| code-link | plugins/code-link/src/api.ts, App.tsx, utils/sockets.ts | framer.getCodeFiles(), framer.createCodeFile(), framer.subscribeToCodeFiles(), framer.getProjectInfo(), framer.subscribeToIsAllowedTo(); code-link shared package and CLI | Source patch/diff workflow, version provenance and permission-aware code changes; no untrusted paths |
| code-versions | plugins/code-versions/src/hooks/useSelectedCodeFile.ts and components/FileDiff.tsx | framer.subscribeToOpenCodeFile(), framer.subscribeToSelection(), framer.getCodeFile(), framer.subscribeToCodeFiles() | Local history/revision timeline for code-linked component, with fail-closed rollback |
| tidyup | plugins/tidyup/src/App.tsx | framer.subscribeToCanvasRoot(), framer.subscribeToSelection(), framer.getNode() | Alignment/spacing cleanup as previewable/undoable native operations |
| cms-export | plugins/cms-export/src/csv.ts, PreviewTable.tsx, App.tsx | Official public example for structured CMS/CSV export (specific API call body to be qualified before port) | Local data/CSV export without mandatory cloud or remote Framer CMS |

The public code-link example has dedicated api.test.ts, app-state.test.ts, messages.test.ts and sockets.test.ts; code-versions includes FileDiff.test.tsx. These are source examples for test design, not evidence the existing Ninerr code passes any parity tests.

## Why this matters for product architecture
Framer's actual public plugin code combines read API discovery, subscriptions, permissions, incremental indexes, CodeFile identity and UI panels. Ninerr already has the canonical document model, local authenticated MCP, history and renderer. Its best migration pattern is an ADAPTER that observes existing studio state, not a wholesale import of Framer service-oriented application code.

- Canvas indexing: subscribe to current project and invalidate on close/switch; only owner-visible nodes and refs, text-only untrusted labels; explicit bounds for 1000+ records.
- Code files: one transaction writer, preserve byte identity on no-op roundtrip; requestId/baseRevision; path permission must come from owner-trusted project root.
- Design styles: use real document tokens and component instances rather than styling generated screenshots.
- Agents: local MCP names and permissions must match GUI semantics; do not copy Framer remote mcp.framer.com endpoint.
- Export plugins: avoid Framer's hosted CMS/publication service as a required workflow; local export to owner-selected path.

## Concrete next code gates

1. SOURCE inspection deeper: record plugin package.json dependencies and copied file notices, especially external UI assets and permissions. No giant repository wholesale copy.
2. PROTOTYPE tests for search service: current Ninerr project data indexes 1000 layers+components+code references; project switch invalidates read sessions; offline packet trap; keyboard focus and accessible query results.
3. Code-linked source tests: unmodified JSX/TSX export bytes identical; code expression preservation; conflict with external file edit fails without overwrite; reviewer preview before commit.
4. Local branching/history: create candidate branch, owner review, merge/reject; two agents conflict, human state preserved.
5. All positive flows must be replayable via installed Ninerr Desktop and authorized loopback MCP on Windows/macOS/Linux.

No source from private Framer editor, account or paid service was accessed in this audit. No product code was changed or shipped. Evidence matches pinned public Git SHA on 2026-11-06.
