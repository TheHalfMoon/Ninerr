# REA execution receipt: Framer and Motion
Date: 2026-11-06. Device: authorized owner Windows PC. Worktree: D:/Ninerr-Framer-REA-20261106, branch research/framer-source-review-20261106, stacked against Ninerr strategy PR #368. All large raw source/capture material stays untracked in .local-evidence/framer-2026-11-06.

## Actual executed source retrieval
- gh api orgs/framer/repos?per_page=100&type=public: 20 public repositories with official fork/license flags (6 non-forks, 14 forks).
- gh api repos/framer/plugins/contents/plugins: 32 public plugin examples, names pinned in FRAMER_PUBLIC_SOURCE_CENSUS.
- gh api repos/framer/agent-plugins/contents: root plugin configs, README and manifest.
- gh api repos/framer/server-api-examples/contents/examples: four example folders.
- gh api repos/framer/fixfont/contents: Python file and README/license.
- gh api repos/.../commits/main: original Framer and Motion exact HEAD revisions stored in source census.
- Local git ls-tree, git grep, git show in public source checkouts at pinned commits: Motion package manifests and 268 test paths; actual Framer plugin global-search/indexer, design-system styles, code-link/code-version, tidyup.
- npm registry public metadata retrieved by OpenCode, stored locally at .local-evidence/framer-2026-11-06/raw/npm: motion, framer-motion, motion-dom, motion-utils, framer-plugin, @framer/plugin, framer-api, @framer/agent.
- 46 developer docs paths indexed and content extracted by OpenCode from official Framer public docs. Raw text pages are NOT internal implementation or private Framer editor.
- Craft Anything public site capture: Framer Academy, Agents, Developers and Plugin Marketplace, 1440/768/390 PNG each. Capture JSON SHA-256 in capture ledger.

## Agent and quota receipt
OpenCode CLI verified as version 2.2.5. Model selected: free opencode/deepseek-v4.1-flash-free. A fresh standalone build agent was launched via local run-ninerr-framer-rea-20261106.ps1 with a complete English research directive, no Codex. Its process read Motion source, Framer plugin source, official web documentation and npm metadata; used Craft Anything and wrote large owner-local evidence. It then returned: **Free usage limit reached** (AI.Error.QuotaExceeded), with the final process exit status 0 even though the model operation FAILED. Distinguish process exit from research completion. The requested 10 agent reports were NOT completed. No paid fallback or model switch was made.

## Independent verification and repairs
An independent manual source examination after the quota verified source SHAs, 20/6/14 repo split, 32 plugin directories, Motion manifest/license, plugin API code usages, 46 docs, registry tags and four capture hashes.
Evidence sheets saved into docs/evidence/ and pushed in Draft PR #375. A source-specific rights ledger explicitly separates public MIT source from missing private code/grant delivery.
Checks: node scripts/identity-census.mjs --write / --check / --verify, tests/identity-census.test.mjs and git diff --cached --check on authored tranche. Exact results for the final expanded commit must be obtained before merging; earlier PR head had 7/7 identity tests and zero violations.
No private Framer editor project, business data, agent OAuth credentials, private repositories, API keys, protected endpoints, DRM or paid assets were accessed. No Ninerr product source was changed in this REA. No public release or deployment made.

## Reproducible evidence commands
- git -C .local-evidence/framer-2026-11-06/src/motion rev-parse HEAD
- git -C .local-evidence/framer-2026-11-06/src/motion ls-tree -r --name-only HEAD -- packages/motion-dom/src/animation
- git -C .local-evidence/framer-2026-11-06/src/framer-plugins grep -n 'framer\.' HEAD -- plugins/global-search/src plugins/code-link/src plugins/design-system/src
- gh api orgs/framer/repos?per_page=100&type=public
- gh api repos/framer/plugins/contents/plugins
- Get-FileHash -Algorithm SHA256 .local-evidence/framer-2026-11-06/captures/agents-20261106/capture.json

The source census is public-scope complete only for the observed GitHub API result. The comprehensive vendor private-source and authenticated editor benchmark is PENDING actual authorized source delivery and access, not an implicit future background task.
