# The headless engine in real agent clients, 2026-11-14

What this records: real sessions of real MCP clients driving the Ninerr Engine with no editor, browser or desktop app. Each session used the engine installed from its tarball, as `docs/ENGINE.md` says: built with `node scripts/build-engine.mjs --pack` on branch `impl/engine-package`, installed with `npm install -g --ignore-scripts` into a scratch prefix. Each client was given the engine through a per-run configuration; no global client setting was changed. Each result was checked independently afterwards, by a fresh engine process reading the project back, not taken from the agent's reply.

- **Machine:** Windows 11 Home (10.0.26300), Node.js 24.19.0.
- **`ninerr doctor`** on the installed engine: every check passes.

## Results

| Client | What ran | Result |
| --- | --- | --- |
| OpenCode 2.3.0 (`opencode run`, model `opencode/deepseek-v4.1-flash-free`, free) | **Session 1:** create a project; make a 1200×800 "Dashboard" frame with background and padding; define a `--brand` color token; make a "Revenue card" frame using `var(--brand)`; export Dashboard as HTML; save | **Pass.** `exports/dashboard.html` exists, with the content policy, no script and the background. The agent's first `set_token` named the token without `--`, was refused with the reason, and the agent corrected it. |
| OpenCode, a new session | **Session 2:** reopen the project; rename "Revenue card" to "Revenue"; export Dashboard as JSX; read the last 3 history entries; close | **Pass.** A fresh engine opens the project at revision 7. The layer is "Revenue", the token is used once, both exports exist, and all 7 changes are attributed to `agent-local-opencode`. |
| OpenCode, a new session | **Session 3:** asked to delete "Revenue" with `delete_layers` | **Refused, as designed.** OpenCode declares MCP elicitation, and in non-interactive `run` it declined the question. The engine answered "The person declined this change." A fresh read shows the layer still there at revision 7. |
| Claude Code 2.1.291 (`claude -p`, `--mcp-config`, `--strict-mcp-config`) | Session 1 as above | **Not run:** "Failed to authenticate: OAuth session expired and could not be refreshed". The person must sign in again. |
| Codex CLI 0.163.0 (`codex exec`, `-c mcp_servers.ninerr…`) | Session 1 as above | **Not run:** the account's usage limit is reached until 2026-11-17. |
| Gemini CLI 0.62.0 (`gemini -p`, project `.gemini/settings.json`) | A short create, frame, export and close | **Not run:** the account's tier no longer supports this client ("no longer supported for Gemini Code Assist for individuals"). |

## What the sessions changed in the engine

- **Clients that keep the engine running.** OpenCode keeps its MCP servers running after `opencode run` exits. So a project an agent left open stayed locked for other clients. Two changes follow: the engine now closes a project after 10 minutes with no call (unless something waits for the person), and its instructions ask agents to `close_project` when done. Both are tested.
- **`ninerr doctor`** now points to `docs/ENGINE.md`.

## Still to qualify

Claude Code and Codex in real sessions, which needs the person to sign in to Claude Code and Codex's limit to reset. Then macOS and Linux runs, and the exact candidate in CI. Engine CI runs on three platforms with each PR. These client sessions ran on Windows only.
