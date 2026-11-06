# NINERR — Implementation-Ready Master Plan

Date: 2026-11-06  
Status: READY TO EXECUTE BOUNDED WORK PACKETS; NOT RELEASE READY  
Repository: TheHalfMoon/Ninerr  
Baseline: main at 8cba15c4e4af40b12476433a49e20a1696cfc0f8, verified on 6 November 2026  
Planning: strategy PR #363; corrected Google EGM PR #368  
Code: offline pack PR #365; stacked file reader PR #367; text-layer/P09 PR #362

## 1. Frozen product contract

Ninerr will be an ambitious, world-class **installed desktop design environment for humans and AI agents**. It should compete with Figma, Adobe Illustrator/Photoshop, Paper, Penpot, Framer, Sketch, Affinity, Stacki, Pencil and emerging AI design tools. Success is measured by real feature parity, superior safety and usability, reliable source-code round-trip, accessibility, offline operation and agent effectiveness. Marketing superiority is not claimed until head-to-head outcomes support it.

The product ships as desktop packages for Windows x64, macOS arm64 and Linux x64, with a native Electron host and a single canonical Ninerr document. Ninerr does **not** host inference, model serving, customer workspaces, user compute, a shared database, vector service, cloud relay or billing. Normal design work and local MCP never require an account, cloud connection, subscription, API key or provider-paid inference. Optional user-initiated model/provider or URL capture work uses the user's own machine or explicitly configured endpoint. Strict local-only mode blocks all external traffic, subject to an OS-level test before this guarantee is marketed.

OpenCode is the preferred programming/review agent. DeepSeek with Craft Anything is the preferred REA/research stack when a free quota is available. **Do not use Codex; do not silently use paid APIs.** The free DeepSeek limit is an external research blocker, not permission to fake an EGM review.

Skilit is integrated as Ninerr Research, Lens, Assets, Design Intelligence and Build Kits. The **Skilit runtime is not copied as a second editable backend**. Its source data is exported with actor filtering and verified grants into rights-aware local reference packs. The installed app never needs Skilit's PostgreSQL, Next.js, Redis, S3 or its account infrastructure. Never delete or retire Skilit until migration tests, asset rights and user decisions permit it.

Authorization boundaries: routine branch edits, tests and Draft PRs may proceed under the founder's standing instruction. Public releases, unverified third-party redistribution, elevated host privileges, financial commitments and permanent project deletion are not authorized by a generic "go ahead."

## 2. Source of truth and decisions

1. docs/MASTER_PLAN.md controls N0, P09, P10 and the existing v1 release gate.
2. Released code and existing schema files control currently implemented behavior. The stage-05-to-07 spec in PR #368 describes proposed behavior; it cannot override code.
3. Approved ADRs and a pinned PR head control a task when the founder accepts that task. P11-P16 remain future work, not included in the current v1 candidate.
4. Ninerr document/session/history/persistence is the only editable document authority. All agents and humans go through its one-writer transaction mechanism.
5. The existing packaged MCP transport is authenticated **loopback HTTP** while the host runs, with 16 defined tools. A Node-based stdio helper is currently checkout-only, not bundled and not a production promise.
6. The actual ReferencePackV1 defined by packages/import-stack/src/reference-packs.mjs in PR #365 is authoritative. No competing manifest format or ID grammar is permitted in v1.
7. Asset rights and source rights are separate. A hash does not grant permission. Unknown, restricted, private and cross-project data fail closed for redistribution.
8. An agent proposes or previews edits; the host authenticates and rechecks permissions, revision and user approval before one atomic commit. An agent cannot approve itself.
9. Competitive advantage is measured on dated, equivalent tasks and hardware. A public marketing-page screenshot is research evidence only, never editor functionality proof.
10. Every implementation PR must be independently reviewable, rerunnable, green on its exact head, reversible and narrowly scoped; no speculative infrastructure PR is necessary.

## 3. Execution order and work packets

Each task below is one small PR or a small ordered stack. A task is complete only on passing the named positive **and negative** tests. File paths listed are intended owners; newly proposed filenames must be created only in that task. Before changing code, inspect the exact owning commit and current APIs.

### Track R: finish and ship the real desktop foundation

**R01, P09 expression preservation (first priority).** From PR #362, inspect packages/studio-host/src/code.ts and packages/code-ir/src/roundtrip.ts. Modify tests/text-layers.test.mjs and existing code workflow tests. On import/export, an original code-bound JSX expression such as a dynamic title must not become literal on-screen text. For unsupported or changed expressions, preserve the original code with provenance or refuse export. Required regression tests: simple expression, mixed text/children, literal escaped braces, malformed code source, no-op export, edit and reimport. Do not execute untrusted expressions.

**R02, P09 CSS precedence.** Resolve issue #360 in the existing import-stack/style cascade and relevant renderer tests. Define the result by actual computed styles, not selector ordering or output string alone. Cases: shorthand followed by longhand and the reverse; mixed margin/padding/border; import→inspector edit→export→reimport; malformed CSS refusal. Reuse the existing parser.

**R03, P09 usable editing.** Finish the canonical P09 requirements in packages/studio-web/src/app.mjs, document/history and existing browser journeys. Group/reorder/move via pointer and keyboard, class inspector, text semantics, meaningful focus states, 320px reflow and actual accessibility audits. Every user edit must be represented by an undoable transaction. Existing GUI/MCP supported operations produce equivalent normalized document results on identical fixtures.

**R04, truthful security and offline gates.** Reuse packages/network-policy and tests/offline-guarantee.test.mjs. Add a main-process egress proof and a packaged whole-process network trap covering Electron main, renderer, utility and children. Offline mode permits only the explicitly allowed loopback host/MCP. The negative control deliberately attempts external DNS/HTTP/update/font/provider access and MUST be observed and denied. No zero-egress release claim until the OS-level evidence exists on all three OS targets.

**R05, P10 release qualification.** Execute from the exact candidate SHA: npm ci, npm run check, smoke, real package journeys and crash-recovery tests, identity census, SBOM/license notices/checksums/corresponding source, Windows/macOS/Linux installations and accessibility. Fresh users must create/edit/undo/save/reopen/export the **currently supported JSX** and connect an authorized local agent without installing Node or buying a model. Do not claim packaged stdio, PDF, SVG/PNG exports, Astro, Skilit UI or full GUI/MCP parity. No public release before all gates and explicit release authorization.

### Track M: integrate the real Skilit design-intelligence foundation

**M01, pack model.** Qualify existing PR #365 without replacing its JSON contract. Implementation: packages/import-stack/src/reference-packs.mjs and design-graph-reference-adapter.mjs, corresponding tests and index export. Expected: deterministic IDs/digests, 1,000-object local search, bounded inputs, separate source/object rights, verified content hashes and refusals for missing grants. Existing local tests passed 20/20 on owner Windows, but exact-head full CI is separately required.

**M02, local file reading.** Qualify stacked PR #367 only after M01. Implementation: packages/import-stack/src/reference-pack-file.ts; tests/reference-pack-file.test.mjs. The host chooses a trusted directory; the request names one basename ending .json. Reuse canonicalDirectory, canonicalFileWithinRoots and readSingleLinkFile. Reject traversal, invalid UTF-8/JSON, oversized manifests, symlink/hardlink where supported and invalid rights. Existing Windows result: 38 targeted cases, 36 pass, 0 fail, 2 symlink tests skipped owing to EPERM. Symlink coverage remains mandatory on a capable OS.

**M03, project-scoped read catalog.** Create packages/studio-host/src/reference-catalog.ts and tests/reference-catalog.test.mjs; add read-only GET /api/references and GET /api/references/:id to the existing server. Import only from an owner-selected local directory; never accept arbitrary paths from MCP. Catalog lifetime equals the currently authorized project. Project close/switch revokes previous catalog access, retaining stable reference IDs when the same pack is reloaded. Search has a bounded query (200 characters) and result limit (1 to 100). Missing pack is an explicit not-loaded response, never a network fallback.

**M04, local MCP read parity.** Add search_design_references and get_design_reference to packages/mcp-protocol/src/tools.mjs and packages/studio-host/src/mcp.ts. Require the existing read grant, bound project identity and valid agent. Use the same catalog/query function as the UI. No directory, URL, raw asset bytes, tenant or authorization token argument is accepted. Verify identical IDs, titles and rights in GUI and MCP; revocation/switch/unknown reference reveals no private metadata. These are read-only tools, not import/apply privileges.

**M05, Research UI.** Add a source-aware Research pane to existing studio-web (new research.mjs only if necessary) with search, kind filters, preview, source/grant/confidence indication, non-blocking empty state, keyboard/focus/accessibility and 320/768/1440 layouts. Render untrusted descriptions as text; disable remote thumbnails, HTML execution and automatic URL capture. Do not add cloud sign-in.

**M06, owner-authorized Skilit exporter.** In the separate TheHalfMoon/Skilit repo, create a source-side export task that uses the existing authorization and visibility filters. Produce actor-visible local records in the exact Ninerr v1 manifest using the M01 adapter, plus an out-of-band rights ledger. No cross-tenant raw database dump. Fixture: source A / tenant A, source B / tenant B, mixed public/private, stale and missing permissions. Tenant B must never appear to tenant A; any missing export rights fail closed. Never retire the Skilit source during this step.

### Track W: comprehensive agent-native, professional editing

**W01, MCP transaction contract v2.** Extend existing mcp-protocol and studio-host code with caller-supplied baseRevision, requestId, typed stale/conflict/refused results and idempotency. A stale revision never updates to the latest revision implicitly. Use the existing document operation validator and one-writer store; do not add generic arbitrary JavaScript evaluation or direct filesystem edits. Duplicate request IDs cannot double-commit; revoked agents cannot write.

**W02, preview/approval and revert.** Add dryRun and propose_change with bounded operations, proposal ID, operation hash, baseRevision, TTL and human-owned accept. Freeze defaults: max 200 ops, max 256 KiB serialized proposal, 32 pending/project, 10-minute expiry. Preview is side-effect free. Accept rechecks the full operation hash and live revision. Revert/reapply requires an explicit reviewed plan and no accidental removal of intervening human edits. Tests include two-agent races, stale revisions, user rejection, crash/reopen and undo lineage.

**W03, packaged local MCP helper and headless option.** Use the existing scripts/ninerr-mcp.mjs, studio-host/relay.ts and scripts/package-desktop.mjs. Package a verified local helper or utility with no user-installed Node/npm. It discovers only an owner-approved local host/project, does not print bearer secrets and cannot bind public interfaces. First gate supports installed app running; an app-closed headless lifecycle needs its own process-owner/auth design and separate native tests, not a silent promise.

**W04, responsive layout.** Extend document model, renderer and studio inspector with constraints, grid/flex-aware layout, snapping, guides, align/distribute/rotate and local font selection. Tests for 320/768/1440 layouts, pointer/keyboard equivalent operations, invalid constraints, 1,000 nodes, undo and source fidelity. Do not invent a second layout engine when the canonical renderer can own the feature.

**W05, tokens and design systems.** Add additive token collection/mode/binding support to the canonical document and inspector. Define explicit missing-token and cycle behavior as refusal, never fallback to unrelated values. Document schema 1 remains readable and unmodified until a v2 edit. Older code must reject new v2 documents without rewriting; version migration tests cover snapshots and journals.

**W06, components and variants.** Add definitions, instances, properties, variants and overrides in existing design-components/document-model/renderer. Instance expansion is a deterministic render projection, not a duplicate editable store. Reject cycles/missing definitions and test 1,000 20-node instances, nested variants, undo/redo and source write-back invariants.

**W07, professional vectors and export.** Add local SVG/PNG/PDF exporters and vector paths/booleans. Compare geometry, pixels, font fallbacks and page boxes against deterministic fixtures. Restrict output to owner-chosen paths. Never embed unknown/restricted pack assets in exports. Treat Astro code round-trip as a separate W07A parser/patch task with zero-edit byte identity and minimal-diff tests; no broad "Astro supported" marketing until verified.

**W08, apply references safely.** Only after M05, M06, W02, W05 and W06, turn approved references into Ninerr native nodes/tokens/components through a preview and one atomic history transaction. Source URN and grants remain inspectable. Unknown/missing source/rights blocks export; proposal refusal leaves journal unchanged. Users can undo an applied reference without losing later human edits.

**W09, user-owned AI and Build Kits.** A deterministic local adapter may call a user-configured local model or an explicitly authorized direct provider through network-policy with cancellation, scope control and visible egress list. Never ship mandatory model weights or pay inference on Ninerr infrastructure. Build Kits are versioned, reproducible, rights-verified local bundles of allowed source references, tokens, component descriptors and user prompts. Test restricted/private exclusion and full source attribution. No remote processing by default.

**W10, design QA and competitor REA.** Use OpenCode + DeepSeek + Craft Anything to research Figma, Adobe, Paper, Penpot, Framer, Stacki, Sketch, Pencil, Affinity and emerging tools. The first 24-task corpus is a minimum starter, not a limit. Benchmarks must record version, date, workflow, machine, account constraints, timing, fidelity, accessibility, source round-trip, offline behavior and agent success; inaccessible features are UNKNOWN, not failed. Current eight public-site capture sets are landing-site evidence, not proof of actual competitor editor features.

## 4. Exact ReferencePackV1 wire contract

This is fixed by the current Draft #365 source. An implementer MUST NOT create another incompatible v1.

Required top-level fields: schemaVersion=1, packId, createdAt, sources[], objects[], assets[].
- Source: id, uri, observedAt, rights.
- Object: id, kind, title, tags, sourceId, assetSha256 (nullable), confidence, visibility, rights.
- Asset: sha256, byteLength, mediaType.
- Rights: status = verified/restricted/unknown; license = string/null; redistributable = boolean.
- Object kinds: screen, flow, pattern, asset, token, component.
- IDs: lowercase urn:ninerr:pack:..., urn:ninerr:source:..., urn:ninerr:object:...; not ninerr-ref://.
- Source URI: local source URN, or HTTPS without credentials, query or fragment.
- Time: UTC ISO timestamp with 3-digit milliseconds.
- Limits: manifest 4 MiB; sources 2,048; objects 10,000; assets 2,048; one asset 32 MiB; aggregate assets 128 MiB.
- All unknown fields, duplicate IDs/hashes/tags, invalid references and excessive sizes are rejected before use.

Distribution permission requires verified and redistributable status **both** at source and object and public visibility, followed by a verified external rights-ledger decision. Rights fields do not prove current tenant/actor authority; the source exporter applies source-system access filters and the local host applies project/agent grants. Asset hash proves bytes, never copyright permission. Future schema enrichments require version 2 and migration tests, not silent v1 edits.

Local host/MCP read service (M03/M04, not yet implemented):
- UI imports pack through an explicitly selected trusted directory.
- GET /api/references returns project, digest, bounded results and provenance metadata; GET /api/references/:id returns safe reference metadata, not protected file bytes.
- search_design_references({query,kinds,limit}) and get_design_reference({id}) call the same service; no path or grant arguments.
- 200-character maximum query and limit 1..100, current open-project scope only. Wrong project, revoked agent and unknown item refuse without metadata.
- All two transports use the same index, permission check and ID oracle. There is never an automatic online search fallback.

## 5. Dependencies and safe parallelism

Track R critical path: R01 + R02 → R03 → R04 → R05 (candidate P09/P10).
Independent local pack path: M01 (#365) → M02 (#367) → M03 → M04/M05. M06 runs as a separate rights-filtered source PR once exact wire format is frozen.
Agent path: W01 → W02 → W03 and W08. Layout path: W04 → W05 → W06. Reference apply: M05 + M06 + W02 + W05 + W06 → W08. User model + Build Kits follow W02, W05, W06 and M06. Standalone vector exporters can start after R03; component-aware export follows W06.
Do not wait for competitor marketing REA to fix verified code bugs; do not announce feature parity until independently measured.

## 6. Measurable gates

Every PR: an observed failure/negative control, exact-head tests, independently reviewed diff, accurate source file census, no unverified license, bounded memory/runtime and project data recovery.

Release gate: installed packages on Windows x64, macOS arm64 and Linux x64, fresh account, no API keys/Node dependency, UI + authenticated local MCP, source export and reopen, file locks/crash recovery, accessibility and keyboard workflows, no unauthorized network egress, SBOM/license notices/checksums, complete tests/CI and source SHA reproduced in artifacts. Public release requires an explicit release decision.

Performance targets, not current claims: 1,000-object pack search p95 ≤100 ms, pack reopen ≤2 s, edit p95 ≤100 ms for 1,000 layers and ≤300 ms for 10,000 on the declared reference machine, 1,000 component instances ≤50 ms expansion p95, source import/export with no loss of unsupported bytes. Five-run reference protocol and negative controls apply. If target cannot be supported, a reviewed ADR must change it *before* a gate is declared passed.

From an exact PR worktree (on Windows use npm.cmd):
    npm ci --ignore-scripts
    node scripts/identity-census.mjs --verify
    npm run check
    npm run smoke
    git diff --check

For #365/#367 only, also run the available reference-packs, design-graph-reference-adapter and reference-pack-file Node tests. All three file-level targeted test files do not exist on plain main. Two skipped Windows symlink tests are not proof they pass on a symlink-capable platform. A long running npm check is not green until its **final exit status and total test summary** are available.

## 7. Concrete merge and verification order

1. P09 #362: fix and qualify issues #360/#361 before the UI source release gate; no surprise broad refactors.
2. #365: qualify pack/rights model, record exact SHA and main CI. Then #367: qualify the trusted local file reader; the earlier #367 Linux failure was stale identity census and was fixed on b063592ce6759690ab8dee2ba2308ef0348655a7; re-check latest-head CI. Never infer a green full check from green Desktop packaging.
3. #363 strategy → #368 corrected EGM → this implementation plan. Merge each only after conflict/authority review, not via force push.
4. M03/M04/M05 can be built without waiting for W04/W05 tokens; **reference apply** must wait for their schemas and one-writer proposal integration.
5. Preserve Skilit repo and its private provenance. No public launch/redistribution/retirement as part of a documentation merge.

## 8. Readiness truth

**READY TO START NOW:** R01, R02, M01/M02 qualification and M06 rights/export inventory. These work packets have named code boundaries, tests and outcomes.  
**IMPLEMENTABLE AFTER THEIR DEPENDENCIES:** M03–M05 and W01–W10, using the versioned interfaces and gates above. Each increment needs tests and a Draft PR; each completed increment may be delivered separately.  
**NOT DELIVERED / NOT CLAIMED:** complete Ninerr product, complete Skilit merge, all design competitors beaten, packaged headless stdio, PNG/SVG/PDF and Astro parity, entire OS network isolation, a public v1.0.0 release.

Independent Google EGM Goldfish stages 05, 06 and 07 were completed, with 34 findings mapped into 14 issue clusters in PR #368. Stages 08/09 are **still pending** because the free DeepSeek model hit usage limits; no paid inference or Codex substitution is authorized. This document is a full engineering plan with bounded work packets, **not a fabricated independent review certificate**. It supersedes incompatible proposed manifest/URN details from the older R2 text and must remain consistent with the version-1 implementation.
