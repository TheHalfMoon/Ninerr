import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

import { createDocument } from "../packages/document-model/src/index.mjs";
import { applyTransaction } from "../packages/history/src/index.mjs";
import { hostPool, ok } from "./support/host-api.mjs";

// Found by the reviews of the structural path for #252 (#327): a restored snapshot is checked
// whole only at the transaction's end, so a snapshot whose nodes name each other as parents, or
// whose child lists are shared or loop, reached the rest of the transaction. A move under such a
// node walked its ancestors for ever, and a removal walked shared child lists in exponential
// time; one edit hung the host. A snapshot must now be one tree under its root.

const frame = (id, fields = {}) => ({ id, type: "frame", children: [], props: {}, ...fields });
const start = () => [frame("root", { children: ["a"] }), { id: "a", type: "element", parentId: "root", props: {} }];

// Parents that name each other, then a move under one of them.
const PARENT_CYCLE = [
  { type: "restore-subtree", rootId: "r", parentId: "root", nodes: [frame("r"), frame("2x", { parentId: "2y" }), frame("2y", { parentId: "2x" })] },
  { type: "move-node", nodeId: "a", parentId: "2x" },
];
// Child lists that loop without naming a parent.
const CHILD_CYCLE = [
  { type: "restore-subtree", rootId: "r", parentId: "root", nodes: [frame("r", { children: ["x"] }), frame("x", { parentId: "r", children: ["y"] }), frame("y", { parentId: "x", children: ["x"] })] },
];
// Two nodes on every level share one child list: removing the root walks 2^levels paths.
const shared = (levels) => {
  const nodes = [frame("r", { children: ["L0a", "L0b"] })];
  for (let level = 0; level < levels; level += 1) {
    const children = level + 1 < levels ? [`L${level + 1}a`, `L${level + 1}b`] : [];
    nodes.push(frame(`L${level}a`, { parentId: level === 0 ? "r" : `L${level - 1}a`, children }), frame(`L${level}b`, { parentId: level === 0 ? "r" : `L${level - 1}a`, children }));
  }
  return [{ type: "restore-subtree", rootId: "r", parentId: "root", nodes }, { type: "remove-node", nodeId: "r" }];
};
const DUPLICATE = [{ type: "restore-subtree", rootId: "r", parentId: "root", nodes: [frame("r", { children: ["x"] }), frame("x", { parentId: "r" }), frame("x", { parentId: "r" })] }];
const SELF = [{ type: "restore-subtree", rootId: "r", parentId: "root", nodes: [frame("r", { children: ["r"] })] }];
const UNREACHED = [{ type: "restore-subtree", rootId: "r", parentId: "root", nodes: [frame("r"), frame("x", { parentId: "y", children: ["y"] }), frame("y", { parentId: "x", children: ["x"] })] }];

// Runs a task in a worker that is terminated if it does not answer in time: a walk that never
// ends blocks its own thread's timers, so a timeout in that thread could not end it.
function inWorker(task, data, ms = 5_000) {
  const source = `
    const { parentPort, workerData } = require("node:worker_threads");
    (async () => {
      const { createDocument, isDescendant } = await import(workerData.model);
      const { applyTransaction } = await import(workerData.history);
      try {
        parentPort.postMessage({ result: (${task})(workerData, { createDocument, isDescendant, applyTransaction }) });
      } catch (error) {
        parentPort.postMessage({ error: error.name + ": " + error.message });
      }
    })();`;
  const worker = new Worker(source, {
    eval: true,
    workerData: {
      model: new URL("../packages/document-model/src/index.mjs", import.meta.url).href,
      history: new URL("../packages/history/src/index.mjs", import.meta.url).href,
      ...data,
    },
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`the transaction did not finish in ${ms} ms`));
    }, ms);
    worker.once("message", (message) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(message);
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

const attempt = (operations) => inWorker(({ nodes, operations }, { createDocument, applyTransaction }) => {
  const document = createDocument({ id: "cycle", nodes });
  applyTransaction(document, { id: "t", actor: "u", baseRevision: document.revision, operations });
  return "applied";
}, { nodes: start(), operations });

test("a restored snapshot that is not one tree under its root is refused at once", async () => {
  for (const [label, operations, refusal] of [
    ["parents naming each other", PARENT_CYCLE, /is not under its root as its parentId says/u],
    ["child lists that loop", CHILD_CYCLE, /lists node x under more than one parent/u],
    ["shared child lists", shared(30), /lists node L1a under more than one parent/u],
    ["a root listing itself", SELF, /lists its root r as a child/u],
    ["nodes not under the root", UNREACHED, /has nodes not under its root/u],
    ["an id named twice", DUPLICATE, /names a node more than once/u],
  ]) {
    const result = await attempt(operations);
    assert.match(result.error ?? "applied", /^TransactionError: Restore snapshot /u, label);
    assert.match(result.error, refusal, label);
  }
});

test("a snapshot a removal recorded is restored as before", () => {
  const document = createDocument({ id: "tree", nodes: [frame("root", { children: ["p"] }), frame("p", { parentId: "root", children: ["q", "s"] }), frame("q", { parentId: "p", children: ["t"] }), frame("s", { parentId: "p" }), { id: "t", type: "text", parentId: "q", props: { text: "x" } }] });
  const removed = applyTransaction(document, { id: "rm", actor: "u", baseRevision: document.revision, operations: [{ type: "remove-node", nodeId: "p" }] });
  const undone = applyTransaction(removed.document, { ...removed.inverse, baseRevision: removed.document.revision });
  assert.deepEqual(undone.document.nodes, document.nodes);
});

test("the walk up from a node stops at a cycle of parents instead of looping", async () => {
  // Not reachable through a transaction now; the walk is guarded all the same. The search down
  // from "a" runs a step at a time beside the walk up (#329), so "a" holds a chain longer than
  // the cycle: the walk up meets the cycle first.
  const chain = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`b${i}`, { id: `b${i}`, parentId: i === 0 ? "a" : `b${i - 1}`, children: i === 9 ? [] : [`b${i + 1}`] }]));
  const nodes = { x: { id: "x", parentId: "y", children: [] }, y: { id: "y", parentId: "x", children: [] }, a: { id: "a", parentId: null, children: ["b0"] }, ...chain };
  const result = await inWorker(({ nodes }, { isDescendant }) => isDescendant({ nodes }, "a", "x"), { nodes });
  assert.match(result.error ?? String(result.result), /Cycle detected at node [xy]/u);
  // With nothing below "a", the search down ends first, and answers.
  const empty = await inWorker((_, { isDescendant }) => isDescendant({ nodes: { x: { id: "x", parentId: "y" }, y: { id: "y", parentId: "x" }, a: { id: "a", parentId: null } } }, "a", "x"), {});
  assert.equal(empty.error ?? empty.result, false);
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
  // Small enough to finish quickly even where it was accepted, so this fails rather than hangs.
  const refused = await call("POST", "/api/edit", { baseRevision: 1, intent: "Shared", operations: shared(4) });
  assert.deepEqual([refused.status, refused.json?.error?.code], [400, "invalid-edit"], JSON.stringify(refused.json));
  await ok(call("POST", "/api/edit", { baseRevision: 1, intent: "Rename", operations: [{ type: "set-props", nodeId: "a", set: { name: "A" } }] }), "a later edit");
});
