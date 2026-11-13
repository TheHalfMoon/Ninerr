import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { client, ok } from "./support/host-api.mjs";

// Align and distribute: several selected layers line up along an edge or centre, or three or
// more are spaced evenly, each as one change Undo takes back, from buttons or the keyboard.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 13, 9, 0, 0) + clock++ * 1000).toISOString();
const box = (id, left, top, width, height) => ({ id, type: "frame", props: { name: id, style: { position: "absolute", left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, background: "#ddd" } } });

test("align and distribute selected layers from the inspector and the keyboard, each undone in one step", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-align-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("align");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    const call = client(host.url, host.token);
    const { document } = await ok(call("GET", "/api/document"), "document");
    await ok(call("POST", "/api/edit", { baseRevision: document.revision, intent: "Add a board", operations: [
      { type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: "board", type: "frame", props: { name: "Board", style: { position: "relative", width: "400px", height: "300px" } } } },
      { type: "insert-node", parentId: "board", index: 0, node: box("a", 10, 40, 20, 20) },
      { type: "insert-node", parentId: "board", index: 1, node: box("b", 100, 10, 40, 30) },
      { type: "insert-node", parentId: "board", index: 2, node: box("c", 300, 70, 30, 10) },
    ] }), "board");
    await waitRevision(page, 1);
    const style = async (id) => (await ok(call("GET", "/api/document"), "document")).document.nodes[id].props.style;
    const tops = async () => Promise.all(["a", "b", "c"].map(async (id) => (await style(id)).top));

    // Nothing selected, or one layer: no Align group. Two: align, but nothing to space evenly.
    assert.equal(await page.locator("#align-group").count(), 0);
    await page.locator('#layers [role=treeitem][data-node-id="a"] > .row').click();
    assert.equal(await page.locator("#align-group").count(), 0);
    await page.locator('#layers [role=treeitem][data-node-id="b"] > .row').click({ modifiers: ["Control"] });
    assert.equal(await page.locator("#align-group button", { hasText: "Space evenly" }).count(), 0);
    await page.locator('#layers [role=treeitem][data-node-id="c"] > .row').click({ modifiers: ["Control"] });
    assert.equal(await page.locator("#align-group").getAttribute("aria-label"), "Align 3 layers");

    await page.locator("#align-group button", { hasText: "Align top" }).click();
    await waitRevision(page, 2);
    assert.deepEqual(await tops(), ["10px", "10px", "10px"], "every top goes to the highest");

    // Alt+Shift+H spaces them evenly across: a at 10..30 and c at 300..330 stay; b goes between.
    await page.locator("#canvas").focus();
    await page.keyboard.press("Alt+Shift+KeyH");
    await waitRevision(page, 3);
    assert.deepEqual([(await style("a")).left, (await style("b")).left, (await style("c")).left], ["10px", "145px", "300px"]);

    // Alt+D aligns their right edges; one Undo takes that change back whole.
    await page.keyboard.press("Alt+KeyD");
    await waitRevision(page, 4);
    assert.deepEqual([(await style("a")).left, (await style("b")).left, (await style("c")).left], ["310px", "290px", "300px"]);
    await page.locator("#action-undo").click();
    await waitRevision(page, 5);
    assert.deepEqual([(await style("a")).left, (await style("b")).left, (await style("c")).left], ["10px", "145px", "300px"]);
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("align measures flow layers as they will be placed, leaves out a hidden layer, and keeps focus on its button", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-align-flow-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("flow");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    const call = client(host.url, host.token);
    const { document } = await ok(call("GET", "/api/document"), "document");
    // A heading in the flow, then a card whose place follows it, holding an absolute badge;
    // and a hidden layer. Taking the heading out of the flow moves the card, and the badge with it.
    await ok(call("POST", "/api/edit", { baseRevision: document.revision, intent: "Add a page", operations: [
      { type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: "board", type: "frame", props: { name: "Board", style: { position: "relative", width: "400px", padding: "20px" } } } },
      { type: "insert-node", parentId: "board", index: 0, node: { id: "heading", type: "frame", props: { name: "heading", style: { height: "30px", width: "100px", background: "#ccc" } } } },
      { type: "insert-node", parentId: "board", index: 1, node: { id: "card", type: "frame", props: { name: "card", style: { position: "relative", height: "100px", background: "#eee" } } } },
      { type: "insert-node", parentId: "card", index: 0, node: { id: "badge", type: "frame", props: { name: "badge", style: { position: "absolute", left: "200px", top: "50px", width: "20px", height: "20px", background: "#999" } } } },
      { type: "insert-node", parentId: "board", index: 2, node: { id: "ghost", type: "frame", props: { name: "ghost", attributes: { hidden: "" }, style: { width: "10px", height: "10px" } } } },
    ] }), "page");
    await waitRevision(page, 1);
    for (const [index, id] of ["heading", "badge", "ghost"].entries()) await page.locator(`#layers [role=treeitem][data-node-id="${id}"] > .row`).click(index === 0 ? {} : { modifiers: ["Control"] });
    assert.equal(await page.locator("#align-group").getAttribute("aria-label"), "Align 2 layers", "the hidden layer is not counted");
    await page.locator('#align-group [data-align="top"]').click();
    await waitRevision(page, 2);
    const tops = await page.evaluate(() => {
      const frame = document.querySelector("iframe").contentDocument;
      const top = (id) => frame.querySelector(`[data-ninerr-id="${id}"]`).getBoundingClientRect().top;
      return { heading: top("heading"), badge: top("badge") };
    });
    assert.ok(Math.abs(tops.heading - tops.badge) < 0.5, `aligned tops: ${JSON.stringify(tops)}`);
    const { document: after } = await ok(call("GET", "/api/document"), "document");
    assert.equal(after.nodes.ghost.props.style.position, undefined, "the hidden layer is not moved");
    await page.waitForFunction(() => document.activeElement?.dataset?.align === "top");
    assert.match(await page.locator("#status").textContent(), /Align layers/u);
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
