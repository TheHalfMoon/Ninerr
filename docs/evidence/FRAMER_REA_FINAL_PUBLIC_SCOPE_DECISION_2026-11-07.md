# Framer ↔ Ninerr — REA decision record and execution-ready research gates
**Research cut:** 2026-11-07. **Status:** public-source inventory complete at pinned SHAs; private-editor architecture/parity NOT verified; Ninerr engineering may begin in well-scoped slices only. This is a durable source-backed research decision, not an implementation claim.

## What was actually accessed and inspected
1. GitHub REST API public listing for Framer: **20 public repositories, 6 original and 14 forks**. This is public org enumeration, not Framer private repo inventory. Full name, fork flag and metadata license are in FRAMER_PUBLIC_SOURCE_CENSUS_2026-11-06.md.
2. Official public example repo https://github.com/framer/plugins at `df96c6d0b9427b1157aac5c87a37e39d42348a27`: all **32 plugin folders**, **670 file paths, 395 JS/TS source files and 17 test paths** statically inventoried. The script uses Git's committed tree, not a checked-out working directory, and detects literal Framer API-style names; it does not prove every execution path. See FRAMER_ALL_32_PLUGIN_SOURCE_INVENTORY_2026-11-07.md.
3. Directly inspected meaningful source files for global search, CodeFile link/history, design-system and canvas cleanup. Specific paths/calls/implications in FRAMER_PLUGIN_SOURCE_AUDIT_2026-11-06.md and FRAMER_NINERR_DIRECT_PORT_CONTRACT_2026-11-07.md. This is a focused code audit, not independent comprehensive security auditing of every dependency.
4. Motion public repository at `78f3ff51b5508f7e8c1c283d8e80bcd26fec37d7`: motion, framer-motion, motion-dom, motion-utils packages; MIT notice; source for spring, inertia, timeline/frameloop, DOM animation, drag, layout and AnimatePresence. **268 test file paths enumerated but tests NOT executed**. Motion source is independent of Framer proprietary editor source.
5. Framer's public developer reference https://www.framer.com/developers/reference and **46 public documentation pages** indexed. Eleven official areas include Canvas, Branching, CMS, CodeFile, Localization, Navigation, Permissions, Plugin UI, Publishing, Settings and User. Public methods do not grant access to backend/internal editor code.
6. 8 public npm package metadata snapshots (Motion family, plugin SDK, agent CLI and framer-api); public packages and package license fields do not themselves establish provenance for all proprietary/third-party components.
7. Official Framer agent connector source `framer/agent-plugins` (MIT) and remote MCP docs: `https://mcp.framer.com/mcp` is **remote OAuth**, editor may be closed, and localization is missing from remote MCP at launch as of October 30 2026. The older `@framer/agent` CLI can cover localization via local bridge. **Neither represents a deployable copy of the private Framer editing backend**.
8. Craft Anything: four public Framer surfaces captured at 1440/768/390 (12 PNGs, 24 files), hashes in capture ledger; raw images and page HTML stay in owner-local `.local-evidence/` and are not published. They do NOT reproduce a signed-in editor test.

## Scope-specific determination

| Question | Decision | Why |
|---|---|---|
| Are public Framer repositories/examples enumerated? | **YES for observed public org as of capture date** | 20 repositories, 32 official plugin examples and exact pinned SHA evidence |
| Is public Motion code/source understood well enough for a **bounded prototype**? | **CONDITIONAL GO** | Package structure, license and candidate source/test paths inspected; runtime perf/a11y/offline tests pending |
| Can Ninerr safely use Framer-style plugin/Canvas concepts as local native features? | **CONDITIONAL GO** | Public source and plugin contracts available; only via explicit adapter and real owner tests |
| Has Ninerr achieved Framer API feature parity? | **NO** | Named color styles, CodeFile inventory, event subscriptions and plugin UI remain meaningful gaps, not solved by unrelated read tools |
| Is full proprietary Framer editor architecture/source available for exact cloning? | **NOT OBSERVED / BLOCKED** | Founder states direct permission, but exact private source archive/repo and rights scope have not been delivered in this workspace |
| Have Framer editor and Ninerr desktop been competitively benchmarked head-to-head? | **NO** | 12 reproducible fixtures documented but no authorized authenticated Framer editor run and equivalent Ninerr native replay |
| Can the research PR merge or can copied sources ship publicly now? | **NO RELEASE DECISION** | Source-notice/dependency review, exact-head CI, native UX, secure integration and artifact-specific rights must pass first |

## Engineering plan that may begin without unavailable private-source material

**P0 — Fix source fidelity/roundtrip gates before expansion.** Use Ninerr's existing P09/source correctness and local MCP authorization as dependencies. Do not compromise expression-preserving JSX/CSS output to achieve visual parity.

**F01 — Public Motion adapter spike:** treat animation as ephemeral preview projection over Ninerr's canonical document. Test reduced motion, keyboard drag, cancel/stop, static export, responsiveness, no network egress and performance. Prefer compatible small utility layers over importing a second rendering engine.

**F02 — Search and Canvas mapping:** adapt official global-search indexing and canvas node lookup to Ninerr's studio host and native MCP. Test >500 local items, scoped selection, project switch invalidation, untrusted label treatment, 1000 nodes and bounded memory/time.

**F03 — Local CodeFile semantics:** create an explicit trusted code-file list/read/revision history and subscriptions. Current `layer_code` is JSX exported from a layer and is **not the same as Framer CodeFile**; current confirmation workflows are **not subscriptions**. Test no-op byte identity, minimal edit, stale conflicts, owner approval, local path confinement and undo.

**F04 — Design system tokens and instances:** named shared color/typography styles in the existing document store, type-safe property controls, consistent token references, duplicate IDs and bad input rejection; same UI/MCP behavior, no shadow document model.

**F05 — Plugin extension UI surface:** sandboxed plugin panel/lifecycle with permissions, keyboard focus and dismissal; Ninerr's document renderer iframe is **not** equivalent to Framer `showUI`.

**F06 — Reversible local agent branches:** isolated user-owned snapshots, owner review/apply/reject, conflict detection, safe rebase/merge, deterministic history. Reuse Ninerr visual-git/history, not remote Framer OAuth server.

Each F-grain requires tests and peer review on exact implementation SHA. No claim of source copy/port is complete until code, provenance, native installed app QA and CI are verified.

## Intellectual-property and access decision

The founder explicitly states comprehensive permission to copy/rebrand Framer. Record this as founder-asserted legal authorization, do not question intent; distinguish that declaration from **actual delivery/access to private source** and rights over third-party plugin dependencies/marketplace content. Framer's public plugin repo and Motion independently have MIT source, preserving their license notices as applicable; Ninerr's own repo is **Apache-2.0**. Source-specific grant/license and transitive notices govern any actual bundling. No bypass of login, private API, paywall, DRM or protected data is needed or planned.

## Current technical block and done criteria

**Public-source REA DONE:** reproducible public source inventory, pinned evidence, source-to-target gap maps, candidate engineering/test contracts, rights ledger and explicit unknowns.

**Full Framer REA NOT DONE:** obtaining exact authorized nonpublic editor source; editor UI/runtime tests from a licensed account; dependency audit of delivered private code; independent system/security/performance review; final *implementation* and release readiness.

**Final release gate:** exact-head automated suite + real Windows/macOS/Linux Ninerr desktop + offline/MCP security + provenance notices + native UX/AI agent acceptance + optional authenticated Framer comparative benchmark. No cherry-picked public web screenshot substitutes for these.

**Research verdict:** **CONDITIONAL GO** for focused F01–F06 engineering from inspected public source. **NO-GO** for claims that Ninerr contains all Framer private source, passes Framer parity, or is ready for a Framer-complete release.
