# Connect Ninerr to Codex, Claude Code, OpenCode and other MCP clients

Ninerr is used by agents through its **headless engine**: a local MCP server on stdio that your agent's client starts itself (`docs/HEADLESS.md`). You need no editor, browser, desktop app, account, credential or network. This page shows each client's configuration, and how to check a connection end to end.

## Requirements

1. Install the engine and run `ninerr doctor`, as `docs/ENGINE.md` says. `doctor` prints the exact command for this computer: `node`, the absolute path of the installed `bin/ninerr.mjs`, and `mcp`.
2. Node.js 22.18 or a later 22.x, or 24.11 or later, on the `PATH` the client sees. Otherwise give the absolute path of Node.js, as `doctor` prints it.

In the templates (`docs/examples/mcp-clients/`), `/ABSOLUTE/PATH/TO/ninerr/bin/ninerr.mjs` stands for that path. Projects go to "Ninerr Projects" in your home folder. To use another folder, add `"--projects", "<absolute folder>"` after `"mcp"`, or set `NINERR_PROJECTS`. On Windows, forward slashes in paths work in every one of these files.

No token or key appears in any of them: only the client that started the engine can talk to it.

## Codex (CLI, IDE and desktop app)

Codex reads `~/.codex/config.toml`, shared by the CLI and its desktop and IDE clients. Add the entry in `docs/examples/mcp-clients/codex.template.toml` without replacing the servers already there:

```toml
[mcp_servers.ninerr]
command = "node"
args = ["/ABSOLUTE/PATH/TO/ninerr/bin/ninerr.mjs", "mcp"]
startup_timeout_sec = 20
tool_timeout_sec = 150
```

Deleting waits up to 120 seconds for your answer, so the tool timeout is longer than that. Check the entry with `codex mcp list`, or `/mcp` in Codex.

## Claude Code

```sh
claude mcp add --transport stdio --scope user ninerr -- node /ABSOLUTE/PATH/TO/ninerr/bin/ninerr.mjs mcp
claude mcp get ninerr
```

User scope makes Ninerr available in all your workspaces. `docs/examples/mcp-clients/claude.mcp.template.json` is the same entry as a file, for `--mcp-config`.

## OpenCode

In your `opencode.json` (user or project), merge the `ninerr` entry under `mcp` from `docs/examples/mcp-clients/opencode.template.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ninerr": { "type": "local", "command": ["node", "/ABSOLUTE/PATH/TO/ninerr/bin/ninerr.mjs", "mcp"], "enabled": true }
  }
}
```

This form is the one OpenCode 2.3.0 ran in the recorded sessions (`docs/evidence/HEADLESS_CLIENTS_2026-11-14.md`). OpenCode keeps its MCP servers running between runs, so ask the agent to `close_project` when it is done. A project left open is released after 10 minutes with no call. Check the entry with `opencode mcp list`.

## Cursor

Merge the entry from `docs/examples/mcp-clients/cursor.mcp.template.json` into `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project).

## Gemini CLI

Merge the entry from `docs/examples/mcp-clients/gemini.settings.template.json` into `~/.gemini/settings.json` (user) or `.gemini/settings.json` (project). Keep `"trust": false`, so Gemini asks before each tool call as well.

## Other MCP clients

Use the local stdio transport, with server name `ninerr`, command `node`, and arguments `[<absolute path of bin/ninerr.mjs>, "mcp"]`.

## Acceptance check, per client

Do this with each client separately. A client that is only configured, or only shows Ninerr in its list, has not been checked.

1. **Create:** "With Ninerr, create a project named `check-<client>`, add a frame named Hero 800 by 400 with a background color, export it as html named hero, then save and close the project." The preview is in that project's `exports/` folder.
2. **Reopen and edit, in a new conversation:** "Open `check-<client>`, rename Hero to Banner, export it as jsx, show the last three history entries, and close it." History names the client's agent for every change.
3. **Dry run:** ask for a `create_frame` with `dryRun: true`. The revision does not change.
4. **Delete:** ask the agent to delete Banner. The client must ask you first, or Ninerr refuses (a client that cannot ask). Decline, and check the layer is still there.
5. **Undo:** ask for a small change, then `undo_change`. The change is gone and history shows both.

`docs/evidence/HEADLESS_CLIENTS_2026-11-14.md` records these checks as run so far. The tests in `tests/headless-engine.test.mjs` and `tests/engine-package.test.mjs` drive the real engine process, but they don't substitute for a client's own session.

## Security and limits

- **Scope.** The engine acts only inside its projects folder, on the project the agent opened. Project names cannot be paths. Exports go only into that project's own `exports/` folder, never through a link. Nothing is fetched from the network.
- **Attribution and undo.** Every change is an attributed, journaled history transaction, and an agent can undo its own changes.
- **Deleting needs you.** It goes through the client's prompt (MCP elicitation), or is refused. An approval is only as trustworthy as that prompt: a client set to approve everything automatically approves for you.
- **Your agent's provider may cost money.** The agent's model provider may charge for its use. Ninerr itself needs no paid service.
- **The editor's server is frozen.** The older way to connect, through the running editor's server with a relay and a per-agent token (`scripts/ninerr-mcp.mjs`, `docs/MCP.md`), still works, but it is frozen with the editor.
