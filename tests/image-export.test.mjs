import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { client, ok } from "./support/host-api.mjs";

// A layer copied as an image: an SVG holding its HTML page, or that SVG drawn as a PNG at twice
// the size, put on the clipboard (nothing is downloaded). The PNG's pixels are the layer's.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 14, 1, 0, 0) + clock++ * 1000).toISOString();

test("copy a layer as PNG and as SVG: the size the canvas draws it, its colours, nothing fetched", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-image-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("image");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    const call = client(host.url, host.token);
    const { document } = await ok(call("GET", "/api/document"), "document");
    await ok(call("POST", "/api/edit", { baseRevision: document.revision, intent: "A badge", operations: [
      { type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: "badge", type: "frame", props: { name: "Badge", style: { width: "120px", height: "60px", background: "#2255ff" } } } },
      { type: "insert-node", parentId: "badge", index: 0, node: { id: "half", type: "element", props: { tag: "div", style: { width: "60px", height: "60px", background: "#ff8800" } } } },
    ] }), "badge");
    await waitRevision(page, 1);
    // What is copied, kept in the page: the clipboard is replaced by a recorder.
    await page.evaluate(() => {
      window.copied = [];
      navigator.clipboard.write = async (items) => { for (const item of items) window.copied.push(await item.getType("image/png")); };
      navigator.clipboard.writeText = async (text) => { window.copied.push(text); };
    });
    await page.locator('#layers [role=treeitem][data-node-id="badge"] > .row').click();
    await page.locator("#action-code").click();
    await page.locator("#code-export-png").waitFor();
    const requests = [];
    page.on("request", (request) => requests.push(request.url()));

    await page.locator("#code-export-png").click();
    await page.waitForFunction(() => /^PNG copied: 120 × 60 at twice that resolution\.$/u.test(document.getElementById("status").textContent));
    const pixels = await page.evaluate(async () => {
      const bitmap = await createImageBitmap(window.copied[0]);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const at = (x, y) => [...context.getImageData(x, y, 1, 1).data];
      return { type: window.copied[0].type, width: bitmap.width, height: bitmap.height, left: at(40, 60), right: at(200, 60) };
    });
    assert.deepEqual([pixels.type, pixels.width, pixels.height], ["image/png", 240, 120], "twice the size the canvas draws it");
    assert.deepEqual(pixels.left, [255, 136, 0, 255], "its child's orange");
    assert.deepEqual(pixels.right, [34, 85, 255, 255], "its own blue");

    await page.locator("#code-export-svg").click();
    await page.waitForFunction(() => /^SVG copied: 120 × 60/u.test(document.getElementById("status").textContent));
    const svg = await page.evaluate(() => window.copied[1]);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="120" height="60" viewBox="0 0 120 60"><foreignObject /u);
    assert.match(svg, /<div xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"[^>]*data-ninerr-image=""/u);
    assert.doesNotMatch(svg, /<script|https?:\/\/(?!www\.w3\.org)/u, "nothing to run or fetch");
    // Making both fetched nothing but the HTML export from the host (the selection the editor
    // shares after a click aside).
    assert.deepEqual(requests.filter((url) => !url.startsWith("data:") && !url.endsWith("/api/selection")), [`${host.url}/api/code/export-html`, `${host.url}/api/code/export-html`]);
    // Where the clipboard refuses: the PNG says so, and the SVG goes to the code box.
    await page.evaluate(() => {
      navigator.clipboard.write = async () => { throw new DOMException("refused", "NotAllowedError"); };
      navigator.clipboard.writeText = async () => { throw new DOMException("refused", "NotAllowedError"); };
    });
    await page.locator("#code-export-png").click();
    await page.waitForFunction(() => document.getElementById("status").textContent === "Copying an image is not allowed here; use Copy as SVG.");
    await page.locator("#code-export-svg").click();
    await page.waitForFunction(() => document.getElementById("status").textContent === "The SVG is in the code box: select it and copy it.");
    assert.match(await page.locator("#code-export").inputValue(), /^<svg /u);
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
