# Ninerr Benchmark Suite

Ninerr ships a reproducible, offline, 14-category benchmark harness with a 9-dimension weighted rubric that strictly separates **deterministic automated metrics (65%)** from **blinded human/evaluator judgment (35%)**.

## Running Locally

```bash
# Run all 14 categories offline (deterministic core)
npm run benchmark

# JSON output or write a reproducible report
node bin/ninerr.mjs benchmark run --json
node bin/ninerr.mjs benchmark run --out benchmarks-report.json --replace

# Filter a single category or enable local real-browser Vision telemetry
node bin/ninerr.mjs benchmark run --category fintech-ledger
node bin/ninerr.mjs benchmark run --category mobile-app-shell --vision

# List all 14 categories and 9 rubric dimensions
node bin/ninerr.mjs benchmark list
```

## 9-Dimension Weighted Rubric

| Dimension | Weight | Mode | What Is Measured |
| --- | --- | --- | --- |
| Aesthetic Craft | 20% | Blinded human review | Visual craft, restraint, composition, domain fit (never auto-filled) |
| UX & Interaction Quality | 15% | Blinded human review | Flow clarity, visual hierarchy, cognitive load (never auto-filled) |
| Production Code Quality | 15% | Automated | Valid multi-framework output (HTML, JSX, Tailwind, Vue, Svelte, Astro) & token compilation |
| Accessibility (WCAG AA/AAA) | 15% | Automated | Contrast, semantic headings/labels, touch targets, reduced-motion compliance |
| Responsive Integrity | 10% | Automated | Scoped breakpoint compilation, fluid containers, zero-overflow checks |
| Functional Preservation | 10% | Automated | Whole-File AST Business-Logic Invariance, Tier 1 CSS invariance, byte-for-byte rollback |
| Brand & System Coherence | 5% | Automated | Brief alignment, 3 distinct aesthetic directions, token system audit |
| Execution Speed | 5% | Automated | Local wall-clock execution budget |
| Resource & Zero-Egress Cost | 5% | Automated | Zero network egress, `$0` mandatory cloud/API inference cost |

## 14 Benchmark Categories

1. `saas-dashboard` — Enterprise SaaS operations dashboard
2. `landing-page` — Product launch landing page
3. `settings-console` — Multi-section application settings console
4. `data-analytics` — Data table & KPI analytics workspace
5. `auth-onboarding` — Authentication & onboarding flow
6. `checkout-pricing` — Checkout & pricing comparison
7. `mobile-app-shell` — Mobile-first app shell
8. `healthcare-clinical` — Healthcare clinical triage console
9. `fintech-ledger` — Fintech ledger & transfer console
10. `developer-console` — Developer CLI & observability console
11. `creative-portfolio` — Creative portfolio showcase
12. `editorial-docs` — Editorial & technical docs layout
13. `theme-high-contrast` — Dual-mode Light/Dark + WCAG AAA high-contrast migration
14. `existing-app-redesign` — Existing React/Tailwind app Tier 1 + Tier 2 redesign with AST invariance & rollback
