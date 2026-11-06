import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { classifyTool } from "../packages/mcp-protocol/src/index.mjs";
import { hostPool, mcpClient, ok } from "./support/host-api.mjs";

// M04: an agent reads the same reference catalog as the person, through the same functions, with
// no way to name a directory, a URL, a tenant or a token, and no write or import authority.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 6, 13, 0, 0) + clock++ * 1000).toISOString();
const at = "2026-11-06T00:00:00.000Z";
const verified = { status: "verified", license: "Apache-2.0", redistributable: true };
const restricted = { status: "restricted", license: null, redistributable: false };
const object = (id, overrides = {}) => ({
  id: `urn:ninerr:object:${id}`, kind: "pattern", title: `Pattern ${id} dashboard`, tags: ["dashboard"],
  sourceId: "urn:ninerr:source:one", assetSha256: null, confidence: "observed", visibility: "public", rights: verified, ...overrides,
});
const pack = {
  schemaVersion: 1, packId: "urn:ninerr:pack:mcp", ownerScope: "urn:ninerr:owner:someone", createdAt: at,
  sources: [{ id: "urn:ninerr:source:one", uri: "https://example.com/one", observedAt: at, rights: verified }],
  assets: [],
  objects: [object("a"), object("b", { title: "Restricted dashboard", rights: restricted }), object("secret", { title: "Secret dashboard", visibility: "private", rights: restricted })],
};

async function hosted(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-mcp-references-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const projects = join(root, "projects");
  const packs = join(root, "packs");
  mkdirSync(projects);
  mkdirSync(packs);
  writeFileSync(join(packs, "pack.json"), JSON.stringify(pack));
  const running = await pool.open(projects);
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  const { token, agent: { agentId } } = await ok(running.call("POST", "/api/agents/create", { name: "Reader" }), "connect");
  const agent = mcpClient(running.host.mcpUrl, token);
  await agent.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  return { running, agent, agentId, packs };
}
const refused = (result, pattern) => {
  assert.equal(result.isError, true, JSON.stringify(result));
  assert.match(result.content[0].text, pattern);
};

test("both tools are read-only", () => {
  assert.equal(classifyTool("search_design_references"), "read");
  assert.equal(classifyTool("get_design_reference"), "read");
});

test("an agent reads the same ids, titles and rights as the person", async (t) => {
  const { running, agent, packs } = await hosted(t);
  await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "pack.json" }), "load");
  const person = await ok(running.call("GET", "/api/references?query=dashboard"), "search");
  const found = (await agent.tool("search_design_references", { query: "dashboard" })).structuredContent;
  assert.deepEqual(found, person);
  assert.equal(found.results[0].source.rights.status, "verified", "both carry the source's rights");
  assert.deepEqual(found.results.map((item) => item.id), ["urn:ninerr:object:a", "urn:ninerr:object:b"]);
  for (const { id } of found.results) {
    const read = (await agent.tool("get_design_reference", { id })).structuredContent;
    assert.deepEqual(read, await ok(running.call("GET", `/api/references/${id}`), "read"));
    assert.equal(read.reference.reuse.allowed, false);
  }
});

test("an unknown, hidden or malformed reference answers alike, with no private metadata", async (t) => {
  const { running, agent, packs } = await hosted(t);
  await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "pack.json" }), "load");
  const hidden = await agent.tool("get_design_reference", { id: "urn:ninerr:object:secret" });
  refused(hidden, /no such reference/u);
  for (const id of ["urn:ninerr:object:absent", "", 7, null]) {
    assert.deepEqual((await agent.tool("get_design_reference", { id })).content, hidden.content, String(id));
  }
  assert.ok(!JSON.stringify(hidden).includes("Secret"));
  const found = (await agent.tool("search_design_references", { query: "secret" })).structuredContent;
  assert.deepEqual(found.results, []);
});

test("no directory, URL, tenant or token argument is accepted", async (t) => {
  const { running, agent, packs } = await hosted(t);
  await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "pack.json" }), "load");
  for (const extra of [{ directory: packs }, { fileName: "pack.json" }, { url: "https://example.com" }, { tenant: "t" }, { token: "x" }, { ownerScope: pack.ownerScope }, { path: packs }]) {
    refused(await agent.tool("search_design_references", { query: "secret", ...extra }), /takes no argument/u);
    refused(await agent.tool("get_design_reference", { id: "urn:ninerr:object:a", ...extra }), /takes no argument/u);
  }
  // Naming the pack's owner does not show its private objects.
  assert.equal((await agent.tool("search_design_references", {})).structuredContent.results.length, 2);
});

test("bounds hold, and with no pack read an agent is told so", async (t) => {
  const { running, agent, packs } = await hosted(t);
  assert.deepEqual((await agent.tool("search_design_references", {})).structuredContent, { project: "site", status: "not-loaded", results: [] });
  refused(await agent.tool("get_design_reference", { id: "urn:ninerr:object:a" }), /no such reference/u);
  await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "pack.json" }), "load");
  for (const args of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: "5" }, { query: "x".repeat(201) }, { query: 7 }, { kinds: ["ghost"] }, { kinds: "pattern" }]) {
    assert.equal((await agent.tool("search_design_references", args)).isError, true, JSON.stringify(args));
  }
});

test("switching projects and revoking the agent both end its reading", async (t) => {
  const { running, agent, agentId, packs } = await hosted(t);
  await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "pack.json" }), "load");
  assert.equal((await agent.tool("get_design_reference", { id: "urn:ninerr:object:a" })).isError, undefined);
  await ok(running.call("POST", "/api/projects/create", { name: "other" }), "switch");
  assert.equal((await agent.tool("search_design_references", {})).structuredContent.status, "not-loaded");
  refused(await agent.tool("get_design_reference", { id: "urn:ninerr:object:a" }), /no such reference/u);
  await ok(running.call("POST", "/api/projects/open", { name: "site" }), "back");
  await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "pack.json" }), "load");
  await ok(running.call("POST", "/api/agents/revoke", { agentId }), "revoke");
  assert.equal(await agent.tool("get_design_reference", { id: "urn:ninerr:object:a" }), undefined, "no result at all for a revoked credential");
});

test("the read grant is required: without one, or with write alone, nothing is shown", async (t) => {
  const { running, agent, agentId, packs } = await hosted(t);
  await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "pack.json" }), "load");
  assert.equal((await agent.tool("search_design_references", {})).isError, undefined);
  for (const grants of [[], [{ principalKind: "actor", principalId: agentId, capabilities: ["document-write"] }]]) {
    running.host.session.setAgentGrants(grants);
    for (const [name, args] of [["search_design_references", {}], ["get_design_reference", { id: "urn:ninerr:object:a" }]]) {
      const refusal = await agent.tool(name, args);
      refused(refusal, /Not allowed/u);
      assert.ok(!JSON.stringify(refusal).includes("Pattern a"));
    }
  }
});

test("an agent's answers carry no owner and no source only a hidden object uses", async (t) => {
  const { running, agent, packs } = await hosted(t);
  const hiddenSource = { id: "urn:ninerr:source:hidden", uri: "https://example.com/hidden", observedAt: at, rights: verified };
  writeFileSync(join(packs, "both.json"), JSON.stringify({ ...pack, sources: [...pack.sources, hiddenSource], objects: [...pack.objects, object("other", { sourceId: hiddenSource.id, visibility: "private", rights: restricted })] }));
  await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "both.json" }), "load");
  const text = JSON.stringify((await agent.tool("search_design_references", {})).structuredContent);
  for (const secret of ["ownerScope", "someone", "source:hidden", "example.com/hidden"]) assert.ok(!text.includes(secret), secret);
  assert.ok(text.includes('"rights"'));
});

test("reading references does not count as reading the project: it unlocks no write", async (t) => {
  const { running, agent, packs } = await hosted(t);
  await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "pack.json" }), "load");
  await ok(running.call("POST", "/api/projects/create", { name: "other" }), "switch");
  await agent.tool("search_design_references", {});
  const write = await agent.tool("create_frame", { name: "Frame", width: 100, height: 100 });
  assert.equal(write.isError, true);
  assert.match(write.content[0].text, /read|project/iu, "refused as a project the agent has not read");
  await agent.tool("project_info", {});
  assert.equal((await agent.tool("create_frame", { name: "Frame", width: 100, height: 100 })).isError, undefined, "reading the project is what unlocks it");
});
