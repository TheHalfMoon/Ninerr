# Ninerr

**Design everything AI builds.**  
*The design intelligence layer for AI. Every AI agent becomes a better designer with Ninerr.*

Ninerr is a free, Apache-2.0, local-first, headless-first, model-agnostic design intelligence engine for AI coding agents and software developers. It gives any agent — Codex, Claude Code, OpenCode, Cursor, Gemini CLI, or your own Node.js workflow — deterministic design planning, taste and accessibility critique, motion tokens, 41 native WCAG-AA components, real-browser visual inspection, safe AST-verified redesign of existing codebases, and multi-framework code export, all 100% locally with zero mandatory cloud services, accounts, subscriptions, API keys, or telemetry.

> **Release notice:** Target version `v0.1.0` (development workspace — no git tag, npm package publish, or GitHub Release is authorized until explicit founder sign-off). The desktop app and browser editor remain intact and working in this repository alongside the headless-first engine.

## Quick start

Ninerr requires Node.js `22.18+` (22.x) or `24.11+`. Installing fetches dependencies; once installed, Ninerr operates completely offline with zero network egress by default.

```bash
npm ci --ignore-scripts

# Verify environment, local browser availability, and zero-egress readiness
node bin/ninerr.mjs doctor

# Generate client config (Codex, Claude Code, OpenCode, Cursor, Gemini CLI) & install 19 official Ninerr skills
node bin/ninerr.mjs connect --client codex --install-skills

# Initialize a new design project with brief + semantic tokens
node bin/ninerr.mjs init --domain enterprise-saas --name "Acme Console"

# Plan 3 WCAG-AA aesthetic directions, audit taste/accessibility, or inspect an existing app
node bin/ninerr.mjs design plan --domain fintech --name "Ledger"
node bin/ninerr.mjs redesign inspect --workspace ./path/to/your-app

# Run the reproducible 14-category offline benchmark suite
npm run benchmark
```

To build and install the standalone Ninerr Engine tarball locally, see `docs/ENGINE.md` and `docs/MCP_CLIENTS.md`. To use Ninerr programmatically from Node.js (`import * as ninerr from "ninerr/sdk"`), see `docs/SDK.md`.

## Core capabilities

- **Headless Engine & MCP Server (`packages/studio-host`, `packages/mcp-protocol`, `bin/ninerr.mjs`):** Stdio MCP server exposing 5 project lifecycle tools and 57 project design tools, per-document authorization, human elicitation for consequential writes, stale-lock recovery, and `--workspace` codebase binding. See `docs/MCP.md` and `docs/HEADLESS.md`.
- **Ninerr Intelligence, Taste & Motion (`packages/design-intelligence`):** 9 domain archetypes, 3-direction WCAG-AA aesthetic planner, brief-aware Taste & anti-slop evaluator, 8 motion tokens + 13 presets with mandatory `prefers-reduced-motion` compilation, and 19 official Ninerr agent skills.
- **Ninerr Components & Design Systems (`packages/component-sources`, `packages/document-model`, `packages/studio-host`):** 41 editable, token-bound WCAG-AA native components across 8 categories, multi-mode design tokens (Light / Dark / WCAG AAA High-Contrast), W3C DTCG import/export, CSS-property-type-aware design-system audits, responsive `@media`/`@container` breakpoints, and 3-way component registry updates.
- **Ninerr Vision & Critic (`packages/vision`, `packages/design-assurance`):** Zero-dependency native Node CDP driver over local Chromium/Edge/Chrome with 3-layer zero-egress containment, multi-viewport screenshots, pure-JS PNG pixel diffing, computed DOM/contrast/overflow telemetry, unified static + rendered critique, and bounded in-memory auto-improvement.
- **Existing-Application Redesign Engine (`packages/studio-host/src/redesign.ts`, `packages/code-ir`):** Offline framework/styling/token/contract discovery, 3-tier bounded CSS & JSX patching (`className`, `cn`, `clsx`, `twMerge`, `cva`), Whole-File `@babel/parser` AST Business-Logic Invariance Gate, SHA-256 plan tokens, atomic multi-file writes, and byte-for-byte rollback journals.
- **Ninerr Research (`packages/studio-host/src/research.ts`, `packages/import-stack`):** Local rights-aware reference packs (`observed-inspiration-only`), offline HTML/CSS pattern extraction, and explicit opt-in CLI-only pinned-IP HTTPS metric capture (`ninerr research capture --allow-network`).
- **Multi-Framework Exporters & Local SDK (`packages/studio-host/src/code.ts`, `packages/studio-host/src/sdk.ts`):** Export designs to HTML, React JSX, Tailwind TSX, Vue 3 SFC, Svelte 5 SFC, and Astro, or embed Ninerr directly via `ninerr/sdk`.
- **Reproducible Benchmarks & Real-World Dogfooding (`benchmarks/README.md`, `scripts/benchmark.mjs`):** 14-category offline benchmark with a 9-dimension rubric strictly separating deterministic automated scores (65%) from pending blinded human/evaluator rubrics (35%).
- **Browser Editor & Desktop App (`packages/studio-web`, `packages/canvas`, `packages/renderer`, `packages/desktop`):** Loopback-only browser editor (`npm start`) and sandboxed Electron desktop app. See `docs/DESKTOP.md`.

## Testing & verification

```bash
npm test              # Full automated test suite
npm run smoke         # Offline end-to-end smoke workflow
npm run benchmark     # 14-category reproducible offline benchmark
```

`npm start` launches the studio host and prints a loopback link to the editor. Projects live in your "Ninerr Projects" folder unless `NINERR_PROJECTS` or `--projects <folder>` specifies another owner-only local directory. See `docs/DESKTOP.md` and `docs/MIGRATION.md`.

## Documentation

- `docs/CAPABILITY_MATRIX.md`: Full capability qualification matrix with test, review, and dogfooding evidence.
- `docs/ENGINE.md` & `docs/MCP_CLIENTS.md`: Building the headless engine and connecting Codex, Claude Code, OpenCode, Cursor, or Gemini CLI.
- `docs/SDK.md`: Programmatic local ESM API (`ninerr` / `ninerr/sdk`).
- `docs/MCP.md`: MCP tool catalog, workspace binding, and authorization boundaries.
- `docs/ARCHITECTURE.md`: Subsystem architecture and invariants.
- `benchmarks/README.md` & `docs/evidence/DOGFOODING_2026-11-27.md`: 14-category benchmark rubric and real-world dogfooding measurements.
- `docs/DESKTOP.md`, `docs/MIGRATION.md`, `docs/RELEASE.md`: Desktop security model, project migrations, and signed release verification.
- `SECURITY.md` & `CONTRIBUTING.md`: Security boundaries, vulnerability reporting, and contribution workflow.
- `docs/CURRENT.md` & `docs/MASTER_PLAN.md`: Program status and roadmap records.

## License & provenance

Ninerr is licensed under the Apache License 2.0 (`LICENSE`).

- `THIRD_PARTY_NOTICES.md` lists third-party software notices.
- `docs/provenance/LICENSE_REGISTER.json` records every audited source and dependency.
- `docs/DONORS.md` records studied projects and exact provenance.
- `docs/provenance/ELECTRON_CORRESPONDING_SOURCE.json` binds the desktop Electron runtime to its exact corresponding source.
