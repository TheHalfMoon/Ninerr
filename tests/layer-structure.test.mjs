import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions, findBrowser, launchBrowser, step, watchRequests } from "./support/browser.mjs";
import { editorReady, waitRevision } from "./support/editor.mjs";

// P09 criterion 2 (a P08-G11 dogfooding finding): layers are reordered, grouped and moved to
// another parent in the editor, by keyboard and by pointer, each as one history transaction
// that undo reverses.

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

// The host's document, as the tree of ids under the first page.
const childrenOf = (host, id) => host.session.document.nodes[id].children;
const parentOf = (host, id) => host.session.document.nodes[id].parentId;
const row = (page, id) => page.locator(`#layer-${id} > .row`);

/** Drag `id`'s row onto `targetId`'s row: "before" its top, "after" its bottom, or "inside" its middle. */
async function drag(page, id, targetId, zone) {
  const box = await row(page, targetId).boundingBox();
  const y = zone === "before" ? 0.1 : zone === "after" ? 0.9 : 0.5;
  await row(page, id).dragTo(row(page, targetId), { targetPosition: { x: box.width / 2, y: box.height * y } });
}

test("layers are reordered, moved to another parent and grouped, by keyboard and pointer, each undone in one step", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-layer-structure-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("structure");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    // A page with three boxes: a, b, c.
    let revision = 0;
    const ids = [];
    for (let made = 0; made < 3; made += 1) {
      // Insert into the page, not into the box just inserted (which is selected).
      if (made > 0) await row(page, host.session.document.rootIds[0]).click();
      await page.locator("#action-insert-box").click();
      await waitRevision(page, ++revision);
      ids.push(childrenOf(host, host.session.document.rootIds[0]).at(-1));
    }
    const pageId = host.session.document.rootIds[0];
    const [a, b, c] = ids;
    assert.deepEqual(childrenOf(host, pageId), [a, b, c]);
    const undo = async () => {
      await page.keyboard.press("Control+z");
      await waitRevision(page, ++revision);
    };

    // Keyboard: reorder. c moves up, then is undone in one step.
    await row(page, c).click();
    await page.keyboard.press("Alt+ArrowUp");
    await waitRevision(page, ++revision);
    assert.deepEqual(childrenOf(host, pageId), [a, c, b]);
    assert.equal(await page.evaluate(() => document.activeElement.id), `layer-${c}`, "focus follows the moved layer");
    await undo();
    assert.deepEqual(childrenOf(host, pageId), [a, b, c]);
    // At either end, nothing moves and the editor says why.
    await row(page, a).click();
    await page.keyboard.press("Alt+ArrowUp");
    await page.waitForFunction(() => document.getElementById("status").textContent === "This layer is already first among its siblings.");
    assert.equal(host.session.revision, revision);

    // Keyboard: into the layer above, and out again.
    await row(page, b).click();
    await page.keyboard.press("Alt+ArrowRight");
    await waitRevision(page, ++revision);
    assert.equal(parentOf(host, b), a);
    assert.deepEqual(childrenOf(host, pageId), [a, c]);
    await page.keyboard.press("Alt+ArrowLeft");
    await waitRevision(page, ++revision);
    assert.equal(parentOf(host, b), pageId);
    assert.deepEqual(childrenOf(host, pageId), [a, b, c], "out of its parent, just after it");
    // A layer stays on a page.
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForFunction(() => document.getElementById("status").textContent === "A layer stays on a page.");
    assert.equal(new URL(page.url()).pathname, "/", "Alt+Left did not navigate back");

    // Keyboard: group two layers with Ctrl+G; one undo removes the group.
    await row(page, a).click();
    await row(page, c).click({ modifiers: ["Control"] });
    await page.keyboard.press("Control+g");
    await waitRevision(page, ++revision);
    const group = childrenOf(host, pageId)[0];
    assert.match(group, /^group-/u);
    assert.deepEqual(childrenOf(host, group), [a, c]);
    assert.deepEqual(childrenOf(host, pageId), [group, b]);
    await page.waitForFunction((id) => document.getElementById(`layer-${id}`)?.getAttribute("aria-selected") === "true", group);
    // The boxes keep their place: the group fills the page and is positioned like them.
    assert.deepEqual(host.session.document.nodes[group].props.style, { position: "absolute", left: "0px", top: "0px", width: "100%", height: "100%" });
    await undo();
    assert.deepEqual(childrenOf(host, pageId), [a, b, c]);
    assert.equal(host.session.document.nodes[group], undefined);

    // Pointer: drag c before a, then into b, then out after b; each undone in one step.
    await drag(page, c, a, "before");
    await waitRevision(page, ++revision);
    assert.deepEqual(childrenOf(host, pageId), [c, a, b]);
    await undo();
    assert.deepEqual(childrenOf(host, pageId), [a, b, c]);
    await drag(page, c, b, "inside");
    await waitRevision(page, ++revision);
    assert.equal(parentOf(host, c), b);
    await drag(page, c, b, "after");
    await waitRevision(page, ++revision);
    assert.deepEqual(childrenOf(host, pageId), [a, b, c]);
    await undo();
    assert.equal(parentOf(host, c), b);
    await undo();
    assert.deepEqual(childrenOf(host, pageId), [a, b, c]);
    // A layer dropped into itself is refused, and nothing changes.
    await row(page, a).click();
    await page.keyboard.press("Alt+ArrowDown");
    await waitRevision(page, ++revision);
    await page.keyboard.press("Alt+ArrowRight");
    await waitRevision(page, ++revision);
    assert.equal(parentOf(host, a), b);
    await drag(page, b, a, "inside");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(host.session.revision, revision, "b cannot go inside its own child");

    // Pointer: the Group button.
    await row(page, c).click();
    await page.locator("#action-group").click();
    await waitRevision(page, ++revision);
    const single = parentOf(host, c);
    assert.match(single, /^group-/u);
    assert.deepEqual(childrenOf(host, single), [c]);
    await undo();
    assert.equal(parentOf(host, c), pageId);

    assert.deepEqual(editor.foreign, []);
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
