# Ninerr ↔ Framer: First Implementable Source-Driven Work Orders

Date: 2026-11-06. Source-based REA tranche, not an assertion of full Framer core-editor access. Canonical Ninerr product: installed Windows/macOS/Linux desktop, offline-first, one document model and local MCP. All outputs stay in user-controlled files. No mandatory Framer cloud, Ninerr inference endpoints, hosted CMS, remote MCP or founder-paid compute.

## Actual current Ninerr anchors

- packages/renderer/src/index.mjs: its own CSS renderer with animation declarations and scoped renamed keyframes. Do not layer a second rendering authority on top of it.
- packages/canvas/src/index.mjs: existing canvas interactions and editable operations.
- packages/studio-host/src/mcp.ts: existing local loopback MCP, auth and project-scoped tools. Existing versions include reference reads. Do not substitute Framer's remote OAuth MCP for Ninerr local MCP.
- packages/document-model, packages/history, packages/persistence and packages/studio-web: canonical document, transaction, persistence and presentation. Read exact latest code and active PRs before editing.
- packages/code-ir: source and JSX code round-trip. Source-preserving behavior remains a release gate.
- packages/design-components and packages/visual-git: candidates for component instances and branch/snapshot semantics, but inspect current behavior and tests before making parity claims.
- packages/import-stack: existing safe import and rights-aware reference foundations.

## Port matrix (research-proposed)

| Framer/Motion capability | Source evidence | Decision | Ninerr implementation anchor | First qualification |
|---|---|---|---|---|
| Motion React animations, presence, springs | https://github.com/motiondivision/motion/tree/78f3ff51b5508f7e8c1c283d8e80bcd26fec37d7/packages/framer-motion | ADAPT existing code where compatible | renderer/canvas plus optional component/effects adapter | snap/animation vs reduced-motion, undo does not change canonical node identity |
| Motion DOM timeline and scroll gestures | https://github.com/motiondivision/motion/tree/78f3ff51b5508f7e8c1c283d8e80bcd26fec37d7/packages/motion-dom | PORT selectively | renderer preview and canvas prototype, never project data authority | offline playback, abort/replay, performance, no hidden egress |
| Motion utility easing/math primitives | https://github.com/motiondivision/motion/tree/78f3ff51b5508f7e8c1c283d8e80bcd26fec37d7/packages/motion-utils | REUSE if justified | pure helper functions near renderer and duration interpolation | deterministic unit/property tests, MIT notices |
| Framer Canvas node plugin API | https://www.framer.com/developers/reference | ADAPT documented operation semantics | studio-host/session + document-model + MCP | create/clone/move/remove on same document via UI + local MCP, stable IDs, undo |
| Framer code file APIs and typecheck | https://www.framer.com/developers/reference | ADAPT, not clone internals | code-ir/host, source write-back | expression preserved, unsupported JSX/TSX/Astro fail closed, no arbitrary path writes |
| Framer Branching API and agent rollbacks | https://www.framer.com/blog/framer-3/ | DESIGN locally with existing history/visual-git | visual-git/history/studio-host | two isolated branches, preview/merge/reject, human edits preserved |
| Framer 2026 remote MCP + editable changes | https://www.framer.com/help/articles/what-you-can-do-with-framer-mcp/ | REINTERPRET locally | existing Ninerr loopback/stdio MCP | human+agent editing parity with project permission and stale-revision checks |
| Official design-system plugin | https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/design-system | SOURCE INSPECT then ADAPT | design-components/tokens/Research UI | token alias and binding checks, no second design model |
| Official code-link + code-versions plugins | https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/code-link | SOURCE INSPECT then ADAPT | code-ir/source provenance/history | no-op source bytes identical, version history preserved |
| Official global-search + tidyup plugins | https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/global-search | SOURCE INSPECT then ADAPT | Research UI/canvas inspector | search 1k elements, selection/focus, no out-of-scope results |
| Official Framer Server API and publishing | https://github.com/framer/server-api-examples | DEFER backend; copy only protocol insights | local export/publish from user machine | reproducible output and optional user-deployed hosting with no Ninerr server |
| Proprietary Framer editor internal source | no public full editor repo found in enumerated Framer org | REQUIRES EXACT AUTHORIZED SOURCE DELIVERY | to be evaluated against existing Ninerr engine after access and audit | pinned source checksum, scope grant, dependency/license/notice check |

## Ordered independent engineering grains

**F01 — Pin and test Motion without rewriting renderer.** Read the exact public Motion source package graph, pin revision and MIT notice, inspect Electron CSP requirements and animation performance. Implement a tiny optional prototype adapter on a branch. Tested snapshots: scroll animation, spring, entrance/exit, drag with reduced-motion and keyboard equivalent; canceled agent action cannot leave dangling animation or hidden state.

**F02 — Source-aware Canvas parity.** Framer documents createFrameNode, removeNodes, cloneNode, getNode, getParent, getChildren, getRect, set/getSelection. Map each to a typed Ninerr operation or explicitly document a gap. No arbitrary JS eval, no undocumented Framer API access. Compare UI intent and MCP intent on identical fixture -> canonical document hash and full undo history.

**F03 — Framer-style safe branching without cloud.** Use Ninerr visual-git/history to create local experiment branches, deterministic preview, owner merge/reject, and replay/revert. A branch always references owner-controlled project snapshots and keeps permissions; malicious agent cannot switch target branch silently.

**F04 — Animation inspector + design tokens.** Add editable animation properties and token bindings, with source round-trip preserving the original JSX/CSS. Test accessibility, component override interactions, breakpoint variants and offline export.

**F05 — Code and version source integrity.** From official public plugins/code-versions and code-link, study code-file UI, version browsing, component reusability and inspector affordances. Adapt in Ninerr with byte-preserving no-op export, minimum diffs for edits, fail-closed unknown syntax and transaction-bound writes.

**F06 — Research + reference-to-design.** Bring actual rights-verified local Framer sample assets into Ninerr's existing reference-pack format via actor-authorized export. Search through GUI and MCP with equal permissions; restrict private/license-unknown; require preview+owner approval before editable native node creation.

**F07 — Measured competitor benchmark.** With a legally accessible Framer test project, compare a new responsive landing page, component variants, animated prototype, CMS-like local data collection, two-agent concurrent changes and code round-trip against actual Ninerr installed app. Record task IDs, signed-in version and plan limitations, exact device, screenshot hashes, finish time, quality/errors and access rights. Without such project, feature status remains OFFICIAL_DOC or UNKNOWN rather than OBSERVED_EDITOR.

## Founder legal declaration vs actual access

The founder reports a direct comprehensive Framer copying/rebranding permission. Respect that direction and maintain a source-specific grant ledger. The public repos can be inspected now. A verified grant and a copy of Framer proprietary source are still needed before asserting that Ninerr has obtained/ported the entire private editor, paid services or third-party marketplace assets. MIT Motion source and official MIT examples are separately available. Do not counterfeit license evidence, access controls, network authorization or publish unapproved content.

## Task completion definition

A grain is done only when actual source is pinned; diff is peer-reviewed; exact-head automated unit/integration/native desktop tests pass; local MCP parity and permissions (when applicable) pass; no cloud expense or private data leakage appears; and the relevant feature works in a real installed Ninerr app. Never describe a public marketing-page inspection as a passed design-editor benchmark.
