import test from "node:test";
import assert from "node:assert/strict";

import {
  DOCUMENT_SCHEMA_VERSION,
  DocumentInvariantError,
  SCHEMA_V2_LIMITS,
  createDocument,
  createNode,
  tokenReferences,
  validateDocument,
} from "../packages/document-model/src/index.mjs";
import { applyCommittedTransaction, applyTransaction, commitTransaction, createHistoryState, replayTransactions, undo } from "../packages/history/src/index.mjs";
import { drawnRoots } from "../packages/renderer/src/index.mjs";

// ADR-0003, ADR-0004 and ADR-0005, accepted 2026-11-09: schema v2 adds `design-system` and
// `component-instance` and gives `component-definition` its props. A document is schema 2 exactly
// when it holds such a node.

const base = () => createDocument({
  id: "doc",
  name: "Site",
  nodes: [
    createNode({ id: "page", type: "page", children: ["frame"] }),
    createNode({ id: "frame", type: "frame", parentId: "page", props: { style: { padding: "var(--space-2)" } } }),
  ],
});
const designSystem = (tokens = [{ name: "--brand", type: "color", collection: "color", values: { light: "#2255ff", dark: "#88aaff" } }], extra = {}) => ({
  id: "ds",
  type: "design-system",
  props: { name: "Site", collections: [{ id: "color", name: "Colour", modes: [{ id: "light", name: "Light" }, { id: "dark", name: "Dark" }], defaultMode: "light" }], tokens, ...extra },
});
let clock = 0;
const tx = (document, operations) => ({ id: `t${clock += 1}`, actor: "person", baseRevision: document.revision, intent: "test", tool: "test", timestamp: "2026-11-09T00:00:00.000Z", operations });
const apply = (document, operations) => applyTransaction(document, tx(document, operations)).document;
const refusedWith = (fn, pattern) => assert.throws(fn, (error) => error instanceof DocumentInvariantError && pattern.test(error.message), String(pattern));

test("a document stays schema 1 until its first schema v2 node, and goes back to 1 when that is undone", () => {
  assert.equal(DOCUMENT_SCHEMA_VERSION, 2);
  const document = base();
  assert.equal(document.schemaVersion, 1, "a new document is schema 1, which older builds open");
  const edited = apply(document, [{ type: "set-props", nodeId: "frame", set: { name: "Hero" } }]);
  assert.equal(edited.schemaVersion, 1, "an ordinary edit keeps it schema 1");

  let state = createHistoryState(document);
  state = commitTransaction(state, tx(document, [{ type: "insert-node", parentId: null, index: 1, node: designSystem() }]));
  assert.equal(state.document.schemaVersion, 2, "the first design system makes it schema 2, in the same transaction");
  state = undo(state);
  assert.equal(state.document.schemaVersion, 1, "undoing it makes it schema 1 again");

  // Removing a subtree that holds the last v2 node makes it schema 1 too.
  const withComponent = apply(document, [{ type: "insert-node", parentId: "frame", index: 0, node: { id: "def", type: "component-definition", props: { name: "Button", properties: [] } } }]);
  assert.equal(withComponent.schemaVersion, 2);
  assert.equal(apply(withComponent, [{ type: "remove-node", nodeId: "frame" }]).schemaVersion, 1);
});

test("the version must match the nodes, and a newer one is refused", () => {
  const document = apply(base(), [{ type: "insert-node", parentId: null, index: 1, node: designSystem() }]);
  refusedWith(() => validateDocument({ ...document, schemaVersion: 1 }), /holds schema v2 nodes but says it is schema 1/u);
  refusedWith(() => validateDocument({ ...base(), schemaVersion: 2 }), /says it is schema 2 but holds no schema v2 node/u);
  refusedWith(() => validateDocument({ ...base(), schemaVersion: 3 }), /Unsupported document schema version 3/u);
});

test("a design system's tokens are checked: names, types, collections, modes and values", () => {
  const insert = (node) => apply(base(), [{ type: "insert-node", parentId: null, index: 1, node }]);
  const token = (fields) => ({ name: "--brand", type: "color", collection: "color", values: { light: "#2255ff" }, ...fields });
  refusedWith(() => insert(designSystem([token({ name: "brand" })])), /CSS custom property name/u);
  refusedWith(() => insert(designSystem([token(), token()])), /token --brand is defined twice/u);
  refusedWith(() => insert(designSystem([token({ type: "gradient" })])), /unknown type/u);
  refusedWith(() => insert(designSystem([token({ collection: "spacing" })])), /names a collection that does not exist/u);
  refusedWith(() => insert(designSystem([token({ values: { sepia: "#000" } })])), /not a mode of its collection/u);
  for (const value of ["red; } body { display: none", "url(https://example.com/x.png)", "a /* b */", "<b>", "@import x", ""]) {
    refusedWith(() => insert(designSystem([token({ values: { light: value } })])), /not one CSS value/u);
  }
  refusedWith(() => insert({ ...designSystem(), props: { ...designSystem().props, collections: [] } }), /1 to 64 collections/u);
  refusedWith(() => insert({ ...designSystem(), props: { ...designSystem().props, collections: [{ id: "c", name: "C", modes: [{ id: "a", name: "A" }], defaultMode: "b" }] } }), /default mode is not one of its modes/u);
  const many = Array.from({ length: SCHEMA_V2_LIMITS.tokens + 1 }, (_, index) => token({ name: `--t${index}` }));
  refusedWith(() => insert(designSystem(many)), /at most 5000 tokens/u);
});

test("an alias must resolve, and an alias cycle is refused with its names", () => {
  const insert = (tokens) => apply(base(), [{ type: "insert-node", parentId: null, index: 1, node: designSystem(tokens) }]);
  const token = (name, value) => ({ name, type: "color", collection: "color", values: { light: value } });
  const fine = insert([token("--blue-500", "#2255ff"), token("--brand", "var(--blue-500)"), token("--link", "color-mix(in oklch, var(--brand) 80%, white)")]);
  assert.equal(fine.schemaVersion, 2);
  refusedWith(() => insert([token("--brand", "var(--missing)")]), /token --brand refers to --missing, which is not a token/u);
  refusedWith(() => insert([token("--a", "var(--b)"), token("--b", "var(--c, red)"), token("--c", "var(--a)")]), /the tokens --a -> --b -> --c -> --a refer to each other in a cycle/u);
  refusedWith(() => insert([token("--self", "calc(var(--self) + 1px)")]), /--self -> --self/u);
  // Setting props takes the fast path, and is checked the same way.
  refusedWith(() => apply(fine, [{ type: "set-props", nodeId: "ds", set: { tokens: [token("--a", "var(--b)"), token("--b", "var(--a)")] } }]), /--a -> --b -> --a/u);
});

test("one design system, at the root, with no children", () => {
  const document = apply(base(), [{ type: "insert-node", parentId: null, index: 1, node: designSystem() }]);
  refusedWith(() => apply(document, [{ type: "insert-node", parentId: null, index: 2, node: { ...designSystem(), id: "ds-2" } }]), /at most one design system/u);
  refusedWith(() => apply(base(), [{ type: "insert-node", parentId: "frame", index: 0, node: designSystem() }]), /a design system is a root node/u);
  refusedWith(() => apply(document, [{ type: "insert-node", parentId: "ds", index: 0, node: { id: "x", type: "element", props: { tag: "div" } } }]), /a design system has no children/u);
  // It holds tokens and is never drawn.
  assert.deepEqual(document.rootIds, ["page", "ds"]);
  assert.deepEqual(drawnRoots(document), ["page"]);
});

test("components and instances: properties checked, an instance's component exists, and nothing contains itself", () => {
  const definition = (id, props = {}) => ({ id, type: "component-definition", props: { name: id, ...props } });
  const instance = (id, componentId, props = {}) => ({ id, type: "component-instance", props: { componentId, ...props } });
  const document = apply(base(), [
    { type: "insert-node", parentId: "frame", index: 0, node: definition("button", { properties: [{ id: "p-label", name: "Label", kind: "text", default: "Go", target: { nodeId: "button-text", field: "text" } }, { id: "p-size", name: "Size", kind: "variant", default: "md", options: ["sm", "md"], target: { nodeId: "button", field: "attributes.class" } }] }) },
    { type: "insert-node", parentId: "button", index: 0, node: { id: "button-text", type: "text", props: { text: "Go" } } },
    { type: "insert-node", parentId: "frame", index: 1, node: instance("buy", "button", { propertyValues: { "p-label": "Buy", "p-size": "sm" }, overrides: [{ path: [], nodeId: "button-text", set: { style: { color: "red" } } }] }) },
  ]);
  assert.equal(document.schemaVersion, 2);
  refusedWith(() => apply(document, [{ type: "insert-node", parentId: "frame", index: 2, node: instance("ghost", "nothing") }]), /still uses its component nothing, which does not exist/u);
  refusedWith(() => apply(document, [{ type: "insert-node", parentId: "frame", index: 2, node: instance("odd", "frame") }]), /its component frame is not a component/u);
  refusedWith(() => apply(document, [{ type: "insert-node", parentId: "buy", index: 0, node: { id: "kid", type: "element", props: { tag: "span" } } }]), /an instance stores no children/u);
  refusedWith(() => apply(document, [{ type: "insert-node", parentId: "button", index: 1, node: instance("loop", "button") }]), /component button -> button contains an instance of itself/u);
  // Through another component, and when an instance is changed in place (setting props).
  const two = apply(document, [{ type: "insert-node", parentId: "frame", index: 2, node: definition("card") }, { type: "insert-node", parentId: "card", index: 0, node: instance("card-button", "button") }]);
  refusedWith(() => apply(two, [{ type: "insert-node", parentId: "button", index: 1, node: instance("back", "card") }]), /contains an instance of itself/u);
  refusedWith(() => apply(two, [{ type: "set-props", nodeId: "buy", set: { componentId: "missing" } }]), /does not exist/u);
  // A definition with live instances cannot be removed out from under them.
  refusedWith(() => apply(document, [{ type: "remove-node", nodeId: "button" }]), /still uses its component button, which does not exist: detach or delete its instances before deleting a component/u);
  // Property rules.
  const property = (fields) => apply(base(), [{ type: "insert-node", parentId: "frame", index: 0, node: definition("d", { properties: [{ id: "p", name: "P", kind: "text", default: "x", target: { nodeId: "d", field: "text" }, ...fields }] }) }]);
  refusedWith(() => property({ kind: "slider" }), /unknown kind/u);
  refusedWith(() => property({ kind: "boolean" }), /default does not match its kind/u);
  refusedWith(() => property({ kind: "variant", default: "lg", options: ["sm", "md"] }), /default is not one of its options/u);
  refusedWith(() => property({ target: { nodeId: "d", field: "onclick" } }), /needs a target node and field/u);
  refusedWith(() => apply(document, [{ type: "set-props", nodeId: "buy", set: { overrides: [{ path: [], nodeId: "button-text", set: { script: "x" } }] } }]), /an override cannot set script/u);
  // A stale override (its definition node removed) is kept, not refused.
  assert.equal(apply(document, [{ type: "remove-node", nodeId: "button-text" }]).nodes.buy.props.overrides.length, 1);
});

test("a token binding is any var(--name) in a value", () => {
  assert.deepEqual(tokenReferences("var(--brand)"), ["--brand"]);
  assert.deepEqual(tokenReferences("calc(var(--space-2) * 2) var( --gap , 4px)"), ["--space-2", "--gap"]);
  assert.deepEqual(tokenReferences("1px solid var(--line, var(--fallback))"), ["--line", "--fallback"]);
  assert.deepEqual(tokenReferences("#fff"), []);
  assert.deepEqual(tokenReferences(42), []);
});

test("a schema 1 component-definition, with no schema 2 props, keeps its project schema 1 until it gains them", () => {
  const legacy = apply(base(), [{ type: "insert-node", parentId: "frame", index: 0, node: { id: "old", type: "component-definition", props: { anything: true } } }]);
  assert.equal(legacy.schemaVersion, 1, "a schema 1 project holding one opens as it did");
  validateDocument(legacy);
  const upgraded = apply(legacy, [{ type: "set-props", nodeId: "old", set: { name: "Old", properties: [] } }]);
  assert.equal(upgraded.schemaVersion, 2, "its first schema 2 prop makes the project schema 2, in that transaction");
  assert.equal(apply(upgraded, [{ type: "set-props", nodeId: "old", unset: ["properties"] }]).schemaVersion, 1);
});

test("a token value is one balanced CSS value that loads nothing", () => {
  const insert = (value) => apply(base(), [{ type: "insert-node", parentId: null, index: 1, node: designSystem([{ name: "--t", type: "fontFamily", collection: "color", values: { light: value } }]) }]);
  for (const value of ["calc(1px", "calc(1px))", '"Inter', "'Inter, sans-serif", 'image-set("https://example.com/a.png" 1x)', "src(x)", "attr(data-x)", "env(safe-area-inset-top)", "red !important", "red\nblue", "a@b"]) {
    refusedWith(() => insert(value), /not one CSS value/u);
  }
  assert.equal(insert('"Helvetica Neue", Inter, sans-serif').schemaVersion, 2, "quoted font names are fine");
});

test("bindings are read in any case, as whole words, outside strings; an alias cycle in capitals is still a cycle", () => {
  assert.deepEqual(tokenReferences("VAR(--a) Var(--b)"), ["--a", "--b"]);
  assert.deepEqual(tokenReferences("myvar(--x) xvar(--y)"), []);
  assert.deepEqual(tokenReferences("'var(--x)', \"var(--y)\", var(--z)"), ["--z"]);
  const token = (name, value) => ({ name, type: "color", collection: "color", values: { light: value } });
  refusedWith(() => apply(base(), [{ type: "insert-node", parentId: null, index: 1, node: designSystem([token("--a", "VAR(--b)"), token("--b", "var(--a)")]) }]), /--a -> --b -> --a/u);
});

test("a property's id never changes, and a property targets its own component's nodes", () => {
  const property = (id, name = "Label", target = "label") => ({ id, name, kind: "text", default: "Go", target: { nodeId: target, field: "text" } });
  const document = apply(base(), [
    { type: "insert-node", parentId: "frame", index: 0, node: { id: "btn", type: "component-definition", props: { name: "Button", properties: [property("p-label")] } } },
    { type: "insert-node", parentId: "btn", index: 0, node: { id: "label", type: "text", props: { text: "Go" } } },
  ]);
  refusedWith(() => apply(document, [{ type: "set-props", nodeId: "btn", set: { properties: [property("label-2")] } }]), /property Label's id cannot change \(it was p-label, now label-2\)/u);
  assert.equal(apply(document, [{ type: "set-props", nodeId: "btn", set: { properties: [] } }]).nodes.btn.props.properties.length, 0, "removing one is allowed");
  // A copy that still names the original's children is refused; a target that is gone is stale and kept.
  refusedWith(() => apply(document, [{ type: "insert-node", parentId: "frame", index: 1, node: { id: "copy", type: "component-definition", props: { name: "Copy", properties: [property("p-label")] } } }]), /targets label, which is not in this component/u);
  assert.equal(apply(document, [{ type: "remove-node", nodeId: "label" }]).nodes.btn.props.properties[0].target.nodeId, "label");
  // Moving a targeted node out of its component is checked too, though the move touches no v2 record.
  refusedWith(() => apply(document, [{ type: "move-node", nodeId: "label", parentId: "frame", index: 0 }]), /targets label, which is not in this component/u);
});

test("the editor's mirror and journal replay follow the version", () => {
  const document = base();
  const mirror = structuredClone(document);
  applyCommittedTransaction(mirror, { operations: [{ type: "insert-node", parentId: null, index: 1, node: designSystem() }] });
  assert.equal(mirror.schemaVersion, 2);
  applyCommittedTransaction(mirror, { operations: [{ type: "remove-node", nodeId: "ds" }] });
  assert.equal(mirror.schemaVersion, 1);
  const replayed = replayTransactions(document, [tx(document, [{ type: "insert-node", parentId: null, index: 1, node: designSystem() }])]);
  assert.equal(replayed.schemaVersion, 2, "a journal that adds a design system replays to schema 2");
  assert.equal(replayTransactions(replayed, [{ ...tx(replayed, [{ type: "remove-node", nodeId: "ds" }]) }]).schemaVersion, 1);
});

test("a schema 1 component-definition stays valid in a schema 2 document, and a node deep inside a component is checked when it moves", () => {
  const withBoth = apply(base(), [
    { type: "insert-node", parentId: null, index: 1, node: designSystem() },
    { type: "insert-node", parentId: "frame", index: 0, node: { id: "old", type: "component-definition", props: { anything: true } } },
  ]);
  assert.equal(withBoth.schemaVersion, 2);
  validateDocument(withBoth);
  // A grandchild a property targets, moved out of the component: the move touches no
  // component record directly, and is still checked.
  const document = apply(base(), [
    { type: "insert-node", parentId: "frame", index: 0, node: { id: "card", type: "component-definition", props: { name: "Card", properties: [{ id: "p-title", name: "Title", kind: "text", default: "Hi", target: { nodeId: "title", field: "text" } }] } } },
    { type: "insert-node", parentId: "card", index: 0, node: { id: "header", type: "group" } },
    { type: "insert-node", parentId: "header", index: 0, node: { id: "title", type: "text", props: { text: "Hi" } } },
  ]);
  refusedWith(() => apply(document, [{ type: "move-node", nodeId: "title", parentId: "frame", index: 0 }]), /targets title, which is not in this component/u);
});
