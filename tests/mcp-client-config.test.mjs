import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// The client templates (docs/MCP_CLIENTS.md) start Ninerr's headless engine on stdio: node, the
// engine's bin/ninerr.mjs, `mcp`. They carry no credential, since only the client that started
// the engine can reach it, and none points at the frozen editor's relay.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ENGINE = /\/bin\/ninerr\.mjs$/u;

test("every template starts the engine with node and `mcp`, and holds no credential", () => {
  for (const name of readdirSync(new URL("../docs/examples/mcp-clients/", import.meta.url))) {
    const text = read(`docs/examples/mcp-clients/${name}`);
    assert.doesNotMatch(text, /TOKEN|token|ninerr-mcp\.mjs|Bearer|secret/u, `${name} carries no credential and no relay`);
    assert.match(text, /bin\/ninerr\.mjs"/u, `${name} names the engine`);
  }
});

test("Codex: a TOML entry whose tool timeout outlasts the wait for the person", () => {
  const config = read("docs/examples/mcp-clients/codex.template.toml");
  assert.match(config, /^\[mcp_servers\.ninerr\]$/mu);
  assert.match(config, /^command = "node"$/mu);
  assert.match(config, /^args = \["[^"]+\/bin\/ninerr\.mjs", "mcp"\]$/mu);
  const timeout = Number(/^tool_timeout_sec = (\d+)$/mu.exec(config)?.[1]);
  assert.ok(timeout > 120, "longer than the engine's 120-second wait for an answer");
});

test("Claude Code and Cursor: stdio entries", () => {
  for (const name of ["claude.mcp.template.json", "cursor.mcp.template.json"]) {
    const entry = JSON.parse(read(`docs/examples/mcp-clients/${name}`)).mcpServers.ninerr;
    assert.deepEqual([entry.type, entry.command, entry.args.length, entry.args[1]], ["stdio", "node", 2, "mcp"], name);
    assert.match(entry.args[0], ENGINE);
    assert.equal(entry.env, undefined, `${name} passes no environment`);
  }
});

test("OpenCode: the form OpenCode 2.3.0 ran, under mcp.ninerr", () => {
  const config = JSON.parse(read("docs/examples/mcp-clients/opencode.template.json"));
  const entry = config.mcp.ninerr;
  assert.equal(entry.type, "local");
  assert.equal(entry.enabled, true);
  assert.deepEqual([entry.command[0], entry.command[2]], ["node", "mcp"]);
  assert.match(entry.command[1], ENGINE);
  assert.equal(config.mcp.servers, undefined);
});

test("Gemini CLI: keeps its own per-tool confirmation", () => {
  const entry = JSON.parse(read("docs/examples/mcp-clients/gemini.settings.template.json")).mcpServers.ninerr;
  assert.equal(entry.trust, false);
  assert.deepEqual([entry.command, entry.args[1]], ["node", "mcp"]);
  assert.match(entry.args[0], ENGINE);
});
