import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, createNode } from "../packages/document-model/src/index.mjs";
import { addCollection, addMode, compileTokens, createDesignSystem, deleteToken, designSystemOf, modeAttribute, renameToken, setToken, tokenUses } from "../packages/document-model/src/tokens.mjs";
import { commitTransaction, createHistoryState, undo } from "../packages/history/src/index.mjs";

// ADR-0004: tokens live on the design-system node; a style binds one with var(--name). Every
// change is one transaction, and a rename or delete reaches every use in it.

let clock = 0;
const start = () => {
  const document = createDocument({
    id: "doc",
    name: "Site",
    nodes: [
      createNode({ id: "page", type: "page", children: ["hero", "card"] }),
      createNode({ id: "hero", type: "frame", parentId: "page", props: { style: { color: "var(--brand)", "background-color": "VAR( --brand , white)", "font-family": "'var(--brand)', serif" } } }),
      createNode({ id: "card", type: "frame", parentId: "page", props: { style: { padding: "calc(var(--space) * 2)" }, stylesheet: "p { color: var(--brand); } p::before { content: 'var(--brand)'; }" } }),
    ],
  });
  let state = createHistoryState(document);
  const run = (operations) => {
    state = commitTransaction(state, { id: `t${clock += 1}`, actor: "person", baseRevision: state.document.revision, intent: "test", tool: "test", timestamp: "2026-11-09T00:00:00.000Z", operations });
    return state.document;
  };
  run(createDesignSystem(state.document, { id: "ds" }));
  run(setToken(state.document, { name: "--blue", type: "color", collection: "base", values: { default: "#2255ff" } }));
  run(setToken(state.document, { name: "--brand", type: "color", collection: "base", values: { default: "var(--blue)" } }));
  run(setToken(state.document, { name: "--space", type: "spacing", collection: "base", values: { default: "8px" } }));
  return { run, get state() { return state; }, set state(value) { state = value; } };
};

test("a design system is created once, and tokens are added and changed in one transaction each", () => {
  const project = start();
  const system = designSystemOf(project.state.document);
  assert.equal(project.state.document.schemaVersion, 2);
  assert.deepEqual(system.props.tokens.map((token) => token.name), ["--blue", "--brand", "--space"]);
  assert.throws(() => createDesignSystem(project.state.document, { id: "ds-2" }), /already has a design system/u);
  project.run(setToken(project.state.document, { name: "--space", values: { default: "12px" } }));
  assert.equal(designSystemOf(project.state.document).props.tokens.find((token) => token.name === "--space").values.default, "12px");
  assert.throws(() => setToken(project.state.document, { name: "--x", type: "color", collection: "base", values: { default: "red; } body {" } }), /not one CSS value|character/u);
  assert.throws(() => setToken(project.state.document, { name: "--loop", type: "color", collection: "base", values: { default: "var(--loop)" } }), /cycle/u);
});

test("a token's uses are found in style values and stylesheets, by whole reference, not in strings", () => {
  const { state } = start();
  assert.deepEqual(tokenUses(state.document, "--brand"), [
    { nodeId: "card", fields: ["stylesheet"] },
    { nodeId: "hero", fields: ["style.color", "style.background-color"] },
  ]);
  assert.deepEqual(tokenUses(state.document, "--space"), [{ nodeId: "card", fields: ["style.padding"] }]);
});

test("renaming a token renames every use and alias in one transaction, and Undo restores them all", () => {
  const project = start();
  const before = project.state.document;
  const document = project.run(renameToken(before, "--brand", "--primary"));
  const tokens = designSystemOf(document).props.tokens;
  assert.deepEqual(tokens.map((token) => token.name), ["--blue", "--primary", "--space"]);
  assert.equal(document.nodes.hero.props.style.color, "var(--primary)");
  assert.equal(document.nodes.hero.props.style["background-color"], "VAR( --primary , white)", "any case, the spacing and the fallback kept");
  assert.equal(document.nodes.hero.props.style["font-family"], "'var(--brand)', serif", "a string's text is not a use");
  assert.equal(document.nodes.card.props.stylesheet, "p { color: var(--primary); } p::before { content: 'var(--brand)'; }", "the string beside a real use is left as written");
  assert.throws(() => renameToken(document, "--blue", "--space"), /already a token/u);
  project.state = undo(project.state);
  assert.deepEqual(project.state.document.nodes.hero.props, before.nodes.hero.props);
  assert.deepEqual(designSystemOf(project.state.document).props.tokens.map((token) => token.name), ["--blue", "--brand", "--space"]);
  // An alias to the renamed token follows it.
  const aliased = project.run(renameToken(project.state.document, "--blue", "--azure"));
  assert.equal(designSystemOf(aliased).props.tokens.find((token) => token.name === "--brand").values.default, "var(--azure)");
});

test("a token in use is never deleted into a dangling reference", () => {
  const project = start();
  assert.throws(() => deleteToken(project.state.document, "--brand"), /--brand is in use/u);
  assert.throws(() => deleteToken(project.state.document, "--blue"), /--blue is in use/u, "an alias is a use");
  // Replaced by another token: each var(--brand), with its fallback, becomes var(--blue).
  const replaced = project.run(deleteToken(project.state.document, "--brand", { token: "--blue" }));
  assert.equal(replaced.nodes.hero.props.style.color, "var(--blue)");
  assert.equal(replaced.nodes.hero.props.style["background-color"], "var(--blue)");
  assert.equal(replaced.nodes.card.props.stylesheet, "p { color: var(--blue); } p::before { content: 'var(--brand)'; }");
  assert.equal(tokenUses(replaced, "--brand").length, 0);
  // Replaced by its own value in its default mode.
  const literal = project.run(deleteToken(project.state.document, "--space", { literal: true }));
  assert.equal(literal.nodes.card.props.style.padding, "calc(8px * 2)");
  assert.throws(() => deleteToken(literal, "--blue", { token: "--blue" }), /not another token/u);
});

test("modes and collections: a new mode starts from the default, and the tokens compile per mode", () => {
  const project = start();
  project.run(addMode(project.state.document, "base", { id: "dark", name: "Dark" }));
  project.run(setToken(project.state.document, { name: "--blue", values: { dark: "#88aaff" } }));
  project.run(addCollection(project.state.document, { id: "density", name: "Density", modeId: "comfortable", modeName: "Comfortable" }));
  const system = designSystemOf(project.state.document);
  assert.equal(system.props.tokens.find((token) => token.name === "--space").values.dark, "8px", "a new mode takes the default's value");
  assert.equal(compileTokens(project.state.document), [
    ":root {\n  --blue: #2255ff;\n  --brand: var(--blue);\n  --space: 8px;\n}",
    '[data-ninerr-mode~="base:dark"] {\n  --blue: #88aaff;\n  --brand: var(--blue);\n  --space: 8px;\n}',
  ].join("\n"));
  assert.equal(modeAttribute({ modes: { base: "dark", density: "comfortable" } }), "base:dark density:comfortable");
  assert.equal(modeAttribute({ modes: { "a b": "x", c: "d:e" } }), null, "only plain collection and mode ids");
  assert.equal(compileTokens(createDocument({ id: "d", name: "n", nodes: [createNode({ id: "p", type: "page" })] })), "");
});

test("code export carries the compiled tokens when the exported layers use any", async () => {
  const { exportJsx } = await import("../packages/studio-host/src/code.ts");
  const project = start();
  const plain = project.run([{ type: "insert-node", parentId: "page", index: 2, node: { id: "plain", type: "frame", props: { style: { color: "red" } } } }]);
  const exported = exportJsx(plain, "hero");
  assert.equal(exported.tokens, compileTokens(plain));
  assert.match(exported.tokens, /^:root \{\n {2}--blue: #2255ff;/u);
  assert.equal(exportJsx(plain, "plain").tokens, null, "a layer that uses no token carries none");
});
