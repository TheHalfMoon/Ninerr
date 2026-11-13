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
      // The page has a border and padding and the box a margin: the insets are measured from the
      // page's padding box to the box's margin box, as CSS places it.
      { type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: "page", type: "frame", props: { name: "Page", style: { position: "relative", width: "400px", height: "200px", padding: "10px", border: "3px solid #000" } } } },
      { type: "insert-node", parentId: "page", index: 0, node: { id: "box", type: "element", props: { tag: "div", style: { position: "absolute", left: "20px", top: "30px", width: "100px", height: "50px", margin: "5px", background: "#ccd" } } } },
      // Left, right and a width: its right is ignored, so it is not what pins it.
      { type: "insert-node", parentId: "page", index: 1, node: { id: "over", type: "element", props: { tag: "div", style: { position: "absolute", left: "10px", right: "10px", width: "50px", top: "0px", height: "10px" } } } },
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
    // 420 - 20 - 110 and 220 - 30 - 60: the padding box less the inset and the margin box.
    assert.deepEqual(await styleOf(), { position: "absolute", width: "100px", height: "50px", margin: "5px", background: "#ccd", right: "290px", bottom: "130px" });
    assert.deepEqual(await drawn(), { left: 28, top: 38, width: 100 }, "it has not moved (3 border + 20 + 5 margin)");
    await resizePage("600px", "300px", 4);
    assert.deepEqual(await drawn(), { left: 228, top: 138, width: 100 }, "it keeps its distance from the right and bottom");

    // Both edges: it stretches with its parent.
    await page.locator('#layers [role=treeitem][data-node-id="box"] > .row').click();
    await page.locator("#inspect-constraint-x").selectOption("both");
    await waitRevision(page, 5);
    assert.deepEqual([(await styleOf()).left, (await styleOf()).right, (await styleOf()).width], ["220px", "290px", undefined]);
    await resizePage("700px", "300px", 6);
    assert.deepEqual(await drawn(), { left: 228, top: 138, width: 200 }, "stretched by the 100 the parent grew");

    // Centre: it keeps its offset from the parent's centre, at its own size.
    await page.locator('#layers [role=treeitem][data-node-id="box"] > .row').click();
    await page.locator("#inspect-constraint-x").selectOption("centre");
    await waitRevision(page, 7);
    assert.deepEqual([(await styleOf()).left, (await styleOf()).right, (await styleOf()).width], ["calc(50% - 140px)", undefined, "200px"], "220 - 720 / 2");
    await resizePage("500px", "300px", 8);
    assert.deepEqual(await drawn(), { left: 128, top: 138, width: 200 }, "3 + (260 - 140) + 5");
    assert.equal(await page.locator("#inspect-constraint-x").inputValue(), "centre");

    // A move by the inspector's buttons keeps the pins.
    await page.locator('#layers [role=treeitem][data-node-id="box"] > .row').click();
    await page.getByRole("button", { name: "Move right 10 pixels" }).click();
    await waitRevision(page, 9);
    assert.deepEqual([(await styleOf()).left, (await styleOf()).bottom], ["calc(50% - 130px)", "130px"]);
    // Vertically centred: 130 from the top of a 320-high padding box is 30 above its centre.
    await page.locator("#inspect-constraint-y").selectOption("centre");
    await waitRevision(page, 10);
    assert.deepEqual([(await styleOf()).top, (await styleOf()).bottom], ["calc(50% - 30px)", undefined]);
    assert.equal((await drawn()).top, 138, "it has not moved");
    // Pinned to the right, a layer whose written right was ignored gets the inset it is drawn at:
    // 520 - 10 - 50.
    await page.locator('#layers [role=treeitem][data-node-id="over"] > .row').click();
    assert.equal(await page.locator("#inspect-constraint-x").inputValue(), "start", "its left wins");
    await page.locator("#inspect-constraint-x").selectOption("end");
    await waitRevision(page, 11);
    const over = (await ok(call("GET", "/api/document"), "document")).document.nodes.over.props.style;
    assert.deepEqual([over.left, over.right, over.width], [undefined, "460px", "50px"]);
    // A layer a class draws in the flow, whatever its style says, cannot be pinned: said, and
    // the control shows its pin as it was.
    const { document: current } = await ok(call("GET", "/api/document"), "document");
    await ok(call("POST", "/api/edit", { baseRevision: current.revision, intent: "A class puts it in the flow", operations: [
      { type: "set-props", nodeId: "page", set: { stylesheet: ".flow { position: static !important; }" } },
      { type: "set-props", nodeId: "box", set: { attributes: { class: "flow" } } },
    ] }), "class");
    await waitRevision(page, 12);
    await page.locator('#layers [role=treeitem][data-node-id="box"] > .row').click();
    await page.locator("#inspect-constraint-x").selectOption("end");
    await page.waitForFunction(() => /^Not changed: this layer is not drawn absolutely positioned/u.test(document.getElementById("status").textContent));
    assert.equal(await page.locator("#inspect-constraint-x").inputValue(), "centre");
    assert.equal((await ok(call("GET", "/api/document"), "document")).document.revision, 12, "nothing was stored");
    // A layer in the flow has no constraints to show.
    const { document: last } = await ok(call("GET", "/api/document"), "document");
    await ok(call("POST", "/api/edit", { baseRevision: last.revision, intent: "Back in the flow", operations: [{ type: "set-props", nodeId: "box", set: { style: { width: "10px" } } }] }), "flow");
    await waitRevision(page, 13);
    await page.locator("#inspect-style-width").waitFor();
    assert.equal(await page.locator("#inspect-constraints").count(), 0);
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
