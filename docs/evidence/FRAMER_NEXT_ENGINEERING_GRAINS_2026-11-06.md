# Ninerr build queue derived from Framer REA (implementation not yet performed)
Date: 2026-11-06. All tasks require separate branches, exact owner, tests and existing P09/P10 release gates. Maintain Windows/macOS/Linux installed product, one document authority, local MCP, offline and no founder-paid model inference.

| Rank | Grain | Public source used, pinned | Ninerr owner | Exit tests |
|---|---|---|---|---|
| F01 | Motion preview-surface spike | Motion commit 78f3ff51, motion-dom animation/generators, motion-utils and React AnimatePresence | existing renderer/canvas, no document schema rewrite | baseline+reduced-motion, stable final geometry, effect frozen in export, renderer quality and p95 no regression |
| F02 | Source-aware Canvas search | framer/plugins commit df96c6d, plugins/global-search/src/utils/indexer/indexer.ts | studio-host project catalog, studio-web Research, MCP read tools | 1000 nodes, id parity across UI/MCP, project switch invalidates, malicious query safe, no egress |
| F03 | Versioned source/code inspector | same public repo code-link/src/api.ts and code-versions/src/hooks/useSelectedCodeFile.ts, FileDiff.test.tsx | code-ir, studio-host and history | no-op source bytes unchanged, external edit conflicts, undo/reopen, no arbitrary paths, owner approval |
| F04 | Token, instance and property-control inspector | framer/plugins/design-system and official /developers/property-controls | design-components/document-model/studio-web | typed controls and variants, invalid input/ref refusal, persistent token bindings, schema migration and accessibility |
| F05 | Layout cleanup and snap | framer/plugins/tidyup/src/App.tsx, Motion DOM layout modules | canvas and renderer | selection-targeted align/distribute with one undoable transaction, keyboard/mouse same outcome, no cross-project edits |
| F06 | Local reversible agent branch/review | official /developers/reference branching APIs, Framer 3 and remote MCP docs for semantics | visual-git/history/studio-host/MCP | two-agent stale conflicts, owner preview, accept/reject, reproducible project snapshots, no accidental overwrites |
| F07 | Local export/static motion capture | Motion animation and Framer component reference static-render advice | renderer/exporter | identical SVG/PNG/PDF golden frames, no premium/restricted asset export, no remote fonts |
| F08 | Framer-style plugin compatibility *surface* | public Framer plugin configs + SDK methods, not proprietary editor binary | local extension host + agent-supervisor | signed or explicit owner-approved plugin, typed scoped permissions, no remote MCP required, CSP and cancel/revoke test |
| F09 | Local structured collections | Framer CMS official docs and public server-api-examples | import-stack/Research, not a hosted CMS | local CSV/JSON mapping, stable field IDs, unknown schema refusal, no tenant crossover |
| F10 | Optional project website publish | public Framer publisher API/Server API examples as reference only | owner-controlled export+deploy adapter | no hidden user account or Ninerr-hosted service; explicit opt-in only |
| F11 | Private editor source intake | founder-reported direct grant but exact internal repo/archive not delivered | provenance/security owner | source artifact hash + documented exact grant, dependencies, assets, migration and tests before copy |
| F12 | Head-to-head actual editor benchmark | official Framer 2026 docs + authorized test account if available | QA/design research | same 12 task fixtures vs Ninerr installed native app, date/version/access states, observed task quality/time |

## No architecture rewrites
Use already implemented Ninerr document-model, history, visual-git, studio-host, renderer, studio-web, code-ir and mcp-protocol. Every feature creates **native editable nodes or read-only references**; runtime animations are a projection only. New Framer-specific cloud CMS, hosting, remote MCP and account service are not mandatory Ninerr dependencies.

## First sprint sequence after source audit
1. Qualify existing Ninerr P09 source correctness and release branches; do not regress code/source fidelity just to add animation.
2. Prototype **F01** as a bounded opt-in Motion adapter against existing renderer; compare old/new perf and reduced motion, roll back if worse.
3. Implement **F02** against the existing local reference catalog and Research/MCP read tools; avoid a competing DB.
4. Implement **F03** source/history actions, typed permission check and sourcemap preservation.
5. Use F04–F12 only as their dependencies clear. Keep overall progress in NINERR_EXECUTION_BOARD_2026-11-06.json and update only with evidence.
6. Publish no Framer-derived code or third-party raw asset without preserving required grants/notice and testing actual installed apps.

## Current verified vs unverified
Verified: public GitHub repo inventory, plugin code usages, Motion source code paths/license, public developer APIs and four website captures. Unverified: complete internal Framer editor source, authenticated Framer editor comparison, legal terms of founder's direct grant, actual Ninerr parity/feature tests. Code was NOT changed to implement any of F01–F12 in this research branch.
