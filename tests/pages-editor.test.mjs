import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { client, ok } from "./support/host-api.mjs";

// Pages: a project's top-level frames. Add page adds one, named for its place, and shows it;
// the page picker selects a page and fits the canvas to it. Each addition is one change.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 13, 15, 0, 0) + clock++ * 1000).toISOString();

test("add pages, pick one to show it, and undo an addition in one step", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-pages-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("pages");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    assert.equal(await page.locator("#page-select").isDisabled(), true, "no pages yet");
    await page.locator("#action-add-page").click();
    await waitRevision(page, 1);
    await page.locator("#action-add-page").click();
    await waitRevision(page, 2);
    const options = () => page.locator("#page-select option").evaluateAll((all) => all.map((option) => [option.textContent, option.selected]));
    assert.deepEqual(await options(), [["Page 1", false], ["Page 2", true]], "the new page is selected");
    const call = client(host.url, host.token);
    const { document } = await ok(call("GET", "/api/document"), "document");
    const [first, second] = document.rootIds.filter((id) => document.nodes[id].type === "frame");
    assert.deepEqual([document.nodes[second].props.name, document.nodes[second].props.style.width, document.nodes[second].props.tag], ["Page 2", "800px", "main"]);
    // The new page is in view: its box is on the stage.
    const inView = (id) => page.evaluate((nodeId) => {
      const stage = document.getElementById("canvas").getBoundingClientRect();
      const frame = document.querySelector("iframe");
      const box = frame.contentDocument.querySelector(`[data-ninerr-id="${nodeId}"]`).getBoundingClientRect();
      const frameBox = frame.getBoundingClientRect();
      const scale = frameBox.width / frame.offsetWidth;
      const top = frameBox.top + box.top * scale;
      const left = frameBox.left + box.left * scale;
      return top >= stage.top - 1 && left >= stage.left - 1 && top + box.height * scale <= stage.bottom + 1 && left + box.width * scale <= stage.right + 1;
    }, id);
    await page.waitForFunction(() => document.getElementById("page-select").value !== "");
    assert.equal(await inView(second), true, "Page 2 is shown");
    // Picking Page 1 selects it and fits the canvas to it.
    await page.locator("#page-select").selectOption(first);
    assert.deepEqual(await options(), [["Page 1", true], ["Page 2", false]]);
    assert.equal(await page.locator(`#layers [role=treeitem][data-node-id="${first}"]`).getAttribute("aria-selected"), "true");
    assert.equal(await inView(first), true, "Page 1 is shown");
    // Back to Page 2 with Show after choosing it; with nothing selected, a new box goes on it.
    await page.locator("#page-select").selectOption(second);
    await page.locator("#action-show-page").click();
    assert.equal(await inView(second), true);
    await page.locator(`#layers [role=treeitem][data-node-id="${second}"] > .row`).click({ modifiers: ["Control"] });
    await page.waitForFunction(() => document.querySelectorAll('#layers [aria-selected="true"]').length === 0);
    await page.locator("#action-insert-box").click();
    await waitRevision(page, 3);
    const { document: withBox } = await ok(call("GET", "/api/document"), "document");
    const box = Object.values(withBox.nodes).find((node) => node.id.startsWith("box"));
    assert.equal(box.parentId, second, "the new box is on the page shown");
    // Undo takes the box and then the second page away.
    await page.locator("#action-undo").click();
    await waitRevision(page, 4);
    await page.locator("#action-undo").click();
    await waitRevision(page, 5);
    assert.deepEqual((await options()).map(([name]) => name), ["Page 1"]);
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
