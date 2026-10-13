import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, rendered, waitRevision, reloadEditor } from "./support/editor.mjs";
import { hostPool, ok } from "./support/host-api.mjs";
import { isLonghandOf, planElement, shorthandsFirst } from "../packages/renderer/src/index.mjs";
import { exportJsx } from "../packages/studio-host/src/code.ts";

// #172 (found by the PC8b review): the editor applied each change as its caller sent it, while
// the store, and so every reload, keeps the journal's sorted key order: the same design could
// draw one way live and another after a reload. A change event now carries its operations in
// the journal's form. Since #294 the renderer applies a style's shorthands before their
// longhands, whatever that order.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 11, 12, 0, 0) + clock++ * 1000).toISOString();
const page = { id: "page", type: "frame", parentId: null, children: [], props: { name: "Page" }, metadata: {} };
const box = { id: "box", type: "frame", parentId: "page", children: [], props: { name: "Box", tag: "div" }, metadata: {} };

async function editing(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-style-order-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const running = await pool.open(root);
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  await ok(running.call("POST", "/api/edit", { baseRevision: 0, intent: "Add", operations: [
    { type: "insert-node", parentId: null, index: 0, node: page },
    { type: "insert-node", parentId: "page", index: 0, node: box },
  ] }), "insert");
  return running;
}

test("a change event's operations are in the journal's key order", async (t) => {
  const running = await editing(t);
  const event = await ok(running.call("POST", "/api/edit", { baseRevision: 1, intent: "Margins", operations: [{ type: "set-props", nodeId: "box", set: { style: { "margin-left": "5px", margin: "0px" } } }] }), "edit");
  assert.deepEqual(Object.keys(event.operations[0].set.style), ["margin", "margin-left"]);
  const { document } = await ok(running.call("GET", "/api/document"), "document");
  assert.deepEqual(Object.keys(document.nodes.box.props.style), Object.keys(event.operations[0].set.style), "the stored document has the same order");
});

test("the editor draws a style the same live and after a reload", browserTestOptions(), async (t) => {
  const running = await editing(t);
  const editor = await openEditor(running.host);
  t.after(() => editor.close());
  await waitRevision(editor.page, 1);
  // A longhand before its shorthand, as a caller may send them.
  await ok(running.call("POST", "/api/edit", { baseRevision: 1, intent: "Margins", operations: [{ type: "set-props", nodeId: "box", set: { style: { "margin-left": "5px", margin: "0px" } } }] }), "edit");
  await waitRevision(editor.page, 2);
  const live = await rendered(editor.page, "box", "margin-left");
  await reloadEditor(editor.page, editor.pending);
  await waitRevision(editor.page, 2);
  assert.equal(live, await rendered(editor.page, "box", "margin-left"), "the same left margin live and after a reload");
  // #294: the longhand refines its shorthand, whatever order it was sent or stored in. The
  // journal stores bottom before inset, so only applying the shorthand first keeps it.
  assert.equal(live, "5px");
  await ok(running.call("POST", "/api/edit", { baseRevision: 2, intent: "Inset", operations: [{ type: "set-props", nodeId: "box", set: { style: { position: "absolute", inset: "1px", bottom: "7px" } } }] }), "inset");
  await waitRevision(editor.page, 3);
  assert.equal(await rendered(editor.page, "box", "bottom"), "7px");
  assert.equal(await rendered(editor.page, "box", "top"), "1px");
  await reloadEditor(editor.page, editor.pending);
  await waitRevision(editor.page, 3);
  assert.equal(await rendered(editor.page, "box", "bottom"), "7px", "the same after a reload");
  // A shorthand marked !important is not refined by a plain longhand, as in CSS.
  await ok(running.call("POST", "/api/edit", { baseRevision: 3, intent: "Important", operations: [{ type: "set-props", nodeId: "box", set: { style: { margin: "1px !important", "margin-left": "5px" } } }] }), "important");
  await waitRevision(editor.page, 4);
  assert.equal(await rendered(editor.page, "box", "margin-left"), "1px");
  assert.deepEqual(editor.foreign, []);
  assert.deepEqual(editor.errors, []);
});

// #294 (decided in P09): a shorthand applies before its own longhands, so a longhand always
// refines it; every other entry keeps its place, so styles without such a pair are unchanged.
test("a style's shorthands come before their longhands, and nothing else moves", () => {
  assert.deepEqual(Object.keys(shorthandsFirst({ "margin-left": "5px", margin: "0px", color: "red" })), ["margin", "margin-left", "color"]);
  assert.deepEqual(Object.keys(shorthandsFirst({ bottom: "0px", inset: "1px", left: "2px" })), ["inset", "bottom", "left"]);
  assert.deepEqual(Object.keys(shorthandsFirst({ "column-gap": "1px", gap: "2px", "row-gap": "3px" })), ["gap", "column-gap", "row-gap"]);
  assert.deepEqual(Object.keys(shorthandsFirst({ "border-top-color": "red", border: "1px solid", "border-top": "2px solid" })), ["border", "border-top", "border-top-color"]);
  assert.deepEqual(Object.keys(shorthandsFirst({ "flex-direction": "row", "flex-flow": "column", "align-items": "a", "place-items": "b" })), ["flex-flow", "flex-direction", "place-items", "align-items"]);
  assert.deepEqual(Object.keys(shorthandsFirst({ "line-height": "2", font: "16px serif", "border-top-left-radius": "1px", "border-radius": "2px" })), ["font", "line-height", "border-radius", "border-top-left-radius"]);
  assert.deepEqual(Object.keys(shorthandsFirst({ "border-block-start-color": "red", "border-block-color": "blue" })), ["border-block-color", "border-block-start-color"]);
  // Shorthands keep their order among themselves: of two overlapping ones, the later still wins.
  assert.deepEqual(Object.keys(shorthandsFirst({ "border-left-color": "red", "border-top": "1px solid", "border-color": "blue" })), ["border-top", "border-color", "border-left-color"]);
  // Logical and physical names are not paired.
  assert.equal(isLonghandOf("bottom", "inset-block"), false);
  // Unrelated names, and custom properties, keep their order.
  const plain = { width: "1px", "background-color": "red", color: "blue", "--margin": "1px", margin: "0px" };
  assert.deepEqual(Object.keys(shorthandsFirst(plain)), Object.keys(plain));
  assert.equal(isLonghandOf("margin-left", "margin"), true);
  assert.equal(isLonghandOf("top", "inset"), true);
  assert.equal(isLonghandOf("margin", "margin-left"), false);
  assert.equal(isLonghandOf("--margin-left", "--margin"), false);
  // The canvas's plan and code export use the same order.
  const node = { id: "n", type: "element", parentId: null, children: [], props: { tag: "div", style: { "margin-left": "5px", margin: "0px" } }, metadata: {} };
  assert.deepEqual(Object.keys(planElement(node).style), ["margin", "margin-left"]);
  const exported = exportJsx({ id: "d", revision: 0, rootIds: ["n"], nodes: { n: node } }, "n").code;
  assert.match(exported, /style="margin: 0px; margin-left: 5px"/u);
});

test("a code write-back writes a style's longhands after their shorthands, as the canvas draws it", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-style-writeback-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const code = join(root, "code");
  mkdirSync(code);
  mkdirSync(join(root, "projects"));
  const file = join(code, "Panel.jsx");
  writeFileSync(file, 'export function Panel() {\n  return <div style="bottom: 1px">Hi</div>;\n}\n');
  const running = await pool.open(join(root, "projects"));
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  await ok(running.call("POST", "/api/codebase/connect", { folder: code }), "connect");
  await ok(running.call("POST", "/api/codebase/import", { file: "Panel.jsx", component: "Panel" }), "import");
  const div = Object.values(running.host.session.document.nodes).find((node) => node.props?.tag === "div" && node.props?.codeSource);
  await ok(running.call("POST", "/api/edit", { baseRevision: running.host.session.revision, intent: "Inset", operations: [{ type: "set-props", nodeId: div.id, set: { style: { bottom: "1px", inset: "0px" } } }] }), "edit");
  const preview = await ok(running.call("POST", "/api/codebase/preview", { nodeId: div.id }), "preview");
  await ok(running.call("POST", "/api/codebase/write", { nodeId: div.id, token: preview.token }), "write");
  assert.match(readFileSync(file, "utf8"), /style="inset: 0px; bottom: 1px"/u, "bottom still refines inset in the file");
});
