import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DocumentInvariantError, cloneDocument, cloneValidated, createDocument, validateDocument } from "../packages/document-model/src/index.mjs";
import { applyCommittedTransaction, applyTransaction, createHistoryState, replayTransactions } from "../packages/history/src/index.mjs";
import { createProject, openProject } from "../packages/persistence/src/index.ts";
import { createPrng } from "./support/prng.mjs";

// #252: an edit copied the whole document with structuredClone and validated it four times.
// Validated documents are now copied directly, and a store skips validating its own
// document. These tests hold both to doing exactly what they replaced.

const AT = "2026-10-10T12:00:00.000Z";

// Every operation applies, but only the final check refuses the result: a restored chain of
// frames deeper than the document's depth limit. (A restored snapshot must itself be one tree,
// so a node no parent lists is refused at once and cannot serve here, #327.)
const tooDeep = (rootId, parentId) => ({
  type: "restore-subtree",
  rootId,
  parentId,
  index: 0,
  nodes: Array.from({ length: 1025 }, (_, level) => ({ id: level === 0 ? rootId : `${rootId}${level}`, type: "frame", parentId: level === 0 ? null : level === 1 ? rootId : `${rootId}${level - 1}`, children: level < 1024 ? [`${rootId}${level + 1}`] : [], props: {} })),
});
const deepEdit = (id, baseRevision) => ({ id, actor: "u", baseRevision, operations: [tooDeep("sub", "frame")] });
const TOO_DEEP = /document tree is deeper than 1024 levels/u;

/** structuredClone's copy and cloneValidated's must be the same, in values and key order. */
function assertSameCopy(value) {
  const ours = cloneValidated(value);
  const theirs = structuredClone(value);
  assert.deepStrictEqual(ours, theirs);
  assert.equal(JSON.stringify(ours), JSON.stringify(theirs), "the same keys, in the same order");
  return ours;
}

test("for tree-shaped validated data, the copy equals structuredClone's, including the cases a plain copy gets wrong (#252)", () => {
  // "__proto__" as an own key must stay an own key, not become the copy's prototype.
  const tricky = JSON.parse('{"__proto__":{"polluted":true},"constructor":"c","b":1,"a":[1,{"x":-0}],"n":null,"z":"z"}');
  const copy = assertSameCopy(tricky);
  assert.ok(Object.hasOwn(copy, "__proto__"));
  assert.equal(Object.getPrototypeOf(copy), Object.prototype);
  assert.equal({}.polluted, undefined, "nothing was polluted");
  assert.ok(Object.is(copy.a[1].x, -0), "-0 stays -0");
  // An object without a prototype is copied as a plain one, as structuredClone does.
  const bare = Object.assign(Object.create(null), { k: [1, 2] });
  assert.equal(Object.getPrototypeOf(assertSameCopy(bare)), Object.prototype);
  // The copy shares nothing with what it copied.
  const nested = { a: { b: [{ c: 1 }] } };
  const deep = cloneValidated(nested);
  deep.a.b[0].c = 2;
  assert.equal(nested.a.b[0].c, 1);
});

test("random tree-shaped documents copy as structuredClone copies them (#252)", () => {
  const random = createPrng(252);
  const value = (depth) => {
    const pick = random.int(0, depth > 3 ? 3 : 5);
    if (pick === 0) return null;
    if (pick === 1) return random.int(0, 1) === 0;
    if (pick === 2) return random.int(0, 999) - 500 + (random.int(0, 1) === 0 ? 0.5 : 0);
    if (pick === 3) return `s${random.int(0, 99)}`;
    if (pick === 4) return Array.from({ length: random.int(0, 3) }, () => value(depth + 1));
    return Object.fromEntries(Array.from({ length: random.int(0, 3) }, () => [random.pick(["a", "b", "__proto__", "toString", "z", "1", "0"]), value(depth + 1)]));
  };
  for (let round = 0; round < 200; round += 1) {
    const nodes = [{ id: "root", type: "frame", children: [], props: { data: value(0) } }];
    for (let index = 0; index < 1 + random.int(0, 4); index += 1) {
      nodes[0].children.push(`n${index}`);
      nodes.push({ id: `n${index}`, type: "element", parentId: "root", props: { data: value(0) }, metadata: { m: value(0) } });
    }
    const document = createDocument({ id: `doc-${round}`, nodes });
    assertSameCopy(document);
    assert.deepStrictEqual(cloneDocument(document), structuredClone(document));
  }
});

test("skipping a store's own input check still validates what a transaction produces (#252)", () => {
  const document = createDocument({ id: "doc", nodes: [{ id: "frame", type: "frame", children: [], props: {} }] });
  // Only the final validation refuses this one; it must run whether the input was checked or not.
  for (const ownValidated of [false, true]) {
    assert.throws(() => applyTransaction(document, deepEdit("t1", 0), { ownValidated }), (error) => error instanceof DocumentInvariantError && TOO_DEEP.test(error.message));
  }
  // Without the option, an input holding values that are not JSON is refused before anything
  // is applied. (The validated copy would turn a Map or a Date into {}: that is why only a
  // caller whose document this module validated may skip the check.)
  for (const value of [new Map([["k", 1]]), new Date(0)]) {
    const broken = createDocument({ id: "doc", nodes: [{ id: "frame", type: "frame", children: [], props: {} }] });
    broken.nodes.frame.props.bad = value;
    const good = { id: "t2", actor: "u", baseRevision: 0, operations: [{ type: "set-props", nodeId: "frame", set: { name: "x" } }] };
    assert.throws(() => applyTransaction(broken, good), (error) => error instanceof DocumentInvariantError && /non-plain object/u.test(error.message));
  }
});

test("a store commits, reopens and refuses exactly as before with its own input check skipped (#252)", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-edit-cost-")));
  try {
    const document = createDocument({ id: "doc", nodes: [{ id: "frame", type: "frame", children: [], props: {} }] });
    createProject(root, { projectId: "cost", document, createdAt: AT });
    const store = openProject(root, { owner: "w", at: AT });
    store.commit({ id: "t1", actor: "u", baseRevision: 0, operations: [{ type: "insert-node", node: { id: "text", type: "text", props: { text: "hi" } }, parentId: "frame" }] });
    // A transaction only the final validation refuses is refused, and nothing is written: the
    // project still opens.
    const before = store.journalSeq;
    assert.throws(() => store.commit(deepEdit("t2", 1)), TOO_DEEP);
    assert.equal(store.journalSeq, before);
    // Changing what the getter returned changes nothing in the store.
    const copy = store.document;
    copy.nodes.frame.props.name = "changed";
    store.commit({ id: "t3", actor: "u", baseRevision: 1, operations: [{ type: "set-props", nodeId: "frame", set: { title: "kept" } }] });
    const committed = store.document;
    assert.equal(committed.nodes.frame.props.name, undefined, "the store's document was never shared");
    store.close();
    const reopened = openProject(root, { owner: "w", at: AT });
    assert.deepStrictEqual(reopened.document, committed, "replay gives the same document");
    reopened.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// #252, the common edit: setting props (typing, a value) changes neither the node keys nor
// the structure, so on a document this module produced only the touched records are checked
// and the order stands. These hold that path to the full one, and to its cost.
test("setting props on a document history produced ends, or is refused, exactly as the full path (#252)", () => {
  const random = createPrng(2520);
  // Nested near the document's depth limit, where a node's own depth is counted from its place
  // in the document (review of #252).
  const nest = (levels) => JSON.parse("[".repeat(levels) + "]".repeat(levels));
  const values = [1, "x", null, true, [1, 2], { a: { b: [3] } }, Number.NaN, undefined, Number.POSITIVE_INFINITY, new Map(), [1, , 3], { deep: nest(80) }, nest(251), nest(252), nest(253), nest(254), nest(255)];
  for (let round = 0; round < 300; round += 1) {
    const nodes = [{ id: "root", type: "frame", children: [], props: { name: "Root" } }];
    for (let index = 0; index < 1 + random.int(0, 5); index += 1) {
      nodes[0].children.push(`n${index}`);
      nodes.push({ id: `n${index}`, type: "element", parentId: "root", props: { text: `t${index}`, style: { color: "red" } } });
    }
    const produced = createHistoryState(createDocument({ id: `doc-${round}`, nodes })).document;
    const plain = structuredClone(produced); // not produced by history: the full path
    const target = random.pick([...nodes.map((node) => node.id), "missing"]);
    const set = { [random.pick(["text", "style", "name", "__proto__", "z"])]: random.pick(values) };
    const unset = random.int(0, 2) === 0 ? [random.pick(["text", "style", "nope"])] : [];
    const transaction = { id: `tx-${round}`, actor: "u", baseRevision: produced.revision, operations: [{ type: "set-props", nodeId: target, set, unset }] };
    const attempt = (document) => {
      try {
        return { document: applyTransaction(document, transaction).document };
      } catch (error) {
        return { error: `${error.name}: ${error.message}` };
      }
    };
    const fast = attempt(produced);
    const full = attempt(plain);
    assert.deepStrictEqual(fast, full, `round ${round}`);
    if (fast.document) assert.equal(JSON.stringify(fast.document), JSON.stringify(full.document), `round ${round}: the same order`);
  }
});

test("setting props on a large produced document costs less than validating it once (#252)", () => {
  const nodes = [{ id: "root", type: "frame", children: [], props: { name: "Root" } }];
  for (let index = 0; index < 49_999; index += 1) {
    nodes[0].children.push(`n${index}`);
    nodes.push({ id: `n${index}`, type: "text", parentId: "root", props: { tag: "p", text: `Text ${index}`, style: { padding: "4px" } } });
  }
  let document = createHistoryState(createDocument({ id: "large", nodes })).document;
  const time = (task) => {
    const started = performance.now();
    task();
    return performance.now() - started;
  };
  // Warm both paths, then take the best of five of each: the comparison is between two costs
  // on the same machine at the same time, so a slow runner slows both.
  const validations = [];
  const edits = [];
  for (let round = 0; round < 6; round += 1) {
    validations.push(time(() => validateDocument(document)));
    edits.push(time(() => {
      document = applyTransaction(document, { id: `tx-${round}`, actor: "u", baseRevision: document.revision, operations: [{ type: "set-props", nodeId: "n123", set: { text: `Edit ${round}` } }] }).document;
    }));
  }
  const validation = Math.min(...validations.slice(1));
  const edit = Math.min(...edits.slice(1));
  assert.equal(document.nodes.n123.props.text, "Edit 5");
  assert.ok(edit < validation, `an edit of one prop on 50,000 nodes took ${edit.toFixed(1)} ms; one validation ${validation.toFixed(1)} ms`);
});

test("a props edit copies only the records it sets, and every document stays as it was (#252)", () => {
  const nodes = [{ id: "root", type: "frame", children: ["a", "b"], props: { name: "Root" } }, { id: "a", type: "text", parentId: "root", props: { text: "A", style: { color: "red" } } }, { id: "b", type: "text", parentId: "root", props: { text: "B" } }];
  const first = createHistoryState(createDocument({ id: "cow", nodes })).document;
  const snapshot = structuredClone(first);
  const second = applyTransaction(first, { id: "t1", actor: "u", baseRevision: first.revision, operations: [{ type: "set-props", nodeId: "a", set: { text: "A2" }, unset: ["style"] }] }).document;
  const third = applyTransaction(second, { id: "t2", actor: "u", baseRevision: second.revision, operations: [{ type: "set-props", nodeId: "a", set: { text: "A3" } }, { type: "set-props", nodeId: "b", set: { text: "B3" } }] }).document;
  // Untouched records are shared; the ones set are copies.
  assert.equal(second.nodes.b, first.nodes.b);
  assert.equal(second.nodes.root, first.nodes.root);
  assert.notEqual(second.nodes.a, first.nodes.a);
  assert.notEqual(third.nodes.b, second.nodes.b);
  // Every document is still what it was.
  assert.deepStrictEqual(first, snapshot);
  assert.deepStrictEqual([second.nodes.a.props, second.nodes.b.props.text], [{ text: "A2" }, "B"]);
  assert.deepStrictEqual([third.nodes.a.props.text, third.nodes.b.props.text], ["A3", "B3"]);
  // A structural edit on a document that shares records copies it whole, and changes none.
  const fourth = applyTransaction(third, { id: "t3", actor: "u", baseRevision: third.revision, operations: [{ type: "remove-node", nodeId: "b" }] }).document;
  assert.equal(fourth.nodes.b, undefined);
  assert.equal(third.nodes.b.props.text, "B3");
  assert.deepStrictEqual(first, snapshot);
  // The in-place apply refuses a document history returned: it may share its records.
  assert.throws(() => applyCommittedTransaction(third, { operations: [{ type: "set-props", nodeId: "a", set: { text: "x" } }] }), /shared value/u);
  assert.equal(third.nodes.a.props.text, "A3");
});

// From the review of the copy on write: a set-props whose nodeId was not a string (5) found
// node "5" by conversion, past the copy and the validation of the records set, and changed a
// record the input shares, even in a transaction then refused. nodeId must be a string.
test("a props edit's node is named by a string, and a refused transaction changes nothing (#252)", () => {
  const nodes = [{ id: "root", type: "frame", children: ["5"], props: {} }, { id: "5", type: "text", parentId: "root", props: { text: "five" } }];
  const document = createHistoryState(createDocument({ id: "ids", nodes })).document;
  const snapshot = structuredClone(document);
  for (const nodeId of [5, ["5"]]) {
    assert.throws(() => applyTransaction(document, { id: "t", actor: "u", baseRevision: document.revision, operations: [{ type: "set-props", nodeId, set: { text: "CHANGED" } }] }), /set-props\.nodeId/u);
  }
  // One that applies, then one that does not: the transaction is refused, and nothing changed.
  assert.throws(() => applyTransaction(document, { id: "t", actor: "u", baseRevision: document.revision, operations: [{ type: "set-props", nodeId: "5", set: { text: "LEAK" } }, { type: "set-props", nodeId: "missing", set: { text: "x" } }] }), /Unknown node id missing/u);
  assert.deepStrictEqual(document, snapshot);
});

test("a journal written before props edits needed a string node id still replays as committed (#252)", () => {
  // From the second review: a set-props journaled by an earlier Ninerr with nodeId 5 (node
  // "5", as getNode converted it) must still replay, or the project would not open.
  const document = createDocument({ id: "old", nodes: [{ id: "root", type: "frame", children: ["5"], props: {} }, { id: "5", type: "text", parentId: "root", props: { text: "five" } }] });
  const replayed = replayTransactions(document, [{ id: "old-1", actor: "u", baseRevision: document.revision, operations: [{ type: "set-props", nodeId: 5, set: { text: "FIVE" } }] }]);
  assert.equal(replayed.nodes["5"].props.text, "FIVE");
  // A live commit still needs a string.
  assert.throws(() => applyTransaction(document, { id: "new-1", actor: "u", baseRevision: document.revision, operations: [{ type: "set-props", nodeId: 5, set: { text: "x" } }] }), /set-props\.nodeId/u);
});

// #252, structural changes: on a document history produced, a transaction that inserts,
// removes, restores or moves is copied on write, checked in the part it changed (or whole when
// that check is not sure) and sorted by merging the keys it added. These hold it to the full
// path over random transactions, valid and not, chained, and the inputs unchanged throughout.
test("structural changes on a document history produced end, or are refused, exactly as the full path (#252)", () => {
  const random = createPrng(25202);
  const nodes = [{ id: "root", type: "frame", children: ["a", "b", "5"], props: {} }, { id: "a", type: "frame", parentId: "root", children: ["a1"], props: {} }, { id: "a1", type: "text", parentId: "a", props: { text: "x" } }, { id: "b", type: "frame", parentId: "root", props: {} }, { id: "5", type: "element", parentId: "root", props: {} }];
  let produced = createHistoryState(createDocument({ id: "struct", nodes })).document;
  let counter = 0;
  const ghost = { type: "restore-subtree", rootId: "g", parentId: "b", nodes: [{ id: "g", type: "frame", children: [], props: {} }, { id: "ghost", type: "element", parentId: "b", props: {} }] };
  const operation = () => {
    const ids = Object.keys(produced.nodes);
    const pick = () => random.pick([...ids, "missing", "root"]);
    switch (random.int(0, 8)) {
      case 0: return { type: "insert-node", node: { id: random.int(0, 4) === 0 ? random.pick(ids) : `n${counter++}`, type: "element", props: { text: `t${counter}` } }, parentId: random.int(0, 5) === 0 ? null : random.int(0, 7) === 0 ? 5 : pick(), index: random.int(0, 3) };
      case 1: return { type: "remove-node", nodeId: random.pick([...ids, "missing"]) };
      case 2: return { type: "move-node", nodeId: random.pick(ids), parentId: random.int(0, 4) === 0 ? null : pick(), index: random.int(0, 2) };
      case 3: return { type: "set-props", nodeId: random.pick([...ids, "missing"]), set: { text: `s${counter++}` } };
      case 4: return { type: "restore-subtree", rootId: `r${counter}`, parentId: random.int(0, 3) === 0 ? null : pick(), nodes: [{ id: `r${counter}`, type: "frame", children: [`r${counter}c`], props: {} }, { id: `r${counter++}c`, type: "text", parentId: `r${counter - 1}`, props: { text: "c" } }] };
      case 5: return ghost;
      case 6: return { type: "insert-node", node: { id: `__proto__`, type: "element", props: {} }, parentId: "root" };
      case 7: return { type: "move-node", nodeId: "root", parentId: random.pick(ids) };
      default: return { type: "insert-node", node: { id: `${counter++}`, type: "element", props: {} }, parentId: "b" };
    }
  };
  let applied = 0;
  for (let round = 0; round < 600; round += 1) {
    const operations = Array.from({ length: 1 + random.int(0, 2) }, operation);
    const transaction = { id: `tx-${round}`, actor: "u", baseRevision: produced.revision, operations };
    const snapshot = structuredClone(produced);
    const attempt = (document) => {
      try {
        return { result: applyTransaction(document, transaction) };
      } catch (error) {
        return { error: `${error.name}: ${error.message}` };
      }
    };
    const fast = attempt(produced);
    const full = attempt(structuredClone(produced));
    assert.deepStrictEqual(produced, snapshot, `round ${round}: the input is unchanged`);
    assert.equal(fast.error, full.error, `round ${round}: ${JSON.stringify(operations).slice(0, 300)}`);
    if (fast.result) {
      assert.equal(JSON.stringify(fast.result.document), JSON.stringify(full.result.document), `round ${round}: the same document, in the same order`);
      assert.equal(JSON.stringify(fast.result.inverse.operations), JSON.stringify(full.result.inverse.operations), `round ${round}: the same inverse`);
      assert.deepStrictEqual(fast.result.affectedNodeIds, full.result.affectedNodeIds);
      produced = fast.result.document;
      applied += 1;
    }
  }
  assert.ok(applied > 60, `${applied} transactions applied`);
});

// From the review of the structural path: cases the random rounds do not reach, each held to
// the full path (the same document in the same key order, or the same refusal).
test("structural changes at the limits end, or are refused, exactly as the full path (#252)", () => {
  const same = (document, operations, label) => {
    const transaction = { id: `tx-${label}`, actor: "u", baseRevision: document.revision, operations };
    const attempt = (input) => {
      try {
        return { document: JSON.stringify(applyTransaction(input, transaction).document) };
      } catch (error) {
        return { error: `${error.name}: ${error.message}` };
      }
    };
    const fast = attempt(document);
    assert.deepStrictEqual(fast, attempt(structuredClone(document)), label);
    return fast;
  };
  const produced = (nodes) => createHistoryState(createDocument({ id: "limits", nodes })).document;
  // Integer-like keys enumerate first: a new key merges among the others all the same.
  const keys = produced([{ id: "root", type: "frame", children: ["9", "1a"], props: {} }, { id: "9", type: "element", parentId: "root", props: {} }, { id: "1a", type: "element", parentId: "root", props: {} }]);
  same(keys, [{ type: "insert-node", node: { id: "2a", type: "element", props: {} }, parentId: "root" }], "an id among digit-led ones");
  // A restored snapshot whose nodes list each other: unreachable.
  same(keys, [{ type: "restore-subtree", rootId: "x", parentId: "root", nodes: [{ id: "x", type: "frame", children: [], props: {} }, { id: "y", type: "frame", parentId: "z", children: ["z"], props: {} }, { id: "z", type: "frame", parentId: "y", children: ["y"], props: {} }] }], "a cycle in a snapshot");
  // Around the depth limit: a chain, an insert at its end, a move of a subtree, a restored chain.
  for (const length of [1020, 1022, 1023, 1024]) {
    const chain = [{ id: "c0", type: "frame", children: ["c1"], props: {} }];
    for (let index = 1; index < length; index += 1) chain.push({ id: `c${index}`, type: "frame", parentId: `c${index - 1}`, children: index + 1 < length ? [`c${index + 1}`] : [], props: {} });
    chain.push({ id: "side", type: "frame", children: ["s1"], props: {} }, { id: "s1", type: "frame", parentId: "side", children: ["s2"], props: {} }, { id: "s2", type: "frame", parentId: "s1", children: [], props: {} });
    let document;
    try {
      document = produced(chain);
    } catch {
      continue; // the chain itself is past the limit
    }
    same(document, [{ type: "insert-node", node: { id: "tip", type: "element", props: {} }, parentId: `c${length - 1}` }], `insert at depth ${length}`);
    same(document, [{ type: "move-node", nodeId: "side", parentId: `c${length - 3}`, index: 0 }], `move to depth ${length}`);
    const snapshot = [{ id: "r0", type: "frame", children: ["r1"], props: {} }];
    for (let index = 1; index < length; index += 1) snapshot.push({ id: `r${index}`, type: "frame", parentId: `r${index - 1}`, children: index + 1 < length ? [`r${index + 1}`] : [], props: {} });
    same(document, [{ type: "restore-subtree", rootId: "r0", parentId: "side", nodes: snapshot }], `restore a chain of ${length}`);
  }
  // The node limit: a document at it takes no more.
  const full = [{ id: "root", type: "frame", children: [], props: {} }];
  for (let index = 1; index < 100_000; index += 1) {
    full[0].children.push(`k${index}`);
    full.push({ id: `k${index}`, type: "element", parentId: "root", props: {} });
  }
  const atLimit = produced(full);
  same(atLimit, [{ type: "insert-node", node: { id: "one-more", type: "element", props: {} }, parentId: "root" }], "past the node limit");
  same(atLimit, [{ type: "remove-node", nodeId: "k1" }, { type: "insert-node", node: { id: "one-more", type: "element", props: {} }, parentId: "root" }], "removed, then one added");
});

test("undoing the removal of a large, deep subtree costs no more than checking it whole (#252)", () => {
  // A chain 1,000 deep with 15 leaves on each level: an undo restores 16,000 nodes at once,
  // deep enough that walking each up the whole way costs several times the whole check.
  const nodes = [{ id: "top", type: "frame", children: ["d0"], props: {} }];
  for (let level = 0; level < 1000; level += 1) {
    const id = `d${level}`;
    const children = Array.from({ length: 15 }, (_, leaf) => `${id}-l${leaf}`);
    if (level + 1 < 1000) children.push(`d${level + 1}`);
    nodes.push({ id, type: "frame", parentId: level === 0 ? "top" : `d${level - 1}`, children, props: {} });
    for (let leaf = 0; leaf < 15; leaf += 1) nodes.push({ id: `${id}-l${leaf}`, type: "text", parentId: id, props: { text: "x" } });
  }
  const document = createHistoryState(createDocument({ id: "deep", nodes })).document;
  const removed = applyTransaction(document, { id: "rm", actor: "u", baseRevision: document.revision, operations: [{ type: "remove-node", nodeId: "d0" }] });
  const undo = { ...removed.inverse, baseRevision: removed.document.revision };
  const time = (task) => {
    const started = performance.now();
    task();
    return performance.now() - started;
  };
  const fast = Math.min(...[0, 1, 2].map(() => time(() => applyTransaction(removed.document, undo))));
  const full = Math.min(...[0, 1, 2].map(() => time(() => applyTransaction(structuredClone(removed.document), undo))));
  assert.ok(fast < full * 2, `restoring 16,000 nodes 1,000 deep: ${fast.toFixed(0)} ms, the whole check ${full.toFixed(0)} ms`);
});
