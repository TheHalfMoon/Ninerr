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
    "flex", "flex-col", "items-start", "justify-between", "absolute", "font-bold", "text-center",
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
    "[grid-template-columns:repeat(2,_1fr)]", "[--brand-color:a\\_b]", "[display:table]", "[font-weight:650]",
  ]);
});

test("a double-quoted font name is written single-quoted, and what no class can carry stays a style", () => {
  const { classes, left } = styleToTailwind({ "font-family": "\"Open Sans\", sans-serif", content: "'a\"b'", "grid-template-areas": "\"a\" \"b\"", "grid-area": "x[1]", "--a_b": "1" });
  assert.deepEqual(classes, ["[font-family:'Open_Sans',_sans-serif]", "[grid-template-areas:'a'_'b']"]);
  // A name with an underscore: in a class the underscore would read as a space.
  assert.deepEqual(left, { content: "'a\"b'", "grid-area": "x[1]", "--a_b": "1" });
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
      { type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: "card", type: "frame", props: { name: "Price card", attributes: { class: "card" }, style: { display: "flex", "flex-direction": "column", padding: "12px 16px", "padding-top": "4px", gap: "8px", background: "#fff" } } } },
      { type: "insert-node", parentId: "card", index: 0, node: { id: "title", type: "text", props: { tag: "h2", text: "Pro", style: { "font-weight": "700", "font-family": "\"Open Sans\", sans-serif", "--a_b": "1" } } } },
      { type: "insert-node", parentId: "card", index: 1, node: { id: "plain", type: "text", props: { tag: "p", text: "Plain" } } },
    ] }), "card");
    await waitRevision(page, 1);
    const exported = await ok(call("POST", "/api/code/export-tailwind", { nodeId: "card" }), "export");
    assert.equal(exported.componentName, "PriceCard");
    // In the store's order. padding-top beside padding stays inline, where it wins as on the canvas.
    assert.match(exported.code, /<div className="card \[background:#fff\] flex flex-col gap-\[8px\] \[padding:12px_16px\]" style=\{\{ paddingTop: "4px" \}\}>/u, exported.code);
    assert.match(exported.code, /<h2 className="\[font-family:'Open_Sans',_sans-serif\] font-bold" style=\{\{ "--a_b": "1" \}\}>Pro<\/h2>/u, exported.code);
    assert.match(exported.code, /<p>Plain<\/p>/u, "a layer with no style has no className added");
    assert.deepEqual([exported.classes, exported.keptAsStyle, exported.layers], [7, 2, 3]);
    // The plain JSX export is unchanged: style objects.
    assert.match((await ok(call("POST", "/api/code/export", { nodeId: "card" }), "jsx")).code, /style=\{\{ background: "#fff", display: "flex"/u);

    await page.locator('#layers [role=treeitem][data-node-id="card"] > .row').click();
    await page.locator("#action-code").click();
    await page.locator("#code-export-tailwind").click();
    await page.waitForFunction(() => /^Tailwind code copied: 7 classes; 2 declarations no class can carry kept as style\.$|code box/u.test(document.getElementById("status").textContent));
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(projects, { recursive: true, force: true });
  }
});
