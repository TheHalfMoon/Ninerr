import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, createNode } from "../packages/document-model/src/index.mjs";
import { commitTransaction, createHistoryState, undo } from "../packages/history/src/index.mjs";
import { definitionsAbove, expandInstance, instancesDrawing, withInstancesExpanded } from "../packages/renderer/src/index.mjs";
import { componentsOf, createComponent, detachInstance, insertInstance } from "../packages/canvas/src/components.mjs";

// ADR-0005: an instance stores only its component, property values and overrides, and is expanded
// when drawn; nothing expanded is stored.

let clock = 0;
const project = () => {
  let state = createHistoryState(createDocument({
    id: "doc",
    name: "Site",
    nodes: [
      createNode({ id: "page", type: "page", children: ["card"] }),
      createNode({ id: "card", type: "frame", parentId: "page", children: ["title", "badge"], props: { name: "Card", tag: "section", style: { padding: "8px" } } }),
      createNode({ id: "title", type: "text", parentId: "card", props: { text: "Hello" } }),
      createNode({ id: "badge", type: "element", parentId: "card", props: { tag: "span", text: "New", attributes: { class: "badge" } } }),
    ],
  }));
  const run = (operations) => {
    state = commitTransaction(state, { id: `t${clock += 1}`, actor: "person", baseRevision: state.document.revision, intent: "test", tool: "test", timestamp: "2026-11-09T00:00:00.000Z", operations });
    return state.document;
  };
  return { run, get document() { return state.document; }, undo() { state = undo(state); return state.document; } };
};
const texts = (view) => [view.props.text, ...view.children.flatMap(texts)].filter((text) => text !== undefined);

test("a layer becomes a component, an instance draws it, and Undo takes each back", () => {
  const p = project();
  p.run(createComponent(p.document, "card", { id: "comp", name: "Card" }));
  assert.equal(Object.hasOwn(p.document.nodes, "card"), false, "the component takes the layer's place");
  assert.equal(p.document.nodes.comp.props.tag, "section", "with its look");
  assert.deepEqual(p.document.nodes.comp.children, ["title", "badge"], "and its children: no wrapper in between");
  assert.deepEqual(componentsOf(p.document), [{ id: "comp", name: "Card" }]);
  assert.equal(p.document.schemaVersion, 2);
  p.run(insertInstance(p.document, "comp", { id: "inst", afterId: "comp" }));
  assert.deepEqual(p.document.nodes.inst.children, [], "an instance stores no children");
  const view = expandInstance(p.document, "inst");
  assert.deepEqual(texts(view), ["Hello", "New"]);
  assert.deepEqual(view.children[0].chain, ["inst"]);
  p.undo();
  assert.equal(Object.hasOwn(p.document.nodes, "inst"), false);
  assert.throws(() => createComponent(p.document, "title", { id: "c2" }), /already inside a component/u);
  // An instance placed inside its own component goes beside it instead.
  const inside = insertInstance(p.document, "comp", { id: "x", afterId: "title" });
  assert.equal(inside[0].parentId, "page");
});

test("an instance draws its property values, the variant they select, and its overrides, in that order", () => {
  const p = project();
  p.run(createComponent(p.document, "card", { id: "comp", name: "Card" }));
  p.run([{ type: "set-props", nodeId: "comp", set: {
    properties: [
      { id: "p-title", name: "Title", kind: "text", default: "Hello", target: { nodeId: "title", field: "text" } },
      { id: "p-badge", name: "Badge", kind: "boolean", default: true, target: { nodeId: "badge", field: "visible" } },
      { id: "p-size", name: "Size", kind: "variant", default: "md", options: ["sm", "md"], target: { nodeId: "comp", field: "attributes.class" } },
    ],
    variants: [{ values: { "p-size": "sm" }, overrides: [{ path: [], nodeId: "comp", set: { style: { padding: "2px" } } }] }],
  } }]);
  p.run(insertInstance(p.document, "comp", { id: "inst" }));
  p.run([{ type: "set-props", nodeId: "inst", set: { propertyValues: { "p-title": "Pro", "p-badge": false, "p-size": "sm" }, overrides: [{ path: [], nodeId: "title", set: { style: { color: "red" } } }] } }]);
  const card = expandInstance(p.document, "inst");
  assert.equal(card.props.attributes.class, "sm", "the variant property sets the class");
  assert.equal(card.props.style.padding, "2px", "the variant's override applies");
  assert.equal(card.props.tag, "section", "the instance is drawn as its component's root");
  const [title, badge] = card.children;
  assert.equal(title.props.text, "Pro", "the text property");
  assert.equal(title.props.style.color, "red", "the instance's own override");
  assert.equal(badge.props.attributes.hidden, "", "a false Shown property hides its layer");
  // The stored component is untouched.
  assert.equal(p.document.nodes.title.props.text, "Hello");
});

test("nested instances expand with their chain; an outer override reaches a nested instance by its path", () => {
  const p = project();
  p.run(createComponent(p.document, "card", { id: "comp", name: "Card" }));
  p.run([
    { type: "insert-node", parentId: "page", index: 1, node: { id: "row", type: "component-definition", props: { name: "Row", properties: [] } } },
    { type: "insert-node", parentId: "row", index: 0, node: { id: "row-card", type: "component-instance", props: { componentId: "comp" } } },
    { type: "insert-node", parentId: "page", index: 2, node: { id: "use", type: "component-instance", props: { componentId: "row", overrides: [{ path: ["row-card"], nodeId: "title", set: { text: "Deep" } }] } } },
  ]);
  const view = expandInstance(p.document, "use");
  const nested = view.children[0];
  assert.deepEqual(nested.chain, ["use"]);
  assert.equal(nested.props.tag, "section", "a nested instance is drawn as its component's root");
  assert.deepEqual(nested.children[0].chain, ["use", "row-card"]);
  assert.deepEqual(texts(view), ["Deep", "New"]);
  // A change inside Card redraws both the instance of Card and the one of Row that holds it.
  assert.deepEqual(definitionsAbove(p.document, ["title"]), ["comp"]);
  assert.deepEqual(instancesDrawing(p.document, ["comp"]).sort(), ["row-card", "use"]);
});

test("code export writes what an instance draws; detach writes it as real layers in one transaction", async () => {
  const { exportJsx } = await import("../packages/studio-host/src/code.ts");
  const p = project();
  p.run(createComponent(p.document, "card", { id: "comp", name: "Card" }));
  p.run(insertInstance(p.document, "comp", { id: "inst" }));
  p.run([{ type: "set-props", nodeId: "inst", set: { propertyValues: {}, overrides: [{ path: [], nodeId: "title", set: { text: "Exported" } }] } }]);
  assert.match(exportJsx(p.document, "inst").code, /Exported/u);
  assert.equal(Object.hasOwn(withInstancesExpanded(p.document, "inst").nodes, "inst"), true);
  let counter = 0;
  const { rootId, operations } = detachInstance(p.document, "inst", () => `d${counter += 1}`);
  const detached = p.run(operations);
  assert.equal(Object.hasOwn(detached.nodes, "inst"), false);
  assert.equal(detached.nodes[rootId].type, "frame");
  const words = [];
  const walk = (id) => {
    const node = detached.nodes[id];
    if (typeof node.props.text === "string") words.push(node.props.text);
    node.children.forEach(walk);
  };
  walk(rootId);
  assert.deepEqual(words, ["Exported", "New"]);
  assert.equal(Object.values(detached.nodes).some((node) => node.props.properties !== undefined && node.type !== "component-definition"), false, "no component props on layers");
  const restored = p.undo();
  assert.equal(restored.nodes.inst.type, "component-instance", "Undo puts the instance back");
});

test("hidden is hidden whatever display a layer has, and an instance's own override can show what a variant hid", () => {
  const p = project();
  p.run([{ type: "set-props", nodeId: "badge", set: { style: { display: "flex" } } }]);
  p.run(createComponent(p.document, "card", { id: "comp", name: "Card" }));
  p.run([{ type: "set-props", nodeId: "comp", set: {
    properties: [{ id: "p-tone", name: "Tone", kind: "variant", default: "plain", options: ["plain", "quiet"], target: { nodeId: "comp", field: "attributes.class" } }],
    variants: [{ values: { "p-tone": "quiet" }, overrides: [{ path: [], nodeId: "badge", set: { visible: false } }] }],
  } }]);
  p.run(insertInstance(p.document, "comp", { id: "inst" }));
  p.run([{ type: "set-props", nodeId: "inst", set: { propertyValues: { "p-tone": "quiet" } } }]);
  const hidden = expandInstance(p.document, "inst").children[1];
  assert.equal(hidden.props.style.display, "none !important", "display: flex does not win over hidden");
  assert.equal(hidden.props.attributes.hidden, "");
  p.run([{ type: "set-props", nodeId: "inst", set: { overrides: [{ path: [], nodeId: "badge", set: { visible: true } }] } }]);
  const shown = expandInstance(p.document, "inst").children[1];
  assert.equal(shown.props.style.display, "flex", "the instance's own override shows it again");
  assert.equal(shown.props.attributes.hidden, undefined);
  // A variant's class joins the layer's own classes.
  p.run([{ type: "set-props", nodeId: "comp", set: { attributes: { class: "card" } } }]);
  assert.equal(expandInstance(p.document, "inst").props.attributes.class, "card quiet");
});

test("what is set on a nested instance itself is drawn on its root, and an instance draws in its own modes", () => {
  const p = project();
  p.run(createComponent(p.document, "card", { id: "comp", name: "Card" }));
  p.run([
    { type: "insert-node", parentId: "page", index: 1, node: { id: "row", type: "component-definition", props: { name: "Row", properties: [] } } },
    { type: "insert-node", parentId: "row", index: 0, node: { id: "row-card", type: "component-instance", props: { componentId: "comp" } } },
    { type: "insert-node", parentId: "page", index: 2, node: { id: "use", type: "component-instance", props: { componentId: "row", modes: { base: "dark" }, overrides: [{ path: [], nodeId: "row-card", set: { style: { margin: "4px" }, visible: false } }] } } },
  ]);
  const view = expandInstance(p.document, "use");
  assert.deepEqual(view.props.modes, { base: "dark" });
  const nested = view.children[0];
  assert.equal(nested.props.style.margin, "4px", "an outer override on the nested instance itself is kept");
  assert.equal(nested.props.style.padding, "8px", "over what its component gives it");
  assert.equal(nested.props.attributes.hidden, "");
});

test("an expansion past its layer budget is not drawn, and code export refuses it", async () => {
  const { exportJsx } = await import("../packages/studio-host/src/code.ts");
  // Eight levels of ten instances each would be 10^8 layers.
  const nodes = [createNode({ id: "page", type: "page", children: ["c0"] }), createNode({ id: "c0", type: "component-definition", parentId: "page", children: ["leaf"], props: { name: "C0", properties: [] } }), createNode({ id: "leaf", type: "text", parentId: "c0", props: { text: "x" } })];
  for (let level = 1; level <= 8; level += 1) {
    const children = Array.from({ length: 10 }, (_, index) => `c${level}-i${index}`);
    nodes[0].children.push(`c${level}`);
    nodes.push(createNode({ id: `c${level}`, type: "component-definition", parentId: "page", children, props: { name: `C${level}`, properties: [] } }));
    for (const id of children) nodes.push(createNode({ id, type: "component-instance", parentId: `c${level}`, props: { componentId: `c${level - 1}` } }));
  }
  nodes[0].children.push("top");
  nodes.push(createNode({ id: "top", type: "component-instance", parentId: "page", props: { componentId: "c8" } }));
  const document = createDocument({ id: "d", name: "n", nodes });
  const started = Date.now();
  assert.equal(expandInstance(document, "top"), null);
  assert.ok(Date.now() - started < 2_000, "the budget stops it early");
  assert.throws(() => exportJsx(document, "top"), (error) => error.code === "export-too-large");
});

test("a layer holding a component cannot become one; an instance that would draw itself goes beside its holder", () => {
  const p = project();
  p.run(createComponent(p.document, "card", { id: "comp", name: "Card" }));
  p.run([{ type: "insert-node", parentId: "page", index: 0, node: { id: "wrap", type: "frame", props: {} } }, { type: "move-node", nodeId: "comp", parentId: "wrap", index: 0 }]);
  assert.throws(() => createComponent(p.document, "wrap", { id: "c2" }), /holds a component/u);
  // Row holds an instance of Card; an instance of Row placed inside Card would draw Card in Card.
  p.run([
    { type: "insert-node", parentId: "page", index: 1, node: { id: "row", type: "component-definition", props: { name: "Row", properties: [] } } },
    { type: "insert-node", parentId: "row", index: 0, node: { id: "row-card", type: "component-instance", props: { componentId: "comp" } } },
  ]);
  const [operation] = insertInstance(p.document, "row", { id: "r1", afterId: "title" });
  assert.equal(operation.parentId, "wrap", "placed beside Card, not inside it");
  // An absolutely placed component's new instance is set off from it.
  p.run([{ type: "set-props", nodeId: "comp", set: { style: { position: "absolute", left: "10px", top: "20px" } } }]);
  assert.deepEqual(insertInstance(p.document, "comp", { id: "i2" })[0].node.props.style, { left: "34px", top: "44px" });
});

test("a component made from a code-bound layer, and a detached instance, carry no code binding", () => {
  const p = project();
  p.run([{ type: "set-props", nodeId: "card", set: { codeSource: { file: "Card.tsx", component: "Card", path: "", tag: "section", base: {}, code: {}, shape: {} } } }]);
  p.run(createComponent(p.document, "card", { id: "comp", name: "Card" }));
  assert.equal(p.document.nodes.comp.props.codeSource, undefined);
  p.run([{ type: "set-props", nodeId: "title", set: { codeSource: { file: "Card.tsx", component: "Card", path: "0", tag: "span", base: {}, code: {}, shape: {} } } }]);
  p.run(insertInstance(p.document, "comp", { id: "inst" }));
  let counter = 0;
  const detached = p.run(detachInstance(p.document, "inst", () => `d${counter += 1}`).operations);
  assert.equal(Object.values(detached.nodes).filter((node) => node.id.startsWith("d")).some((node) => node.props.codeSource !== undefined), false, "writing back a detached copy never reaches the component's source");
});
