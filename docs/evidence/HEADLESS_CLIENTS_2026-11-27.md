# The headless engine in real agent clients, 2026-11-27

What this records: real sessions of real MCP clients driving the Ninerr Engine (`ninerr-0.1.0.tgz`, 16 reachable workspace packages, 165 files) with no editor, browser, or desktop app. The engine tarball was built with `node scripts/build-engine.mjs --pack` and installed via `npm install -g --ignore-scripts` into a clean prefix. Each client was given the installed `ninerr` command via per-run configuration without mutating global user configuration. Every outcome was verified independently from disk after the client exited.

- **Machine:** Windows 11 (Node.js 24.19.0).
- **`ninerr doctor`** on the installed engine: every check passed (exit code `0`).

## Results

| Client | What ran | Result |
| --- | --- | --- |
| Codex CLI 0.163.0 (`codex exec --skip-git-repo-check --ignore-user-config --ephemeral --approve-for-me`, `-c mcp_servers.ninerr…`) | **Session 1 (full Phase 1 + Phase 2 workflow):** `create_project`, `design_intelligence(action: "plan")`, `set_design_brief(applyDirectionId)`, `create_layers`, `apply_motion`, `export_design(format: "html")`, `export_design(format: "tsx")`, `close_project` | **Pass.** Independent inspection confirmed `exports/hero.html` (CSP meta tag, zero scripts, `@keyframes`, `@media (prefers-reduced-motion: reduce)`), `exports/HeroView.tsx` (`import type React from "react"`), `.ninerr/lock` released cleanly on `close_project`, and full project revision history persisted. |
| Codex CLI 0.163.0 (new session) | **Session 2 (consequential safety boundary):** reopen project and invoke `delete_layers` | **Refused, as designed.** Non-interactive execution declined the elicitation confirmation (`"The person declined this change."`). Independent inspection confirmed the layer remained intact at revision 3 with zero mutation. |
| OpenCode 2.3.2 (`opencode run -m openai/gpt-5.6-luna-fast`) | **Session 1 (full Phase 1 + Phase 2 workflow):** same 8-tool MCP sequence (`create_project`, `design_intelligence`, `set_design_brief`, `create_layers`, `apply_motion`, `export_design` HTML & TSX, `close_project`) | **Pass.** Independent inspection confirmed `exports/hero.html` with `prefers-reduced-motion: reduce`, `exports/HeroView.tsx`, and clean final revision 3. |
| Claude Code 2.1.291 (`claude -p --mcp-config … --strict-mcp-config`) | Session 1 configuration check | **Quota unavailable on host account:** authenticated cleanly and loaded the strict MCP config, then returned `"You've hit your weekly limit · resets Nov 29, 7am (Asia/Riyadh)"`. Will re-run once host quota resets. |

## Notes for client configuration

- **Codex CLI non-interactive runs:** pass `--ignore-user-config --ephemeral --approve-for-me` (or configure `mcp_servers.ninerr` in `~/.codex/config.toml`) when qualifying or automating Codex CLI against a local Ninerr MCP server.
- **OpenCode model selection:** specify an active model (`-m <provider>/<model>`) when running `opencode run` if the default free tier endpoint is rate-limited or unresponsive.
