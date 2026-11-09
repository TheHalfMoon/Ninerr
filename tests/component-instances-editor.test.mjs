import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { client, ok } from "./support/host-api.mjs";

// ADR-0005 through the editor: a layer becomes a component, an instance of it is placed and drawn
// from it, a change to the main component reaches the instance, a property's value is set on the
// instance, a click inside it selects it, and it is detached into real layers.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 9, 18, 0, 0) + clock++ * 1000).toISOString();
const frameText = (page, selector) => page.evaluate((query) => [...document.querySelector("iframe").contentDocument.querySelectorAll(query)].map((element) => element.textContent), selector);

test("make a component, place an instance, change the component and the instance's property, then detach it", browserTestOptions(), async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ninerr-instances-editor-")));
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
      { type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: "card", type: "frame", props: { name: "Card", style: { width: "200px", height: "60px", background: "#eee" } } } },
      { type: "insert-node", parentId: "card", index: 0, node: { id: "title", type: "text", props: { name: "Title", text: "Hello" } } },
    ], intent: "Add card" }), "card");
    await waitRevision(page, 1);

    // Make it a component.
    await page.locator('#layers [role=treeitem][data-node-id="card"] > .row').click();
    await page.locator("#action-components").click();
    await page.locator("#component-name").fill("Card");
    await page.locator("#component-create").click();
    await waitRevision(page, 2);
    // Insert an instance.
    await page.locator('#components-list button[aria-label="Insert an instance of Card"]').click();
    await waitRevision(page, 3);
    const { document: placed } = await ok(call("GET", "/api/document"), "document");
    const instanceId = Object.values(placed.nodes).find((node) => node.type === "component-instance").id;
    assert.deepEqual(await frameText(page, `[data-ninerr-id="${instanceId}"]`), ["Hello"], "the instance draws its component");
    await page.locator("#dialog[open] button", { hasText: "Close" }).last().click();

    // A change to the main component reaches the instance.
    await ok(call("POST", "/api/edit", { baseRevision: placed.revision, operations: [{ type: "set-props", nodeId: "title", set: { text: "Welcome" } }], intent: "Edit title" }), "edit title");
    await waitRevision(page, 4);
    assert.deepEqual(await frameText(page, `[data-ninerr-id="${instanceId}"]`), ["Welcome"]);

    // Give the component a text property on its title, then set it on the instance.
    const componentId = placed.nodes.card.parentId;
    await page.locator(`#layers [role=treeitem][data-node-id="${componentId}"] > .row`).click();
    await page.locator("#action-components").click();
    await page.locator("#property-name").fill("Title");
    await page.locator("#property-target").selectOption("title");
    await page.locator("#property-add").click();
    await waitRevision(page, 5);
    await page.locator("#dialog[open] button", { hasText: "Close" }).last().click();
    // A click inside the instance selects the instance, not its component's layer.
    const box = await page.evaluate((id) => {
      const frame = document.querySelector("iframe");
      const rect = frame.contentDocument.querySelector(`[data-ninerr-id="${id}"] [data-ninerr-instance]`).getBoundingClientRect();
      const outer = frame.getBoundingClientRect();
      return { x: outer.left + rect.left + 5, y: outer.top + rect.top + 5 };
    }, instanceId);
    await page.mouse.click(box.x, box.y);
    await page.locator("#action-components").click();
    await page.locator('input[data-property]').fill("Pro");
    await page.locator('input[data-property]').press("Tab");
    await waitRevision(page, 6);
    assert.deepEqual(await frameText(page, `[data-ninerr-id="${instanceId}"]`), ["Pro"], "the instance draws its own value");
    assert.deepEqual(await frameText(page, '[data-ninerr-id="title"]:not([data-ninerr-instance])'), ["Welcome"], "the main component keeps its own");

    // Detach: real layers in its place, in one transaction; Undo brings the instance back.
    await page.locator("#components-detach").click();
    await waitRevision(page, 7);
    const { document: detached } = await ok(call("GET", "/api/document"), "document");
    assert.equal(Object.hasOwn(detached.nodes, instanceId), false);
    assert.ok(Object.values(detached.nodes).some((node) => node.props.text === "Pro" && node.id !== "title"), "the drawn value is now a real layer");
    await page.locator("#dialog[open] button", { hasText: "Close" }).last().click();
    await page.keyboard.press("Control+z");
    await waitRevision(page, 8);
    assert.deepEqual(await frameText(page, `[data-ninerr-id="${instanceId}"]`), ["Pro"]);
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
