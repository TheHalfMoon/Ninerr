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
  assert.equal(p.document.nodes.card.parentId, "comp", "the layer is now the main component");
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
      { id: "p-size", name: "Size", kind: "variant", default: "md", options: ["sm", "md"], target: { nodeId: "card", field: "attributes.class" } },
    ],
    variants: [{ values: { "p-size": "sm" }, overrides: [{ path: [], nodeId: "card", set: { style: { padding: "2px" } } }] }],
  } }]);
  p.run(insertInstance(p.document, "comp", { id: "inst" }));
  p.run([{ type: "set-props", nodeId: "inst", set: { propertyValues: { "p-title": "Pro", "p-badge": false, "p-size": "sm" }, overrides: [{ path: [], nodeId: "title", set: { style: { color: "red" } } }] } }]);
  const [card] = expandInstance(p.document, "inst").children;
  assert.equal(card.props.attributes.class, "sm", "the variant property sets the class");
  assert.equal(card.props.style.padding, "2px", "the variant's override applies");
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
