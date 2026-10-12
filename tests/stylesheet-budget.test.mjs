import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openProject } from "../packages/persistence/src/index.ts";
import { MAX_PROJECT_STYLESHEET_BYTES } from "../packages/studio-host/src/session.ts";
import { hostPool, mcpClient, ok } from "./support/host-api.mjs";

// #299 item 4 (from the review of #298): a layer's stylesheet is limited to 2 MiB, but an
// agent's duplicate_layers copies it with the layer, growing the document and its journal by
// up to 2 MiB a copy. A project's stylesheets now have a budget in all: a change that would
// grow them past it is refused and changes nothing; one that does not is never held back.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 12, 12, 0, 0) + clock++ * 1000).toISOString();
// About 0.95 MB of safe CSS, within an import's 1 MiB: seventeen copies fit the 16 MiB budget.
const CSS = ".a{color:red}".repeat(73_000);
// About 1.9 MB, a sheet as large as a layer may hold.
const LARGE = ".a{color:red}".repeat(146_000);

async function host(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-sheet-budget-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, pool, running: await pool.open(root) };
}

test("an agent's copies of a page past the project's stylesheet budget are refused, and change nothing", async (t) => {
  assert.equal(MAX_PROJECT_STYLESHEET_BYTES, 16 * 1024 * 1024);
  const { running } = await host(t);
  const { call } = running;
  await ok(call("POST", "/api/projects/create", { name: "site" }), "create");
  const review = await ok(call("POST", "/api/import", { html: "<link rel=\"stylesheet\" href=\"site.css\"><p class=\"a\">Hi</p>", name: "Page", stylesheets: [{ name: "site.css", css: CSS }] }), "review");
  const { frameId } = await ok(call("POST", "/api/import/commit", { proposalId: review.proposalId }), "commit");
  const sheet = (await ok(call("GET", "/api/document"), "document")).document.nodes[frameId].props.stylesheet;
  assert.ok(Buffer.byteLength(sheet) > 0.9e6, `the page's sheet is ${Buffer.byteLength(sheet)} bytes`);
  const { token } = await ok(call("POST", "/api/agents/create", { name: "Copier" }), "connect an agent");
  const agent = mcpClient(running.host.mcpUrl, token);
  await agent.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "budget", version: "1" } });
  const fits = Math.floor(MAX_PROJECT_STYLESHEET_BYTES / Buffer.byteLength(sheet));
  for (let copy = 1; copy < fits; copy += 1) {
    const copied = await agent.tool("duplicate_layers", { nodeIds: [frameId] });
    assert.equal(copied.isError, undefined, `copy ${copy}: ${JSON.stringify(copied).slice(0, 300)}`);
  }
  const { revision } = await ok(call("GET", "/api/document"), "document");
  const refused = await agent.tool("duplicate_layers", { nodeIds: [frameId] });
  assert.equal(refused.isError, true, JSON.stringify(refused).slice(0, 300));
  assert.match(JSON.stringify(refused), /stylesheets are limited to 16 MiB in all/u);
  assert.equal((await ok(call("GET", "/api/document"), "document")).revision, revision, "nothing was committed");
});

test("a change that does not grow a project's stylesheets is never held back, even past the budget", async (t) => {
  const { root, pool, running } = await host(t);
  await ok(running.call("POST", "/api/projects/create", { name: "hand" }), "create");
  await ok(running.call("POST", "/api/projects/close"), "close");
  await pool.close(running.host);
  // Nine large sheets, written past the host (one change each): over the budget already.
  const store = openProject(join(root, "hand"), { owner: "by-hand", at: now() });
  try {
    for (let index = 0; index < 9; index += 1) {
      store.commit({ id: `tx-hand-${index}`, actor: "user-1", intent: "By hand", baseRevision: store.revision, operations: [{ type: "insert-node", parentId: null, index, node: { id: `page-${index}`, type: "frame", parentId: null, children: [], props: { name: `Page ${index}`, stylesheet: LARGE }, metadata: {} } }] });
    }
  } finally {
    store.close();
  }
  const reopened = await pool.open(root);
  const { revision } = await ok(reopened.call("POST", "/api/projects/open", { name: "hand" }), "open");
  // A smaller sheet, and an edit with no sheet at all, both go through.
  await ok(reopened.call("POST", "/api/edit", { baseRevision: revision, intent: "Smaller", operations: [{ type: "set-props", nodeId: "page-0", set: { stylesheet: ".a{color:blue}" } }] }), "a smaller sheet");
  await ok(reopened.call("POST", "/api/edit", { baseRevision: revision + 1, intent: "Rename", operations: [{ type: "set-props", nodeId: "page-1", set: { name: "Home" } }] }), "a rename");
  // Eight large sheets are left (about 15.2 MB): a copy of one would pass the budget.
  const { token } = await ok(reopened.call("POST", "/api/agents/create", { name: "Copier" }), "connect an agent");
  const agent = mcpClient(reopened.host.mcpUrl, token);
  await agent.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "budget", version: "1" } });
  const refused = await agent.tool("duplicate_layers", { nodeIds: ["page-1"] });
  assert.equal(refused.isError, true, JSON.stringify(refused).slice(0, 300));
  assert.match(JSON.stringify(refused), /stylesheets are limited to 16 MiB in all/u);
  assert.equal((await ok(reopened.call("GET", "/api/document"), "document")).revision, revision + 2, "nothing was committed");
});
