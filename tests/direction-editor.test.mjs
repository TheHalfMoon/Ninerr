import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { client, ok } from "./support/host-api.mjs";

// Right-to-left editing: a layer's text direction set in the inspector, drawn by the canvas,
// written by the export, and kept by its children.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 13, 23, 0, 0) + clock++ * 1000).toISOString();

test("set a layer right to left: the canvas draws it so, its children follow, and the export writes it", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-direction-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("direction");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    const call = client(host.url, host.token);
    const { document } = await ok(call("GET", "/api/document"), "document");
    await ok(call("POST", "/api/edit", { baseRevision: document.revision, intent: "An Arabic card", operations: [
      { type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: "card", type: "frame", props: { name: "Card", style: { width: "300px" } } } },
      { type: "insert-node", parentId: "card", index: 0, node: { id: "title", type: "text", props: { tag: "h2", text: "مرحبا بكم", style: { margin: "0px" } } } },
    ] }), "card");
    await waitRevision(page, 1);
    await page.locator('#layers [role=treeitem][data-node-id="card"] > .row').click();
    const control = page.getByRole("combobox", { name: "Text direction" });
    assert.equal(await control.inputValue(), "", "from its parent until set");
    const box = await control.boundingBox();
    assert.ok(box.height >= 24, `the control is ${box.height}px high`);

    await control.selectOption("rtl");
    await waitRevision(page, 2);
    const { document: after } = await ok(call("GET", "/api/document"), "document");
    assert.deepEqual(after.nodes.card.props.attributes, { dir: "rtl" });
    const drawn = await page.evaluate(() => {
      const frame = document.querySelector("iframe").contentDocument;
      const card = frame.querySelector('[data-ninerr-id="card"]');
      const title = frame.querySelector('[data-ninerr-id="title"]');
      const view = frame.defaultView;
      const range = frame.createRange();
      range.selectNodeContents(title);
      return { dir: card.getAttribute("dir"), card: view.getComputedStyle(card).direction, title: view.getComputedStyle(title).direction, gapRight: card.getBoundingClientRect().right - range.getBoundingClientRect().right };
    });
    assert.deepEqual([drawn.dir, drawn.card, drawn.title], ["rtl", "rtl", "rtl"], "its children follow it");
    assert.ok(drawn.gapRight < 1, `the heading starts at the right edge (${drawn.gapRight}px from it)`);

    const exported = await ok(call("POST", "/api/code/export", { nodeId: "card" }), "export");
    assert.match(exported.code, /dir="rtl"/u, exported.code);

    // From its parent again: the attribute is gone.
    await page.locator('#layers [role=treeitem][data-node-id="card"] > .row').click();
    await page.getByRole("combobox", { name: "Text direction" }).selectOption("");
    await waitRevision(page, 3);
    assert.equal((await ok(call("GET", "/api/document"), "document")).document.nodes.card.props.attributes, undefined);
    // An instance draws its component's attributes: its direction is set on the component, so
    // it has no control of its own.
    const { document: before } = await ok(call("GET", "/api/document"), "document");
    await ok(call("POST", "/api/edit", { baseRevision: before.revision, intent: "A component and an instance", operations: [
      { type: "insert-node", parentId: null, index: before.rootIds.length, node: { id: "comp", type: "component-definition", props: { name: "Badge", properties: [] } } },
      { type: "insert-node", parentId: "comp", index: 0, node: { id: "label", type: "text", props: { tag: "span", text: "جديد" } } },
      { type: "insert-node", parentId: "card", index: 1, node: { id: "inst", type: "component-instance", props: { componentId: "comp", propertyValues: {} } } },
    ] }), "instance");
    await waitRevision(page, 4);
    await page.locator('#layers [role=treeitem][data-node-id="comp"] > .row').click();
    await page.getByRole("combobox", { name: "Text direction" }).waitFor();
    await page.locator('#layers [role=treeitem][data-node-id="inst"] > .row').click();
    await page.locator("#inspect-style-width").waitFor();
    assert.equal(await page.getByRole("combobox", { name: "Text direction" }).count(), 0);
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
