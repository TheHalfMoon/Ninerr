import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";

import { createDocument, getSubtreeNodeIds } from "../packages/document-model/src/index.mjs";
import { applyTransaction } from "../packages/history/src/index.mjs";

// #329: inside one transaction a restored chain may be deeper than a committed document can be
// (depth is checked at the transaction's end). Removing it again walked the subtree by
// recursion and overflowed the stack, so a transaction that ends valid was refused.

const chain = (length) => Array.from({ length }, (_, level) => ({ id: `c${level}`, type: "frame", parentId: level === 0 ? null : `c${level - 1}`, children: level + 1 < length ? [`c${level + 1}`] : [], props: {} }));

test("a chain restored and removed in one transaction applies, however deep", () => {
  const document = createDocument({ id: "deep", nodes: [{ id: "root", type: "frame", children: [], props: {} }] });
  const operations = [{ type: "restore-subtree", rootId: "c0", parentId: "root", nodes: chain(50_000) }, { type: "remove-node", nodeId: "c0" }];
  const { document: after } = applyTransaction(document, { id: "t", actor: "u", baseRevision: document.revision, operations });
  assert.deepEqual(Object.keys(after.nodes), ["root"]);
});

test("a subtree's ids come in the same order as before: each node, then its children's subtrees", () => {
  const document = createDocument({ id: "order", nodes: [
    { id: "a", type: "frame", children: ["b", "e"], props: {} },
    { id: "b", type: "frame", parentId: "a", children: ["c", "d"], props: {} },
    { id: "c", type: "element", parentId: "b", props: {} },
    { id: "d", type: "element", parentId: "b", props: {} },
    { id: "e", type: "frame", parentId: "a", children: ["f"], props: {} },
    { id: "f", type: "element", parentId: "e", props: {} },
  ] });
  assert.deepEqual(getSubtreeNodeIds(document, "a"), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(getSubtreeNodeIds(document, "e"), ["e", "f"]);
  assert.throws(() => getSubtreeNodeIds(document, "missing"), /missing/u);
});

test("a subtree whose child lists loop is refused at once, not walked until memory runs out", async () => {
  // Not reachable through a transaction (#327 keeps restored snapshots one tree); guarded all
  // the same. Run in a worker that is terminated, since a walk that never ends cannot time out.
  const worker = new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    import(workerData).then(({ getSubtreeNodeIds }) => {
      const nodes = { a: { id: "a", parentId: null, children: ["b"] }, b: { id: "b", parentId: "a", children: ["a"] } };
      try {
        parentPort.postMessage(String(getSubtreeNodeIds({ nodes }, "a").length));
      } catch (error) {
        parentPort.postMessage(error.name + ": " + error.message);
      }
    });`, { eval: true, workerData: new URL("../packages/document-model/src/index.mjs", import.meta.url).href, resourceLimits: { maxOldGenerationSizeMb: 256 } });
  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("did not finish in 5 s"), 5_000);
    worker.once("message", (message) => { clearTimeout(timer); resolve(message); });
    worker.once("error", (error) => { clearTimeout(timer); resolve(`worker failed: ${error.message}`); });
  });
  await worker.terminate();
  assert.match(outcome, /^DocumentInvariantError: Cycle detected at node [ab]$/u);
});

// #329 item 2: a move checks that the new parent is not inside the moved node by walking up
// from the new parent, which cost the new parent's depth on every move: 1,000 moves under a
// restored chain 100,000 deep took about a minute in one transaction. No valid document is
// deeper than its limit, so the walk stops there and refuses a deeper parent at once.
test("moves under a parent deeper than the limit are refused at once, not walked", async () => {
  const outcome = await new Promise((resolve) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require("node:worker_threads");
      (async () => {
        const { createDocument } = await import(workerData.model);
        const { applyTransaction } = await import(workerData.history);
        const length = 99_990;
        const chain = Array.from({ length }, (_, level) => ({ id: "c" + level, type: "frame", parentId: level === 0 ? null : "c" + (level - 1), children: level + 1 < length ? ["c" + (level + 1)] : [], props: {} }));
        const document = createDocument({ id: "deep", nodes: [{ id: "root", type: "frame", children: ["a"], props: {} }, { id: "a", type: "element", parentId: "root", props: {} }] });
        const moves = Array.from({ length: 1000 }, (_, index) => ({ type: "move-node", nodeId: "a", parentId: index % 2 === 0 ? "c" + (length - 1) : "root" }));
        const started = Date.now();
        try {
          applyTransaction(document, { id: "t", actor: "u", baseRevision: document.revision, operations: [{ type: "restore-subtree", rootId: "c0", parentId: "root", nodes: chain }, ...moves] });
          parentPort.postMessage({ applied: true, ms: Date.now() - started });
        } catch (error) {
          parentPort.postMessage({ error: error.name + ": " + error.message, ms: Date.now() - started });
        }
      })();`, { eval: true, workerData: { model: new URL("../packages/document-model/src/index.mjs", import.meta.url).href, history: new URL("../packages/history/src/index.mjs", import.meta.url).href } });
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ error: "did not finish in 20 s" });
    }, 20_000);
    worker.once("message", (message) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(message);
    });
  });
  assert.match(outcome.error ?? "applied", /^DocumentInvariantError: node c99989 is deeper than 1024 levels/u);
});

test("moves within the depth limit are still checked against the moved node's own subtree", () => {
  const document = createDocument({ id: "tree", nodes: [{ id: "root", type: "frame", children: [], props: {} }] });
  const operations = [{ type: "restore-subtree", rootId: "c0", parentId: "root", nodes: chain(1_000) }, { type: "move-node", nodeId: "c0", parentId: "c999" }];
  assert.throws(() => applyTransaction(document, { id: "t", actor: "u", baseRevision: document.revision, operations }), /into its own subtree|own descendant|descendant/u);
  // At the limit's edge, a move is checked, not refused for depth: c1022 is 1,024 levels down.
  const near = [{ type: "restore-subtree", rootId: "c0", parentId: "root", nodes: chain(1_023) }, { type: "restore-subtree", rootId: "x", parentId: "root", nodes: [{ id: "x", type: "element", props: {} }] }, { type: "move-node", nodeId: "x", parentId: "c1021" }];
  const { document: after } = applyTransaction(document, { id: "t2", actor: "u", baseRevision: document.revision, operations: near });
  assert.equal(after.nodes.x.parentId, "c1021");
});
