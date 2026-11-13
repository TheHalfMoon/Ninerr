import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startStudioHost } from "../packages/studio-host/src/index.ts";

// ADR-0006 in part: an agent may dry-run any change (checked as a real one would be, nothing
// made, and no person asked to confirm a delete it does not make), and may base a change on the
// revision it read, so a change to a document that moved on since is refused.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 13, 22, 0, 0) + clock++ * 1000).toISOString();

async function withAgent(callback) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-mcp-dry-")));
  const host = await startStudioHost({ projectsRoot: root, now, confirmationWaitMs: 2_000 });
  const owner = (method, path, body) => fetch(`${host.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${host.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then(async (response) => ({ status: response.status, json: await response.json().catch(() => null) }));
  let id = 0;
  const mcp = (token, method, params) => fetch(host.mcpUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }), id: ++id }),
  }).then((response) => response.json());
  try {
    const { token } = (await owner("POST", "/api/agents/create", { name: "Agent" })).json;
    await owner("POST", "/api/projects/create", { name: "site" });
    await mcp(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    const tool = async (name, args = {}) => (await mcp(token, "tools/call", { name, arguments: args })).result;
    const list = async () => (await mcp(token, "tools/list")).result.tools;
    const raw = async (params) => (await mcp(token, "tools/call", params)).result;
    await callback({ host, owner, tool, list, raw });
  } finally {
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
}

const structured = (result) => (assert.notEqual(result.isError, true, result.content?.[0]?.text), result.structuredContent);
const refusal = (result) => (assert.equal(result.isError, true), result.content[0].text);

test("a dry run checks a change and says what it would touch, and makes nothing", async () => {
  await withAgent(async ({ host, tool, list }) => {
    await tool("project_info");
    const before = host.session.document.revision;
    const dry = structured(await tool("create_frame", { width: 100, height: 50, name: "Card", dryRun: true }));
    assert.equal(dry.dryRun, true);
    assert.equal(dry.revision, before);
    assert.ok(dry.wouldChange.length >= 1 && dry.operations >= 1);
    assert.equal(host.session.document.revision, before, "nothing was made");
    // A real change made the same way works, and a dry run of an invalid change is refused as the real one would be.
    const made = structured(await tool("create_frame", { width: 100, height: 50, name: "Card" }));
    assert.equal(host.session.document.revision, before + 1);
    assert.ok(made.nodeId);
    // A dry run is refused where the real change would be, with the same answer.
    const real = refusal(await tool("set_text", { nodeId: "no-such-layer", text: "x" }));
    assert.equal(refusal(await tool("set_text", { nodeId: "no-such-layer", text: "x", dryRun: true })), real);
    assert.match(refusal(await tool("create_frame", { width: 100, height: 50, dryRun: "yes" })), /dryRun is true or false/u);
    // Every tool that changes the document lists both arguments; a read tool lists neither.
    const tools = await list();
    const schema = (name) => tools.find((entry) => entry.name === name).inputSchema.properties;
    assert.deepEqual([Object.hasOwn(schema("set_styles"), "dryRun"), Object.hasOwn(schema("delete_layers"), "baseRevision"), Object.hasOwn(schema("layer_tree"), "dryRun")], [true, true, false]);
  });
});

test("a dry-run delete asks no one and deletes nothing; baseRevision refuses a change to a document that moved on", async () => {
  await withAgent(async ({ host, tool }) => {
    await tool("project_info");
    const { nodeId } = structured(await tool("create_frame", { width: 100, height: 50, name: "Doomed" }));
    const revision = host.session.document.revision;
    // A real delete waits for the person; a dry run returns at once with what it would remove.
    const dry = structured(await tool("delete_layers", { nodeIds: [nodeId], dryRun: true }));
    assert.deepEqual([dry.dryRun, dry.wouldChange.includes(nodeId)], [true, true]);
    assert.equal(host.session.document.nodes[nodeId] !== undefined, true, "nothing was deleted");
    // Based on the revision it read, a change goes through; based on an older one, it is refused.
    structured(await tool("set_text", { nodeId, text: "Hello", baseRevision: revision }));
    assert.match(refusal(await tool("set_text", { nodeId, text: "Stale", baseRevision: revision })), new RegExp(`based on revision ${revision}, and it is at ${revision + 1}`, "u"));
    assert.match(refusal(await tool("set_text", { nodeId, text: "Bad", baseRevision: -1 })), /baseRevision is a revision number/u);
    assert.equal(host.session.document.revision, revision + 1);
  });
});

test("a delete the person approves after the document changed is refused, and arguments that are not an object stay refused", async () => {
  await withAgent(async ({ host, owner, tool, raw }) => {
    await tool("project_info");
    const { nodeId } = structured(await tool("create_frame", { width: 100, height: 50, name: "Doomed" }));
    const revision = host.session.document.revision;
    // The agent asks to delete at the revision it read; while the person is asked, they edit.
    const asking = tool("delete_layers", { nodeIds: [nodeId], baseRevision: revision });
    let pending = [];
    for (let tries = 0; tries < 100 && pending.length === 0; tries += 1) {
      pending = (await owner("GET", "/api/confirmations")).json.pending;
      if (pending.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(pending.length, 1, "the person is asked");
    const edited = await owner("POST", "/api/edit", { baseRevision: revision, intent: "Rename", operations: [{ type: "set-props", nodeId, set: { name: "Kept" } }] });
    assert.equal(edited.status, 200);
    await owner("POST", "/api/confirmations/decide", { id: pending[0].id, approve: true });
    const answer = await asking;
    assert.equal(answer.isError, true, "the delete is not made on a document that moved on");
    assert.match(answer.content[0].text, new RegExp(`revision ${revision}`, "u"));
    assert.equal(host.session.document.nodes[nodeId].props.name, "Kept", "the layer and the person's edit are there");
    // Arguments that are not an object are refused as before, and the person is not asked.
    for (const bad of [null, 5, "ab", [1]]) assert.equal((await raw({ name: "delete_layers", arguments: bad })).isError, true, JSON.stringify(bad));
    assert.deepEqual((await owner("GET", "/api/confirmations")).json.pending, []);
  });
});
