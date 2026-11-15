# Ninerr Deep REA: Competitor Evidence and Craft Anything / OpenCode Study
Date: 2026-11-06
Status: research protocol with **desk-verified preliminary findings only**, NOT completed hands-on REA
Baseline: Ninerr main `8cba15c4e4af40b12476433a49e20a1696cfc0f8`
Parent decision: `docs/strategy/NINERR_SKILIT_FOUNDATION_2026-11-06.md`

## Purpose
Discover the actual product workflows, architecture boundaries, quality bar, and agent primitives Ninerr must beat. The goal is not a list of competitors' advertised features; each conclusion must have a reproducible task, a primary-source reference or permitted observed run, a failure classification and a measurable Ninerr counterpart.

Previous October 18 research covers Figma, Paper Desktop and Claude Design, and is proposed in PRs #356–#359. Reconcile and reuse that evidence; do not report those PRs as merged or claim a newer product version was tested using older evidence.

## Priority by threat and strategic relevance
| Tier | Competitor or set | Why it matters | Preliminary evidence (not hands-on) |
|---|---|---|---|
| P0 | Figma Design, its design agent, Figma Make, MCP | native components, tokens, team collaboration, write-to-canvas | Official Figma docs confirm remote MCP read/write primitives and native design agent |
| P0 | Paper Desktop | agent-connected HTML/CSS canvas, design/code loop, data/context | Paper's official product description documents MCP and code synchronization |
| P0 | pen.dev / Pencil | repo-held design files, bidirectional MCP, .fig/web import | Official FAQ says .pen is JSON-based, can be stored in Git and edited through IDE/CLI |
| P0 | Stacki | precise Astro code-as-source visual editing, fallback for opaque code | Official docs state actual .astro files are edited and unsupported code is preserved |
| P0 | Framer 3 + agents | production-quality responsive website design, branching and publishing | Framer's 2026 release says agents work in the canvas; live tasks still required |
| P0 | Adobe Photoshop, Illustrator and Firefly assistants | professional compositing, vector editing, multi-step art production | Adobe's June 2026 official announcement describes agents for creative apps |
| P1 | Google Stitch, Claude Design, v0, Lovable, Bolt | prompt-to-usable-interface speed and code quality | Verify current supported features and versions before claiming parity |
| P1 | Penpot, Sketch, Canva, Webflow, Builder.io | team design, vector operations, publishing and extensibility | No 2026 hands-on findings in this study yet |
| P1 | Mobbin and comparable reference libraries | research/search quality and Skilit integration | Compare only sources and assets that may legally be analyzed or redistributed |
| P2 | InDesign, Adobe Express, Adobe XD legacy compatibility, motion/3D tools | later creative expansion | Scope separately; do not block Ninerr core shipping on full creative-suite parity |

## Preliminary findings: documented, not yet observed
1. **Figma**: the developer docs describe native design read/write from supported MCP clients. Test whether agents can reliably create and modify real components, variables, variants and auto layout; evaluate latency and review/undo, including plan/seat restrictions. Sources: https://developers.figma.com/docs/figma-mcp-server/ and https://help.figma.com/hc/en-us/articles/39216419318551-Get-started-with-the-Figma-MCP-server
2. **Adobe**: official June 2026 announcement describes multi-step assistant workflows for Photoshop, Illustrator, InDesign and more, including editable outcomes. Test individual licensed capabilities, not a claim that Ninerr must reproduce all Adobe applications in release 1. Source: https://news.adobe.com/news/2026/06/adobe-unveils-major-expansion
3. **Stacki**: local Astro file editing and unchanged unsupported markup is a concrete behavioral target. Test its exact source-diff behavior on nested routes, component props, conditional expressions and content collections. Sources: https://stacki.build/docs/introduction/ and https://stacki.build/docs/how-editing-works/
4. **Paper**: official site describes one canvas connecting agents, code and real data via MCP, with a design-to-code-to-design loop. Verify actual round-trip and transaction semantics with local runs. Source: https://paper.design/
5. **pen.dev**: official FAQ documents Git-storable .pen files, IDE and CLI tools, Figma and website import, HTML/CSS/Tailwind export. Verify fidelity, unsupported behavior and round-trip. Source: https://www.pen.dev/faq
6. **Framer**: announced agents, branching and a community in June 2026. Test responsive quality and publishing against Ninerr with the same source prompt/assets. Source: https://www.framer.com/blog/framer-3/

## Craft Anything: tool use and guardrails
**Identified implementation:** Craft Anything (https://github.com/CodeWithH-B/CraftAnything), an early-alpha Rust desktop/CLI/MCP software-inspection and rebuild project. Its public README describes Study → Build → Check → Refine and marks application behavior checking as partial. The existence of 314 advertised tools is not proof all are qualified. This repo must be pinned and its license and actual installed binary verified before use.

Use Craft Anything as a *measurement and permitted observation tool* for competitor programs/sites, **not** as a means to extract proprietary source, protected services, logos/assets or credentials. Its own responsible-use notice restricts analysis to permitted targets and disclaims DRM/login/anti-cheat bypass. Evidence must be licensed appropriately; for Figma/Adobe, use official documentation, public demos, public APIs, authorized account sessions, controlled sample projects and local observable interactions; do not reverse-engineer protected binaries or bypass access restrictions.

### Command and tool workflow
1. Record target, date, version, exact URL/installer source and scope permission in `TARGETS.json` (to be created during the experimental grain).
2. Attempt OpenCode preflight using the installed CLI on the owner's Windows device; record actual availability and errors. Do not claim an OpenCode run completed unless output and saved evidence are inspected.
3. If Craft Anything CLI is actually installed and qualified, run its **documented** read-only inspection commands against authorized fixtures/targets; do not invent flags. Capture tool versions, full exit status, hashes and machine specification.
4. For sites or apps that cannot be safely instrumented, run manual/Playwright/UIA observation and record missing coverage as UNKNOWN rather than guessing.
5. Create an equivalent Ninerr fixture, test with Playwright/UIAutomation + MCP and independent human visual review; measure both native layer structure and export.
6. Mark each finding OBSERVED, OFFICIAL_DOC, INFERRED or UNKNOWN. A claim that Ninerr is better is allowed only where both products were run on the same task and judged by the same rubric.

## Benchmark fixture set — 24 tasks
Use identical inputs, design references and device conditions. Record time, steps, cost, revision count, crashes, visual errors, semantic correctness, undo, accessibility, and data egress.

### Human editing (H01–H04)
- H01: Create responsive 3-screen product UI from reusable tokens, variants and components.
- H02: Edit component variants across 100 instances; verify no accidental local overrides.
- H03: Keyboard-only reparent/group/layer arrange and inspect screen reader labels.
- H04: Import and revise a complex vector icon with paths, curves, gradients and mask fidelity.

### Agent canvas (A01–A06)
- A01: Inspect a document by stable semantic IDs without screenshots.
- A02: Multi-step creation of 3 editable screens using existing component library.
- A03: Dry-run a destructive component deletion and show affected usages before approval.
- A04: Two agents edit distinct subtrees simultaneously; verify deterministic conflict handling.
- A05: Human revises one agent's output; undo one atomic agent transaction without losing human edits.
- A06: Continue interrupted agent execution without double-committing or losing attribution.

### Source round-trip (C01–C05)
- C01: Import React/JSX component, change one class, measure semantic equivalence and minimal diff.
- C02: Import Astro pages/components with dynamic routes and preserve unsupported expressions.
- C03: CSS shorthand/longhand collision; compare browser preview, exported code and original file.
- C04: Import mixed tokens, Tailwind and CSS variables; edit, write back, reopen without drift.
- C05: Reconcile external code change while an agent edits the corresponding frame; reject stale writes.

### Research and Skilit integration (R01–R04)
- R01: Paste publicly accessible URL, extract token/typography/layout report with source evidence.
- R02: Find matching rights-qualified UI patterns and filter restricted assets from export.
- R03: Convert a sourced flow into a native editable Ninerr component design; preserve source IDs.
- R04: Pass evidence pack between agents; every object can be resolved by stable IDs after restart.

### Creative and quality (V01–V03)
- V01: Draw vector logo with editable paths; export SVG/PDF/PNG and reimport with measured loss.
- V02: Generate brand campaign composition with correct font rights, color modes and asset metadata.
- V03: Rebuild a reference screen at desktop/tablet/mobile and test motion, interaction and accessibility.

### Security and recovery (S01–S02)
- S01: Fully offline local design and agent review; prove zero non-loopback egress.
- S02: Crash during project + agent transaction; reopen, recover, verify checksum and exact history.

## Scoring and exit conditions
- Score task **correctness 35%**, **editable semantic fidelity 20%**, **human controllability & reversibility 15%**, **production round-trip 15%**, **latency/resources 10%**, **privacy & cost 5%**.
- Each task is 0–5 per dimension; publish raw counts, rubric and evidence before weighted composites. N/A must not silently become a zero or a perfect score.
- A functional crash, data loss, rights violation or unauthorized external egress is an automatic disqualifier for the relevant release gate regardless of weighted score.
- At least 3 repeat runs for nondeterministic agents. Fix model version, temperature/seed when supported; report variation and spend.
- Evaluate official competitor release versions at run time. Figma/Adobe premium features that require entitlements must be labeled NOT TESTED when unavailable.
- No customer data or proprietary competitor source in evidence fixtures. Host only permitted screenshots and cite URLs.

## Integration research questions
- Is Skilit's PostgreSQL graph a read-only knowledge provider or does it hold data Ninerr must own? Avoid dual-write canonical authority.
- What Skilit object identifiers can become stable Ninerr resource URIs without breaking existing client references?
- Can Lens URL capture run locally with fail-closed SSRF, domain allowance, bounded resources and no vendor-specific cloud?
- Which provider integrations require redistribution licensing, separate rights to logos/fonts/screenshots, or user consent?
- What incremental Skilit source can be reused after current Draft #178–#188 conflict resolution and exact-SHA rights audit?
- How can agents retrieve and apply sources without bypassing human asset-usage permissions?
- How will Ninerr expose research and design through a unified MCP toolset without hundreds of fragile micro-tools?

## Required deliverables before calling the REA complete
- Immutable `TARGETS.json`, source/provenance ledger, target access and version evidence.
- For every benchmark: input fixture, steps, observed artifacts, canonical outputs, UI screenshots permitted by rights, hashes, pass/fail table, failure analysis.
- Per-competitor scored study with disconfirmed strengths and explicit unknowns.
- One page of prioritized differentiation claims, each linked to cross-product evidence.
- A Nimerr/Skilit package-level integration map from **actual repo source**; per-module decision adapt/port/retire and dependency licenses.
- Revised architecture and bounded implementation grains with concrete tests, owners and gating dependencies.
- Fresh-context independent review and exact-head CI evidence before merge.

## Important status disclosure
At document creation this research is a scoped, source-grounded **preflight** only. Official documentation was read and the connected repositories were inspected; no 24-task live comparative experiment, qualified Craft Anything binary session, or OpenCode-generated report is claimed completed.
