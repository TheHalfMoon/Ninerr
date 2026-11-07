import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, rendered, waitRevision, reloadEditor } from "./support/editor.mjs";
import { hostPool, ok } from "./support/host-api.mjs";
import { isImportant, isLonghandOf, planElement, shorthandsFirst, withoutOverriddenLonghands } from "../packages/renderer/src/index.mjs";
import { exportJsx, importJsx } from "../packages/studio-host/src/code.ts";
import { importedStyle, styleOutOfWrittenOrder } from "../packages/studio-host/src/imports.ts";

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
  // #294: the longhand refines its shorthand, whatever order it was sent or stored in.
  assert.equal(live, "5px");
  await ok(running.call("POST", "/api/edit", { baseRevision: 2, intent: "Inset", operations: [{ type: "set-props", nodeId: "box", set: { style: { position: "absolute", inset: "1px", bottom: "7px" } } }] }), "inset");
  await waitRevision(editor.page, 3);
  // The journal stores bottom before inset, so only applying the shorthand first keeps it.
  assert.equal(await rendered(editor.page, "box", "bottom"), "7px");
  assert.equal(await rendered(editor.page, "box", "top"), "1px");
  await reloadEditor(editor.page, editor.pending);
  await waitRevision(editor.page, 3);
  assert.equal(await rendered(editor.page, "box", "bottom"), "7px", "the same after a reload");
  // A shorthand marked !important is not refined by a plain longhand, as in CSS.
  await ok(running.call("POST", "/api/edit", { baseRevision: 3, intent: "Important", operations: [{ type: "set-props", nodeId: "box", set: { style: { margin: "1px !important", "margin-left": "5px" } } }] }), "important");
  await waitRevision(editor.page, 4);
  assert.equal(await rendered(editor.page, "box", "margin-left"), "1px");
  // An important declaration also wins where shorthands overlap: border-color is plain, so it
  // must not take back border-bottom's important colour, though the journal's order puts it later.
  await ok(running.call("POST", "/api/edit", { baseRevision: 4, intent: "Borders", operations: [{ type: "set-props", nodeId: "box", set: { style: { "border-bottom": "3px solid rgb(255, 0, 0) !important", "border-color": "rgb(0, 0, 255)", "border-style": "solid" } } }] }), "borders");
  await waitRevision(editor.page, 5);
  assert.equal(await rendered(editor.page, "box", "border-bottom-color"), "rgb(255, 0, 0)");
  assert.equal(await rendered(editor.page, "box", "border-left-color"), "rgb(0, 0, 255)");
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
  // A logical side and a physical side are not paired; a physical shorthand is refined by its
  // logical parts.
  assert.equal(isLonghandOf("bottom", "inset-block"), false);
  assert.equal(isLonghandOf("margin-left", "margin-inline"), false);
  assert.deepEqual(Object.keys(shorthandsFirst({ "margin-inline": "5px", margin: "0px" })), ["margin", "margin-inline"]);
  // A longhand already after its shorthand stays where it stands.
  assert.deepEqual(Object.keys(shorthandsFirst({ margin: "0px", color: "red", "margin-left": "1px" })), ["margin", "color", "margin-left"]);
  // One waits for the last of its shorthands, wherever they stand.
  assert.deepEqual(Object.keys(shorthandsFirst({ "border-top-color": "red", color: "red", "border-top": "1px solid", border: "0" })), ["color", "border", "border-top", "border-top-color"]);
  // Vendor-prefixed shorthands pair with their own longhands.
  assert.deepEqual(Object.keys(shorthandsFirst({ "-webkit-mask-image": "none", "-webkit-mask": "none" })), ["-webkit-mask", "-webkit-mask-image"]);
  // Unrelated names, and custom properties, keep their order.
  const plain = { width: "1px", "background-color": "red", color: "blue", "--margin": "1px", margin: "0px" };
  assert.equal(shorthandsFirst(plain), plain, "a style with no pair is returned as it is");
  assert.equal(isLonghandOf("margin-left", "margin"), true);
  assert.equal(isLonghandOf("top", "inset"), true);
  assert.equal(isLonghandOf("margin", "margin-left"), false);
  assert.equal(isLonghandOf("--margin-left", "--margin"), false);
  // The canvas's plan and code export use the same order.
  const node = { id: "n", type: "element", parentId: null, children: [], props: { tag: "div", style: { "margin-left": "5px", margin: "0px" } }, metadata: {} };
  assert.deepEqual(Object.keys(planElement(node).style), ["margin", "margin-left"]);
  const exported = exportJsx({ id: "d", revision: 0, rootIds: ["n"], nodes: { n: node } }, "n").code;
  assert.match(exported, /style=\{\{ margin: "0px", marginLeft: "5px" \}\}/u);
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

// #360: a longhand written before its own shorthand is overridden by it. Import keeps what the
// declaration means, since the canvas applies shorthands first whatever the stored order.
test("a longhand a later shorthand overrides does not come into the layer", () => {
  const style = (cssText) => importedStyle({ cssText });
  assert.deepEqual(style("bottom: 1px; inset: 0px"), { inset: "0px" });
  assert.deepEqual(style("inset: 0px; bottom: 1px"), { inset: "0px", bottom: "1px" });
  assert.deepEqual(style("margin-left: 5px; margin: 0px; color: red"), { margin: "0px", color: "red" });
  // Written again, a name takes the later place: margin overrides margin-left here too.
  assert.deepEqual(style("margin: 1px; margin-left: 5px; margin: 2px"), { margin: "2px" });
  // Important, as in CSS.
  assert.deepEqual(style("margin-left: 5px !important; margin: 0px"), { "margin-left": "5px !important", margin: "0px" });
  assert.deepEqual(style("margin-left: 5px; margin: 0px !important"), { margin: "0px !important" });
  assert.deepEqual(style("margin-left: 5px !important; margin: 0px !important"), { margin: "0px !important" });
  assert.deepEqual(Object.keys(style("margin-left: 5px !important /* c */; margin: 0px")), ["margin-left", "margin"]);
  // A plain repeat does not beat an important declaration of the same name.
  assert.deepEqual(style("color: red !important; color: blue"), { color: "red !important" });
  // Linear: one style of 20,000 declarations must not hold the host (85 s when quadratic).
  const many = Array.from({ length: 20_000 }, (_, index) => `--x${index}: 1`).join("; ");
  const started = performance.now();
  assert.equal(Object.keys(style(`${many}; margin: 0px`)).length, 20_001);
  assert.ok(performance.now() - started < 5_000, "a style's size does not stall the host");
  // Real pairs too, through the order the canvas applies them.
  const pairs = Object.fromEntries(Array.from({ length: 20_000 }, (_, index) => [`margin-a${index}`, "1px"]));
  const ordering = performance.now();
  assert.equal(Object.keys(shorthandsFirst({ ...pairs, margin: "0px" }))[0], "margin");
  assert.ok(performance.now() - ordering < 5_000, "ordering a large style does not stall the host");
  // A long run of comments after a value must not take exponential time to read.
  const comments = performance.now();
  assert.equal(isImportant(`red !important${"/**/".repeat(490)}x`), false);
  assert.equal(isImportant(`red !important${"/**/".repeat(490)}`), true);
  assert.ok(performance.now() - comments < 1_000, "reading !important takes no exponential time");
  // Overlapping shorthands and unrelated names stay: neither is the other's longhand.
  assert.deepEqual(Object.keys(style("border-color: red; border-top: 1px solid")), ["border-color", "border-top"]);
  assert.deepEqual(Object.keys(style("--margin-left: 1px; --margin: 2px")), ["--margin-left", "--margin"]);
  const plain = { color: "red" };
  assert.equal(withoutOverriddenLonghands(plain), plain, "nothing overridden: the same object");
  // A name that starts with a shorthand's but that the shorthand does not reset stays.
  for (const [name, shorthand] of [
    ["flex-direction", "flex"], ["flex-wrap", "flex"], ["flex-flow", "flex"],
    ["border-collapse", "border"], ["border-spacing", "border"], ["outline-offset", "outline"],
    ["overflow-wrap", "overflow"], ["overflow-anchor", "overflow"], ["background-blend-mode", "background"],
    ["grid-row", "grid"], ["grid-column", "grid"], ["grid-area", "grid"], ["grid-gap", "grid"],
    ["text-decoration-skip-ink", "text-decoration"], ["font-synthesis", "font"], ["border-radius", "border"],
  ]) {
    const written = `${name}: initial; ${shorthand}: inherit`;
    assert.deepEqual(Object.keys(style(written)), [name, shorthand], written);
  }
  // And one it does reset goes, as far down as it reaches. Kept, it would win: the store's
  // sorted order puts a longhand after a shorthand its name starts with.
  for (const [name, shorthand] of [
    ["border-block-start", "border-block"], ["background-position-x", "background-position"], ["font-variant-caps", "font-variant"],
    ["column-rule-width", "column-rule"], ["overscroll-behavior-x", "overscroll-behavior"], ["text-emphasis-color", "text-emphasis"],
    ["white-space-collapse", "white-space"], ["text-wrap-mode", "text-wrap"], ["animation-timeline", "animation"], ["offset-path", "offset"],
    ["flex-grow", "flex"], ["border-top-color", "border"], ["border-top-color", "border-top"], ["border-top", "border"], ["border-image-source", "border"],
    ["border-top-left-radius", "border-radius"], ["grid-template-rows", "grid"], ["grid-row-start", "grid-area"], ["grid-row-start", "grid-row"],
    ["overflow-x", "overflow"], ["background-position-x", "background"], ["line-height", "font"], ["font-size", "font"],
    ["margin-inline-start", "margin"], ["margin-inline-start", "margin-inline"], ["top", "inset"], ["row-gap", "gap"], ["outline-color", "outline"],
  ]) {
    const written = `${name}: initial; ${shorthand}: inherit`;
    assert.deepEqual(Object.keys(style(written)), [shorthand], written);
  }
  // Code import, as the layer and through export.
  const nodes = importJsx('export function A() { return <div style="bottom: 1px; inset: 0px; left: 2px">a</div>; }').operations[0].nodes;
  assert.deepEqual(nodes[1].props.style, { inset: "0px", left: "2px" });
});

test("what a style draws is the same as written, on the canvas, and after export and reimport", browserTestOptions(), async (t) => {
  const running = await editing(t);
  const editor = await openEditor(running.host);
  t.after(() => editor.close());
  await waitRevision(editor.page, 1);
  const sources = [
    "position: absolute; bottom: 1px; inset: 0px",
    "position: absolute; inset: 0px; bottom: 1px",
    "margin-left: 5px; margin: 0px",
    "margin: 0px; margin-left: 5px",
    "margin: 1px; margin-left: 5px; margin: 2px",
    "margin-left: 5px !important; margin: 0px",
    "column-gap: 1px; gap: 2px",
    "border-block-start: 1px solid rgb(1, 2, 3); border-block: 2px solid rgb(4, 5, 6)",
    "background-position-x: 5px; background-position: 0px 0px",
    "font-variant-caps: small-caps; font-variant: normal",
    "display: flex; flex-direction: column; flex: 1",
    "border-radius: 8px; border: 1px solid rgb(1, 2, 3)",
    "outline-offset: 3px; outline: 1px solid rgb(1, 2, 3)",
    "border-top-color: rgb(1, 2, 3); border: 1px solid rgb(4, 5, 6)",
  ];
  const properties = ["position", "top", "bottom", "margin-left", "margin-top", "column-gap", "row-gap", "border-top-color", "border-left-color", "flex-direction", "flex-grow", "border-top-left-radius", "outline-offset", "border-top-width", "background-position-x", "font-variant-caps"];
  // A probe beside the layer, in the canvas's own document, with the style as written.
  const computed = (css) => editor.page.evaluate(([style, names]) => {
    const canvas = document.querySelector("iframe").contentDocument;
    const box = canvas.querySelector('[data-ninerr-id="box"]');
    const probe = canvas.createElement("div");
    probe.setAttribute("style", style);
    box.parentElement.append(probe);
    const values = Object.fromEntries(names.map((name) => [name, canvas.defaultView.getComputedStyle(probe).getPropertyValue(name)]));
    probe.remove();
    return values;
  }, [css, properties]);
  const drawn = () => editor.page.evaluate((names) => {
    const canvas = document.querySelector("iframe").contentDocument;
    const style = canvas.defaultView.getComputedStyle(canvas.querySelector('[data-ninerr-id="box"]'));
    return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]));
  }, properties);
  const cssOf = (style) => Object.entries(shorthandsFirst(style)).map(([name, value]) => `${name}: ${value}`).join("; ");
  let revision = 1;
  for (const source of sources) {
    const written = await computed(source);
    const style = importJsx(`export function A() { return <div style="${source}">a</div>; }`).operations[0].nodes[1].props.style;
    await ok(running.call("POST", "/api/edit", { baseRevision: revision, intent: "Style", operations: [{ type: "set-props", nodeId: "box", set: { style } }] }), source);
    revision += 1;
    await waitRevision(editor.page, revision);
    assert.deepEqual(await drawn(), written, `${source}: on the canvas`);
    const code = exportJsx(running.host.session.document, "box").code;
    const again = importJsx(code).operations[0].nodes[1].props.style;
    assert.deepEqual(await computed(cssOf(again)), written, `${source}: after export and reimport`);
  }
  assert.deepEqual(editor.errors, []);
});

test("a dead longhand in a file is no edit: an untouched style is never written back", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-style-dead-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const code = join(root, "code");
  mkdirSync(code);
  mkdirSync(join(root, "projects"));
  const file = join(code, "Panel.jsx");
  const source = 'export function Panel() {\n  return <div style="bottom: 1px; inset: 0px" title="a">Hi</div>;\n}\n';
  writeFileSync(file, source);
  const running = await pool.open(join(root, "projects"));
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  await ok(running.call("POST", "/api/codebase/connect", { folder: code }), "connect");
  await ok(running.call("POST", "/api/codebase/import", { file: "Panel.jsx", component: "Panel" }), "import");
  const div = Object.values(running.host.session.document.nodes).find((node) => node.props?.tag === "div" && node.props?.codeSource);
  assert.deepEqual(div.props.style, { inset: "0px" });
  const untouched = await ok(running.call("POST", "/api/codebase/preview", { nodeId: div.id }), "preview");
  assert.equal(untouched.diff ?? "", "", "nothing to write");
  // Another field written back leaves the style exactly as the file has it.
  await ok(running.call("POST", "/api/edit", { baseRevision: running.host.session.revision, intent: "Title", operations: [{ type: "set-props", nodeId: div.id, set: { attributes: { title: "b" } } }] }), "edit");
  const preview = await ok(running.call("POST", "/api/codebase/preview", { nodeId: div.id }), "preview");
  await ok(running.call("POST", "/api/codebase/write", { nodeId: div.id, token: preview.token }), "write");
  assert.equal(readFileSync(file, "utf8"), source.replace('title="a"', 'title="b"'));
});

test("a longhand added after import is an edit, and an untouched style with one is not", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-style-added-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const code = join(root, "code");
  mkdirSync(code);
  mkdirSync(join(root, "projects"));
  const added = join(code, "Added.jsx");
  writeFileSync(added, 'export function Added() {\n  return <div style="inset: 0px">Hi</div>;\n}\n');
  const kept = join(code, "Kept.jsx");
  const keptSource = 'export function Kept() {\n  return <section style="inset: 0px; bottom: 1px">Hi</section>;\n}\n';
  writeFileSync(kept, keptSource);
  const running = await pool.open(join(root, "projects"));
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  await ok(running.call("POST", "/api/codebase/connect", { folder: code }), "connect");
  await ok(running.call("POST", "/api/codebase/import", { file: "Added.jsx", component: "Added" }), "import");
  await ok(running.call("POST", "/api/codebase/import", { file: "Kept.jsx", component: "Kept" }), "import");
  const bound = (tag) => Object.values(running.host.session.document.nodes).find((node) => node.props?.tag === tag && node.props?.codeSource);
  // bottom sorts before inset in the store, but it refines inset: a real edit, written back.
  await ok(running.call("POST", "/api/edit", { baseRevision: running.host.session.revision, intent: "Bottom", operations: [{ type: "set-props", nodeId: bound("div").id, set: { style: { inset: "0px", bottom: "2px" } } }] }), "edit");
  const edit = await ok(running.call("POST", "/api/codebase/preview", { nodeId: bound("div").id }), "preview");
  await ok(running.call("POST", "/api/codebase/write", { nodeId: bound("div").id, token: edit.token }), "write");
  assert.match(readFileSync(added, "utf8"), /style="inset: 0px; bottom: 2px"/u);
  // And the same pair, untouched, is nothing to write.
  const untouched = await ok(running.call("POST", "/api/codebase/preview", { nodeId: bound("section").id }), "preview");
  assert.equal(untouched.diff ?? "", "");
  assert.equal(readFileSync(kept, "utf8"), keptSource);
});

test("the HTML import review says when a style loses a longhand its shorthand overrides", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-style-note-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const running = await pool.open(root);
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  const review = await ok(running.call("POST", "/api/import", { html: '<main><p style="bottom: 1px; inset: 0px">a</p><p style="inset: 0px; bottom: 1px">b</p></main>', name: "Page" }), "review");
  assert.ok(review.notes.includes("1 layer has style properties left out that a later shorthand in the same style overrides; the layer looks the same."), JSON.stringify(review.notes));
  await ok(running.call("POST", "/api/import/commit", { proposalId: review.proposalId }), "commit");
  const styles = Object.values(running.host.session.document.nodes).filter((node) => node.props?.tag === "p").map((node) => node.props.style);
  // Layer ids are random, so the two come in either order.
  assert.deepEqual(styles.sort((a, b) => Object.keys(a).length - Object.keys(b).length), [{ inset: "0px" }, { inset: "0px", bottom: "1px" }]);
});

// #370, case 4: a browser reads comments, strings and parentheses, so a style's own reader must.
test("a style's semicolons end declarations only outside comments, strings and parentheses", () => {
  const style = (cssText) => importedStyle({ cssText });
  assert.deepEqual(style("margin-left: 5px !important/*; margin: 0px"), { "margin-left": "5px !important" }, "a comment left open runs to the end");
  assert.deepEqual(style("color: red /* ; margin: 0 */; top: 1px"), { color: "red", top: "1px" });
  assert.deepEqual(style("/* a: b; */ color: red"), { color: "red" });
  assert.deepEqual(style("margin-left: 5px; /* margin: 0 */"), { "margin-left": "5px" }, "a shorthand in a comment overrides nothing");
  assert.deepEqual(style('content: "a;b"; color: red'), { content: '"a;b"', color: "red" });
  assert.deepEqual(style('content: "a\\";b"; color: red'), { content: '"a\\";b"', color: "red" });
  assert.deepEqual(style("background: url(data:image/png;base64,AAAA); color: red"), { background: "url(data:image/png;base64,AAAA)", color: "red" });
  assert.deepEqual(style("background: url(a/*b*/c); color: red"), { background: "url(a/*b*/c)", color: "red" }, "not a comment inside url()");
  assert.deepEqual(style("color: red; ;; top: 1px;"), { color: "red", top: "1px" });
  assert.deepEqual(style("width: 1/**/px; top: 1px"), { width: "1 px", top: "1px" }, "a comment separates what it stands between");
  // Linear: a long string of comments does not hold the host.
  const started = performance.now();
  assert.deepEqual(style(`${"/*x*/".repeat(100_000)}color: red`), { color: "red" });
  assert.deepEqual(style(`color: red${" /* x".repeat(100_000)}`), { color: "red" });
  // 14.8 s for the first of these when the reader re-read its growing value at each bracket.
  for (const piece of ["(", "a(", "(a)", "url()", "\\\\", '"', "/**/", "["]) style(`x: ${piece.repeat(Math.floor(256 * 1024 / piece.length))}; top: 1px`);
  assert.ok(performance.now() - started < 2_000);
});

// Compared with a browser, so that this reader cannot drift from what a style means: the page
// reads each style itself, and this reader's result, applied, must give the same values.
test("a style reads the same here as in a browser, however odd", browserTestOptions(), async (t) => {
  const running = await editing(t);
  const editor = await openEditor(running.host);
  t.after(() => editor.close());
  const { page } = editor;
  await waitRevision(page, 1);
  const names = ["color", "top", "width", "background-image", "font-family", "margin-left", "margin-top"];
  const read = (cssText) => page.evaluate(([text, wanted]) => {
    const probe = document.createElement("div");
    probe.style.cssText = text;
    return Object.fromEntries(wanted.map((name) => [name, probe.style.getPropertyValue(name)]));
  }, [cssText, names]);
  // This reader's result, applied as the canvas applies it: one property at a time, in its order.
  const applied = (style) => page.evaluate(([entries, wanted]) => {
    const probe = document.createElement("div");
    for (const [name, value] of entries) {
      const important = /!\s*important\s*$/iu.test(value);
      probe.style.setProperty(name, value.replace(/!\s*important\s*$/iu, "").trim(), important ? "important" : "");
    }
    return Object.fromEntries(wanted.map((name) => [name, probe.style.getPropertyValue(name)]));
  }, [Object.entries(shorthandsFirst(style)), names]);
  for (const cssText of [
    "color: red; top: 1px",
    "width: calc(1px /* don't */ + 2px); color: red",
    "width: calc(1px /* \" */ + 2px); color: red",
    "width: calc(1px /* ( */ + 2px); color: red",
    "background-image: url(a'b); color: red",
    'background-image: url(a"b); color: red',
    "background-image: url(a;b); color: red",
    "background-image: url( a/*b*/c ); color: red",
    'background-image: url("a;b"); color: red',
    "BACKGROUND-IMAGE: URL(a;b); color: red",
    'font-family: "a\n; color: red; top: 1px',
    'font-family: "a\r\n; color: red; top: 1px',
    "color: red\\\"; top: 1px",
    "x: \\(; top: 1px",
    "width: 1px\\/*; top: 1px",
    "x: [a; color: red; b]; top: 1px",
    "x: {a; color: red; b}; top: 1px",
    "color: red; x: (((; top: 1px",
    "x: ); top: 1px",
    "x: (]); top: 1px",
    'font-family: "a;b"; top: 1px',
    "top: 1px /* a; color: red */",
    "/* open; top: 1px",
    `font-family: url(${" ".repeat(100)}"a)b"); top: 1px; color: red`,
    'x: url( "a)b); top: 1px',
    "x: xurl(a'b); top: 1px; color: 'red'",
    "x: my-url(/*)*/; color: red; ); top: 1px",
    'font-family: "a\r; color: red; top: 1px',
    'font-family: "a\\\r\nb"; top: 1px; color: red',
    "margin-left: 5px; margin: 0px )",
    "margin-left: 5px; margin: 0px",
    "margin: 0px; margin-left: 5px",
    "margin-left: 5px !important; margin: 0px",
    "color: blue; color: red; color: green",
    "x: URL(a'b); top: 1px; color: red",
    "x: (]; color: red; y: ); top: 1px",
  ]) {
    assert.deepEqual(await applied(importedStyle({ cssText })), await read(cssText), JSON.stringify(cssText));
  }
  assert.deepEqual(editor.errors, []);
});

test("a code import says when it leaves a declaration out, and the file is not changed", browserTestOptions(), async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-style-left-out-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const running = await pool.open(root);
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  const left = 'export function A() { return <main><p style="bottom: 1px; inset: 0px">a</p><p style="inset: 0px; bottom: 1px">b</p></main>; }';
  assert.equal((await ok(running.call("POST", "/api/code/import", { code: left }), "import")).layersWithStyleLeftOut, 1);
  assert.equal((await ok(running.call("POST", "/api/code/import", { code: "export function B() { return <p style=\"inset: 0px; bottom: 1px\">b</p>; }" }), "import")).layersWithStyleLeftOut, 0);
  const editor = await openEditor(running.host);
  t.after(() => editor.close());
  const { page } = editor;
  await waitRevision(page, running.host.session.revision);
  await page.locator("#action-code").click();
  await page.locator("#code-import").fill(left);
  await page.locator("#code-import").press("Tab");
  await page.locator("#dialog[open] form button.primary, #dialog[open] form button[type=submit]").first().click();
  await page.waitForFunction(() => /left out that a later shorthand/u.test(document.getElementById("status")?.textContent ?? ""));
  assert.match(await page.locator("#status").textContent(), /1 layer has style properties left out/u);
  assert.deepEqual(editor.errors, []);
});

// The limit decided in P09 (#369): pinned, so a change to it is noticed, and checked against a
// browser, so that what the import reports is exactly what draws differently.
test("the import reports overlapping properties the canvas draws out of written order", browserTestOptions(), async (t) => {
  const running = await editing(t);
  const editor = await openEditor(running.host);
  t.after(() => editor.close());
  const { page } = editor;
  await waitRevision(page, 1);
  const names = ["border-top-color", "border-left-color", "border-top-left-radius", "margin-left", "top", "row-gap", "flex-direction", "outline-offset"];
  // Computed, since a logical property such as margin-inline only resolves there.
  await page.evaluate(() => {
    window.computed = (probe, wanted) => {
      document.body.append(probe);
      const values = wanted.map((name) => getComputedStyle(probe).getPropertyValue(name)).join("|");
      probe.remove();
      return values;
    };
  });
  const drawn = (entries) => page.evaluate(([list, wanted]) => {
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    // As the renderer applies a style: plain declarations, then important ones.
    const important = (value) => /!\s*important\s*$/iu.test(value);
    for (const [name, value] of list) if (!important(value)) probe.style.setProperty(name, value);
    for (const [name, value] of list) if (important(value)) probe.style.setProperty(name, value.replace(/!\s*important\s*$/iu, "").trim(), "important");
    return computed(probe, wanted);
  }, [entries, names]);
  const browser = (cssText) => page.evaluate(([text, wanted]) => {
    const probe = document.createElement("div");
    probe.style.cssText = `position: absolute; ${text}`;
    return computed(probe, wanted);
  }, [cssText, names]);
  for (const [cssText, reported] of [
    ["border-top: 1px solid blue; border-color: red", true],
    ["border-color: red; border-top: 1px solid blue", false],
    ["margin-left: 1px; margin-inline: 3px", true],
    ["margin-inline: 3px; margin-left: 1px", false],
    ["top: 1px; inset-block: 2px", true],
    ["row-gap: 1px; grid-gap: 2px", true],
    ["border-top: 1px solid blue !important; border-color: red", false],
    ["margin: 0px; margin-left: 5px", false],
    ["margin-left: 5px; margin: 0px", false],
    ["color: red; top: 1px", false],
    // A shorthand does not set everything its name begins: these draw alike, and are not reported.
    ["border-radius: 4px; border: 1px solid red", false],
    ["flex-direction: column; flex: 1", false],
    ["outline-offset: 3px; outline: 1px solid red", false],
    // Importance on both sides settles nothing, so the order still decides.
    ["border-top: 1px solid blue !important; border-color: red !important", true],
    ["margin-left: 1px !important; margin-inline: 3px !important", true],
    ["margin: 11px !important; margin-left: 14px", false],
    ["margin-left: 1px; top: 2px; width: 3px", false],
  ]) {
    const style = importedStyle({ cssText });
    const stored = Object.fromEntries(Object.keys(style).sort().map((name) => [name, style[name]]));
    const canvas = await drawn(Object.entries(shorthandsFirst(stored)));
    assert.equal(styleOutOfWrittenOrder({ cssText }), reported, cssText);
    assert.equal(canvas !== await browser(cssText), reported, `${cssText}: drawn ${canvas}`);
  }
  // Linear in a style's size, with shorthands present so that every name is compared.
  const started = performance.now();
  assert.equal(styleOutOfWrittenOrder({ cssText: `margin: 0; border: 0; ${Array.from({ length: 20_000 }, (_, index) => `x-${index}: 1px`).join(";")}` }), false);
  assert.ok(performance.now() - started < 5_000);
  assert.deepEqual(editor.errors, []);
});

test("the import review and a code import both say when a style may draw differently", async (t) => {
  const running = await editing(t);
  const code = 'export function A() { return <main><p style="border-top: 1px solid blue; border-color: red">a</p><p style="color: red">b</p></main>; }';
  assert.equal((await ok(running.call("POST", "/api/code/import", { code }), "import")).layersWithStyleOutOfOrder, 1);
  assert.equal((await ok(running.call("POST", "/api/code/import", { code: 'export function B() { return <p style="color: red">b</p>; }' }), "import")).layersWithStyleOutOfOrder, 0);
  const review = await ok(running.call("POST", "/api/import", { html: '<main><p style="margin-left: 1px; margin-inline: 3px">a</p><p style="color: red">b</p></main>', name: "Page" }), "review");
  assert.ok(review.notes.includes("1 layer has overlapping style properties that the canvas applies in its own order, so it may draw differently from the source."), JSON.stringify(review.notes));
  const plain = await ok(running.call("POST", "/api/import", { html: '<main><p style="color: red">b</p></main>', name: "Plain" }), "review");
  assert.ok(!plain.notes.some((note) => note.includes("overlapping")), JSON.stringify(plain.notes));
});
