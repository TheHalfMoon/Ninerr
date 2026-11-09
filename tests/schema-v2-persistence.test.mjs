import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hostPool, ok } from "./support/host-api.mjs";
import { createDocument } from "../packages/document-model/src/index.mjs";
import { PROJECT_FILES, createProject, openProject } from "../packages/persistence/src/index.ts";

// ADR-0003 through the store: a project that gains a design system reopens as schema 2, and one
// that loses its last schema 2 node reopens as schema 1, from its journal and from a checkpoint.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 9, 15, 0, 0) + clock++ * 1000).toISOString();
const DESIGN_SYSTEM = {
  id: "ds",
  type: "design-system",
  props: { name: "Site", collections: [{ id: "color", name: "Colour", modes: [{ id: "light", name: "Light" }], defaultMode: "light" }], tokens: [{ name: "--brand", type: "color", collection: "color", values: { light: "#2255ff" } }] },
};

test("a project that gains a design system reopens as schema 2, and as schema 1 once it is gone", async (t) => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ninerr-schema-v2-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "projects"));
  const { call } = await pool.open(join(root, "projects"));
  await ok(call("POST", "/api/projects/create", { name: "site" }), "create");
  const edit = async (operations) => {
    const { revision } = await ok(call("GET", "/api/document"), "document");
    return ok(call("POST", "/api/edit", { baseRevision: revision, operations, intent: "test", tool: "test" }), "edit");
  };
  const reopen = async () => {
    await ok(call("POST", "/api/projects/close", {}), "close");
    await ok(call("POST", "/api/projects/open", { name: "site" }), "open");
    return (await ok(call("GET", "/api/document"), "document")).document;
  };

  assert.equal((await ok(call("GET", "/api/document"), "document")).document.schemaVersion, 1);
  const { document: before } = await ok(call("GET", "/api/document"), "document");
  await edit([{ type: "insert-node", parentId: null, index: before.rootIds.length, node: DESIGN_SYSTEM }]);
  const reopened = await reopen();
  assert.equal(reopened.schemaVersion, 2);
  assert.deepEqual(reopened.nodes.ds.props.tokens.map((token) => token.name), ["--brand"]);

  await edit([{ type: "remove-node", nodeId: "ds" }]);
  const again = await reopen();
  assert.equal(again.schemaVersion, 1, "with no schema 2 node left, it is schema 1, which older builds open");
  assert.equal(Object.hasOwn(again.nodes, "ds"), false);
});

test("after a crash, a journal that added or removed the design system replays to the right schema", (t) => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ninerr-schema-v2-crash-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const at = "2026-11-09T15:00:00.000Z";
  createProject(root, { projectId: "p", document: createDocument({ id: "d", nodes: [{ id: "page", type: "page" }] }), createdAt: at });
  const commit = (store, operations) => store.commit({ id: `t${store.revision + 1}`, actor: "person", baseRevision: store.revision, intent: "test", tool: "test", timestamp: at, operations });
  // A crash: committed to the journal, never closed, so no checkpoint moves the snapshot.
  const crash = () => rmSync(join(root, PROJECT_FILES.directory, PROJECT_FILES.lock));
  let store = openProject(root, { owner: "w", at });
  commit(store, [{ type: "insert-node", parentId: null, index: 1, node: DESIGN_SYSTEM }]);
  crash();
  store = openProject(root, { owner: "w", at });
  assert.equal(store.document.schemaVersion, 2, "the journal's design system makes the replayed document schema 2");
  store.checkpoint();
  commit(store, [{ type: "remove-node", nodeId: "ds" }]);
  crash();
  store = openProject(root, { owner: "w", at });
  assert.equal(store.document.schemaVersion, 1, "replayed past a schema 2 checkpoint, it is schema 1 again");
  store.close();
});
