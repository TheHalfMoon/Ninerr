import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocument } from "../packages/document-model/src/index.mjs";
import { applyTransaction, replayTransactions } from "../packages/history/src/index.mjs";
import { hostPool, ok } from "./support/host-api.mjs";

// Found by the review of the structural path for #252: a transaction can restore a snapshot
// whose nodes name each other as parents (it is checked whole only at the transaction's end),
// then move a node under one of them. The move's check of the new parent's ancestors walked
// that cycle for ever, so one edit hung the host. It is refused now.

const CYCLE = [
  { type: "restore-subtree", rootId: "r", parentId: "root", nodes: [{ id: "r", type: "frame", children: [], props: {} }, { id: "2x", type: "frame", parentId: "2y", props: {} }, { id: "2y", type: "frame", parentId: "2x", props: {} }] },
  { type: "move-node", nodeId: "a", parentId: "2x" },
];
const nodes = () => [{ id: "root", type: "frame", children: ["a"], props: {} }, { id: "a", type: "element", parentId: "root", props: {} }];

test("a move under a node in a cycle of parents is refused, not walked for ever", { timeout: 10_000 }, () => {
  const document = createDocument({ id: "cycle", nodes: nodes() });
  assert.throws(() => applyTransaction(document, { id: "t", actor: "u", baseRevision: document.revision, operations: CYCLE }), /Cycle detected at node 2[xy]/u);
  assert.throws(() => replayTransactions(document, [{ id: "t", actor: "u", baseRevision: document.revision, operations: CYCLE }]), /Cycle detected/u);
});

test("the host refuses such an edit at once and stays usable", { timeout: 20_000 }, async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-cycle-")));
  let clock = 0;
  const pool = hostPool(() => new Date(Date.UTC(2026, 9, 13, 12) + clock++ * 1000).toISOString());
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const { call } = await pool.open(root);
  await ok(call("POST", "/api/projects/create", { name: "site" }), "create");
  await ok(call("POST", "/api/edit", { baseRevision: 0, intent: "Setup", operations: [{ type: "insert-node", node: { id: "root", type: "frame", props: {} }, parentId: null }, { type: "insert-node", node: { id: "a", type: "element", props: {} }, parentId: "root" }] }), "setup");
  const refused = await call("POST", "/api/edit", { baseRevision: 1, intent: "Cycle", operations: CYCLE });
  assert.deepEqual([refused.status, refused.json?.error?.code], [400, "invalid-edit"], JSON.stringify(refused.json));
  await ok(call("POST", "/api/edit", { baseRevision: 1, intent: "Rename", operations: [{ type: "set-props", nodeId: "a", set: { name: "A" } }] }), "a later edit");
});
