# Framer Public GitHub Source Census — 2026-11-06

Status: independently verified via GitHub REST API from the authorized owner Windows computer; **not a claim to inventory private Framer source**.
Command shape: gh api 'orgs/framer/repos?per_page=100&type=public' ; public organization returned exactly **20** repositories on 2026-11-06. Fork flag and license expression are from repository metadata, not assertions about each dependency.

## Framer-origin repositories (6)

| Repository | Public metadata license | Pinned HEAD SHA on 2026-11-06 | Source class / relevance |
|---|---|---|---|
| https://github.com/framer/plugins | MIT | df96c6d0b9427b1157aac5c87a37e39d42348a27 | Official Framer plugin examples; high-priority code source, NOT Framer's private core editor |
| https://github.com/framer/agent-plugins | MIT | 2fb4aa5d8030b6dcda7f33ffd4791388b356f7d8 | Official agent/plugin configuration and examples; inspect scripts/config |
| https://github.com/framer/fixfont | MIT | 0e66a79c730d1ee3d5b2a12aa979cc8c40017b2c | WOFF2 metadata repair utility; possible font import QA utility |
| https://github.com/framer/plugin-oauth | no license expression found | d6d59e5978f4172dce1493f7d2e5706f8df770b0 | Example plugin OAuth worker; cloud architecture not part of offline Ninerr |
| https://github.com/framer/server-api-examples | no license expression found | 383b4585d0fdb8607149c71f685a4908a2115595 | Framer server API example integrations; inspect API contracts, do not port remote server requirement |
| https://github.com/framer/.github | no license expression found | main (not pinned in this census) | Framer organization profile/docs, not editor source |

## Forks appearing under Framer organization (14)

The organization contains these **forked** repositories; do not conflate a fork with wholly Framer-owned source or assert the founder's Framer grant covers all its third-party components.

| Repository | GitHub-reported license | Scope classification |
|---|---|---|
| https://github.com/framer/paper.js | NOASSERTION | SVG/vector library fork |
| https://github.com/framer/aws_s3_log_ingestion_lambda | Apache-2.0 | AWS ingestion infrastructure |
| https://github.com/framer/aws-log-ingestion | Apache-2.0 | AWS logging |
| https://github.com/framer/certmagic | Apache-2.0 | TLS certificate plumbing |
| https://github.com/framer/go-agent | Apache-2.0 | agent/infrastructure lineage, examine separate upstream |
| https://github.com/framer/caddy | Apache-2.0 | web server, not required by offline core |
| https://github.com/framer/terraform-provider-aws | MPL-2.0 | cloud provisioning, reject for mandatory desktop |
| https://github.com/framer/ismyhostfastyet | GPL-3.0 | performance/hosting utility |
| https://github.com/framer/distributed-load-testing-on-aws | NOASSERTION | infrastructure load testing |
| https://github.com/framer/route53 | MIT | DNS infrastructure |
| https://github.com/framer/morgan | MIT | HTTP logging |
| https://github.com/framer/summa | MIT | inspect upstream/lineage before reuse |
| https://github.com/framer/env-aws-params | BSD-3-Clause | cloud config |
| https://github.com/framer/terraform-aws-lambda | Apache-2.0 | AWS provisioning |

**Count integrity:** 6 original + 14 forks = 20 public repos, zero listed as archived in this API result. This API has no access to unseen private repositories.

## Verified high-value code trees

The official Framer plugins repository's public /plugins folder exposes **32 example plugins** (names enumerated directly using GitHub Contents API):
3rd-party-optimizer, airtable, ascii, ashby, cms-export, code-link, code-versions, color-extract, concentric, csv-import, design-system, dither, doodles, flip-image, global-search, google-search-console, google-sheets, greenhouse, hubspot, locale-sync, notion, phosphor, photobooth, pong, prco, recruitee, redirect-sync, renamer, rss-feeds, threshold, tidyup, unsplash.

Most relevant Ninerr candidate paths for code/UX patterns: design-system (tokens), code-link/code-versions (source/link history), global-search (asset/search UX), locale-sync, tidyup (layout QA), cms-export/csv-import, redirect-sync, color-extract, dither. Every addition needs a source file audit, dependency/license inspection and real acceptance tests. Installed Ninerr must remain local-first; cloud-only examples are reference designs, not required infrastructure.

Framer server-api-examples includes these public example folders: csv-importer, json-api, notion-automations-sync, publish. These demonstrate Framer's **remote** Server API and require a Framer project API key; they are not proof of the underlying proprietary editor source.

Framer agent-plugins public root has: .agents, .claude-plugin, .cursor-plugin, .github, .mcp.json, LICENSE, README.md, assets, mcp.json, plugin.json, scripts, server.json. These expose agent integration configs, not the Framer editor runtime.

## Motion and related animation source (different GitHub owner)

| Repository | License | Pinned HEAD SHA on 2026-11-06 | Actual source |
|---|---|---|---|
| https://github.com/motiondivision/motion | MIT | 78f3ff51b5508f7e8c1c283d8e80bcd26fec37d7 | packages/framer-motion (React animation), packages/motion (public API), packages/motion-dom (DOM animation), packages/motion-utils (core helpers) |
| https://github.com/motiondivision/motionone | verify exact package-specific licensing | 9d1d257c9b849debd5bb4e2ea36858b636118701 | older Motion One implementation, check for deprecated APIs |

Motion source includes animation and gestures and powers Framer's animations. It does **not** contain the complete Framer canvas, editor, collaboration backend or deployment system. Motion+ content is separate; do not assume premium example assets are MIT. Do not install heavy dependencies merely for research.

## Official live APIs and 2026 Framer MCP

- https://www.framer.com/developers/reference lists explicit Framer Plugin APIs for branching (getActiveBranch/createBranch/subscribe...), canvas operations (getSelection/getCanvasRoot/createFrameNode/removeNodes/cloneNode/getNode/getParent/getChildren/getRect), CMS, code files, permissions, publishing, redirects and user access. This is public SDK documentation, **not** the internal Framer source implementation.
- https://www.framer.com/help/articles/what-you-can-do-with-framer-mcp/ and https://www.framer.com/help/articles/getting-started-with-framer-mcp/ (updated Oct 30, 2026) describe **remote OAuth MCP**; Framer editor need not remain open, supports page/layout/CMS/branch changes; localization remains unsupported at launch.
- https://www.framer.com/help/articles/what-you-can-do-with-local-agents/ describes local @framer/agent bridge for localization and related workflows.
- https://www.framer.com/blog/framer-3/ (June 16 2026) describes Agents and Branching; this is vendor-reported behavior, not an independently reproduced editor session.

## Ninerr decisions and action seeds

1. **Keep** Ninerr's canonical document, local StudioSession, permission gateway, history and Electron desktop.
2. **Port/adapt** verified Motion animation/gestures and performance techniques to existing renderer only after dependency/migration/a11y checks, preserving applicable MIT notices; do not replace Ninerr renderer wholesale.
3. **Adapt** the high-value public Framer plugin patterns as local Ninerr extension/Research UX, using existing app/MCP (no Framer runtime dependency).
4. **Implement locally**, not copy Framer's remote service: agent planning, reversible local branches, preview/review, typed Canvas node edits, component/tokens, safe code files and source-preserving write-back.
5. **Defer** parity claims for Framer proprietary editor internals until the exact authorized source is delivered to the project and reviewed. A website link, public JavaScript and public repo list cannot establish access to closed source.
6. Track source rights and verification separately; the founder reports legal permission from Framer, but its actual grant/scope, original source delivery and downstream dependency rights have not been independently produced in this research branch. No public release or unauthorized asset redistribution follows automatically.

This census is a reproducible public-source inventory, not an exhaustive proprietary-source archive. Detailed source-by-source implementation testing remains to be qualified.
