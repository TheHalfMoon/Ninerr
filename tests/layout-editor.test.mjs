import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { client, ok } from "./support/host-api.mjs";

// Auto layout in the inspector: a layer's children placed in a row or a column (CSS flex), with
// a gap, padding and alignment; each change is one change Undo takes back.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 13, 18, 0, 0) + clock++ * 1000).toISOString();
const box = (id, left, top, width, height) => ({ id, type: "frame", props: { name: id, style: { position: "absolute", left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, background: "#ccc" } } });

test("place a layer's children in a row with a gap, padding and alignment, then undo back to free", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-layout-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("layout");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    const call = client(host.url, host.token);
    const { document } = await ok(call("GET", "/api/document"), "document");
    await ok(call("POST", "/api/edit", { baseRevision: document.revision, intent: "Add a board", operations: [
      { type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: "board", type: "frame", props: { name: "Board", style: { position: "relative", width: "400px", height: "200px" } } } },
      { type: "insert-node", parentId: "board", index: 0, node: box("a", 200, 100, 40, 20) },
      { type: "insert-node", parentId: "board", index: 1, node: box("b", 10, 10, 60, 40) },
      { type: "insert-node", parentId: "board", index: 2, node: box("c", 300, 150, 30, 30) },
    ] }), "board");
    await waitRevision(page, 1);
    await page.locator('#layers [role=treeitem][data-node-id="board"] > .row').click();
    assert.equal(await page.locator("#inspect-layout-mode").inputValue(), "free");
    assert.equal(await page.locator("#inspect-style-gap").count(), 0, "no flex controls while placed freely");
    const boxes = () => page.evaluate(() => {
      const frame = document.querySelector("iframe").contentDocument;
      return Object.fromEntries(["board", "a", "b", "c"].map((id) => {
        const rect = frame.querySelector(`[data-ninerr-id="${id}"]`).getBoundingClientRect();
        return [id, { left: Math.round(rect.left), top: Math.round(rect.top) }];
      }));
    });

    await page.locator("#inspect-layout-mode").selectOption("row");
    await waitRevision(page, 2);
    let at = await boxes();
    assert.deepEqual([at.a.left - at.board.left, at.b.left - at.board.left, at.c.left - at.board.left], [0, 40, 100], "in a row, in their order");
    await page.locator("#inspect-style-gap").fill("10");
    await page.locator("#inspect-style-gap").press("Enter");
    await waitRevision(page, 3);
    await page.locator("#inspect-style-padding").fill("8");
    await page.locator("#inspect-style-padding").press("Enter");
    await waitRevision(page, 4);
    await page.locator("#inspect-style-align-items").selectOption("center");
    await waitRevision(page, 5);
    at = await boxes();
    assert.deepEqual([at.a.left - at.board.left, at.b.left - at.board.left, at.c.left - at.board.left], [8, 58, 128], "8px of padding, then 10px between each");
    // Centred in the board's 200px content box, inside 8px of padding: a, 20px high, starts at 8 + 90.
    assert.equal(at.a.top - at.board.top, 98);
    const { document: after } = await ok(call("GET", "/api/document"), "document");
    const style = after.nodes.board.props.style;
    assert.deepEqual([style.display, style["flex-direction"], style.gap, style.padding, style["align-items"]], ["flex", "row", "10px", "8px", "center"]);
    assert.equal(after.nodes.a.props.style.position, undefined, "the children joined the row");

    // Placing them freely again keeps each where the row put it.
    await page.locator("#inspect-layout-mode").selectOption("free");
    await waitRevision(page, 6);
    const kept = await boxes();
    assert.deepEqual([kept.a.left - kept.board.left, kept.b.left - kept.board.left, kept.c.left - kept.board.left, kept.a.top - kept.board.top], [8, 58, 128, 98], "nothing moves");
    const { document: freed } = await ok(call("GET", "/api/document"), "document");
    assert.deepEqual([freed.nodes.a.props.style.position, freed.nodes.board.props.style.display], ["absolute", undefined]);
    await page.locator("#action-undo").click();
    await waitRevision(page, 7);
    // Four more Undos: back to the free layout as it was first, each child where it was.
    for (let revision = 8; revision <= 11; revision += 1) {
      await page.locator("#action-undo").click();
      await waitRevision(page, revision);
    }
    const { document: undone } = await ok(call("GET", "/api/document"), "document");
    assert.deepEqual([undone.nodes.a.props.style.left, undone.nodes.a.props.style.position, undone.nodes.board.props.style.display], ["200px", "absolute", undefined]);
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
