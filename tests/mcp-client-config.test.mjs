import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Codex template forwards only the environment variable name", () => {
  const config = read("docs/examples/mcp-clients/codex.template.toml");
  assert.match(config, /\[mcp_servers\.ninerr\]/);
  assert.match(config, /env_vars\s*=\s*\["NINERR_MCP_TOKEN"\]/);
  assert.match(config, /scripts\/ninerr-mcp\.mjs/);
  assert.doesNotMatch(config, /^\s*NINERR_MCP_TOKEN\s*=/m);
});

test("Claude Code template is valid stdio MCP JSON and never includes a literal credential", () => {
  const config = JSON.parse(read("docs/examples/mcp-clients/claude.mcp.template.json"));
  const client = config.mcpServers.ninerr;
  assert.equal(client.command, "node");
  assert.equal(client.type, "stdio");
  assert.match(client.args[0], /scripts\/ninerr-mcp\.mjs$/);
  assert.equal(client.env.NINERR_MCP_TOKEN, "${NINERR_MCP_TOKEN}");
});

test("OpenCode V2 template is valid local MCP JSON with env expansion", () => {
  const config = JSON.parse(read("docs/examples/mcp-clients/opencode.template.json"));
  assert.equal(config.mcp.servers.ninerr.type, "local");
  assert.equal(config.mcp.servers.ninerr.command[0], "node");
  assert.match(config.mcp.servers.ninerr.command[1], /scripts\/ninerr-mcp\.mjs$/);
  assert.equal(config.mcp.servers.ninerr.environment.NINERR_MCP_TOKEN, "{env:NINERR_MCP_TOKEN}");
});

test("client guide requires a live agent connection, not merely a configured command", () => {
  const guide = read("docs/MCP_CLIENTS.md");
  for (const name of ["Codex", "Claude Code", "OpenCode", "guide", "project_info", "layer_tree", "dry-run", "delete_layers", "NINERR_MCP_TOKEN"]) {
    assert.ok(guide.includes(name), `missing MCP acceptance topic: ${name}`);
  }
  assert.match(guide, /not proof|not the same/i);
});
