import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { client, ok } from "./support/host-api.mjs";

// ADR-0005 through the editor: a double-click inside an instance picks the layer drawn there; it
// is changed for that instance alone, as its override, and the component stays as it is.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 9, 19, 0, 0) + clock++ * 1000).toISOString();
const drawn = (page, instanceId, nodeId) => page.evaluate(({ instance, node }) => {
  const element = [...document.querySelector("iframe").contentDocument.querySelectorAll(`[data-ninerr-id="${instance}"] [data-ninerr-instance]`)].find((candidate) => candidate.getAttribute("data-ninerr-id") === node);
  if (!element) return null;
  const style = getComputedStyle(element);
  return { text: element.textContent, color: style.color, display: style.display };
}, { instance: instanceId, node: nodeId });

test("double-click a layer inside an instance, change it for that instance, reset it, and go to the main component", browserTestOptions(), async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ninerr-instance-edit-")));
  const projects = join(root, "projects");
  mkdirSync(projects);
  const host = await startStudioHost({ projectsRoot: projects, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    const call = client(host.url, host.token);
    await page.locator("#new-project-name").fill("site");
    await page.locator("#dialog[open] button.primary", { hasText: "Create project" }).click();
    await waitRevision(page, 0);
    const { document } = await ok(call("GET", "/api/document"), "document");
    await ok(call("POST", "/api/edit", { baseRevision: document.revision, operations: [
      { type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: "card", type: "frame", props: { name: "Card", style: { width: "240px", height: "80px", background: "#eee", color: "rgb(0, 0, 0)" } } } },
      { type: "insert-node", parentId: "card", index: 0, node: { id: "title", type: "text", props: { name: "Title", text: "Hello", style: { display: "block" } } } },
    ], intent: "Add card" }), "card");
    await waitRevision(page, 1);
    await page.locator('#layers [role=treeitem][data-node-id="card"] > .row').click();
    await page.locator("#action-components").click();
    await page.locator("#component-create").click();
    await waitRevision(page, 2);
    await page.locator("#components-list button").first().click();
    await waitRevision(page, 3);
    await page.locator("#dialog[open] button", { hasText: "Close" }).last().click();
    const { document: placed } = await ok(call("GET", "/api/document"), "document");
    const instanceId = Object.values(placed.nodes).find((node) => node.type === "component-instance").id;

    // Double-click the instance's title on the canvas: the layer is picked and outlined.
    const point = await page.evaluate((id) => {
      const frame = document.querySelector("iframe");
      const element = [...frame.contentDocument.querySelectorAll(`[data-ninerr-id="${id}"] [data-ninerr-instance]`)].find((candidate) => candidate.getAttribute("data-ninerr-id") === "title");
      const rect = element.getBoundingClientRect();
      const outer = frame.getBoundingClientRect();
      return { x: outer.left + rect.left + 4, y: outer.top + rect.top + 4 };
    }, instanceId);
    await page.mouse.dblclick(point.x, point.y);
    await page.locator('[data-ninerr-target="title"]').waitFor();

    await page.locator("#action-components").click();
    await page.locator("#instance-text").fill("Pro");
    await page.locator("#instance-text").press("Tab");
    await waitRevision(page, 4);
    assert.equal((await drawn(page, instanceId, "title")).text, "Pro");
    await page.locator("#instance-style").fill("color: rgb(255, 0, 0)");
    await page.locator("#instance-style").press("Tab");
    await waitRevision(page, 5);
    assert.equal((await drawn(page, instanceId, "title")).color, "rgb(255, 0, 0)");
    await page.locator("#instance-shown").uncheck();
    await waitRevision(page, 6);
    assert.equal((await drawn(page, instanceId, "title")).display, "none", "hidden, though its own display is block");
    // The component is untouched.
    const { document: after } = await ok(call("GET", "/api/document"), "document");
    assert.equal(after.nodes.title.props.text, "Hello");
    assert.deepEqual(after.nodes[instanceId].props.overrides, [{ path: [], nodeId: "title", set: { text: "Pro", style: { color: "rgb(255, 0, 0)" }, visible: false } }]);

    // Reset this layer: drawn from the component again.
    await page.locator("#instance-reset-layer").click();
    await waitRevision(page, 7);
    assert.deepEqual(await drawn(page, instanceId, "title"), { text: "Hello", color: "rgb(0, 0, 0)", display: "block" });
    // By keyboard: the layer is picked from the list too.
    await page.locator("#instance-layer").selectOption({ label: "Title" });
    await page.locator("#instance-text").waitFor();
    // Edit main component: the component's own layer is selected, as a layer.
    await page.locator("#instance-edit-main").click();
    await page.waitForFunction(() => document.querySelector('#layers [role=treeitem][data-node-id="title"]')?.getAttribute("aria-selected") === "true");
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
