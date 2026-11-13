import test from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { styleToTailwind } from "../packages/code-ir/src/index.ts";
import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { client, ok } from "./support/host-api.mjs";

// A layer's style as Tailwind classes (the Tailwind export): each declaration one class that
// sets exactly what it says. A utility where one says it exactly, an arbitrary value for a
// length, an arbitrary property for anything else, and what no class can carry left as a style.

test("each declaration becomes one class that says exactly what it does", () => {
  const { classes, left } = styleToTailwind({
    display: "flex", "flex-direction": "column", "align-items": "flex-start", "justify-content": "space-between",
    position: "absolute", "font-weight": "700", "text-align": "center",
    padding: "12px", "margin-top": "-4px", gap: "0.5rem", width: "50%", "z-index": "2",
  });
  assert.deepEqual(classes, [
    "flex", "flex-col", "items-start", "justify-between", "absolute", "font-[700]", "text-center",
    "p-[12px]", "mt-[-4px]", "gap-[0.5rem]", "w-[50%]", "z-[2]",
  ]);
  assert.deepEqual(left, {});
});

test("anything a utility does not say exactly is an arbitrary property, with spaces and underscores encoded", () => {
  assert.deepEqual(styleToTailwind({
    padding: "12px 8px", color: "#1d4ed8", background: "linear-gradient(90deg, red, blue)", width: "calc(100% - 2rem)",
    "grid-template-columns": "repeat(2, 1fr)", "--brand-color": "a_b", display: "table", "font-weight": "650",
  }).classes, [
    "[padding:12px_8px]", "[color:#1d4ed8]", "[background:linear-gradient(90deg,_red,_blue)]", "[width:calc(100%_-_2rem)]",
    "[grid-template-columns:repeat(2,_1fr)]", "[--brand-color:a\\_b]", "[display:table]", "font-[650]",
  ]);
});

test("a double-quoted font name is written single-quoted, and what no class can carry stays a style", () => {
  const { classes, left } = styleToTailwind({ "font-family": "\"Open Sans\", sans-serif", content: "'a\"b'", "grid-template-areas": "\"a\" \"b\"", "grid-area": "x[1]", "--a_b": "1" });
  assert.deepEqual(classes, ["[font-family:'Open_Sans',_sans-serif]", "[grid-template-areas:'a'_'b']"]);
  // A name with an underscore: in a class the underscore would read as a space.
  assert.deepEqual(left, { content: "'a\"b'", "grid-area": "x[1]", "--a_b": "1" });
});

test("properties that overlap stay a style, since Tailwind's stylesheet, not their order, decides between classes", () => {
  const left = (style) => Object.keys(styleToTailwind(style).left);
  // A shorthand and its longhand; logical and physical; a side and no side.
  assert.deepEqual(left({ padding: "1px", "padding-top": "2px", color: "red" }), ["padding", "padding-top"]);
  assert.deepEqual(left({ "border-top": "1px solid blue", "border-color": "red" }), ["border-top", "border-color"]);
  assert.deepEqual(left({ "margin-left": "4px", "margin-inline-start": "8px" }), ["margin-left", "margin-inline-start"]);
  assert.deepEqual(left({ width: "10px", "inline-size": "5px" }), ["width", "inline-size"]);
  assert.deepEqual(left({ inset: "0", top: "1px" }), ["inset", "top"]);
  assert.deepEqual(left({ font: "12px serif", "line-height": "2" }), ["font", "line-height"]);
  assert.deepEqual(left({ "place-items": "center", "align-items": "start" }), ["place-items", "align-items"]);
  assert.deepEqual(left({ gap: "1px", "row-gap": "2px" }), ["gap", "row-gap"]);
  assert.deepEqual(left({ all: "unset", color: "red" }), ["all", "color"], "all resets every property");
  assert.deepEqual(left({ background: "red", "background-color": "blue", overflow: "hidden", "overflow-x": "auto" }), ["background", "background-color", "overflow", "overflow-x"]);
  // What does not overlap stays classes: two physical sides, two sizes, align and justify.
  for (const style of [{ top: "1px", left: "2px" }, { "margin-top": "1px", "margin-left": "2px" }, { width: "1px", height: "2px" }, { "align-items": "center", "justify-content": "center" }, { "font-size": "12px", "font-weight": "700" }]) {
    assert.deepEqual(left(style), [], JSON.stringify(style));
  }
});

test("start and end are not the flex-relative utilities; spaces and ampersands are carried exactly", () => {
  assert.deepEqual(styleToTailwind({ "justify-content": "end", "align-items": "start" }).classes, ["[justify-content:end]", "[align-items:start]"]);
  assert.deepEqual(styleToTailwind({ "justify-content": "flex-end" }).classes, ["justify-end"]);
  assert.deepEqual(styleToTailwind({ content: "\"a  b\"" }).classes, ["[content:'a__b']"], "two spaces are two underscores");
  assert.deepEqual(styleToTailwind({ content: "'&'" }), { classes: [], left: { content: "'&'" } }, "an & would be written as a JavaScript string, doubling the backslashes Tailwind reads");
});

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 13, 23, 30, 0) + clock++ * 1000).toISOString();

test("the host exports a layer as JSX with Tailwind classes, keeping its own classes first and what no class carries as style; the editor copies it", browserTestOptions(), async () => {
  const projects = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-tailwind-")));
  const host = await startStudioHost({ projectsRoot: projects, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("tailwind");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    const call = client(host.url, host.token);
    const { document } = await ok(call("GET", "/api/document"), "document");
    await ok(call("POST", "/api/edit", { baseRevision: document.revision, intent: "A card", operations: [
      { type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: "card", type: "frame", props: { name: "Price card", style: { display: "flex", "flex-direction": "column", padding: "12px 16px", "padding-top": "4px", gap: "8px", background: "#fff" } } } },
      { type: "insert-node", parentId: "card", index: 0, node: { id: "title", type: "text", props: { tag: "h2", text: "Pro", style: { "font-weight": "700", "font-family": "\"Open Sans\", sans-serif", "--a_b": "1" } } } },
      { type: "insert-node", parentId: "card", index: 1, node: { id: "plain", type: "text", props: { tag: "p", text: "Plain" } } },
      { type: "insert-node", parentId: "card", index: 2, node: { id: "note", type: "text", props: { tag: "p", text: "Note", attributes: { class: "note" }, style: { color: "red" } } } },
    ] }), "card");
    await waitRevision(page, 1);
    const exported = await ok(call("POST", "/api/code/export-tailwind", { nodeId: "card" }), "export");
    assert.equal(exported.componentName, "PriceCard");
    // In the store's order. padding and padding-top overlap, so both stay inline, where the later
    // wins as on the canvas.
    assert.match(exported.code, /<div className="\[background:#fff\] flex flex-col gap-\[8px\]" style=\{\{ padding: "12px 16px", paddingTop: "4px" \}\}>/u, exported.code);
    assert.match(exported.code, /<h2 className="\[font-family:'Open_Sans',_sans-serif\] font-\[700\]" style=\{\{ "--a_b": "1" \}\}>Pro<\/h2>/u, exported.code);
    // A layer with classes of its own keeps its style inline: a rule for one of them could set the
    // same property, and only an inline style is sure to win.
    assert.match(exported.code, /<p className="note" style=\{\{ color: "red" \}\}>Note<\/p>/u, exported.code);
    assert.match(exported.code, /<p>Plain<\/p>/u, "a layer with no style has no className added");
    assert.deepEqual([exported.classes, exported.keptAsStyle, exported.layers, exported.stylesheetApplies], [6, 4, 4, false]);
    // With a page stylesheet, every style stays inline: its rules could set the same properties.
    await ok(call("POST", "/api/edit", { baseRevision: (await ok(call("GET", "/api/document"), "document")).document.revision, intent: "A stylesheet", operations: [{ type: "set-props", nodeId: "card", set: { stylesheet: "h2 { color: blue; }" } }] }), "stylesheet");
    await waitRevision(page, 2);
    const sheeted = await ok(call("POST", "/api/code/export-tailwind", { nodeId: "card" }), "export with a stylesheet");
    assert.deepEqual([sheeted.classes, sheeted.stylesheetApplies], [0, true]);
    assert.doesNotMatch(sheeted.code, /className="\[/u);
    await ok(call("POST", "/api/edit", { baseRevision: (await ok(call("GET", "/api/document"), "document")).document.revision, intent: "No stylesheet", operations: [{ type: "set-props", nodeId: "card", set: {}, unset: ["stylesheet"] }] }), "unset");
    await waitRevision(page, 3);
    // The plain JSX export is unchanged: style objects.
    assert.match((await ok(call("POST", "/api/code/export", { nodeId: "card" }), "jsx")).code, /style=\{\{ background: "#fff", display: "flex"/u);

    await page.locator('#layers [role=treeitem][data-node-id="card"] > .row').click();
    await page.locator("#action-code").click();
    await page.locator("#code-export-tailwind").click();
    await page.waitForFunction(() => /^Tailwind code copied: 6 classes; 4 declarations kept as style, where a class would not say exactly the same\.$|code box/u.test(document.getElementById("status").textContent));
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(projects, { recursive: true, force: true });
  }
});
