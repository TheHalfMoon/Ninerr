import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { client, ok } from "./support/host-api.mjs";

// ADR-0004 through the editor: the person creates a design system in Tokens, adds a token, sees
// a layer that uses var(--brand) drawn with it, adds a Dark mode and gives the layer that mode.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 9, 16, 0, 0) + clock++ * 1000).toISOString();
const colourOf = (page, id) => page.evaluate((nodeId) => {
  const element = document.querySelector("iframe").contentDocument.querySelector(`[data-ninerr-id="${nodeId}"]`);
  return element ? getComputedStyle(element).color : null;
}, id);

test("create a design system, add a token, and draw a layer with it in each mode", browserTestOptions(), async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ninerr-tokens-editor-")));
  const projects = join(root, "projects");
  mkdirSync(projects);
  const host = await startStudioHost({ projectsRoot: projects, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("site");
    await page.locator("#dialog[open] button.primary", { hasText: "Create project" }).click();
    await waitRevision(page, 0);
    // A layer that uses the token before it exists: unbound, drawn with the browser's default.
    const call = client(host.url, host.token);
    const { document } = await ok(call("GET", "/api/document"), "document");
    await ok(call("POST", "/api/edit", { baseRevision: document.revision, operations: [{ type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: "hero", type: "frame", props: { name: "Hero", text: "Hello", style: { color: "var(--brand, rgb(0, 0, 0))", width: "200px", height: "80px" } } } }], intent: "Add hero" }), "hero");
    await waitRevision(page, 1);
    assert.equal(await colourOf(page, "hero"), "rgb(0, 0, 0)");

    await page.locator("#action-tokens").click();
    await page.locator("#tokens-create").click();
    await waitRevision(page, 2);
    await page.locator("#token-new-name").fill("--brand");
    await page.locator("#token-new-value").fill("rgb(255, 0, 0)");
    await page.locator("#token-add").click();
    await waitRevision(page, 3);
    assert.equal(await colourOf(page, "hero"), "rgb(255, 0, 0)", "the canvas draws the layer with the token");
    assert.equal(await page.locator('[data-token-row="--brand"] td').nth(2).textContent(), "1", "the hero layer is its one use");

    // A Dark mode, then the token's dark value, then the layer in Dark.
    await page.locator('section[aria-label="Base"] input[aria-label="New mode for Base"]').fill("Dark");
    await page.locator('section[aria-label="Base"] button', { hasText: "Add mode" }).click();
    await waitRevision(page, 4);
    await page.locator('input[data-token="--brand"][data-mode="dark"]').fill("rgb(0, 0, 255)");
    await page.locator('input[data-token="--brand"][data-mode="dark"]').press("Tab");
    await waitRevision(page, 5);
    assert.equal(await colourOf(page, "hero"), "rgb(255, 0, 0)", "the layer is still in the default mode");
    // The redraw after the change keeps focus where the keyboard left it, inside the dialog.
    assert.equal(await page.evaluate(() => document.getElementById("dialog").contains(document.activeElement) && document.activeElement !== document.body), true, "focus stays in the dialog");
    // A refused change is said in the dialog.
    await page.locator("#token-new-name").fill("--brand");
    await page.locator("#token-new-value").fill("red");
    await page.locator("#token-add").click();
    assert.match(await page.locator("#tokens-error").textContent(), /--brand is already a token/u);
    await page.locator("#dialog[open] button", { hasText: "Close" }).last().click();

    await page.locator('#layers [role=treeitem][data-node-id="hero"] > .row').click();
    await page.locator("#action-tokens").click();
    await page.locator("#token-layer-mode").selectOption("base:dark");
    await page.locator("#token-layer-mode-apply").click();
    await waitRevision(page, 6);
    assert.equal(await colourOf(page, "hero"), "rgb(0, 0, 255)", "in Dark, the canvas draws the token's dark value");
    assert.equal(await page.evaluate(() => document.querySelector("iframe").contentDocument.querySelector('[data-ninerr-id="hero"]').getAttribute("data-ninerr-mode")), "base:dark");
    // The design system is not a layer.
    assert.equal(await page.locator('#layers [role=treeitem][data-node-id^="design-system"]').count(), 0);

    // Undo takes the mode back; the token stays.
    await page.locator("#dialog[open] button", { hasText: "Close" }).last().click();
    await page.keyboard.press("Control+z");
    await waitRevision(page, 7);
    assert.equal(await colourOf(page, "hero"), "rgb(255, 0, 0)");
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("import Astryx's token CSS: review it, add it in one change, and draw a layer with an Astryx token in each mode", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-token-css-editor-")));
  mkdirSync(join(root, "projects"));
  const host = await startStudioHost({ projectsRoot: join(root, "projects"), now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("astryx");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    await page.locator("#action-tokens").click();
    await page.locator("#token-css-file").setInputFiles(fileURLToPath(new URL("./fixtures/astryx/astryx-tokens.css", import.meta.url)));
    await page.locator("#token-css-review").click();
    await page.locator("#token-css-summary").waitFor();
    assert.equal(await page.locator("#token-css-summary").textContent(), "Astryx tokens from astryx-tokens.css: 247 new.");
    assert.ok((await page.locator("#token-css-kept li").allTextContents()).includes("--duration-fast: a duration: Ninerr has no motion token type"));
    assert.equal(await page.locator("#token-css-apply").textContent(), "Add 247 tokens");
    await page.locator("#token-css-apply").click();
    await waitRevision(page, 1);
    await page.locator("#token-css-done").waitFor();
    // A layer that uses an Astryx token is drawn with its light value, and its dark one in Dark.
    const call = client(host.url, host.token);
    const { document } = await ok(call("GET", "/api/document"), "document");
    await ok(call("POST", "/api/edit", { baseRevision: document.revision, operations: [{ type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: "accent", type: "frame", props: { name: "Accent", style: { width: "40px", height: "40px", background: "var(--color-accent)" } } } }], intent: "Add a layer" }), "layer");
    await waitRevision(page, 2);
    const painted = () => page.evaluate(() => getComputedStyle(document.querySelector("iframe").contentDocument.querySelector('[data-ninerr-id="accent"]')).backgroundColor);
    assert.equal(await painted(), "rgb(0, 100, 224)");
    const { document: now2 } = await ok(call("GET", "/api/document"), "document");
    const system = Object.values(now2.nodes).find((node) => node.type === "design-system");
    await ok(call("POST", "/api/edit", { baseRevision: now2.revision, operations: [{ type: "set-props", nodeId: "accent", set: { modes: { [system.props.collections[0].id]: "dark" } } }], intent: "Dark" }), "dark");
    await waitRevision(page, 3);
    assert.equal(await painted(), "rgb(1, 113, 227)");
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
