# The headless engine: audit and migration plan

Under the founder's decision of 2026-11-14 (`docs/provenance/FOUNDER_DECISION_2026-11-14_AGENT_FIRST_HEADLESS.md`), Ninerr v0.1.0 is used by agents over MCP with no graphical interface. This page records how MCP depends on the editor today, the design that removes that dependency, the increments it is built in, and which release gates still apply.

## Audit: what ties MCP to an open editor

The MCP server's logic is not tied to the editor. `handleMcpMessage(context, actor, message)` (`packages/studio-host/src/mcp.ts`) takes a context:

```ts
{ session: () => StudioSession | null; selection; references; confirmations; now; lastRead }
```

Every tool runs on `context.session()`, through the same `StudioSession` (the single writer), with authorization by `requireMCPToolCall` against the session's access policy. The ties are around it:

1. **Only a person opens a project.** `session()` returns the project the studio host has open. It is opened only by the editor's HTTP routes, `POST /api/projects/create` and `POST /api/projects/open` (`server.ts`). With no project open, every tool answers "No project is open in Ninerr. Ask the person to open one."
2. **The MCP endpoint lives on the host's loopback HTTP server.** That server exists only while `npm start` or the desktop app runs. The stdio relay (`scripts/ninerr-mcp.mjs`, `relay.ts`) only forwards to it, and finds it through the projects folder.
3. **Agents are registered and credentialed in the editor.** An agent's token comes from the editor's Agents dialog (`agents.ts`). Its grant on the open project comes from that registry (`setAgentGrants`).
4. **Consequential calls wait for the editor's dialog.** `delete_layers` and `delete_token` go through the `ConfirmationBroker`, which the editor shows and the person answers. With no editor, a call waits 50 seconds and is told to call again.
5. **Visual output is the editor's.** PNG and SVG copy (#439) run in the browser canvas. HTML, JSX and Tailwind export run in the host (`code.ts`), but only to the editor's clipboard.
6. **There is no lifecycle for an agent:** no tool to list, create, open, save or close a project, read history, or undo.

The document model, history, persistence, renderer and code export never needed the editor.

## Design

A new stdio MCP server, the **headless engine**, runs in the agent client's own process tree: `ninerr mcp --projects <folder>`.

- **It owns the project lifecycle.** It holds at most one open `StudioSession` and answers MCP itself, calling the same `handleMcpMessage` with its own context. So it uses the same catalog, writer, authorization, revision checks and dry runs.
- **Lifecycle tools,** handled by the engine before document tools: `list_projects`, `create_project`, `open_project` and `close_project`. They act only inside the configured projects folder, through `StudioSession.open` and its name rules (no paths, case-collision checks, lock files, legacy migration). Opening holds the project's lock, as the editor does, so the editor and the engine never write the same project at once.
- **Identity and authorization.** The stdio process is started by the person's own client, and only that client can speak to it. So no token is needed: there is no listener to reach. The agent is an actor of its own, `agent-local-<client>`, named from the client's `initialize` and shown as such in history. On opening, it is granted read and document-write on that one document. The owner's grant stays fixed. Document-scoped authorization is unchanged.
- **Consequential calls.** If the client declared MCP elicitation, the engine asks the person through the client, `elicitation/create`, with the same plain summary the editor shows, bound to the exact call. Otherwise the call is denied, telling the agent to ask the person to delete by hand, or to use a client that can confirm. Nothing is approved without the person.
- **Revision history and undo** for the agent's own changes, as MCP tools: `history`, `undo`, `redo`. They go through the session's per-actor undo, as in the editor.
- **Saving and exporting.** Every change is already journaled at once. `save_project` checkpoints. `export_design` writes HTML, JSX, Tailwind, tokens as CSS and JSON, or a component tree into the project's own `exports/` folder, through the trusted-file writer, never outside it. That path is returned for the agent to give the person.
- **Previews.** The HTML export is a static, script-free page, the same rendering the canvas uses. It is a preview in any browser, with the editor's safety: no scripts, and no fetched resources. PNG is done only where a local browser is available, and reported as unavailable otherwise, never faked.
- **Validation.** Design checks and the accessibility audit the editor uses, as a read tool that returns actionable findings.
- **Distribution.** The repository's root package gets a `bin` (`ninerr`), with `ninerr mcp`, `ninerr doctor` (prerequisites, folder, lock and client-config checks with actionable messages) and the existing local web mode. It installs from a git checkout or a packed tarball with `npm install -g`. Nothing is published to npm without the founder.
- **The GUI path is kept.** The HTTP MCP endpoint, the relay and the editor stay as they are, frozen. The engine and the editor never hold the same project at once, thanks to the project lock.

## Increments (each a reviewed PR with exact-head CI)

1. This decision and plan, and the canonical documents updated.
2. The engine: the stdio server, lifecycle tools, local agent identity and grants, consequential calls by elicitation or denial, and `history`, `undo` and `redo`. With end-to-end tests over real stdio (spawned process), including negative tests: a path or `..` name, a locked project, a denied delete, a stale revision, a corrupt project, and refusal without elicitation.
3. Exports and previews into `exports/`, and validation reports.
4. The `ninerr` CLI (`bin`), `ninerr doctor`, and client configuration for Codex, Claude Code, OpenCode, Cursor and Gemini CLI. This builds on PR #468, re-pointed at the engine.
5. Qualification: install, connect, create, design, preview, export, save, reopen and edit, in real Codex and Claude Code sessions and separately in OpenCode, recorded per client, with CI on three platforms. The release workflow then builds the engine's artifact (a reproducible packed tarball, SBOM, notices, checksums and provenance) in place of desktop archives.

## Release gates for v0.1.0, reclassified

| Gate (from P10) | For the headless v0.1.0 |
| --- | --- |
| Full suite on three platforms; smoke | **Applies.** |
| Security, offline, crash recovery, migration | **Applies, to the engine.** The offline guarantee is checked on the engine's process. |
| SBOM, notices, checksums, provenance, tag and version consistency, dependency audit | **Applies, to the engine artifact.** |
| Dogfooding | **Applies, through the engine and real agents.** |
| Gate 13 performance | The agent-edit and persistence budgets apply. The editor's browser budgets stay measured, but are not a v0.1.0 gate. |
| Desktop packages: smoke, journey, resilience, clean-machine desktop install | **Not a v0.1.0 gate.** They keep running in CI to keep the frozen code working. A clean-machine install of the CLI replaces the desktop install. |
| Screen-reader pass of the editor (#376) | **Not a v0.1.0 gate** while the editor is frozen. It returns with the Desktop product. |
| Electron's LGPL corresponding source (#457) | Arises only if Electron binaries are distributed. If v0.1.0 ships no desktop archive, it is not needed for v0.1.0. That is for the founder to confirm. #457 stays a draft. |
