# Ninerr: Founder Product Direction and Skilit Integration
Date: 2026-11-06
Status: founder-requested strategic direction; implementation proposal pending exact-head review
Repository baseline: TheHalfMoon/Ninerr main at `8cba15c4e4af40b12476433a49e20a1696cfc0f8`
Related repository: TheHalfMoon/Skilit (protected main and overlapping draft integration candidates)

## North star
Make Ninerr the preferred environment for professional human designers **and** autonomous design agents. A user or an agent should be able to research a design, create and refine editable work, connect it to production code, validate quality, collaborate, and publish without scattering work across five products.

"Best in the world" and "the only choice" are the ambition, **not yet an evidence-backed product claim**. Ninerr must earn that position in reproducible cross-product tests.

## Founder decision to pursue integration
- **Ninerr is the primary product and the long-term destination for Skilit capabilities.**
- Skilit's research corpus, Lens, assets, pattern/flow analysis, rights/provenance graph, Build Kits, and agent interfaces are candidates for first-class **Ninerr Research / Intelligence** capabilities.
- Ninerr's document model, canvas, history, source round-trip, permissions, and agent transaction semantics remain the authority for editable designs.
- Do **not** ship two overlapping editors or two canonical design models. Do **not** merge repository histories, migrate production data, delete Skilit, rename existing packages, or shut down services before migration gates pass.
- Preserve Skilit's approved source provenance, existing asset rights, governance commitments, stable resource identifiers, and tenant/data isolation.
- Skilit's unmerged Draft PRs #178–#188 contain overlapping integration alternatives. Do not stack or merge them indiscriminately. Inventory all heads and select a single reviewed candidate before porting.
- The older Ninerr P09/P10 release work and proposed P11–P16 extension remain separately governed. This strategy document does not silently approve or merge prior PRs.

## Product surfaces (one coherent application)
1. **Design**: native editable UI/web/app layouts, components, variants, variables, constraints, auto layout, vector tools, reusable libraries, prototyping, accessibility checks, responsive editing.
2. **Create**: agent-led and direct-manipulation production for screens, product flows, websites, icons, logos, brand systems, illustrations, and marketing compositions. Raster/print/video/3D are separate evidence-gated expansions; do not call them supported before implementation.
3. **Research** (Skilit): source-grounded screen/flow/pattern and asset search, URL/image Lens, design critique, comparison, collections, reference packs, evidence and lawful reuse rights.
4. **Build**: semantically faithful import, visual edit, minimal-diff write-back and export, codebase components and data binding. Never overwrite unsupported source.
5. **Agents**: human-visible intent, read/plan/dry-run/write/preview/review/undo/reconcile via MCP/API/CLI/SDK; transactions are attributable, reversible and conflict-aware. Multiple agents can collaborate safely.
6. **Ship**: previews, revision-aware publishing and reproducible quality gates, without mandatory paid inference or cloud service.

## Architectural integration thesis
Ninerr is the system of record for editable documents, node identities, revision history and design operations. Skilit is an **evidence graph and retrieval/intelligence provider** behind bounded domain adapters.

Candidate packages (names provisional, confirm against both current repo trees):
- `packages/design-intelligence/contracts`: versioned reference, rights, confidence, evidence and link schemas.
- `packages/design-intelligence/adapters/skilit`: read-only source APIs/MCP and object-ID resolver; local first.
- `packages/design-intelligence/lens`: sandboxed URL/image capture and design token extraction; SSRF, egress and rights safeguards.
- `packages/design-intelligence/references`: persistent provenance-bound research collections and compact agent context packs.
- `packages/design-intelligence/apply`: explicit, reviewable conversion of reference packs into native Ninerr nodes/components/tokens; undoable as one transaction.
- `packages/agent-design`: versioned MCP operations shared by human UI and agents; preconditioned write and dry-run by default when modifying production-linked designs.

No second canvas engine, second user identity system, or second authoritatively editable design database. Skilit's existing PostgreSQL and object storage may remain as internal backing providers during migration but must not silently duplicate Ninerr's canonical document state.

### Migration gates
- **M0 inventory**: pin Ninerr and Skilit source SHAs, licenses, donor notices, dependency trees, live Draft PR integration candidates, APIs, schemas, rights and data classifications; build a feature-by-feature keep/adapt/retire matrix.
- **M1 contracts**: stable, namespace-safe IDs for sources and assets; read-only REST/MCP adapter with deterministic fixtures, paginated search, tenancy, provenance and rights checks.
- **M2 embedded research**: Research, Lens and asset browser within Ninerr; each human query has matching structured agent access; no unauthorized egress.
- **M3 apply to design**: reference-to-native-token/component/frame workflow with preview, explicit rights confirmation, bounded transformations and full undo; agent does not bypass review.
- **M4 migration qualification**: replay representative Skilit workflows and Ninerr workflows on exact commits; verify identical authorized object retrieval, no broken saved references, source round-trip, least privilege, offline operation and acceptable latency.
- **M5 consolidation**: only after M4 and founder governance approval, archive/rebrand Skilit endpoints/repo if appropriate; publish redirect and migration guidance with evidence.

## Compete by measured quality
Strong product claims require benchmarks against current versions of Figma, Adobe creative tools, Paper, pen.dev, Framer, Stacki, and agent-to-code competitors, plus Skilit's own capabilities. Use dated evidence records, screenshots where permissible, tasks, exact versions, failure cases and clear unknowns. No marketing claim based on a mocked UI or competitor docs alone.

### Minimum acceptance targets (proposed, not previously achieved)
- Core agent editing: 100% of supported operations addressable via public API/MCP, no GUI scraping, stable object/revision IDs, side-effect free dry run.
- Reliability: 0 silent destructive code edits; every approved change can be undone, replayed or explained.
- Real-world design: at least 24 cross-product benchmark tasks spanning human editing, design-system fidelity, multi-step agents, code round-trip, responsive design, vector creation, research-to-design and recovery; every task has independent rubric, reference artifacts and failure diagnostics.
- Visual/semantic quality: inspect native layers and production output, not screenshot similarity alone; compare typography, responsive states, accessibility, interaction and token usage.
- Integration: existing saved Skilit objects remain recoverable or have verified redirects, with source rights intact; explicit migration tests for tenant isolation.
- Cost: core local workflows run without a mandatory paid provider; publish API/compute tradeoffs honestly.
- Security: no DRM/auth/paywall bypass in REA; local/private defaults, sandboxed URL capture and model egress controls.

## Delivery sequencing
1. Freeze benchmark tasks and verify source baselines before new broad engineering promises.
2. Complete Ninerr's presently approved P09/P10 gates or explicitly document a founder-governed reprioritization.
3. Complete integration M0 and M1 on small, separately reviewed branches.
4. Port user-visible Research and Lens in bounded grains (M2), while qualifying the design surface against strongest competitors.
5. Add reviewable research-to-design and agent workflows (M3).
6. Qualify M4, then consider formal Skilit consolidation (M5).
7. Expand into high-fidelity vector and raster creation when real benchmarks justify the scope; avoid trying to build Photoshop, Premiere, InDesign and Figma simultaneously.

## Existing repository references
- Ninerr: `docs/MASTER_PLAN.md` (N0, P08, P09, P10), previous proposed P11–P16 PRs #356–#359, `docs/research/rea-design-platforms/` (October 18 study).
- Skilit: `PRODUCT.md`, `ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`, `GOVERNANCE.md`; overlapping draft candidates #178–#188.
- Separate research brief: `docs/strategy/REA_COMPETITORS_AND_CRAFT_ANYTHING_2026-11-06.md`.

## Change-control and evidence notice
This commit is **planning only**. It makes no performance, design parity, REA hands-on, import success or release-readiness claim. It is not a substitute for required Graft, PStack, Alibaba OCR applicability, and exact-head CI where the respective repositories require them. Existing published content and licensing obligations remain unchanged.
