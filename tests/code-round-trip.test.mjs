import test from "node:test";
import assert from "node:assert/strict";

import { exportJsx, importJsx, objectStyleText } from "../packages/studio-host/src/code.ts";

// #398: an object style is brought in as the style it says, and exporting imported code then
// bringing it in again settles, instead of nesting one more element each round.

const imported = (source) => {
  const result = importJsx(source);
  const nodes = {};
  for (const node of result.operations[0].nodes) nodes[node.id] = { children: [], ...node };
  return { ...result, document: { id: "d", revision: 0, rootIds: [result.frameId], nodes }, rootId: result.operations[0].nodes[1].id };
};

const exportedPage = (source) => {
  const { document, frameId } = imported(source);
  return exportJsx(document, frameId).code;
};

test("an object style of literal values is brought in as the style it says", () => {
  const { document, rootId, layersWithStyleLeftOut } = imported(`export function A() { return <main style={{ padding: "40px", backgroundColor: '#fafafa', zIndex: 2, marginTop: 8, opacity: 0.5, WebkitLineClamp: 3, MozBoxFlex: 1, "--brand": "red", gap: 0 }}><p style="color: red">x</p></main>; }`);
  assert.deepEqual(document.nodes[rootId].props.style, { padding: "40px", "background-color": "#fafafa", "z-index": "2", "margin-top": "8px", opacity: "0.5", "-webkit-line-clamp": "3", "-moz-box-flex": "1", "--brand": "red", gap: "0" });
  assert.deepEqual(document.nodes[document.nodes[rootId].children[0]].props.style, { color: "red" });
  assert.equal(layersWithStyleLeftOut, 0);
});

test("an object style that is not only literal values is counted as left out, never dropped silently", () => {
  for (const style of ["{...base}", "{ padding: size }", "{ [key]: \"1px\" }", "{ padding: `4px` }", "{ color: \"red; x: y\" }", "{ padding: pad() }", "styles.card", "{ a: \"\\u0041\" }"]) {
    const { document, rootId, layersWithStyleLeftOut } = imported(`export function A() { return <main style={${style}}>x</main>; }`);
    assert.equal(layersWithStyleLeftOut, 1, style);
    assert.deepEqual(document.nodes[rootId].props.style, {}, style);
  }
});

test("objectStyleText reads exactly the literal object forms", () => {
  assert.equal(objectStyleText(`style={{ msTransition: "none", flexGrow: 1, width: -2.5, top: .5 }}`), "-ms-transition: none; flex-grow: 1; width: -2.5px; top: 0.5px");
  assert.equal(objectStyleText(`style={{}}`), "");
  assert.equal(objectStyleText(`style={{ a: "1", }}`), "a: 1");
  for (const refused of [`style="a: b"`, `style={{ a: 1 b: 2 }}`, `style={{ a: 1e3 }}`, `style={{ a: 1px }}`, `style={{ a: "x" + "y" }}`, `style={{ a }}`, `style={{ "a": "\n" }}`]) assert.equal(objectStyleText(refused), null, refused);
});

test("export, import, export settles: the page imported code sits in is not exported as a wrapper", () => {
  const source = `export function Card() { return <section style={{ padding: 40 }}><h2>Title</h2><p className="body">Words</p></section>; }`;
  const first = imported(source);
  const once = exportJsx(first.document, first.frameId).code;
  assert.doesNotMatch(once, /800px|min-height/u, "the page's own style is not part of the component");
  assert.match(once, /function Card\(/u);
  const twice = exportedPage(once);
  assert.equal(twice, once);
  // Exporting the component itself gives the same code.
  assert.equal(exportJsx(first.document, first.rootId).code, once);
});

test("a page the person has changed exports as itself, and still settles from the second round", () => {
  const first = imported(`export function Card() { return <section><h2>Title</h2></section>; }`);
  first.document.nodes[first.frameId].props.style = { ...first.document.nodes[first.frameId].props.style, background: "#000000" };
  const once = exportJsx(first.document, first.frameId).code;
  assert.match(once, /background: #000000/u, "a styled page keeps its style");
  const twice = exportedPage(once);
  assert.equal(exportedPage(twice), twice);
  assert.equal(twice, once);
});

test("a page holding more than one layer exports as itself", () => {
  const { document, frameId, rootId } = imported(`export function Card() { return <section>x</section>; }`);
  const copy = { ...structuredClone(document.nodes[rootId]), id: "second", parentId: frameId };
  document.nodes.second = copy;
  document.nodes[frameId].children.push("second");
  assert.match(exportJsx(document, frameId).code, /800px/u);
});

test("a connected file's object style shows on the canvas, and only a change to it is reported as not written back", async (t) => {
  const { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { hostPool, ok } = await import("./support/host-api.mjs");
  const CARD = `export function Card() {\n  return (\n    <section style={{ padding: 40, backgroundColor: "#fafafa" }} title="Plan">\n      <h2>Pro</h2>\n    </section>\n  );\n}\n`;
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ninerr-398-")));
  mkdirSync(join(root, "projects"));
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, "app", "card.tsx"), CARD);
  let clock = 0;
  const pool = hostPool(() => new Date(Date.UTC(2026, 10, 7) + clock++ * 1000).toISOString());
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const { call } = await pool.open(join(root, "projects"));
  await ok(call("POST", "/api/projects/create", { name: "site" }), "create");
  await ok(call("POST", "/api/codebase/connect", { folder: join(root, "app") }), "connect");
  const brought = await ok(call("POST", "/api/codebase/import", { file: "card.tsx", component: "Card" }), "bring in");
  assert.equal(brought.layersWithStyleLeftOut, 0);
  const { document } = await ok(call("GET", "/api/document"), "document");
  let { revision } = await ok(call("GET", "/api/document"), "document");
  const section = document.nodes[brought.frameId].children[0];
  assert.deepEqual(document.nodes[section].props.style, { padding: "40px", "background-color": "#fafafa" });
  const edit = async (set) => {
    revision = (await ok(call("POST", "/api/edit", { baseRevision: revision, intent: "Edit", operations: [{ type: "set-props", nodeId: section, set }] }), "edit")).revision;
  };
  // An unrelated literal change writes back, with no notice about the style it did not touch.
  await edit({ attributes: { title: "Team" } });
  let plan = await ok(call("POST", "/api/codebase/preview", { nodeId: section }), "preview");
  assert.deepEqual(plan.notWritten, []);
  await ok(call("POST", "/api/codebase/write", { nodeId: section, token: plan.token }), "write");
  assert.equal(readFileSync(join(root, "app", "card.tsx"), "utf8"), CARD.replace(`title="Plan"`, `title="Team"`));
  // A change to the object style is code, so it is reported and never written.
  ({ revision } = await ok(call("GET", "/api/document"), "document"));
  await edit({ style: { padding: "24px", "background-color": "#fafafa" } });
  plan = await ok(call("POST", "/api/codebase/preview", { nodeId: section }), "preview");
  assert.deepEqual(plan.notWritten.map((entry) => entry.reason), ["the style is code in the source and is not written back"]);
  // Clearing it is a change too.
  await edit({ style: {} });
  plan = await ok(call("POST", "/api/codebase/preview", { nodeId: section }), "preview");
  assert.deepEqual(plan.notWritten.map((entry) => entry.reason), ["the style is code in the source and is not written back"]);
});
