import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, rendered, waitRevision } from "./support/editor.mjs";
import { hostPool, ok } from "./support/host-api.mjs";

// #172 (found by the PC8b review): the renderer applies a style's entries in key order, so a
// later shorthand overrides an earlier longhand. The editor applied each change as its caller
// sent it, while the store, and so every reload, keeps the journal's sorted key order: the
// same design could draw one way live and another after a reload. A change event now carries
// its operations in the journal's form.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 11, 12, 0, 0) + clock++ * 1000).toISOString();
const page = { id: "page", type: "frame", parentId: null, children: [], props: { name: "Page" }, metadata: {} };
const box = { id: "box", type: "frame", parentId: "page", children: [], props: { name: "Box", tag: "div" }, metadata: {} };

async function editing(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-style-order-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const running = await pool.open(root);
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  await ok(running.call("POST", "/api/edit", { baseRevision: 0, intent: "Add", operations: [
    { type: "insert-node", parentId: null, index: 0, node: page },
    { type: "insert-node", parentId: "page", index: 0, node: box },
  ] }), "insert");
  return running;
}

test("a change event's operations are in the journal's key order", async (t) => {
  const running = await editing(t);
  const event = await ok(running.call("POST", "/api/edit", { baseRevision: 1, intent: "Margins", operations: [{ type: "set-props", nodeId: "box", set: { style: { "margin-left": "5px", margin: "0px" } } }] }), "edit");
  assert.deepEqual(Object.keys(event.operations[0].set.style), ["margin", "margin-left"]);
  const { document } = await ok(running.call("GET", "/api/document"), "document");
  assert.deepEqual(Object.keys(document.nodes.box.props.style), Object.keys(event.operations[0].set.style), "the stored document has the same order");
});

test("the editor draws a style the same live and after a reload", browserTestOptions(), async (t) => {
  const running = await editing(t);
  const editor = await openEditor(running.host);
  t.after(() => editor.close());
  await waitRevision(editor.page, 1);
  // A longhand before its shorthand, as a caller may send them.
  await ok(running.call("POST", "/api/edit", { baseRevision: 1, intent: "Margins", operations: [{ type: "set-props", nodeId: "box", set: { style: { "margin-left": "5px", margin: "0px" } } }] }), "edit");
  await waitRevision(editor.page, 2);
  const live = await rendered(editor.page, "box", "margin-left");
  await editor.page.reload();
  await editor.page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  await waitRevision(editor.page, 2);
  assert.equal(live, await rendered(editor.page, "box", "margin-left"), "the same left margin live and after a reload");
  assert.deepEqual(editor.foreign, []);
  assert.deepEqual(editor.errors, []);
});
