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

test("a layer inside an instance is changed as the instance's override: merged, cleared, reset, and never the component", async () => {
  const { instanceLayers, overrideFor, parseDeclarations, resetInstance, setInstanceOverride } = await import("../packages/canvas/src/components.mjs");
  const p = project();
  p.run(createComponent(p.document, "card", { id: "comp", name: "Card" }));
  p.run(insertInstance(p.document, "comp", { id: "inst" }));
  assert.deepEqual(instanceLayers(p.document, "inst").map(({ nodeId, path, depth }) => [nodeId, path, depth]), [["comp", [], 0], ["title", [], 1], ["badge", [], 1]], "its root first, then its layers");
  // The root takes an override like any layer: drawn on the instance itself.
  p.run(setInstanceOverride(p.document, "inst", { path: [], nodeId: "comp" }, { style: { padding: "20px" } }));
  assert.equal(expandInstance(p.document, "inst").props.style.padding, "20px");
  p.run(resetInstance(p.document, "inst"));
  const title = { path: [], nodeId: "title" };
  p.run(setInstanceOverride(p.document, "inst", title, { text: "Pro" }));
  p.run(setInstanceOverride(p.document, "inst", title, { style: parseDeclarations("color: red; padding: 4px") }));
  assert.deepEqual(overrideFor(p.document, "inst", title).set, { text: "Pro", style: { color: "red", padding: "4px" } }, "changes to one layer merge");
  p.run(setInstanceOverride(p.document, "inst", title, { style: { padding: "" }, visible: false }));
  assert.deepEqual(overrideFor(p.document, "inst", title).set, { text: "Pro", style: { color: "red" }, visible: false }, "a property set to empty is taken off");
  const [drawn] = expandInstance(p.document, "inst").children;
  assert.equal(drawn.props.text, "Pro");
  assert.equal(p.document.nodes.title.props.text, "Hello", "the component is untouched");
  p.run([{ type: "set-props", nodeId: "inst", set: { propertyValues: { kept: true } } }]);
  p.run(resetInstance(p.document, "inst", title));
  assert.equal(overrideFor(p.document, "inst", title), null);
  assert.deepEqual(p.document.nodes.inst.props.propertyValues, { kept: true }, "reset keeps property values");
  p.run(setInstanceOverride(p.document, "inst", { path: [], nodeId: "badge" }, { text: "Hot" }));
  p.run(resetInstance(p.document, "inst"));
  assert.deepEqual(p.document.nodes.inst.props.overrides, []);
  for (const bad of ["color red", "color: "]) assert.throws(() => parseDeclarations(bad), /is not a CSS declaration/u, bad);
  // What the canvas would not draw is refused, saying why, never dropped silently.
  for (const bad of ["x{}: 1", "grid-row2: 1", "background: url(x.png)", "color: red}"]) assert.throws(() => parseDeclarations(bad), /not a style property the canvas draws|could fetch or run something/u, bad);
  assert.deepEqual(parseDeclarations("--brand: #f00; color: var(--brand)"), { "--brand": "#f00", color: "var(--brand)" }, "a custom property themes one instance");
  // A semicolon inside a string or brackets does not end a declaration; a value already held
  // (an agent's) stands as written while the person changes another.
  assert.deepEqual(parseDeclarations('font-family: "a;b", serif; color: red', { "font-family": '"a;b", serif' }), { "font-family": '"a;b", serif', color: "red" });
  assert.throws(() => parseDeclarations('font-family: "a;b", serif'), /could fetch or run something, or hide a declaration/u, "the same value, newly written, is checked");
  assert.deepEqual(parseDeclarations("background: f(a;b); color: red", { background: "f(a;b)" }), { background: "f(a;b)", color: "red" }, "nor one inside brackets");
});

test("a layer of a nested instance is overridden by its path, and the layer list knows what is hidden", async () => {
  const { instanceLayers, setInstanceOverride } = await import("../packages/canvas/src/components.mjs");
  const p = project();
  p.run(createComponent(p.document, "card", { id: "comp", name: "Card" }));
  p.run([
    { type: "insert-node", parentId: "page", index: 1, node: { id: "row", type: "component-definition", props: { name: "Row", properties: [] } } },
    { type: "insert-node", parentId: "row", index: 0, node: { id: "row-card", type: "component-instance", props: { componentId: "comp" } } },
    { type: "insert-node", parentId: "page", index: 2, node: { id: "use", type: "component-instance", props: { componentId: "row" } } },
  ]);
  const layers = instanceLayers(p.document, "use");
  const nestedTitle = layers.find((layer) => layer.nodeId === "title");
  assert.deepEqual(nestedTitle.path, ["row-card"], "a layer of the nested instance is reached through it");
  p.run(setInstanceOverride(p.document, "use", nestedTitle, { text: "Deep", visible: false }));
  const drawn = expandInstance(p.document, "use").children[0].children[0];
  assert.equal(drawn.props.text, "Deep");
  assert.equal(instanceLayers(p.document, "use").find((layer) => layer.nodeId === "title").hidden, true);
});

test("an instance-swap property chooses the component a nested instance draws; a slot draws one in a layer", () => {
  const p = project();
  // Two small components to choose from, and Card holding a nested instance of Icon and a slot.
  p.run([
    { type: "insert-node", parentId: "page", index: 1, node: { id: "icon", type: "component-definition", props: { name: "Icon", properties: [], text: "★" } } },
    { type: "insert-node", parentId: "page", index: 2, node: { id: "dot", type: "component-definition", props: { name: "Dot", properties: [], text: "•" } } },
    { type: "insert-node", parentId: "card", index: 2, node: { id: "card-icon", type: "component-instance", props: { componentId: "icon" } } },
    { type: "insert-node", parentId: "card", index: 3, node: { id: "well", type: "frame", props: { name: "Well" } } },
    { type: "insert-node", parentId: "well", index: 0, node: { id: "well-own", type: "text", props: { text: "own" } } },
  ]);
  p.run(createComponent(p.document, "card", { id: "comp", name: "Card" }));
  p.run([{ type: "set-props", nodeId: "comp", set: { properties: [
    { id: "p-icon", name: "Icon", kind: "instance-swap", default: "", target: { nodeId: "card-icon", field: "children" } },
    { id: "p-well", name: "Content", kind: "slot", default: "", target: { nodeId: "well", field: "children" } },
  ] } }]);
  p.run(insertInstance(p.document, "comp", { id: "inst" }));
  const drawn = (view) => [view.props.text, ...view.children.flatMap(drawn)].filter((text) => text !== undefined);
  assert.deepEqual(drawn(expandInstance(p.document, "inst")), ["Hello", "New", "★", "own"], "the defaults: its own icon and the layer's own content");
  p.run([{ type: "set-props", nodeId: "inst", set: { propertyValues: { "p-icon": "dot", "p-well": "icon" } } }]);
  const view = expandInstance(p.document, "inst");
  assert.deepEqual(drawn(view), ["Hello", "New", "•", "★"], "the swap draws Dot; the slot draws Icon in place of the layer's own");
  const well = view.children.find((child) => child.id === "well");
  assert.equal(well.children[0].id, "well/slot");
  // An override reaches into what the slot draws, by its path.
  p.run([{ type: "set-props", nodeId: "inst", set: { overrides: [{ path: ["well/slot"], nodeId: "icon", set: { text: "☆" } }] } }]);
  assert.deepEqual(drawn(expandInstance(p.document, "inst")), ["Hello", "New", "•", "☆"]);
  // A change to Dot or Icon redraws the instance that draws it only through its values.
  assert.deepEqual(instancesDrawing(p.document, ["dot"]), ["inst"]);
  assert.ok(instancesDrawing(p.document, ["icon"]).includes("inst"));
});

test("swap and slot rules: their targets, their defaults, and a value that would draw a component in itself", () => {
  const p = project();
  p.run(createComponent(p.document, "card", { id: "comp", name: "Card" }));
  const property = (fields) => [{ type: "set-props", nodeId: "comp", set: { properties: [{ id: "p", name: "P", kind: "instance-swap", default: "", target: { nodeId: "title", field: "children" }, ...fields }] } }];
  assert.throws(() => p.run(property({})), /targets title, which is not an instance/u);
  assert.throws(() => p.run(property({ kind: "slot", target: { nodeId: "title", field: "text" } })), /sets its target's children/u);
  assert.throws(() => p.run(property({ kind: "slot", default: "nowhere" })), /default is not a component/u);
  p.run(property({ kind: "slot" }));
  // A slot that would draw Card inside Card is drawn as nothing there, not forever.
  p.run(insertInstance(p.document, "comp", { id: "inst" }));
  p.run([{ type: "set-props", nodeId: "inst", set: { propertyValues: { p: "comp" } } }]);
  const view = expandInstance(p.document, "inst");
  assert.deepEqual(view.children.find((child) => child.id === "title").children, [], "the slot that would draw Card in Card is left empty");
});
