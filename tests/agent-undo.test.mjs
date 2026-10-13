import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions, findBrowser, launchBrowser, step, watchRequests } from "./support/browser.mjs";
import { editorReady, waitRevision } from "./support/editor.mjs";

// P09 criterion 1 (a P08-G11 dogfooding finding): after an agent edits, the person undoes that
// change where the editor's own Undo is, with "Undo agent change" (or Ctrl+Alt+Z), without
// looking for Revert in the history. It reverts the latest agent change this person may
// revert, names it, and is offered only while there is one.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 13, 12, 0, 0) + clock++ * 1000).toISOString();

async function openEditor(host) {
  const browser = await launchBrowser({ executablePath: findBrowser(), headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const foreign = [];
  const errors = [];
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(`${host.url}/`)) return route.continue();
    foreign.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  const pending = watchRequests(page);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await step("opening the editor", pending, () => page.goto(host.launchUrl()));
  await editorReady(page, pending);
  return { page, foreign, errors, close: () => browser.close() };
}

const layerCount = (page) => page.locator("#layers [role=treeitem]").count();
const background = (page, nodeId) => page.evaluate((id) => document.querySelector("iframe").contentDocument.querySelector(`[data-ninerr-id="${id}"]`)?.style.background ?? null, nodeId);
const undoAgent = (page) => page.locator("#action-undo-agent");
// The button follows the session's answer, which comes just after the change itself.
const offered = (page, label) => page.waitForFunction((expected) => {
  const button = document.getElementById("action-undo-agent");
  return expected === null ? button.hidden : !button.hidden && button.getAttribute("aria-label") === expected;
}, label);

test("an agent's change is undone next to Undo, by pointer and keyboard, newest first", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-agent-undo-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("undo");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    assert.equal(await undoAgent(page).isHidden(), true, "nothing to offer in a new project");

    await page.locator("#action-agents").click();
    await page.locator("#agent-name").fill("Claude Code");
    await page.keyboard.press("Enter");
    const token = await page.locator("#agent-credential").inputValue();
    await page.locator("#dialog[open] button.primary").click();
    let id = 0;
    const post = (body) => fetch(host.mcpUrl, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }).then((response) => response.json());
    await post({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    const tool = (name, args) => post({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }).then((answer) => answer.result);

    // The person's own change is undone with Undo, not offered as an agent's.
    await page.locator("#action-insert-box").click();
    await waitRevision(page, 1);
    assert.equal(await undoAgent(page).isHidden(), true);
    const boxLayers = await layerCount(page);

    // Two agent changes: the newest is offered, by name, and announced.
    const frameId = (await tool("create_frame", { name: "Landing", width: 640, height: 400 })).structuredContent.nodeId;
    await waitRevision(page, 2);
    const createIntent = (await page.locator("#history li .intent").first().textContent());
    const before = await background(page, frameId);
    await tool("set_styles", { updates: [{ nodeId: frameId, styles: { background: "#123456" } }] });
    await waitRevision(page, 3);
    const styleIntent = (await page.locator("#history li .intent").first().textContent());
    await offered(page, `Undo agent change: ${styleIntent} by Claude Code`);
    assert.equal(await page.locator("#status").textContent(), `Claude Code: ${styleIntent}. Undo agent change undoes it.`);
    // In the history, only the change that can be reverted now offers Revert.
    assert.equal(await page.locator("#history button.revert").count(), 1);
    assert.equal(await page.locator("#history li").first().locator("button.revert").count(), 1);

    // By pointer: the style goes, and the agent's earlier change is offered next.
    await undoAgent(page).click();
    await waitRevision(page, 4);
    assert.equal(await background(page, frameId), before);
    assert.equal(await page.locator("#history li .intent").first().textContent(), `Revert: ${styleIntent}`);
    assert.match(await page.locator("#history li").first().locator(".who").textContent(), /^You /u);
    await offered(page, `Undo agent change: ${createIntent} by Claude Code`);

    // By keyboard, from the layers tree: the frame goes, and nothing more is offered.
    await page.locator("#layers [role=treeitem] > .row").first().click();
    await page.keyboard.press("Control+Alt+z");
    await waitRevision(page, 5);
    assert.equal(await layerCount(page), boxLayers, "only the person's box is left");
    await offered(page, null);
    assert.equal(await page.locator("#history button.revert").count(), 0);
    // With nothing to offer, the shortcut says so and changes nothing.
    await page.keyboard.press("Control+Alt+z");
    await page.waitForFunction(() => document.getElementById("status").textContent === "No agent change to undo.");

    // The person's Undo undoes their own revert: the frame is back.
    await page.keyboard.press("Control+z");
    await waitRevision(page, 6);
    assert.equal(await layerCount(page), boxLayers + 1);
    // The button is also reached and used from the keyboard alone.
    await tool("set_styles", { updates: [{ nodeId: frameId, styles: { background: "#654321" } }] });
    await waitRevision(page, 7);
    const again = (await page.locator("#history li .intent").first().textContent());
    await offered(page, `Undo agent change: ${again} by Claude Code`);
    // From Undo, Tab reaches it (past Redo when Redo is enabled).
    await page.locator("#action-undo").focus();
    for (let presses = 0; presses < 2 && await page.evaluate(() => document.activeElement.id) !== "action-undo-agent"; presses += 1) await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.id), "action-undo-agent");
    await page.keyboard.press("Enter");
    await waitRevision(page, 8);
    assert.equal(await background(page, frameId), before);

    assert.deepEqual(editor.foreign, []);
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
