# Ninerr Real-World Dogfooding & Benchmark Evidence (2026-11-27)

Date: 2026-11-27  
Scope: Isolated end-to-end validation of Ninerr's Codebase Redesign Engine, Local Research Pattern Extractor, Multi-Framework Exporters, Vision/Critic Engine, and 14-Category Reproducible Benchmark Suite across 5 real production software applications (6,249 total source files).

## 1. Isolation & Safety Protocol

- Every real-world application under test was copied to a disposable scratch directory outside its canonical repository before running any Ninerr command.
- Canonical application repositories were never modified, committed to, or pushed to.
- All runs executed 100% locally with zero network egress (`networkAttempts = 0`).
- Every Tier 1 CSS token patch and Tier 2 JSX class patch passed Ninerr's Whole-File `@babel/parser` AST Business-Logic Invariance Gate before writeback and was rolled back atomically via Ninerr's journal, with SHA-256 byte-for-byte identity verified against the original files.

## 2. Anonymized Real-World Dogfooding Targets

| Anonymized Target | Stack & Characteristics | Source Files |
| --- | --- | ---: |
| `app-alpha` | Next.js + React + Tailwind CSS v3 (`^3.4.x`) + Radix UI | 1,176 |
| `app-beta` | TypeScript + Vite tooling workspace (no global CSS design tokens) | 376 |
| `app-gamma-web` | React + Vite + Tailwind CSS v4 + Base UI | 1,855 |
| `app-gamma-astro` | Astro static marketing site | 23 |
| `app-delta` | React + Vite desktop workspace application | 2,819 |
| **Total** | **5 real production apps across 4 frontend stacks** | **6,249** |

## 3. Real Bugs Discovered & Fixed Through Dogfooding

Running Ninerr against real >1,000-file codebases immediately uncovered three genuine defects that synthetic small-fixture tests did not trigger:

1. **DFS Scan Budget Starvation of Stylesheets (`packages/studio-host/src/redesign.ts`):**
   - *Observed failure:* On repositories with >600 source files (`app-alpha` with 1,176 files, `app-gamma-web` with 1,855 files, `app-delta` with 2,819 files), depth-first directory traversal exhausted the 600-file scan budget inside deep feature/component directories before reaching top-level `globals.css` or `index.css` stylesheets, reporting `0` CSS tokens on `app-alpha` and `app-gamma-web`.
   - *Fix:* Upgraded `scanWorkspacePaths` to breadth-first traversal (BFS) with a dedicated stylesheet reservation budget (`maxScanCssFiles: 120`) so top-level and sibling CSS/SCSS files are discovered reliably even in multi-thousand-file monorepos.
2. **Tailwind CSS v3.4 Misdetected as v4 (`packages/studio-host/src/redesign.ts`):**
   - *Observed failure:* Checking `tailwindcss` version strings with `.includes("4")` misclassified `tailwindcss: "^3.4.x"` on `app-alpha` as `tailwind-v4`.
   - *Fix:* Replaced substring matching with a strict major-version regex `/(?:^|[\^~>=<\s])4(?:\.|$)/u` so `^3.4.x` resolves accurately to `tailwind-v3` while `^4.0.0` resolves to `tailwind-v4`.
3. **Cross-Type Hardcoded Literal False Positives in Design System Audit (`packages/studio-host/src/design-system-ops.ts`):**
   - *Observed failure:* Running the 14-category benchmark flagged `style.font-size: 16px` as matching `--radius-lg` (`radius`) and `style.font-size: 12px` as matching `--space-3` (`spacing`).
   - *Fix:* Made `auditDesignSystem` map CSS properties (`font-size`, `border-radius`, `gap`, `padding`, `color`, etc.) to compatible token types (`fontSize`, `radius`, `spacing`, `color`, etc.) before emitting `system:hardcoded-literal-matches-token`.

All three fixes are locked with permanent regression tests in `tests/redesign.test.mjs` and `tests/benchmark.test.mjs`.

## 4. Measured Before vs. After Dogfooding Results

| Target | Metric | Before Fix | After Fix | Verification |
| --- | --- | ---: | ---: | --- |
| `app-alpha` | Detected Tailwind | `tailwind-v4` (wrong) | `tailwind-v3` (exact) | `analyzeCodebase` |
| `app-alpha` | Discovered CSS files / tokens | `0` files / `0` tokens | `5` files / `60` tokens | Tier 1 (`--bg-color`) & Tier 2 (`bg-white -> bg-slate-50`, 5 files, AST-verified) applied & rolled back 100% byte-for-byte |
| `app-alpha` | Analysis latency | `1,885 ms` | `1,465 ms` | `-22%` latency |
| `app-beta` | Scanned files / latency | `375` files / `148.7 ms` | `375` files / `148.7 ms` | Clean zero-crash analysis on non-CSS tooling repo |
| `app-gamma-web` | Discovered CSS files / tokens | `0` files / `0` tokens | `3` files / `647` tokens | Tier 1 (`--app-scrollbar-width`) & Tier 2 (`bg-white -> bg-slate-50`, AST-verified) applied & rolled back 100% byte-for-byte |
| `app-gamma-web` | Analysis latency | `2,176 ms` | `916 ms` | `2.4x` faster |
| `app-gamma-astro` | Routes / CSS tokens / latency | `8` routes / `4` tokens / `41 ms` | `8` routes / `4` tokens / `41 ms` | Tier 1 (`--silver`) applied & rolled back 100% byte-for-byte |
| `app-delta` | Discovered CSS files / tokens | `757` tokens | `18` files / `1,871` tokens | `data-testid`: `113 -> 186`, hooks: `1,276 -> 1,609`, handlers: `1,210 -> 1,518`; Tier 1 (`--offline-background`) & Tier 2 (`p-4 -> p-5`, 5 files, AST-verified) applied & rolled back 100% byte-for-byte |
| **Combined** | **Total real CSS tokens discovered** | **761** | **2,582 (+239%)** | **100% AST invariance pass + 100% SHA-256 rollback identity** |

### Local Research, Multi-Framework Export & Vision Verification

- **Ninerr Research (`extractPatternsFromSource`):** Extracted structured palettes and custom properties offline across real app stylesheets (`app-gamma-web`: 32 colors, 570 custom properties; `app-gamma-astro`: 32 colors; `app-delta`: 32 colors, 1,089 custom properties).
- **Ninerr Vision & Critic (`renderAndInspect` + `improveDesignInMemory`):** Rendered live desktop (`1280x800`) and mobile (`390x844`) viewports in local headless Chromium/Edge with zero network egress, reducing an intentional multi-defect test document's defect score from **80 -> 0** in 3 atomic node operations.
- **Multi-Framework Exporters:** Verified clean HTML, React JSX, Tailwind TSX, Vue 3 SFC, Svelte 5 SFC, and Astro static outputs across all authoring benchmark categories.

## 5. 14-Category Reproducible Benchmark Results

Command: `npm run benchmark` (offline static suite) and `ninerr benchmark run --category mobile-app-shell --vision --json` (live local browser Vision spot check).

- **Offline 14-category wall-clock duration:** `747.4 ms` (`networkAttempts = 0`)
- **Automated Deterministic Mean:** **`64.51 / 65` pts (`99.2%`)** across all 14 categories (`saas-dashboard`, `landing-page`, `settings-console`, `data-analytics`, `auth-onboarding`, `checkout-pricing`, `mobile-app-shell`, `healthcare-clinical`, `fintech-ledger`, `developer-console`, `creative-portfolio`, `editorial-docs`, `theme-high-contrast`, `existing-app-redesign`).
- **Live Vision Spot Check (`mobile-app-shell --vision`):** `visionUsed = true`, `networkAttempts = 0`, `10,889.6 ms` (<15s budget), defect score reduced **`56 -> 34`** (`0` errors, `0` accessibility errors/warnings), automated score **`64.5 / 65` pts (`99.2%`)**.
- **Blinded Human/Evaluator Rubric (35 pts — `aesthetic` 20 + `ux` 15):** Explicitly recorded as `pending-blinded-human-review` (`null`). Ninerr never fabricates or auto-fills subjective human scores.

## 6. Explicit Remaining Limitations

1. **Blinded Human Rubric (35% weight):** Requires independent human design evaluators scoring blinded outputs; automated runs always leave `aesthetic` and `ux` explicitly `null`.
2. **Live Claude Code MCP Session:** Live end-to-end stdio MCP sessions were verified on Codex CLI `0.163.0` and OpenCode `2.3.2` (`docs/evidence/HEADLESS_CLIENTS_2026-11-27.md`); live Claude Code session verification remains pending the local host weekly quota reset (Nov 29).
3. **External Release Publishing:** Git tagging, npm package publishing, and GitHub Release creation remain reserved for explicit founder authorization.
