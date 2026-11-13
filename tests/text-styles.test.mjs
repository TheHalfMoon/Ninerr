import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { client, ok } from "./support/host-api.mjs";

// Text styles: a layer's typography saved as a marked class rule in its page's stylesheet, and
// applied to other layers by name. The canvas draws them through the stylesheet; export carries it.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 14, 2, 0, 0) + clock++ * 1000).toISOString();
// The page's own rules. One is not only typography, one is inside an at-rule, one is typography
// alone but not written as a text style (a utility class), one is more specific than a class,
// inside a card, and one holds a brace in a string. Of the two marked rules, .boxy is not
// typography; .lead, just after a statement, is the page's one text style.
const SHEET = [
  "@charset \"utf-8\";",
  ".card { padding: 8px; color: red; }",
  "@media (min-width: 1px) { .wide { color: blue; } }",
  ".text-white { color: #ffffff; }",
  ".card h3 { font-size: 10px; }",
  ".quote::before { content: \"{\"; }",
  "/* ninerr text style */",
  ".boxy { padding: 2px; }",
  "@layer base, theme;",
  "/* ninerr text style */",
  ".lead { font-size: 18px; }",
].join("\n");

test("save a layer's typography as a text style, apply it to another layer, and take it off; what would draw differently is refused", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-text-styles-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("styles");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    const call = client(host.url, host.token);
    const { document } = await ok(call("GET", "/api/document"), "document");
    await ok(call("POST", "/api/edit", { baseRevision: document.revision, intent: "A page with texts", operations: [
      { type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: "page", type: "frame", props: { name: "Page", style: { width: "400px" }, stylesheet: SHEET } } },
      { type: "insert-node", parentId: "page", index: 0, node: { id: "title", type: "text", props: { tag: "h2", text: "Pricing", style: { margin: "0px", "font-family": "Georgia, serif", "font-size": "32px", "font-weight": "700" } } } },
      { type: "insert-node", parentId: "page", index: 1, node: { id: "other", type: "text", props: { tag: "p", text: "Plans", attributes: { class: "text-white" }, style: { margin: "0px", "font-size": "12px" } } } },
      { type: "insert-node", parentId: "page", index: 2, node: { id: "card", type: "element", props: { tag: "div", attributes: { class: "card" } } } },
      { type: "insert-node", parentId: "card", index: 0, node: { id: "inner", type: "text", props: { tag: "h3", text: "Pro", style: { "font-size": "40px" } } } },
      { type: "insert-node", parentId: null, index: document.rootIds.length + 1, node: { id: "lone", type: "text", props: { tag: "p", text: "Alone", style: { "font-size": "20px" } } } },
    ] }), "page");
    await waitRevision(page, 1);
    const select = (id) => page.locator(`#layers [role=treeitem][data-node-id="${id}"] > .row`).click();
    const fontOf = (id) => page.evaluate((nodeId) => {
      const element = document.querySelector("iframe").contentDocument.querySelector(`[data-ninerr-id="${nodeId}"]`);
      const style = element.ownerDocument.defaultView.getComputedStyle(element);
      return [style.fontFamily, style.fontSize, style.fontWeight];
    }, id);
    const status = (text) => page.waitForFunction((expected) => document.getElementById("status").textContent === expected, text);
    const stored = async () => (await ok(call("GET", "/api/document"), "document")).document;

    // A text with no page around it has no text style controls.
    await select("lone");
    await page.locator("#inspect-text-style").waitFor();
    assert.equal(await page.locator("#inspect-text-style-new").count(), 0);

    // A name that is not one is refused, saying so.
    await select("title");
    await page.locator("#inspect-text-style-new").fill("Big Heading");
    await page.locator("#inspect-text-style-save").click();
    await status("Not saved: a text style's name is lowercase letters, digits and hyphens, starting with a letter.");
    assert.deepEqual(await page.locator("#inspect-text-style-name option").evaluateAll((all) => all.map((option) => option.value)), ["", "lead"], "only a marked rule of typography alone is a text style");

    // Saved: the marked rule is in the page's stylesheet, the layer has the class, its own style
    // lost those declarations, and the canvas draws it the same.
    await page.locator("#inspect-text-style-new").fill("heading");
    await page.locator("#inspect-text-style-save").click();
    await waitRevision(page, 2);
    let doc = await stored();
    assert.equal(doc.nodes.page.props.stylesheet, `${SHEET}\n/* ninerr text style */\n.heading { font-family: Georgia, serif; font-size: 32px; font-weight: 700; }`);
    assert.deepEqual([doc.nodes.title.props.attributes, doc.nodes.title.props.style], [{ class: "heading" }, { margin: "0px" }]);
    assert.deepEqual(await fontOf("title"), ["Georgia, serif", "32px", "700"]);
    assert.deepEqual(await page.locator("#inspect-text-style-name option").evaluateAll((all) => all.map((option) => option.value)), ["", "lead", "heading"]);

    // Saved again: its typography is now the text style's, so it has none of its own to save.
    await page.locator("#inspect-text-style-new").fill("heading");
    await page.locator("#inspect-text-style-save").click();
    await status("Not saved: this layer has no typography of its own to save (font, size, weight, line height, letter spacing, case or colour).");

    // Applied to another layer by name: its own value for what the style sets gives way, its
    // utility class stays, and it draws the same. None takes the style off, nothing else.
    await select("other");
    await page.locator("#inspect-text-style-name").selectOption("heading");
    await waitRevision(page, 3);
    doc = await stored();
    assert.deepEqual([doc.nodes.other.props.attributes, doc.nodes.other.props.style], [{ class: "text-white heading" }, { margin: "0px" }]);
    assert.deepEqual(await fontOf("other"), ["Georgia, serif", "32px", "700"]);
    await select("other");
    await page.locator("#inspect-text-style-name").selectOption("");
    await waitRevision(page, 4);
    assert.deepEqual((await stored()).nodes.other.props.attributes, { class: "text-white" });

    // A more specific rule of the page (.card h3) would beat the class where the layer's own
    // style beat it: refused, saying what would change.
    await select("inner");
    await page.locator("#inspect-text-style-new").fill("big");
    await page.locator("#inspect-text-style-save").click();
    await status("Not saved: as a class, a rule of this page would draw it differently (font-size: 40px → 10px).");

    // A name already a rule in the stylesheet is refused.
    await ok(call("POST", "/api/edit", { baseRevision: 4, intent: "Typography", operations: [{ type: "set-props", nodeId: "other", set: { style: { margin: "0px", "font-size": "12px" } } }] }), "typography");
    await waitRevision(page, 5);
    await select("other");
    await page.locator("#inspect-text-style-new").fill("card");
    await page.locator("#inspect-text-style-save").click();
    await status("Not saved: the page's stylesheet already has a rule for .card.");
    assert.equal((await stored()).revision, 5, "nothing refused was stored");

    // Export carries the page's stylesheet with the rule, and the class.
    const exported = await ok(call("POST", "/api/code/export", { nodeId: "page" }), "export");
    assert.match(exported.stylesheet ?? "", /\.heading \{ font-family: Georgia, serif; font-size: 32px; font-weight: 700; \}/u);
    assert.match(exported.code, /<h2 className="heading"/u);
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
