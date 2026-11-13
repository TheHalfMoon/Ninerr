import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { client, ok } from "./support/host-api.mjs";

// The inspector's constraints: a positioned layer pinned to its parent's left, right, both edges
// or centre, each one change that keeps where it is drawn, and kept when its parent is resized
// and when it is moved.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 13, 22, 0, 0) + clock++ * 1000).toISOString();

test("pin a layer to its parent's right, both edges and centre, and it keeps its place as the parent grows", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-constraints-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("constraints");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    const call = client(host.url, host.token);
    const { document } = await ok(call("GET", "/api/document"), "document");
    await ok(call("POST", "/api/edit", { baseRevision: document.revision, intent: "Add a page with a box", operations: [
      { type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: "page", type: "frame", props: { name: "Page", style: { position: "relative", width: "400px", height: "200px" } } } },
      { type: "insert-node", parentId: "page", index: 0, node: { id: "box", type: "element", props: { tag: "div", style: { position: "absolute", left: "20px", top: "30px", width: "100px", height: "50px", background: "#ccd" } } } },
    ] }), "page");
    await waitRevision(page, 1);
    await page.locator('#layers [role=treeitem][data-node-id="box"] > .row').click();
    await page.locator("#inspect-constraints").waitFor();
    assert.deepEqual([await page.locator("#inspect-constraint-x").inputValue(), await page.locator("#inspect-constraint-y").inputValue()], ["start", "start"]);
    // Named by their labels and group, and large enough to hit (WCAG 2.5.8).
    assert.equal(await page.getByRole("group", { name: "Pin to parent" }).count(), 1);
    for (const name of ["Horizontally", "Vertically"]) {
      const control = page.getByRole("combobox", { name });
      assert.equal(await control.count(), 1, name);
      const box = await control.boundingBox();
      assert.ok(box.height >= 24 && box.width >= 24, `${name}: ${box.width}x${box.height}`);
    }

    const styleOf = async () => (await ok(call("GET", "/api/document"), "document")).document.nodes.box.props.style;
    const drawn = () => page.evaluate(() => {
      const frame = document.querySelector("iframe").contentDocument;
      const box = frame.querySelector('[data-ninerr-id="box"]').getBoundingClientRect();
      const parent = frame.querySelector('[data-ninerr-id="page"]').getBoundingClientRect();
      return { left: box.left - parent.left, top: box.top - parent.top, width: box.width };
    });
    const resizePage = async (width, height, revision) => {
      const { document: current } = await ok(call("GET", "/api/document"), "document");
      await ok(call("POST", "/api/edit", { baseRevision: current.revision, intent: "Resize the page", operations: [{ type: "set-props", nodeId: "page", set: { style: { ...current.nodes.page.props.style, width, height } } }] }), "resize");
      await waitRevision(page, revision);
    };

    // Right and bottom: the insets that keep it where it is.
    await page.locator("#inspect-constraint-x").selectOption("end");
    await waitRevision(page, 2);
    await page.locator("#inspect-constraint-y").selectOption("end");
    await waitRevision(page, 3);
    assert.deepEqual(await styleOf(), { position: "absolute", width: "100px", height: "50px", background: "#ccd", right: "280px", bottom: "120px" });
    assert.deepEqual(await drawn(), { left: 20, top: 30, width: 100 }, "it has not moved");
    await resizePage("600px", "300px", 4);
    assert.deepEqual(await drawn(), { left: 220, top: 130, width: 100 }, "it keeps its distance from the right and bottom");

    // Both edges: it stretches with its parent.
    await page.locator('#layers [role=treeitem][data-node-id="box"] > .row').click();
    await page.locator("#inspect-constraint-x").selectOption("both");
    await waitRevision(page, 5);
    assert.deepEqual([(await styleOf()).left, (await styleOf()).right, (await styleOf()).width], ["220px", "280px", undefined]);
    await resizePage("700px", "300px", 6);
    assert.deepEqual(await drawn(), { left: 220, top: 130, width: 200 }, "stretched by the 100 the parent grew");

    // Centre: it keeps its offset from the parent's centre, at its own size.
    await page.locator('#layers [role=treeitem][data-node-id="box"] > .row').click();
    await page.locator("#inspect-constraint-x").selectOption("centre");
    await waitRevision(page, 7);
    assert.deepEqual([(await styleOf()).left, (await styleOf()).right, (await styleOf()).width], ["calc(50% - 130px)", undefined, "200px"]);
    await resizePage("500px", "300px", 8);
    assert.deepEqual(await drawn(), { left: 120, top: 130, width: 200 }, "250 - 130");
    assert.equal(await page.locator("#inspect-constraint-x").inputValue(), "centre");

    // A move by the inspector's buttons keeps the pins.
    await page.locator('#layers [role=treeitem][data-node-id="box"] > .row').click();
    await page.getByRole("button", { name: "Move right 10 pixels" }).click();
    await waitRevision(page, 9);
    assert.deepEqual([(await styleOf()).left, (await styleOf()).bottom], ["calc(50% - 120px)", "120px"]);
    // A layer in the flow has no constraints to show.
    const { document: last } = await ok(call("GET", "/api/document"), "document");
    await ok(call("POST", "/api/edit", { baseRevision: last.revision, intent: "Back in the flow", operations: [{ type: "set-props", nodeId: "box", set: { style: { width: "10px" } } }] }), "flow");
    await waitRevision(page, 10);
    await page.locator("#inspect-style-width").waitFor();
    assert.equal(await page.locator("#inspect-constraints").count(), 0);
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
