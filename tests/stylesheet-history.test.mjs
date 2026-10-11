import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openProject } from "../packages/persistence/src/index.ts";
import { hostPool, mcpClient, ok } from "./support/host-api.mjs";

// #299 item 5 (from the review of #298): the host refuses a stylesheet that loads or executes
// anything, whoever sets it. A project written by hand can still hold one; changing or
// deleting it is fine, but an undo or revert that would bring it back must be refused as that
// operation's conflict, not committed.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 11, 12, 0, 0) + clock++ * 1000).toISOString();
const UNSAFE = ".a{background:url(https://tracker.example/p.png)}";
const SAFE = ".a{color:rgb(1, 2, 3)}";

/** A host with project "hand" open, whose page holds UNSAFE, written past the host. */
async function handWritten(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-sheet-history-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  let running = await pool.open(root);
  await ok(running.call("POST", "/api/projects/create", { name: "hand" }), "create");
  await ok(running.call("POST", "/api/projects/close"), "close");
  await pool.close(running.host);
  const store = openProject(join(root, "hand"), { owner: "by-hand", at: now() });
  try {
    store.commit({ id: "tx-hand", actor: "user-1", intent: "By hand", baseRevision: store.revision, operations: [{ type: "insert-node", parentId: null, index: 0, node: { id: "page", type: "frame", parentId: null, children: [], props: { name: "Page", stylesheet: UNSAFE }, metadata: {} } }] });
  } finally {
    store.close();
  }
  running = await pool.open(root);
  const { revision } = await ok(running.call("POST", "/api/projects/open", { name: "hand" }), "open");
  return { running, revision };
}

async function refusedAs(running, path, body, code, revision) {
  const refused = await running.call("POST", path, body);
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  assert.equal(refused.json.error.code, code);
  assert.match(refused.json.error.message, /load and execute nothing/u);
  const after = await ok(running.call("GET", "/api/document"), "document");
  assert.equal(after.revision, revision, "nothing was committed");
  return after.document;
}

test("an undo that would bring back a hand-written unsafe stylesheet is refused as a conflict", async (t) => {
  const { running, revision } = await handWritten(t);
  await ok(running.call("POST", "/api/edit", { baseRevision: revision, intent: "Safe sheet", operations: [{ type: "set-props", nodeId: "page", set: { stylesheet: SAFE } }] }), "replace the sheet");
  const document = await refusedAs(running, "/api/undo", undefined, "undo-conflict", revision + 1);
  assert.equal(document.nodes.page.props.stylesheet, SAFE);
});

test("undoing the deletion of a layer with a hand-written unsafe stylesheet is refused", async (t) => {
  const { running, revision } = await handWritten(t);
  await ok(running.call("POST", "/api/edit", { baseRevision: revision, intent: "Delete", operations: [{ type: "remove-node", nodeId: "page" }] }), "delete the page");
  const document = await refusedAs(running, "/api/undo", undefined, "undo-conflict", revision + 1);
  assert.equal(document.nodes.page, undefined);
});

test("reverting an agent's deletion that would bring back an unsafe stylesheet is refused", async (t) => {
  const { running, revision } = await handWritten(t);
  const { token } = await ok(running.call("POST", "/api/agents/create", { name: "Tidier" }), "connect an agent");
  const agent = mcpClient(running.host.mcpUrl, token);
  await agent.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "sheet-history", version: "1" } });
  const deleting = agent.tool("delete_layers", { nodeIds: ["page"] });
  deleting.catch(() => {}); // awaited below; a failed assertion first must not leave it unhandled
  let pending = [];
  for (let tries = 0; tries < 200 && pending.length === 0; tries += 1) {
    ({ pending } = await ok(running.call("GET", "/api/confirmations"), "confirmations"));
    if (pending.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(pending.length, 1, "the deletion asks the person");
  await ok(running.call("POST", "/api/confirmations/decide", { id: pending[0].id, approve: true }), "accept");
  assert.equal((await deleting).isError, undefined);
  const deletion = (await ok(running.call("GET", "/api/history"), "history")).entries.at(-1);
  assert.equal(deletion.tool, "delete_layers");
  const document = await refusedAs(running, "/api/revert", { transactionId: deletion.transactionId }, "revert-conflict", revision + 1);
  assert.equal(document.nodes.page, undefined);
});
