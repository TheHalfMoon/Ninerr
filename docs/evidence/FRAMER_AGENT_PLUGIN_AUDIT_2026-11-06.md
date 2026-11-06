# Framer Agent Plugin Source Audit — 2026-11-06

Evidence: public source inspected from https://github.com/framer/agent-plugins at pinned commit 2fb4aa5d8030b6dcda7f33ffd4791388b356f7d8. Repo reports MIT license. These are source-level observations of the **plugin integration files**; they are NOT access to Framer's proprietary editing engine, runtime, inference or back-end services.

## Files and findings

- https://github.com/framer/agent-plugins/blob/main/README.md : describes Framer AI agent connection from third-party AI clients; user authenticates through their Framer account; the plugin routes reads/writes through Framer servers. The README explicitly states that nothing runs locally in this model.
- https://github.com/framer/agent-plugins/blob/main/.mcp.json : declares mcpServers.framer.type=http and URL https://mcp.framer.com/mcp. This is a **remote** server configuration.
- https://github.com/framer/agent-plugins/blob/main/plugin.json : identifies the plugin name framer, version 1.0.1, license MIT, capability categories Interactive/Read/Write, website, privacy, terms, icon assets and install metadata.
- The repo root also includes .agents, .claude-plugin, .cursor-plugin, .github, mcp.json, server.json, scripts, assets and plugin.json. These are client integration descriptors; they are not the Framer editor source.

## Current product contract (official documentation)

- https://www.framer.com/help/articles/what-you-can-do-with-framer-mcp/ (updated October 30, 2026): external agent can create/change pages, use responsive breakpoints and components, edit CMS content, audit SEO, and branch work; requires account OAuth; the Framer editor can be closed. Localization not yet available via remote MCP.
- https://www.framer.com/help/articles/what-you-can-do-with-local-agents/ : legacy local @framer/agent CLI bridge enables localization and related workflows. This is a separate developer bridge from the newer remote MCP service.
- https://www.framer.com/developers/reference : plugin APIs for branching, node edit/read, CodeFile, CMS, permission checks and publishing. Public interface descriptions do not reveal proprietary backend implementation.

## Ninerr decisions

1. KEEP the Ninerr-installed local MCP server and existing canonical document; do **not** replace it with https://mcp.framer.com/mcp.
2. ADAPT permissible plugin-packaging conventions (client descriptors, tool-scoped Read/Write capabilities, OAuth only for optional external services) without copying product identity or unnecessary cloud routing.
3. Implement owner-scoped local agent project access; local StudioSession authorization; caller-supplied document revision; no unauthorized external egress; native editable nodes; reviewable changes and safe revert.
4. Use Framer's permission and branch semantics as reference. Do not claim parity until native UI, MCP tool outputs, journal/history and branch merge semantics are tested.
5. Proprietary editor/source code and cloud MCP implementation are **not present in this public repository**. A founder-stated direct grant is recorded in the main authorization file; source-specific delivery/access and redistribution notices must be verified before bundling closed source.

## Minimum tests for a Ninerr local agent plugin

- A fresh installed Windows/macOS/Linux user needs no Framer account, Framer API key or remote MCP.
- All local tool operations use Ninerr loopback/stdio, no remote host, no model provider required for deterministic edits.
- On project switch or revocation, no old project details leak through read or write operations.
- Two agents plus a human cannot overwrite a newer revision; owner preview/reject creates zero journal writes.
- Offline firewall negative control blocks external MCP and provider traffic, while authorized loopback continues.
- Plugin manifest capability declaration cannot grant stronger privileges than the current user.

Status: public file audit complete for these source files; live authenticated Framer API behavior and Ninerr parity tests remain unverified. This is research evidence, not a finished code port.
