import test from "node:test";
import assert from "node:assert/strict";

import { createDocument, createNode } from "../packages/document-model/src/index.mjs";
import { addCollection, addMode, addToken, compileTokens, createDesignSystem, deleteToken, designSystemOf, modeAttribute, renameToken, setToken, tokenUses } from "../packages/document-model/src/tokens.mjs";
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

test("an alias follows the token it names into each mode, across collections too", () => {
  const project = start();
  project.run(addMode(project.state.document, "base", { id: "dark", name: "Dark" }));
  project.run(setToken(project.state.document, { name: "--blue", values: { dark: "#88aaff" } }));
  // --button in another collection, set only in its default: it must still follow --brand.
  project.run(addCollection(project.state.document, { id: "semantic", name: "Semantic" }));
  project.run(addToken(project.state.document, { name: "--button", type: "color", collection: "semantic", values: { default: "var(--brand)" } }));
  const css = compileTokens(project.state.document);
  const dark = css.slice(css.indexOf('[data-ninerr-mode~="base:dark"]'));
  assert.match(dark, /--blue: #88aaff;/u);
  assert.match(dark, /--brand: var\(--blue\);/u, "an alias in the same collection is declared again in the mode");
  assert.match(dark, /--button: var\(--brand\);/u, "and so is one in another collection that reaches it through --brand");
  assert.throws(() => addToken(project.state.document, { name: "--blue", type: "color", collection: "base", values: { default: "red" } }), /already a token/u);
});

test("uses in instance overrides and variant overrides are found, renamed and replaced", () => {
  const project = start();
  project.run([
    { type: "insert-node", parentId: "page", index: 2, node: { id: "def", type: "component-definition", props: { name: "Btn", properties: [], variants: [{ values: {}, overrides: [{ path: [], nodeId: "def", set: { style: { color: "var(--brand)" } } }] }] } } },
    { type: "insert-node", parentId: "page", index: 3, node: { id: "inst", type: "component-instance", props: { componentId: "def", overrides: [{ path: [], nodeId: "def", set: { style: { "border-color": "var(--brand)" } } }] } } },
  ]);
  const found = tokenUses(project.state.document, "--brand").map(({ nodeId, fields }) => `${nodeId}:${fields.join(",")}`);
  assert.ok(found.includes("def:variants.0.overrides.0.style.color"), found.join(" "));
  assert.ok(found.includes("inst:overrides.0.style.border-color"), found.join(" "));
  const renamed = project.run(renameToken(project.state.document, "--brand", "--primary"));
  assert.equal(renamed.nodes.inst.props.overrides[0].set.style["border-color"], "var(--primary)");
  assert.equal(renamed.nodes.def.props.variants[0].overrides[0].set.style.color, "var(--primary)");
  const deleted = project.run(deleteToken(renamed, "--primary", { token: "--blue" }));
  assert.equal(deleted.nodes.inst.props.overrides[0].set.style["border-color"], "var(--blue)");
  assert.equal(tokenUses(deleted, "--primary").length, 0);
});

test("comments and escaped quotes in a stylesheet never hide a use or make one", () => {
  const project = start();
  const sheet = "/* don't */ .x { color: var(--brand) } /* it's var(--brand) */ .y::before { content: \"\\\" var(--brand)\" }";
  const document = project.run([{ type: "set-props", nodeId: "card", set: { stylesheet: sheet } }]);
  assert.deepEqual(tokenUses(document, "--brand").find(({ nodeId }) => nodeId === "card").fields, ["stylesheet"]);
  assert.throws(() => deleteToken(document, "--brand"), /in use/u, "the use behind an apostrophe in a comment is found");
  const renamed = project.run(renameToken(document, "--brand", "--primary"));
  assert.equal(renamed.nodes.card.props.stylesheet, "/* don't */ .x { color: var(--primary) } /* it's var(--brand) */ .y::before { content: \"\\\" var(--brand)\" }", "only the code's reference changes");
  // A layer stylesheet that declares the token locally is a use, and is renamed with it.
  const local = project.run([{ type: "set-props", nodeId: "card", set: { stylesheet: ":scope { --primary: red; color: var(--primary); }" } }]);
  assert.equal(project.run(renameToken(local, "--primary", "--accent")).nodes.card.props.stylesheet, ":scope { --accent: red; color: var(--accent); }");
});

test("collection and mode ids hold no colon, and values never hold what a stylesheet may not", () => {
  const project = start();
  assert.throws(() => addCollection(project.state.document, { id: "a:b", name: "A" }), /letters, digits and \. _ -/u);
  assert.throws(() => addMode(project.state.document, "base", { id: "b:c", name: "B" }), /letters, digits and \. _ -/u);
  for (const value of ['"javascript:x"', "'vbscript:x'", "behavior: x", "-moz-binding"]) {
    assert.throws(() => setToken(project.state.document, { name: "--f", type: "fontFamily", collection: "base", values: { default: value } }), /scheme or binding|character/u, value);
  }
});

test("a delete by literal gives aliases the token's value in each mode; one by a token that refers back is refused", () => {
  const project = start();
  project.run(addMode(project.state.document, "base", { id: "dark", name: "Dark" }));
  project.run(setToken(project.state.document, { name: "--blue", values: { dark: "#88aaff" } }));
  const deleted = project.run(deleteToken(project.state.document, "--blue", { literal: true }));
  const brand = designSystemOf(deleted).props.tokens.find((token) => token.name === "--brand");
  assert.deepEqual(brand.values, { default: "#2255ff", dark: "#88aaff" });
  // --brand refers to --blue; replacing --blue with --brand would make a cycle.
  const again = start();
  assert.throws(() => deleteToken(again.state.document, "--blue", { token: "--brand" }), /--brand itself refers to --blue; choose another token, or its value/u);
});

test("a rename that would rewrite more layers than one change may is refused with how many", () => {
  const nodes = [createNode({ id: "page", type: "page", children: Array.from({ length: 5_000 }, (_, index) => `n${index}`) })];
  for (let index = 0; index < 5_000; index += 1) nodes.push(createNode({ id: `n${index}`, type: "frame", parentId: "page", props: { style: { color: "var(--brand)" } } }));
  let state = createHistoryState(createDocument({ id: "d", name: "n", nodes }));
  const run = (operations) => {
    state = commitTransaction(state, { id: `big${clock += 1}`, actor: "person", baseRevision: state.document.revision, intent: "t", tool: "t", timestamp: "2026-11-09T00:00:00.000Z", operations });
  };
  run(createDesignSystem(state.document, { id: "ds" }));
  run(addToken(state.document, { name: "--brand", type: "color", collection: "base", values: { default: "red" } }));
  assert.throws(() => renameToken(state.document, "--brand", "--primary"), /--brand is used by 5000 layers; one change can rewrite at most 4999/u);
});

test("code export carries tokens an instance's component uses, and each layer's mode", async () => {
  const { exportJsx } = await import("../packages/studio-host/src/code.ts");
  const project = start();
  const document = project.run([
    { type: "insert-node", parentId: "page", index: 2, node: { id: "def", type: "component-definition", props: { name: "Btn", properties: [] } } },
    { type: "insert-node", parentId: "def", index: 0, node: { id: "def-label", type: "text", props: { text: "Go", style: { color: "var(--brand)" } } } },
    { type: "insert-node", parentId: "page", index: 3, node: { id: "box", type: "frame", props: { modes: { base: "default" } } } },
    { type: "insert-node", parentId: "box", index: 0, node: { id: "inst", type: "component-instance", props: { componentId: "def" } } },
  ]);
  assert.match(exportJsx(document, "box").tokens ?? "", /--brand/u, "the instance's component uses --brand");
  assert.match(exportJsx(document, "box").code, /data-ninerr-mode="base:default"/u);
});
