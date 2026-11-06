# Framer Full-Spectrum REA — Verified Findings, Evidence & Status
Date: 2026-11-06
Scope: public Framer organization, Motion source code, official Framer developer APIs, public npm packages, agent connectors, public Craft Anything captures and exact Ninerr desktop integration decisions.
Status: VERIFIED PUBLIC-SOURCE TRANCHE COMPLETE. PRIVATE FRAMER EDITOR SOURCE NOT DELIVERED. AUTHENTICATED EDITOR BENCHMARK NOT RUN. NOT AN IMPLEMENTED FEATURE OR A COMPLETED AUDIT OF UNAVAILABLE PRIVATE REPOSITORIES.

## Quantified source and evidence coverage
- 20 Framer organization public repos via live GitHub REST API: 6 original and 14 forks, at observation time. Not a claim about private organization repositories.
- 32 public plugin example folders; 4 Server API example folders; pinned HEADs for 5 original Framer implementation/example sources and 2 Motion-family repos.
- Motion source audited directly at commit 78f3ff51b5508f7e8c1c283d8e80bcd26fec37d7: 5 package directories, manifest versions 14.10.1/14.7.0, MIT LICENSE.md and 268 enumerated test file paths (not executed).
- 46 official public developer-doc page entries captured and indexed, including 11 categories of plugin APIs and several property/control concepts; content stored in owner-only raw extraction.
- 8 public npm packages/metadata examined: motion, framer-motion, motion-dom, motion-utils, framer-plugin, @framer/plugin, framer-api, @framer/agent. These do not collectively reproduce Framer's proprietary editor.
- 4 Framer public surfaces captured by Craft Anything, 3 PNG screenshots each: 12 screenshots, 4 capture.json files and 24 total files. Raw media remains private to owner/local working evidence, hashes in ledger.
- At least 6 actual Framer plugin source implementations inspected (design-system, global-search, code-link, code-versions, tidyup, cms-export). This is not all 32 implementations fully inspected; contents of all 32 directories were listed.
- Full OpenCode/DeepSeek research attempt reached free quota. Its original requested 10-file report set did NOT finish; independently verified reports below supersede any assumption of completion.

## Canonical written evidence inside this Ninerr PR
- FRAMER_PUBLIC_SOURCE_CENSUS_2026-11-06.md — 20 repositories, fork/owner split, SHA pinning, examples
- FRAMER_MOTION_SOURCE_AUDIT_2026-11-06.md — exact Motion package graphs, source files, test paths and safe port choices
- FRAMER_PLUGIN_SOURCE_AUDIT_2026-11-06.md — actual source-level Framer API calls in multiple plugins, target Ninerr files and tests
- FRAMER_AGENT_PLUGIN_AUDIT_2026-11-06.md — remote MCP connector vs proprietary server distinction
- FRAMER_PUBLIC_API_AND_NPM_AUDIT_2026-11-06.md — observed npm tags, property controls, preview vs editor semantics
- FRAMER_API_CAPABILITY_MAP_2026-11-06.md — eleven public API groups, 46 developer pages and local equivalent decisions
- FRAMER_CRAFT_ANYTHING_CAPTURE_LEDGER_2026-11-06.md — 4 capture hashes, exact source/capture limits
- FRAMER_NINERR_PORT_REVIEW_2026-11-06.md — first source-to-Ninerr KEEP/PORT/ADAPT/DEFER mapping and 7 implementation grains
- FRAMER_RIGHTS_AND_ACCESS_LEDGER_2026-11-06.md — founder-permission assertion, actual public source and proprietary access gaps
- FRAMER_REPRODUCIBLE_BENCHMARKS_2026-11-06.md — 12 comparable editor/agent tasks, statuses unknown until real replay
- FRAMER_NEXT_ENGINEERING_GRAINS_2026-11-06.md — ranked implementation tasks and dependency gates
- FRAMER_OPENCODE_WORKLOG_2026-11-06.md — exact procedure, observed tool results and free quota stop
All paths are relative to docs/evidence/. The full research charter lives at docs/research/FRAMER_OPENCODE_REA_DIRECTIVE_2026-11-06.md.

## Key architecture decisions for Ninerr
1. Framer's public Motion MIT animation engine can help preview gestures, springs, layout transitions and deterministic export-mode effects; no need to import the whole Framer application.
2. Framer's public plugin examples are authentic functioning source for design-system styles, code-version UI, canvas search, CodeFile integration, and layout tidy-up. Their host API usage does not make proprietary editor source public.
3. Framer's **official 2026 MCP** is a remote OAuth service. It can run while Framer is closed, unlike older local CLI. Ninerr's permanent constraint is installed desktop + authenticated local MCP + no Ninerr-hosted user compute. Rebuild comparable semantics in Ninerr's document/session/history and client plugin, not cloud transport.
4. Framer's official Canvas/branching/CMS/CodeFile APIs are PUBLIC contracts. They do not expose internal storage code; API parity must be built and tested on the current Ninerr canonical document.
5. A grant assertion is not source delivery: founder explicitly says they have permission, but the actual private editor repository/archive, grant scope and third-party dependency rights have not been independently supplied. No bypass, private data or full editor clone is claimed.
6. Source quality and actual Framer editor superiority can only be compared after identical test projects and native Ninerr installed test journeys. The present four public site captures cannot pass editor benchmark tasks.

## Acceptance
This is a reproducible evidence tranche, NOT a release decision or all-source archive. PR #375 remains Draft until evidence review and exact-head CI. Next work may start from Motion and public plugin sources, but full private editor source integration requires legitimate source access and a verified rights ledger. No application code, release or user data has been modified by this REA.
