# Ninerr — Desktop-First, Agent-Native Implementation Blueprint
Date: 2026-11-06
Status: engineering-ready **draft for EGM independent Goldfish validation**; founder product constraints are confirmed, but implementation/release gates are NOT passed.
Proposed PR: #363; execution source of truth remains `docs/MASTER_PLAN.md` until this document is reviewed and adopted.

## 1. Product contract (non-negotiable)

Ninerr must become the preferred professional design environment for **both humans and agents**, combining a rich native desktop canvas, professional layout/components/vector workflows, faithful source-code editing, and Skilit intelligence in **one installed desktop product**.

1. **Native installation**: Windows, macOS and Linux packages. The existing Electron shell is reused. A website or mandatory web login cannot be the primary product.
2. **Offline core**: design, editing, files, local search, provenance inspection, imports of already-local assets, exports, undo/recovery and MCP operations work with all non-loopback egress blocked.
3. **No founder-paid user compute or cloud**: Ninerr does NOT operate a hosted multi-tenant database, cloud design workspaces, model inference endpoint, GPU queue, relay, embeddings service or mandatory user backend. The user owns their computer/storage and may choose their own model/provider. Hosting static documentation/installers is distinct from servicing user computation.
4. **Two equal clients**: the installed app UI and local MCP execute the same document commands and have equivalent effects, permissions, history and error behavior. OpenCode, other supported agent clients and human designers are first class.
5. **No account to start**: no Ninerr subscription, login, API key or model download is required to draw, edit, search bundled/local references, export or serve local MCP.
6. **Network disclosure**: browsing a public design reference URL or using an optional user-selected external model is explicitly opt-in from the user's computer, separately labeled ONLINE; strict Offline Mode blocks both. Default telemetry, remote fonts, analytics and auto-upload are forbidden.
7. **One document model**: Ninerr owns editable node identity, layout, components, tokens, history and source patches. Skilit contributes evidence/references/rights/search, not a competing canvas or authoritative editable store.
8. **Quality claims by tests**: "best" is an aspiration. Compare identical fixtures and exact versions across product capabilities. Marketing must not imply untested parity.
9. **Copy-first with provenance**: founder declares permission to copy/rename examined donors, yet every shipped bundle must have verified, source-specific scope, dependency and asset/redistribution permissions, notices and pinned hashes. No unapproved protected account or DRM bypass.
10. **No unrelated product rewrite**: avoid resurrecting cloud-only Skilit billing/auth/worker backend, duplicating rendering engines, or replacing an already-qualified local desktop host.

## 2. Verified source baselines and exclusions

Ninerr main `8cba15c4e4af40b12476433a49e20a1696cfc0f8`; strategy draft PR #363. Skilit main `157ace7fc57aae9e135a368b7bbe1829ae7111ae`, migration inventory issue #189. Both SHA values were checked on 2026-11-06; recheck before merging.

Verified implementation anchors:
- `packages/desktop/src/main.mjs`: starts `startStudioHost({projectsRoot, port: 0})` and Electron window; local host.
- `packages/studio-host/src/mcp.ts`: MCP over loopback HTTP, edit operations through `session.edit(..., "mcp")`, authorization checks and active-project read gate.
- `packages/studio-host/src/relay.ts`, `scripts/ninerr-mcp.mjs`: stdio relay to the local host.
- `packages/document-model/`, `packages/persistence/`, `packages/history/`, `packages/canvas/`, `packages/renderer/`, `packages/code-ir/`, `packages/studio-web/`: existing primitives to improve, not replace.
- `docs/MCP.md`: current catalog contains **16 tools**, transport/setup/authorization contracts.
- Skilit `ARCHITECTURE.md`: PostgreSQL is canonical; `web` is Next.js/auth/billing/remote MCP, `worker` does processing, object storage is external in deployment. **Not directly suitable** as a mandatory component of Ninerr's offline app.
- Skilit `PRODUCT.md`: Research, Assets, Lens, Agents, Create and reference packs are feature candidates.

Unmerged/proposed work must NOT be treated as existing production support: Ninerr PR #359 (P11–P16 plan), PR #362 (P09 text model); Skilit Draft PRs #178–#188 (possibly overlapping source changes). Do not indiscriminately merge stacked or competing drafts.

## 3. One concrete system design

```text
Human UI (Electron renderer)           Agent (OpenCode or other MCP client)
             |                                  |
    typed UI command boundary          local stdio MCP
             |                                  |
       hardened Electron main  <---> local-only studio-host MCP HTTP
                           \        /
                  same access / operation gateway
                             |
                    canonical Ninerr document
         nodes + styles + tokens + components + stable IDs
                             |
             atomic history / snapshot / journal
                             |
          OS-selected filesystem / safe local assets
                             |
          read-only Skilit-inspired intelligence
       reference packs + rights + local search index
                             |
        optional URL Lens capture on user's computer
```

### Runtime modes (do not conflate them)
- **A Desktop-only**: opens without Internet. UI edits with no agent. No user account or model required.
- **B MCP-only**: installed Ninerr provides a supported headless local host or opens the host without a visible canvas window; agent can read/edit/export local workspaces via stdio. This requires implementation and native testing: the existing relay currently expects a running host; do not advertise headless as shipped.
- **C Local-agent**: user-installed agent/local LLM communicates over local MCP; Ninerr provides deterministic operations, not inference.
- **D Explicit online**: user chooses a URL to examine or supplies external AI provider credentials. Traffic originates from user machine; OFFLINE switch shuts it down entirely.

### Architecture decisions
**D-01 desktop**: continue Electron implementation, hardened renderer, no remote content or privileged Node in pages. Desktop process owns window lifecycle and a singleton studio host with safe shutdown and project locks.

**D-02 local MCP**: reuse existing stdio relay and loopback HTTP rather than inventing a new remote service. Add optional background/headless host lifecycle to installed package, with project selection/listing, access prompts, and controlled exits; no remote bind or automatic tunneling.

**D-03 one mutation gateway**: UI and MCP operations reach `StudioSession` with the same typed intents and canonical revision. `baseRevision`, `requestId`, dryRun, impact preview, proposed change, tokenized approval and operation checksum are introduced incrementally per P11. No second history log or write path.

**D-04 local references**: use a self-contained versioned reference-pack manifest with namespaced stable IDs, SHA256 asset hashes, source identity, rights/license metadata, capture timestamp, confidence and supported transformations. Local files are authoritative for imported reference packs. Add SQLite FTS5 **only if real search benchmarks justify it**; index is disposable/rebuildable and must not become canonical. Do not embed PostgreSQL or third-party hosted search.

**D-05 local Lens**: capture of local images is offline. URL capture is a separate user-initiated online subprocess or sandboxed worker with least privilege, bounded bytes/time/redirects, private-address and localhost denial, blocked arbitrary filesystem access, sanitized evidence and no credentials passed to content. No hidden crawler queue.

**D-06 model ownership**: no embedded paid model, user credential interception or automatic GPU downloads. The built-in app may make deterministic suggestions without a model. User's locally running or chosen provider-driven agent controls via MCP. An optional built-in BYO model interface is a later independent feature, never an activation requirement.

**D-07 distribution**: ship signed where feasible, or disclose unsigned publisher binaries; generate checksums/SBOM/notices, corresponding Electron LGPL source and reproducible release provenance. Distribution site may be static; static hosting is not user compute.

## 4. Two-track delivery to avoid a never-ending release

**Track R — usable desktop release**: finish existing P09/P10 and exact-head release gate. This is not blocked on full professional vector parity, every competitor REA, or complete Skilit migration. Never reclassify missing P09/P10 acceptance as done because the strategy changed.

**Track W — world-class design platform**: P11–P16 technical extensions and Skilit M0–M5, each merged only after functional acceptance. Work in small independently reviewed PRs, coordinating shared contracts.

Dependencies:
```text
R0 current exact-head inventory -> R1 P09 completion -> R2 P10 packaging/quality -> R3 release gate
W0 REA + permission ledger -> W1 local MCP + transactions -> W2 professional layout/tokens/instances
W0 -> S0 Skilit source map -> S1 local reference packs -> S2 Research/Lens -> S3 apply-to-design
W1 + W2 + S3 -> W3 agent creation + vectors + prototype -> W4 product polish / advanced parity
```

### R1: existing desktop readiness (P09)
Use `docs/MASTER_PLAN.md` as canonical acceptance, not approximations. Finish edit Undo control, pointer+keyboard layer grouping/reparent/reorder, class inspector, accessibility tests, and text + CSS shorthand/longhand decisions. Run actual native window tests; ensure visual identity is consistent. PR #362 is not merged.

### R2: cross-platform release qualification (P10)
On exact candidate SHA run full JS tests, smoke, performance reference, migration corpus, security/no-network evidence, seven-project dogfood, native packages and packaged journey/resilience on Win x64/macOS arm64/Linux x64. Bind all artifacts, notices, SBOM, checksums and required corresponding source to commit. Critical issues block publish.

### W0: deep REA and source-map
- Deep REA uses **OpenCode + DeepSeek + Craft Anything** (no Codex). The old 24 tasks are the starter regression corpus, not a cap on research.
- Each new finding requires evidence type OBSERVED / OFFICIAL_DOC / INFERRED / UNKNOWN, version, URL or source SHA, sample input, reproduction steps, measured outcome and what would falsify it.
- Search multiple competitors beyond Figma/Adobe/Paper/Pencil/Stacki/Framer as relevance warrants. Do not confuse landing page inspection with authenticated editor tests.
- Rights-ledger rows identify exact source, ownership, redistribution conditions, third-party asset status and whether copying is permitted. Preserve required notices.
**Exit W0:** first priority baseline and keep/adapt/reject matrix are approved; no unverified claim that thousands of features were copied.

### W1: MCP transaction semantics
Files: `packages/studio-host/src/mcp.ts`, `session.ts`, `packages/mcp-protocol/src/tools.mjs`, `packages/studio-web/src/app.mjs`, `tests/mcp-server.test.mjs`, `tests/mcp-relay.test.mjs`.
1. Read `project_info` with stable IDs and revision; require read-first access policy.
2. `dryRun({baseRevision,operations})` returns normalized ops, warnings, impact/deletion list and digest but makes **no revision/history/file change**.
3. `apply_operations({baseRevision,requestId,operations})` applies one atomic transaction, idempotent by actor + requestId + argument hash; stale revisions reject with structured conflicting fields.
4. UI proposal panel can preview/accept/reject; accept checks revision again. Unsafe deletes and agent-supplied content require explicit approval; 'reject' creates no journal entry.
5. One agent transaction is undoable without silently losing later human edits; two agents editing different subtrees do not corrupt state.
6. Existing relay remains local-only; headless mode requires separate installation, token provision, process lifecycle and native security tests.
**Exit W1:** desktop and MCP can replay equivalent edits and achieve equivalent document hash; 0 silent destructive writes; stale and duplicate requests are tested.

### W2: professional design substrate
Files: `packages/document-model`, `packages/canvas`, `packages/renderer`, `packages/studio-web`, `packages/code-ir`.
1. CSS-based responsive constraints/auto-layout with truthful unsupported-state fallback.
2. Tokens, modes, aliases, types and reference validation with explicit versioned schema migration.
3. Components and instances with variants, overrides, reset, swap, stable identities and codebound references.
4. Manual vector paths/shapes, masks/boolean operations through qualified local libraries, precision export SVG/PNG/PDF.
5. Text/font rendering, keyboard-first editing and WCAG checks; no cloud font requirement.
6. Source links: React/JSX, Astro/CSS, minimal diffs, fail-closed unsupported structures.
**Exit W2:** three-screen reference system passes desktop, tablet and mobile; 100 instances update from master without drift, stale/unsupported imports preserve source; five-run performance acceptance per master plan.

### S0–S3: migrate Skilit to an offline intelligence module
**S0**: pin Skilit main and current Draft PR alternatives; inventory Product, ProductVersion, Artifact, Asset, Relation, Flow, Pattern, Collection, CaptureRun, AnalysisRun and ImportRecord, API/REST/MCP and rights. No bulk repo merge.
**S1**: write `ReferencePackV1` and typed `ReferenceObject` contracts (below), with local hashed assets and immutable provenance. No mandatory Postgres/Redis/pgvector/S3/remote auth.
**S2**: Ninerr Research/Assets/Lens UI backed by same search/read contracts exposed to MCP agents; local keyword search first. Online URL Lens opt-in, fail-closed source/rights checks.
**S3**: `propose_reference_apply` converts a rights-approved reference pack to native Ninerr tokens/frames/components behind a human-previewed transaction. Reopen, undo, and agent retrieval preserve reference URIs. No embedded Skilit canvas.

Proposed minimum portable reference contract:
```json
{
  "schema": "ninerr.reference-pack/1",
  "packId": "urn:ninerr:pack:<uuid>",
  "createdAt": "<RFC3339>",
  "sources": [{"id":"urn:ninerr:source:<hash>","uri":"https://...","observedAt":"<RFC3339>","rights":{"status":"verified|restricted|unknown","license":"<id-or-null>","redistributable":false}}],
  "objects": [{"id":"urn:ninerr:object:<hash>","kind":"screen|flow|pattern|asset|token|component","sourceId":"urn:ninerr:source:<hash>","assetSha256":"<hex-or-null>","confidence":"observed|documented|inferred|unknown"}]
}
```
IDs are examples, not a final normative schema. Verify actual Skilit domain IDs and adoption/migration before locking schemas. Entries with unknown rights may be referenced for analysis but not redistributed by default.

**Exit S3:** an offline 1,000-object mixed-rights reference-pack fixture searches and reopens, all stable IDs resolve, and restricted assets cannot be exported. No remote network or access to unrelated files.

### W3: agent-native creation and advanced visual production
- Agent's input plan is a proposed set of typed operations, not direct code or hidden file overwrites.
- Offer component/library reuse before hallucinated new components; each agent session has visible provenance and undo.
- Full export correctness including PDF and editable SVG, layout quality, font handling, accessibility and provenance.
- Professional creative extensibility via versioned local plugins with narrow capabilities, no undocumented system privileges.
- Do not attempt full video/3D/print-suite parity before the desktop agent design core is proven.

### W4: experience and distribution
- One cohesive Ninerr UI with Research / Canvas / Components / Assets / Inspect / History / Agents / Export; no Skilit-branded secondary experience.
- Packaging, recovery, onboarding, visual identity, documentation of local stdio MCP for supported clients (especially OpenCode) and clear offline/online modes.
- Comparative benchmarks across supported tasks with repeatable fixtures, versions and failure analyses; update marketing only after proof.

## 5. Test matrix and absolute failure criteria

| ID | Required proof | Pass / failure boundary |
|---|---|---|
| A1 offline | fresh install, net denied for create, edit, reopen, MCP, export, local research | **zero non-loopback egress** and zero required login |
| A2 parity | run human vs MCP intents on same fixture | equivalent canonical document and undo history |
| A3 conflict | duplicate id, stale edit, agent+human interleaving | at most one commit per id; rejected stale writes; no lost user edits |
| A4 persistence | simulated crash after proposed and committed actions | no partially committed or unrecoverable document |
| A5 source safety | Astro, JSX and complex CSS fixtures | bytes preserved when unchanged; unsupported source never overwritten |
| A6 creative quality | responsive frames, vector export, typography, component instances | native editable nodes; coherent files, not screenshot-only simulations |
| A7 security | malicious localhost web page, MCP client, URL redirects, workspace files | no cross-workspace access, local credentials/secret leaks or remote binding |
| A8 Skilit | 1,000 local refs with rights + reopen | every allowed URI resolves; restricted assets never exported |
| A9 economics | architectural audit and installation | zero founder-hosted per-user compute; user supplies any AI model/provider |
| A10 packaging | Windows/macOS/Linux exact-head installers | passes native journeys, hashes/SBOM/notices/corresponding-source gates |

Failures in A1/A3/A4/A5/A7/A9 block release even when a weighted visual benchmark score is high. Performance thresholds follow `docs/MASTER_PLAN.md`, rather than unsupported blanket target values.

## 6. EGM Goldfish protocol and readiness state

Google Elephant-Goldfish Model is installed on the owner's computer, but **installation is not a completed review**. EGM draft exists locally on an authorized Windows worktree; first OpenCode + DeepSeek independent zoom-out reviewer was invoked. Windows Desktop Commander later became unresponsive; no completed, saved five-stage Goldfish report is verified. Treat Goldfish stages 5 Zoom Out, 6 Comprehension, 7 Design Critique, 8 Zoom Out again, and 9 Implementation Readiness as PENDING until their fresh-context output and issue disposition are inspected.

Reviewer instructions: read source-sha-pinned docs, the EGM persona and standard, then inspect code directly. Independently challenge (a) assuming no web traffic from localhost, (b) remote service leakage via optional providers, (c) headless transport UX and local authorization, (d) duplicated Skilit canonical DB, (e) source-rights and asset provenance, (f) missing package-level implementation details, (g) unbounded research scope becoming an execution blocker. Every Blocker must be fixed with a new plan diff and independently re-reviewed before this is marked APPROVED.

Status truth:
- Founder direction: CONFIRMED.
- Source-anchored plan draft: WRITTEN.
- Google EGM independent complete review: NOT VERIFIED.
- REA on public Stacki landing page: OBSERVED; authenticated editor parity UNKNOWN.
- Fully implemented offline Skilit migration: NOT DONE.
- Native packages / v1 release criteria: NOT VERIFIED.
- This document alone is not approval to merge, publish, run paid models, or replace the canonical master plan.

## 7. First independently mergeable engineering tasks after approval

1. **Local MCP headless proof**: add a failing test where installed app is closed, `stdio` initializes, opens an authorized local project and reports revision, then exits cleanly. Scope of file writes and credential provisioning must be determined in a short ADR first.
2. **Offline reference-pack read-only spike**: support a 20-object fixture, rights filter and stable IDs in the local store; test re-open and zero network, without importing Skilit runtime.
3. **Agent mutation dry-run**: implement a single atomic operation path with baseRevision and no side effects; test reject/accept stale variants.
4. **Astro round-trip corpus**: 54-file input corpus (or user-owned equivalent), zero-edit byte identity, one-edited-node minimal diff, unsupported-source fail-closed.
5. **Research-to-design preview**: one right-cleared pattern -> native editable tokens/frames -> UI/agent consistent transaction and undo.

Deliver each as bounded test-first PR with exact-head CI and fresh-context review; first three are priority. Maintain an explicit risk register, issue dependencies and founder release decision.
