# Connect Ninerr to Codex, Claude Code, OpenCode, and other MCP clients

Ninerr's local studio host already implements a **37-tool** MCP server. This is a client-configuration guide, **not a hosted remote MCP service**. The desktop/editor and the agent edit the same open project through the studio host. Tools support read/write classes, revision checks, dry runs, undo, and explicit human approvals for consequential deletion. See [MCP protocol and security](MCP.md).

## Requirements

1. A **stable installed or checked-out Ninerr** folder on the **same computer** as the agent. The three clients need the absolute path to `scripts/ninerr-mcp.mjs` inside that installation. **Do not point them at a temporary PR worktree**; such paths can disappear.
2. Node 22.18+ (22.x) or 24.11+; run `npm ci --ignore-scripts` once in Ninerr if using a source checkout.
3. Start Ninerr (`npm start` from the installation or start its desktop app), open a project, choose **Agents → Connect**, and copy the one-time agent credential into a private secret store or your current process environment. Never commit it, paste it in a chat, or put it in CLI arguments or a `*.json`/`*.toml` file.
4. Start your MCP client **after** setting the `NINERR_MCP_TOKEN` environment variable in the environment inherited by that client. Only the named agent's permissions are available; it cannot access unopened projects by default.

The stdio relay uses `scripts/ninerr-mcp.mjs`; it discovers the local studio host through the private Ninerr Projects directory, or accepts `--projects <folder>` or `--url http://127.0.0.1:<port>/mcp`. It does **not** start Ninerr on its own or connect to a remote hosted instance.

### Safe, temporary token setup

In PowerShell, prompt without echo or shell-history exposure. Launch the MCP client **from the same terminal**; closing the terminal clears this session variable:

```powershell
$secure = Read-Host -Prompt "Ninerr agent credential" -AsSecureString
$env:NINERR_MCP_TOKEN = [System.Net.NetworkCredential]::new("", $secure).Password
Remove-Variable secure
```

On macOS/Linux, use your OS secret manager or a hidden-input prompt and export the value in the MCP client's environment. Avoid embedding credentials into CLI commands or tracked project configuration. The environment is scoped to processes that inherit it; treat local access to that user session as sensitive.

## Codex CLI / Codex desktop / Codex IDE

Codex reads its user-scoped `~/.codex/config.toml`. Codex CLI and its desktop and IDE clients share this MCP configuration. Add or edit the `ninerr` entry without replacing unrelated configuration:

```toml
[mcp_servers.ninerr]
command = "node"
args = ["D:/YOUR-STABLE-NINERR-CHECKOUT/scripts/ninerr-mcp.mjs"]
env_vars = ["NINERR_MCP_TOKEN"]
startup_timeout_sec = 20
tool_timeout_sec = 90
```

Replace the sample path with the absolute path on your machine; on Windows, forward slashes in the TOML string work for the Node script path. If your Ninerr Projects directory is not the default, append `"--projects", "C:/Users/YourUser/Ninerr Projects"` to `args`. The `env_vars` entry explicitly forwards an existing variable; **do not use** `[mcp_servers.ninerr.env]` to store the credential.

Run `codex mcp list`, open Codex and inspect `/mcp`. Start with an agent read call to `guide` and `project_info`. If it fails, verify that Ninerr is running, a project is open, and Codex was launched with the token variable. A broken or stopped local host must not trigger a remote fallback.

## Claude Code

From PowerShell (using the stable path you chose):

```powershell
claude mcp add --transport stdio --scope user ninerr -- node "D:/YOUR-STABLE-NINERR-CHECKOUT/scripts/ninerr-mcp.mjs"
claude mcp get ninerr
```

Claude Code's **user** scope makes Ninerr available in any of your workspaces without putting a credential in a repository. Launch Claude Code from the terminal carrying `NINERR_MCP_TOKEN`, and run `/mcp` to confirm the connection. If `ninerr` already exists, inspect its configuration before replacing it.

An optional client-specific local JSON config may also be used (template in `docs/examples/mcp-clients/claude.mcp.template.json`); expand its example path and ensure its token environment substitution is supported by the installed Claude Code version. Prefer the `claude mcp add` command.

## OpenCode

Current OpenCode V2 config stores servers under `mcp.servers` in the user or project `opencode.jsonc`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "ninerr": {
        "type": "local",
        "command": ["node", "D:/YOUR-STABLE-NINERR-CHECKOUT/scripts/ninerr-mcp.mjs"],
        "environment": {
          "NINERR_MCP_TOKEN": "{env:NINERR_MCP_TOKEN}"
        }
      }
    }
  }
}
```

Replace the path, then **merge** the `mcp.servers.ninerr` object with your existing configuration rather than overwriting other servers. Use `opencode mcp list` or `/mcps` to check. Launch OpenCode with the credential in its environment. Source: `docs/examples/mcp-clients/opencode.template.json`.

## Other MCP clients

Use the **local stdio** transport with:

- Executable: `node`
- Arguments: absolute path to Ninerr's `scripts/ninerr-mcp.mjs`, optionally `--projects <absolute-projects-folder>`
- Environment: `NINERR_MCP_TOKEN` inherited securely by the client process (not written into shared configs).
- Server name: `ninerr`; call `guide` first.

If a client only supports Streamable HTTP, use Ninerr's authenticated **loopback-only** `POST /mcp` endpoint with its Bearer credential, after discovering the runtime port from your local Ninerr host. Never expose `/mcp` publicly or tunnel it without a separate security design.

## Acceptance check (all clients)

1. Start Ninerr and open a **disposable test project**; create an agent connection and grant the appropriate read/write access.
2. In Codex/Claude Code/OpenCode, ask: **"Call Ninerr's `guide`, `project_info` and `layer_tree`. Do not edit anything."** Confirm the tool results identify the open project.
3. Ask the agent to **dry-run** `create_frame` or `set_text` at the revision it just read; confirm no document change.
4. Ask it to make one small reversible change and check that the editor reflects an **attributed agent transaction**; undo it from Ninerr.
5. Attempt a consequential `delete_layers` with a test frame: it must request **a person’s approval**, not execute silently. Deny approval and verify no deletion.
6. Switch projects or revoke the agent connection: verify that a stale agent cannot continue changing the prior document without re-reading/connecting.
7. Repeat the read + dry-run + edit flow separately with **each client**. Seeing a client in `mcp list` is **not proof** that an end-to-end connection passed.

Ninerr's `tests/mcp-server.test.mjs`, `tests/mcp-relay.test.mjs` and `tests/mcp-authorization.test.mjs` exercise the server and relay but are **not substitutes** for a live test with each installed client. Do not mark a client "connected" until the actual test passes.

## Security / limitations

- The currently implemented tools operate on Ninerr's **open document**, not arbitrary files or networks; they do not grant general system access.
- A client must authenticate with a per-agent credential; the host enforces document authorization.
- Writes are journaled and reversible; consequential deletions need human confirmation.
- A locally installed client and Ninerr host must be on the same device for the relay's loopback restrictions.
- A configured client is not the same as a **released v0.1.0 product**; final-version client matrix and release evidence are separate gates.
- This integration does not require a paid cloud API for the Ninerr server. The agent vendor may have its own plan or inference costs.
