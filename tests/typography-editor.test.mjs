import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { client, ok } from "./support/host-api.mjs";

// The inspector's text section: font (a family, a stack, or a font token), weight, line height,
// letter spacing and alignment, each one change, drawn on the canvas.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 13, 20, 0, 0) + clock++ * 1000).toISOString();

test("set a text layer's font from a token, its weight, line height, letter spacing and alignment", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-type-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("type");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    const call = client(host.url, host.token);
    const { document } = await ok(call("GET", "/api/document"), "document");
    await ok(call("POST", "/api/edit", { baseRevision: document.revision, intent: "Add a page with a heading and a token", operations: [
      { type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: "system", type: "design-system", props: { name: "Design system", collections: [{ id: "base", name: "Base", modes: [{ id: "default", name: "Default" }], defaultMode: "default" }], tokens: [{ name: "--font-heading", type: "fontFamily", collection: "base", values: { default: "Georgia, serif" } }] } } },
      { type: "insert-node", parentId: null, index: document.rootIds.length + 1, node: { id: "page", type: "frame", props: { name: "Page", style: { position: "relative", width: "400px", height: "200px" } } } },
      { type: "insert-node", parentId: "page", index: 0, node: { id: "title", type: "text", props: { tag: "h1", text: "Hello", style: { width: "300px", margin: "0px" } } } },
    ] }), "page");
    await waitRevision(page, 1);
    await page.locator('#layers [role=treeitem][data-node-id="title"] > .row').click();
    await page.locator("#inspect-text-style").waitFor();
    assert.deepEqual(await page.locator("#font-families option").evaluateAll((all) => all.slice(0, 2).map((option) => option.value)), ["var(--font-heading)", "system-ui, sans-serif"], "the project's font tokens come first");

    const set = async (selector, value, revision) => {
      const control = page.locator(selector);
      if (await control.evaluate((element) => element.localName === "select")) await control.selectOption(value);
      else {
        await control.fill(value);
        await control.press("Enter");
      }
      await waitRevision(page, revision);
    };
    await set("#inspect-style-font-family", "var(--font-heading)", 2);
    await set("#inspect-style-font-weight", "700", 3);
    await set("#inspect-style-line-height", "1.5", 4);
    await set("#inspect-style-letter-spacing", "2", 5);
    await set("#inspect-style-text-align", "center", 6);

    const { document: after } = await ok(call("GET", "/api/document"), "document");
    const style = after.nodes.title.props.style;
    assert.deepEqual([style["font-family"], style["font-weight"], style["line-height"], style["letter-spacing"], style["text-align"]], ["var(--font-heading)", "700", "1.5", "2px", "center"], "a line height stays unitless; a letter spacing gets px");
    const drawn = await page.evaluate(() => {
      const element = document.querySelector("iframe").contentDocument.querySelector('[data-ninerr-id="title"]');
      const computed = element.ownerDocument.defaultView.getComputedStyle(element);
      return [computed.fontFamily, computed.fontWeight, computed.lineHeight, computed.letterSpacing, computed.textAlign];
    });
    assert.deepEqual(drawn, ["Georgia, serif", "700", "48px", "2px", "center"], "the canvas draws them, the font through its token");
    // A font the canvas would not draw (a semicolon hides a second declaration) is refused, saying why.
    await page.locator("#inspect-style-font-family").fill("Arial; color: red");
    await page.locator("#inspect-style-font-family").press("Enter");
    await page.waitForFunction(() => /^Not changed: font-family's value/u.test(document.getElementById("status").textContent));
    assert.equal(await page.locator("#inspect-style-font-family").inputValue(), "var(--font-heading)");
    assert.equal((await ok(call("GET", "/api/document"), "document")).document.revision, 6, "nothing was stored");
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
