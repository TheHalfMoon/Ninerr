import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { browserTestOptions } from "./support/browser.mjs";
import { openEditor } from "./support/editor.mjs";
import { hostPool, ok } from "./support/host-api.mjs";

// #302 (found by the review of #301): the editor loaded the document, then opened its change
// stream, and marked itself ready before the stream was connected. A change committed in
// between never reached it until a later one showed the gap. The stream's first opening now
// refreshes the copy, and the editor is ready only once changes reach it.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 11, 12, 0, 0) + clock++ * 1000).toISOString();

test("a change committed while the editor's stream is connecting is shown once the editor is ready", browserTestOptions(), async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-editor-ready-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const running = await pool.open(root);
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  const page = { id: "page", type: "frame", parentId: null, children: [], props: { name: "Page" }, metadata: {} };
  await ok(running.call("POST", "/api/edit", { baseRevision: 0, intent: "Add", operations: [{ type: "insert-node", parentId: null, index: 0, node: page }] }), "insert");
  let committed = false;
  // The stream is requested after the document is loaded: commit a change right then, before
  // letting the stream through.
  const editor = await openEditor(running.host, {
    beforeOpen: async (tab) => {
      // The revision the editor shows at the very moment it says it is ready.
      await tab.addInitScript(() => {
        new MutationObserver(() => {
          if (document.documentElement.dataset.ready === "true" && window.readyRevision === undefined) window.readyRevision = document.getElementById("revision")?.textContent ?? null;
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-ready"] });
      });
      await tab.route("**/api/events*", async (route) => {
        if (!committed) {
          committed = true;
          await ok(running.call("POST", "/api/edit", { baseRevision: 1, intent: "Rename", operations: [{ type: "set-props", nodeId: "page", set: { name: "Renamed" } }] }), "edit in the gap");
        }
        await route.continue();
      });
    },
  });
  t.after(() => editor.close());
  assert.equal(committed, true);
  assert.equal(await editor.page.evaluate(() => window.readyRevision), "Revision 2", "ready means caught up");
  assert.deepEqual(editor.errors, []);
});
