# Ninerr REA — Primary-source competitor findings (first verified tranche)
Date: 2026-11-06
Status: desk-reviewed primary sources; **NOT** qualified live editor head-to-head testing.
Related: `docs/strategy/DEEP_REA_OPENCODE_CRAFT_ANYTHING_2026-11-06.md`, `docs/strategy/DESKTOP_FIRST_AGENT_NATIVE_BLUEPRINT_2026-11-06.md`.

## Evidence legend
- **OBSERVED_TOOL**: personally captured behavior or tool result on the exact target, with date/environment.
- **OFFICIAL_DOC**: a source-owner's docs or announcement; capability may have plan/version restrictions.
- **INFERRED**: interpretation, not independently reproduced.
- **UNKNOWN**: requires signed-in editor, installed app, API entitlement, license permission, or missing fixture.

A public product website is not the authenticated editing application. Do not turn self-reported vendor performance into cross-product scoring.

## 1. Stacki — source-code integrity is core UX

Owner docs: https://stacki.build/docs/introduction/ ; https://stacki.build/docs/how-editing-works/ ; https://stacki.build/docs/code-editing/ ; https://stacki.build/docs/quick-start/
Evidence: OFFICIAL_DOC, documentation accessed November 6, 2026. Live public homepage open was separately OBSERVED_TOOL on Windows Edge using Craft Anything `v0.3.0`: `https://stacki.build/`, title Stacki, 848 DOM elements, 15 images, 24 links, no failed network requests in tool output; the actual editor was NOT tested.

Documented differentiators:
- Works directly on real Astro files, no second design document project format or mandatory account/cloud.
- Editor parses layout, elements, component instances, text, expressions, loops, conditions and raw code blocks. Only writes the edited node's serialization.
- Official claim: **53 of 54 real files** round-tripped byte-identically with no edits. This is a Stacki-reported sample, NOT independently replicated.
- Unrepresentable markup falls back to the code editor; unsupported source is not destructively "partially converted".
- Project's own `astro dev` generates preview with temporary markers for selection; direct CSS, component props, content collections and breakpoints remain in the source.

Ninerr consequence: `packages/code-ir` + `studio-host/code.ts` must implement **source-preserving/no-op equivalence** on Astro/JSX. Treat file-byte integrity, fallback and external edit conflict resolution as release blockers, not nice-to-have UI features.

New tests:
- SRC-001: zero-edit corpus, byte-by-byte SHA identity and untouched mtime; include unusual quote styles, loops/conditions, comments, multi-line props, no frontmatter and nested dynamic routes.
- SRC-002: update one class on one node; diff must contain only that node's permitted span, and re-render must match intended layout.
- SRC-003: unknown AST node -> code-only view; never rewrite the file or pretend to have imported it.
- SRC-004: external Git/worktree change while editor is open -> stale conflict with original preserved and resolution UI.

## 2. Paper Desktop — installed stdio MCP as an agent product surface

Owner docs: https://paper.design/docs/mcp ; https://paper.design/docs/support
Evidence: OFFICIAL_DOC, not a tested signed-in Paper document.

Documented differentiators:
- The installed Paper Desktop app launches a local MCP server; installed Paper CLI can be configured with OpenCode and other agents via stdio.
- The `paper mcp` bridge can register tools even if Desktop is closed, and forwards reads/writes when app/file is available.
- HTTP loopback remains for older clients; native app selection, direct editable HTML/CSS model and keyboard/pen/vector shortcuts matter.

Ninerr consequence: make **headless-usable local MCP** first-class rather than only an HTTP relay to an open Electron window. The currently implemented Ninerr `scripts/ninerr-mcp.mjs` expects an already running host, so parity is UNKNOWN and requires implementation.

New tests:
- MCP-017: install package, close UI, start configured stdio client; `initialize` and `tools/list` are responsive and provide actionable "open project" behavior without cloud.
- MCP-018: connect two clients to same authorized workspace, close/reopen UI; state/revision/auth remain consistent, no leaked localhost bearer credentials.
- MCP-019: malicious web origin targets loopback MCP; without session token/intent, no observable project metadata or mutation.

## 3. pen.dev / Pencil — repository-native document and agent tool contracts

Owner docs: https://www.pen.dev/faq ; https://docs.pen.dev/getting-started/ai-integration
Evidence: OFFICIAL_DOC, not a live .pen editable test.

Documented differentiators:
- Desktop, IDE extension and CLI; JSON-based `.pen` design files can live in Git alongside images/fonts/libraries.
- An agent can use integrated model or external MCP client; user can bring an own model/provider (subject to terms/availability).
- Supports Figma .fig/paste and website import, with HTML/CSS/Tailwind and raster/PDF export advertised.

Ninerr consequence: all Ninerr documents must be user-owned portable files, with explicit media dependencies, schema migrations and text-diff/semantic-diff inspection. No database-locked artifact that cannot be backed up or versioned.

New tests:
- DOC-001: copy project plus asset folder to second machine, reopen offline without orphaned fonts/images/links.
- DOC-002: independent read-only agent and GUI inspect same document ID, token bindings and layer graph after restart.
- DOC-003: intentionally incompatible version opens read-only/error with migration guidance, never silent corruption.

## 4. Figma MCP — native write-back, design-system correctness and seat constraints

Owner docs: https://developers.figma.com/docs/figma-mcp-server/ ; https://help.figma.com/hc/en-us/articles/39216419318551-Get-started-with-the-Figma-MCP-server
Evidence: OFFICIAL_DOC. Authenticated native canvas writing NOT TESTED.

Documented differentiators:
- Agents can read native design data and write frames, components, variables and auto layout; full design-system context is the intended approach.
- Remote MCP has the broadest feature coverage; desktop MCP has plan/seat restrictions. Figma writing currently beta/subject to future paid limits per current documentation.

Ninerr consequence: any externally connected agent must create **genuine editable** Ninerr nodes and existing component/library usages, not bitmap renders or disposable HTML previews. Ninerr differentiation is fully offline local MCP with no founder service bill.

New tests:
- DS-001: agent builds three screens using real existing variants and tokens; audit reports zero detached clones/unbound hardcoded styles where real equivalents exist.
- DS-002: 100 component instances update after a library token/variant change and correctly reset overrides.
- AG-001: agent makes ten edits, a human changes one layer, undo/replay preserves human work and permits audit of each operation.

## 5. Framer 3 — whole-site agent, safe branching, code and CMS context

Owner: https://www.framer.com/blog/framer-3/ (June 16, 2026)
Evidence: OFFICIAL_DOC, agent production workflows not reproduced.

Documented differentiators:
- Canvas-native agents can create pages, adjust breakpoints/components/effects, write code components, operate CMS content and audit links/accessibility.
- Branching isolates experiments and offers review/merge. External agents can operate on existing workflows.

Ninerr consequence: history alone is not enough for safe multi-agent product design; agents should propose changes on isolated revision branches for complex jobs and show visual + semantic diff before accepting. A full distributed source control engine is not required for v1: start with local session branches/reversible proposals on the existing journal.

New tests:
- BR-001: two design alternatives share a base revision; keeping variant A cannot contaminate B or other user edits.
- BR-002: stage a multi-screen agent flow, inspect visuals and changed native nodes, then accept as one undoable revision.
- SITE-001: dynamic content and responsive test at 390, 768, 1440px; broken link and keyboard audit.

## 6. Adobe — multi-step creative production, preflight, editable outputs

Owner: https://news.adobe.com/news/2026/06/adobe-unveils-major-expansion (June 18, 2026)
Evidence: OFFICIAL_DOC, neither installed Adobe binaries nor authenticated creative agents were tested.

Documented differentiators:
- Adobe AI Assistants are in public beta for Photoshop, Illustrator, InDesign, Premiere and Frame.io (the actual feature and entitlement must be checked on target version).
- Photoshop assistant organizes layers/handles composites and resizing.
- Illustrator assistant performs batch/versioned outputs and checks missing fonts or color-mode problems.
- InDesign assistant updates layouts and print readiness; workflow is multi-step and editable.

Ninerr consequence: the user's goal to beat Adobe does **not** imply implementing an entire video editor, raster retoucher and print publishing app simultaneously. Prioritize **design-artifact preflight** (fonts, exports, link completeness, tokens, assets, color profile assumptions), native vectors and reproducible batch export from existing documents. Image-editing engine parity remains an independent later research gate.

New tests:
- CR-001: batch export 20 variation files with correct native layers/fonts and reproducible manifests.
- CR-002: preflight detects missing font, broken linked asset, inaccessible contrast, missing alt text and print-output incompatibility.
- CR-003: editable SVG/PDF export/import round-trip with measured loss instead of preview-only image equivalence.

## Competitive implications (priority-order proposal, NOT scored victory)

| Priority | What to copy/adapt | Existing Ninerr anchor | Missing qualification |
|---|---|---|---|
| P0 | local Desktop + MCP bridge/headless | `packages/desktop`, `studio-host/src/mcp.ts`, `relay.ts` | installed UI closed, stdio read/write and auth |
| P0 | byte-preserving Astro/JSX round-trip | `packages/code-ir`, `studio-host/src/code.ts` | unsupported-node fail-close, 54-file class |
| P0 | agent transactions/preview/concurrency | `studio-host/src/session.ts`, `mcp.ts` | dry-run idempotency, stable review/undo |
| P0 | design tokens/components/variants | `document-model`, `renderer`, `canvas` | full native editable outputs + code rebind |
| P1 | Skilit local references and Lens | separate Skilit source and Ninerr host | offline pack import and rights validation |
| P1 | branching/alternative agent work | `history` and `visual-git` | true non-destructive branch/proposal model |
| P1 | design preflight/batch export | existing export/model | quality tests, missing font/assets checks |
| P2 | full raster/print/video parity | not a coherent first milestone | separately scoped domain product decision |

## Live REA queue and execution requirements

OpenCode with DeepSeek and Craft Anything v0.3.0 Deep mode remain the required runtime for actual target inspection. Before a final live comparison, record target version and authorized sample, OpenCode CLI response, single persistent Craft Anything MCP browser session and artifact hashes; capture both desktop and mobile where possible. Signed-out landing-page captures **must remain labeled** as such.

P0 experiments: Stacki source no-op and one-node diff using its actual desktop editor; Paper stdio MCP startup with closed/open UI; pen.dev `.pen` file semantics and agent/native layer export; Figma component/variable write via documented API in an authorized user project; Framer branches and editable content; Illustrator batch preflight using an authorized local sample.

If Windows owner device is offline/unreachable, do not fake or replace OpenCode live REA with source-only reading. This document is a completed desk-research tranche, not evidence that the broader Deep REA or EGM Goldfish review finished.
