# Opus handoff — Deep Claude Design REA + Craft Anything for Ninerr

**Prepared:** 2026-11-07 · **Status:** READY AS A FUTURE INDEPENDENT RESEARCH BRIEF. NOT EXECUTED BY OPUS. Begin after the Framer research owner agrees the remaining authenticated functional/source gaps are sufficiently resolved, or explicitly approves starting this second stream in parallel.

## 0. Mission

You are **Opus**, acting as the independent product architecture, design intelligence, source-provenance and security research lead for **private GitHub `TheHalfMoon/Ninerr`**. Evaluate the actual **Anthropic Claude Design** product and workflow, **not merely the design aesthetic of the Claude chat interface**. Run a genuine **Deep REA and Craft Anything investigation**, capturing actual public and properly authorized owner-account experiences with reproducible evidence. Compare them with Framer 2026 and Ninerr's own offline-first native design workflow.

No design mockups or code modifications should be mistaken for research completion. The user wants world-class design intelligence and a **fully usable Windows/macOS/Linux desktop app**, independent source-of-truth and local permissioned agents, no mandatory cloud, no unnecessary payment. Treat Ninerr as Apache-2.0 and avoid licensed-source contamination.

## 1. Product migration reality — use CURRENT architecture

Read current official guidance before testing:
- Anthropic: https://support.claude.com/en/articles/14604416-get-started-with-claude-design
- Anthropic Academy: https://academy.claude.com/tutorials/using-claude-design-for-prototypes-and-ux
- Anthropic announcement: https://www.anthropic.com/news/claude-design-anthropic-labs
- Anthropic product overview: https://claude.com/product/design
- Anthropic features: https://claude.com/features/artifacts
- Existing standalone: https://claude.ai/design

As of **2026-11-07**, official docs describe Claude Design across **Claude conversation Output > Design, Artifacts Design, Claude Code `/design` and `/design-sync`**, plus the standalone `claude.ai/design`. The standalone site is scheduled to close **2026-12-14**; therefore the **integrated Claude + Artifacts + Claude Code** product is primary, with standalone considered legacy for transition/compatibility research only. Availability and pricing may vary by subscription, organization policy and rollout: verify the actual account without inferring entitlement or starting paid usage. Core design features include chat-to-design, on-canvas direct edits, inline comments, reusable design systems, clickable prototypes/Play, export/sharing and design ↔ code sync. These are official claims until independently reproduced.

Do NOT confuse:
1. Claude Design product's drawing/artboard engine,
2. Claude chat Artifacts generic embedded outputs,
3. Claude Code design/code bridge,
4. the underlying Claude model/agent,
5. standalone 2026 legacy product,
6. third-party design integrations.

## 2. Start with current Ninerr + Framer evidence

Owner repo: `TheHalfMoon/Ninerr` (private). Begin from current main and active branches, **do not assume old research PR is merged**.
Framer Draft PR: https://github.com/TheHalfMoon/Ninerr/pull/375
Key documents:
- `docs/evidence/FRAMER_REA_FINAL_PUBLIC_SCOPE_DECISION_2026-11-07.md`
- `docs/evidence/FRAMER_DEEP_CRAFT_ANYTHING_REA_2026-11-07.md`
- `docs/evidence/FRAMER_AUTHENTICATED_EDITOR_AND_ACADEMY_REA_2026-11-07.md`
- `docs/evidence/FRAMER_AUTHENTICATED_FUNCTIONAL_REPLAY_2026-11-07.md`
- `docs/evidence/FRAMER_NINERR_DIRECT_PORT_CONTRACT_2026-11-07.md`
- `docs/evidence/FRAMER_REPRODUCIBLE_BENCHMARKS_2026-11-06.md`

Framer verified in an authorized blank owner project: native Canvas/Layers/Assets/Style, create `290×190` Fixed Frame with `F`+drag, wrap in Stack using `⌘⌥↩`, Stack became Fit with child, undo twice restores one original Desktop `1200×1000` at X=0 Y=0; breakpoint menu offered Tablet 810 and Phone 390 but **Phone addition was NOT qualified**. No Agent requests/publishing/payments. Signed-in Safari screenshot is evidence but Craft Anything on Windows browser was signed out; no authenticated DOM/CDP claim.

Ninerr implementation anchors: `packages/studio-host/src/mcp.ts`, `packages/canvas/src/index.mjs`, `packages/renderer/src/index.mjs`, `packages/document-model`, `packages/design-components`, `packages/code-ir`, `packages/history`, `packages/visual-git`, `packages/studio-web`.

## 3. Source and runtime census (REA, no false claims)

1. Search for official public API references, CLI/docs, installed app packages and public repositories explicitly licensed for redistribution. Pin URLs, date, revisions and artifacts.
2. Inspect product functionality, data/document model, component schema, canvas behavior, output format, roundtrip handling, UI interaction and design-system import. **Do not claim private Anthropic editor source is available** merely because browser JavaScript is loaded.
3. Trace only public/authorized request outlines, local caches and working directory files. Do not capture session cookies, credentials, request bodies with private content, hidden app state or unrelated user artifacts. No bypass of auth or usage limits.
4. Record rights and IP: separate official public code/docs and SaaS frontend delivered JS from third-party plugin assets, proprietary sources and user-owned data. Design ideas and independently implemented functionality do not automatically authorize copying proprietary internals.
5. Maintain an API/state/feature parity matrix for Claude Design ↔ Framer ↔ Ninerr with **Observed / Official Documented / Inferred / Unavailable / Not Tested** columns. Avoid false one-to-one analogies (e.g., document render iframe ≠ plugin UI, JSX export ≠ original CodeFile).

## 4. Craft Anything execution protocol

Use available `Craft Anything` tool, currently **0.3.0** on authorized owner Windows (`D:\Ninerr-Tools\CraftAnything-0.3.0\unpacked\craft-anything-0.3.0-windows-x64-portable\craft-anything-cli.exe`). Investigate whether a newer legitimate release improves the browser engine; **do not upgrade blindly or install untrusted binaries**. A single persistent `craft-anything-cli mcp` session is necessary for `web_site_open` → `web_site_capture` → `web_page_states_capture` and `web_page_js_analyze`, because separate CLI processes close the browser between commands. Use project `.cany`, evidence IDs, finding ledger, and native `report` output. Set local output directories under an ignored owner-controlled path. Do not commit raw copyrighted/site screenshots or secrets unless separately authorized.

At least the following surfaces should be captured (when actually accessible):
- Official Claude Design product and Academy/docs pages (desktop/tablet/mobile: 1440/768/390 CSS widths).
- Integrated Design template creation from Claude Artifacts.
- Integrated Design in a normal Claude conversation using Output > Design.
- Existing owned artifact with on-canvas edit/resize/alignment, code view where offered and prototype Play.
- Design system import/connection (use synthetic free local tokens, **no unrelated private customer data**).
- Claude Code `/design` and `/design-sync` workflow using a disposable sandbox and synthetic project only.
- Legacy standalone `claude.ai/design` **only to contrast migration**, without investing in a soon-to-retire-only implementation.

For each surface record target/app version, viewport, action sequence, accessible names/state, HTML/DOM if allowed, screenshots and hash, supported export artifact, read-only network outline, failures/retries, source/copyright caveats, and exact user-visible behavior. Do not pretend an open marketing page satisfies a logged-in design test.

For signed-in access, use an **owner-authorized** account/session and non-production artifact. If the browser is not connected, report the blocker. Do **not** transplant cookies, silently enable unsafe browser scripting, bypass protected endpoints, or pay for higher tiers without the owner's explicit direction.

## 5. Functional benchmark contracts (12 minimum)

Use synthetic sample brief with non-sensitive content: `Ninerr Mini UI Lab`, a dashboard page, three cards and one chart placeholder. Reuse identical input across Claude Design, Framer and Ninerr; no copying real private project assets.

| ID | Required user journey | Success evidence |
|---|---|---|
| CD-01 | Text brief → three editable artboards | Artboard IDs, visible editable controls, design source provenance |
| CD-02 | Inline canvas move/resize a card | Before/after coordinates, visible change and actual persisted state |
| CD-03 | Comment on one selected layer → scoped edit | Targeted diff, no unintended sibling change |
| CD-04 | Direct rich-text edit + undo/redo | Content roundtrip and full reversal with no duplication |
| CD-05 | Responsive desktop/tablet/phone views | 1440/768/390 screenshots, no overflow and semantics preserved |
| CD-06 | Import synthetic design system from local GitHub/JSON | Colors/type/aliases references match canonical token IDs |
| CD-07 | Reusable component and two variants/overrides | Instance inheritance and scoped override behavior |
| CD-08 | Multi-screen clickable prototype with Play | Input and navigation actually work without hidden unmocked calls |
| CD-09 | Design → Claude Code `/design` export | Exact files, format, source fidelity and build/preview result |
| CD-10 | `/design-sync` → modify code → roundtrip | No-op byte identity, minimal diff and conflict handling |
| CD-11 | Share and export under plan's real limits | Local artifact delivered/export format verified; do not publish publicly |
| CD-12 | Access control, interruptions and costs | Deny read/write, network privacy, restart recovery; billed model use prohibited without authorization |

For each benchmark: compare **task completion, fidelity, editability, latency, offline/privacy, accessibility, cost, rights and native export**. If feature is absent on the connected free account, mark `PLAN-LIMITED` or `UNAVAILABLE`, not passed. Distinguish results observed in product from docs/marketing and keep exact date/version.

## 6. Ninerr decision engineering (no required cloud)

Propose **original, local-first** Ninerr adaptations where useful:
- Conversation + canvas as synchronized local-state projections; AI suggestions as inspectable typed diff transactions with owner accept/reject and undo, never AI as sole state authority.
- Source-backed code/artboard roundtrip and reusable design systems with stable IDs and native exports; no online design backend mandatory.
- Safe use of offline providers where feasible and user-activated optional external inference; explicit egress/receipts and secret boundaries.
- Inline comments and direct manipulation over the same canonical document; event stream with revocation and per-project permission scope.
- Reversible branches for human and agent work with provenance, component-aware merges, no phantom duplicate data model.
- Fast design-system sync that preserves Apache-2.0 source and all third-party notices.

Map each recommended feature to existing files and tests, not generic product ideas. Reuse Ninerr's current architecture; do not unnecessarily port entire proprietary services or embed an inference account in the desktop app.

## 7. Deliverables + done gates

Create a **separate private research branch/Draft PR**, not a rewrite of the Framer PR:
1. `docs/research/CLAUDE_DESIGN_DEEP_REA_2026-11-XX.md`: source census, rights ledger, timeline/migration, observed functionality, unknowns.
2. `docs/evidence/CLAUDE_DESIGN_CRAFT_ANYTHING_LEDGER_2026-11-XX.md`: evidence IDs, SHA256, source paths, reproducible captures and limitations.
3. `docs/research/CLAUDE_DESIGN_FRAMER_NINERR_PARITY_2026-11-XX.md`: weighted capability and gap matrix, implementation anchors.
4. `docs/research/CLAUDE_DESIGN_12_TASK_BENCHMARK_2026-11-XX.md`: replay results with method and access/cost restrictions, not plan-only checklists.
5. `docs/research/NINERR_CLAUDE_DESIGN_IMPLEMENTATION_GRAINS_2026-11-XX.md`: P0–P2 deliverable-sized grains with acceptance tests, rights gates, offline constraints and resource estimates; independent architecture, privacy and UX reviews.

Run minimum source/identity/integration checks locally for doc changes; run Ninerr actual native journeys and platform CI for any later production implementation. Correct test setup faults and explicitly label blocked tests. **Do not merge or ship** without exact-head CI, authorized sign-off and native desktop QA.

Declare phase **public-source REA complete** when citations/rights/observed capabilities are done. Declare **full product deep REA complete** only if the authorized logged-in workflow, key benchmark tasks, independent review and residual blockers are genuinely closed. If not, publish a clear partial/blocked decision and the next executable gate, not "done".

## 8. Opus communication style

Write source reports and engineering instructions in **English**. User-facing summaries in **Arabic**; brief factual receipts: what actually happened, what changed, commit, tests, remaining blocks. No repeated "continue?" questions, no fake background work. Do not expose private account IDs or sandbox screenshot data in public links. The user asked for Claude Design specifically; do not drift into generic ChatGPT/Claude marketing aesthetics or unrelated apps.

**One-line mandate:** Deep Craft Anything + source-grounded independent REA of the actual integrated Claude Design product, then design a safer, local-first Ninerr equivalent with measured behavior and no invented parity.
