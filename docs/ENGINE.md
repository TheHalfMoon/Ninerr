# Installing the Ninerr Engine and connecting an agent

The Ninerr Engine is Ninerr without a graphical interface: a local design engine that AI agents use over MCP. Your agent creates and edits projects, writes previews and code, and saves them in a folder on your computer. You need no editor, browser, desktop app, account or network once it is installed (`docs/HEADLESS.md`).

**Nothing is published yet.** Until the founder approves a release, the engine is built from this repository.

## 1. Prerequisites

- Node.js 22.18 or a later 22.x, or 24.11 or later.
- npm, which comes with Node.js.
- Windows, macOS or Linux.

## 2. Build and install

From a checkout of this repository:

```sh
npm ci --ignore-scripts
node scripts/build-engine.mjs --pack
npm install -g --ignore-scripts dist/ninerr-0.1.0.tgz
```

The build writes the engine as an ordinary npm package (`dist/engine`) and its tarball. Each of Ninerr's own packages is bundled in it as plain JavaScript, and its four third-party packages are pinned to the lockfile's versions. Building the same commit again gives the same tarball, byte for byte.

`--ignore-scripts` means no package's install script runs. Ninerr needs none: the one native module it uses on Windows, koffi, ships its prebuilt binaries.

## 3. Check the setup

```sh
ninerr doctor
```

`doctor` checks three things:
- the Node.js version;
- the projects folder (`--projects <folder>`, or `NINERR_PROJECTS`, or "Ninerr Projects" in your home folder), which must be one only you can change;
- the engine itself, end to end: it creates a project in a scratch folder, designs in it and writes a preview.

Each failed check says what to do. At the end, `doctor` prints the exact command and arguments an MCP client needs on this computer.

## 4. Connect your agent

Give your client an MCP server named `ninerr`. Use the command and arguments `ninerr doctor` printed: the absolute path of Node.js, then the absolute path of `bin/ninerr.mjs`, `mcp` and `--projects <folder>`. That form works everywhere. On Windows, the `ninerr` command is a `.cmd` file, which some clients cannot start without a shell. On macOS and Linux, `ninerr` with the arguments `mcp` also works.

In the examples below, `<node>` and `<ninerr.mjs>` stand for those two paths.

- **Claude Code:**

  ```sh
  claude mcp add ninerr -- <node> <ninerr.mjs> mcp
  ```

- **Codex** (CLI, IDE and desktop app): add to `~/.codex/config.toml`:

  ```toml
  [mcp_servers.ninerr]
  command = "<node>"
  args = ["<ninerr.mjs>", "mcp"]
  ```

- **OpenCode:** in `opencode.json`:

  ```json
  { "mcp": { "ninerr": { "type": "local", "command": ["<node>", "<ninerr.mjs>", "mcp"], "enabled": true } } }
  ```

- **Cursor** (`~/.cursor/mcp.json`) and **Gemini CLI** (`~/.gemini/settings.json`):

  ```json
  { "mcpServers": { "ninerr": { "command": "<node>", "args": ["<ninerr.mjs>", "mcp"] } } }
  ```

No token or key is needed. The client starts the engine itself, and only that client can talk to it.

## 5. Use it

Ask your agent, for example: "Create a pricing page with Ninerr and give me an HTML preview." The agent:
1. calls `create_project`;
2. designs with the document tools (frames, styles, tokens, components);
3. calls `export_design` to write a preview page, or JSX or Tailwind code, into the project's `exports/` folder;
4. tells you where the file is.

Every change is in the project's history, attributed to the agent, and the agent can undo its own. Deleting asks you first, in the client. A client that cannot ask is refused.

## 6. Uninstall

```sh
npm uninstall -g ninerr
```

Your projects folder stays until you delete it.
