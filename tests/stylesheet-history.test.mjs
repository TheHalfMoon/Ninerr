import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openProject } from "../packages/persistence/src/index.ts";
import { hostPool, ok } from "./support/host-api.mjs";

// #299 item 5 (from the review of #298): the host refuses a stylesheet that loads or executes
// anything, whoever sets it. A project written by hand can still hold one; replacing it is
// fine, but an undo that would bring it back must be refused as a conflict, not committed.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 11, 12, 0, 0) + clock++ * 1000).toISOString();
const UNSAFE = ".a{background:url(https://tracker.example/p.png)}";
const SAFE = ".a{color:rgb(1, 2, 3)}";

test("an undo that would bring back a hand-written unsafe stylesheet is refused as a conflict", async (t) => {
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
  // Written past the host, as a hand-edited project would be.
  const store = openProject(join(root, "hand"), { owner: "by-hand", at: now() });
  try {
    store.commit({ id: "tx-hand", actor: "user-1", intent: "By hand", baseRevision: store.revision, operations: [{ type: "insert-node", parentId: null, index: 0, node: { id: "page", type: "frame", parentId: null, children: [], props: { name: "Page", stylesheet: UNSAFE }, metadata: {} } }] });
  } finally {
    store.close();
  }
  running = await pool.open(root);
  const opened = await ok(running.call("POST", "/api/projects/open", { name: "hand" }), "open");
  const revision = opened.revision ?? (await ok(running.call("GET", "/api/document"), "document")).revision;
  await ok(running.call("POST", "/api/edit", { baseRevision: revision, intent: "Safe sheet", operations: [{ type: "set-props", nodeId: "page", set: { stylesheet: SAFE } }] }), "replace the sheet");
  const undo = await running.call("POST", "/api/undo");
  assert.equal(undo.status, 409, JSON.stringify(undo.json));
  assert.equal(undo.json.error.code, "undo-conflict");
  assert.match(undo.json.error.message, /load and execute nothing/u);
  const after = await ok(running.call("GET", "/api/document"), "document");
  assert.equal(after.revision, revision + 1, "nothing was committed");
  assert.equal(after.document.nodes.page.props.stylesheet, SAFE);
});
