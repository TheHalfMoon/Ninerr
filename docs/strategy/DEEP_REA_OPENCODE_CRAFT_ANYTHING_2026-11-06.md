# Ninerr Deep REA Charter — OpenCode, DeepSeek and Craft Anything
Date: 2026-11-06
Status: founder directive; exploratory research active; findings require verification
Supersedes: fixed scope assumption of 24 tasks as a maximum. The previous 24 tasks remain minimum regression fixtures, not a research ceiling.
Product contract: installed desktop, local MCP, private/offline-first, no Ninerr-operated cloud or founder-paid user inference.

## Goal
Explore everything materially useful from professional design products and agent-native design tools. Identify reproducible capabilities, internal workflows, implementation models, ergonomics, file formats, extensibility, fidelity, and UX differentiators that Ninerr can copy (where authorized), adapt, integrate, then surpass. Do not optimize for a feature checklist; optimize for depth, hard evidence, full working flows, and original Ninerr coherence.

## Required researcher runtime
- Run the research with **OpenCode and DeepSeek**, not Codex.
- Use **Craft Anything v0.3.0 Deep mode** through its local MCP for authorized inspection of observable applications/public websites, or documented direct CLI commands. Pin source/version and verification details.
- The installed Craft Anything release advertises 315 tool capabilities during the 2026-11-06 on-device preflight. A self-test saw 29 base MCP tools, which expand via toolset enablement. Do not treat all advertised capabilities as tested on every target.
- Keep a full evidence trail, including screenshots and script/layout/file metadata where access is authorized. Large media may remain in excluded local evidence storage until rights and storage strategy are resolved; source manifests, evidence IDs, hashes, reproducible instructions and conclusions go in the repository.
- No fixed number of targets, findings or task categories. Let findings open new research threads when they materially affect Ninerr's architecture or user experience.
- This is **not permission for unlimited paid inference, infrastructure spend, indefinite unattended running, bypassing access controls, or exposing user secrets**.

## Competitor families
1. Figma Design/Make and agent APIs, Adobe Photoshop/Illustrator/Firefly, Sketch, Affinity, Penpot, Canva.
2. Paper Desktop, pen.dev/Pencil, Stacki, Framer, Webflow, Builder.io, responsive web/code visual editors.
3. Google Stitch, Claude Design, v0, Lovable, Bolt, design coding agents, MCP-driven creative suites.
4. Design-intelligence references and research tools such as Mobbin, plus Skilit's own corpus, Lens, assets and Build Kits.
5. Further specialist tools discovered from evidence, e.g. vector editors, icon creation, fonts, motion/prototyping and code-to-design.

## Open-ended discovery questions
- How do professional tools represent and persist editable design: nodes, layers, variant sets, symbols, constraints, vector data, typography, tokens, document/version formats?
- How do human operations and agent operations converge on one reversible mutation model? Which tools offer per-step previews, write preconditions, attribution, concurrent-agent conflict resolution and stable layer IDs?
- Can an agent accomplish the same workflow without screenshot-only GUIs or undocumented private network APIs?
- Can code imports and visual edits retain original structure exactly or with small diffs? Can Astro/React/Vue/CSS round-trip without destructive code normalization?
- What constitutes professional fidelity in real output: layout, adaptive breakpoints, responsive behaviors, masks, gradients, font metrics, SVG/PDF/export, accessibility, art direction?
- Which workflows are surprisingly useful and not visible in landing-page marketing? Which competitors have surprising regressions and footguns? What features are worth not copying?
- What can be reused from Ninerr's existing Electron app, document model, history, rendering, source round-trip and MCP, rather than introducing another editor/host?
- How should Skilit's cloud-oriented architecture be distilled into local reference packs, provenance and rights-aware search without embedding Postgres/Next.js/auth/billing/remote worker as a requirement?
- How can Ninerr maintain local privacy while allowing user-initiated website Lens and user-owned model APIs as explicit optional device-side actions?

## Actual experimental loop
1. Identify target and right to inspect. Record exact version, URL/release, date, host platform and whether the target is signed-out/limited.
2. Inspect in Craft Anything Deep mode in a single session: open/capture/interaction observation/JS or file structure when permitted, extraction of evidence/unknowns. Do not infer authenticated editor behavior from a marketing website.
3. For each discovery, compare against equivalent Ninerr source and tests. Reproduce on a sample file/project when feasible. Record OBSERVED / OFFICIAL_DOC / INFERRED / UNKNOWN separately.
4. Record a candidate: adopt licensed/pinned upstream implementation, port behind an adapter, improve Ninerr-native code, or reject with reason.
5. Add or revise a benchmark task only if it exposes measurable product quality. The previous 24 tasks are a starter set; there is no research ceiling.
6. Red-team privacy, source preservation, safety, licensing, operating-system packaging and CPU/memory costs.
7. Use Google EGM to challenge architecture hypotheses with fresh independent reviewer contexts, not as proof of product parity.
8. Keep a prioritized research queue and complete a bounded evidence-backed slice in every active run; do not promise asynchronous work or invent completion.

## Zero-cloud architecture acceptance
The installed desktop UI and stdio/loopback local MCP must create/edit/reopen/export offline on Windows/macOS/Linux. Project data belongs to the user. No mandatory login, Ninerr service, hosted DB, paid model, required API key, cloud sync, relay, telemetry, or inference billed to founder. Optional online research is initiated explicitly from the user's machine and can be disabled; AI compute is paid/executed by the user or their chosen agent/provider.

## Rights and limitations
Founder states official permission to copy/adapt/rebrand. Track the granted scope independently for proprietary source, assets, fonts, trademarks, redistribution and third-party dependencies before distributing, and preserve notices/licenses that remain mandatory. Do not bypass DRM, paywalls, authentication, or private accounts. Keep raw competitor assets out of public repo until source permissions and provenance are proven.

## On-device preflight evidence (2026-11-06)
- OpenCode v2.2.5, DeepSeek `opencode/deepseek-v4.1-flash-free`, response to one-line invocation succeeded.
- Craft Anything `v0.3.0` publisher hash for Windows portable: `cf60e403c7eb33d51b8dd167335e79d031e516c39cac4a58c97fa70ef81ed6d8`; observed hash matched. OpenCode MCP registration verified in its doctor.
- `web_site_open` against `https://stacki.build/` succeeded with a private Edge browser (title Stacki, 848 DOM elements, 15 images, 24 links, no reported browser errors). This is an observed public landing-page inspection, not a product editor qualification.
- Separate CLI calls cannot share an opened website; use one persistent MCP/app/rebuild session to capture and inspect the same page. A CLI site-open command without explicit tool approval returns `consent_required`; the research agent must use only approved, scoped actions and report refusals.

## Required output
Versioned research reports, per-target primary-source and observed evidence ledger, comparison matrix and unknowns, implementation and design quality opportunities with source paths, architecture risks, Skilit migration options, repeatable benchmark fixtures, and an execution-ready prioritized work breakdown. Mark exactly what was tested, what was only read, and what remains unknown. No product implementation or release claims in this charter.
