import test from "node:test";
import assert from "node:assert/strict";

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
