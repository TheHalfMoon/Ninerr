import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { hostPool, ok } from "./support/host-api.mjs";

// P09 criterion 3 (a P08-G11 dogfooding finding): the inspector edits an element's classes,
// which its page's stylesheet styles it by. Each edit is one change, drawn at once, and undone.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 13, 12, 0, 0) + clock++ * 1000).toISOString();
const PAGE = `<!doctype html><html><head><style>
body{color:rgb(1, 2, 3)}
.title{color:rgb(78, 115, 223)}
.loud{color:rgb(200, 0, 0)}
</style></head><body><h1 class="title">Dashboard</h1><p>Plain</p></body></html>`;

test("the inspector edits an element's classes, drawn at once with its page's stylesheet, and undone", browserTestOptions(), async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-classes-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const running = await pool.open(root);
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  const review = await ok(running.call("POST", "/api/import", { html: PAGE, name: "Dashboard" }), "review");
  const { revision: imported } = await ok(running.call("POST", "/api/import/commit", { proposalId: review.proposalId }), "commit");
  const editor = await openEditor(running.host);
  t.after(() => editor.close());
  const { page } = editor;
  await waitRevision(page, imported);
  const nodes = () => running.host.session.document.nodes;
  // The element holding these words (HTML import gives it a text layer of its own, #235).
  const elementOf = (text) => Object.values(nodes()).find((node) => node.props?.text === text).parentId;
  const plain = elementOf("Plain");
  const title = elementOf("Dashboard");
  const colour = (id) => page.evaluate((nodeId) => getComputedStyle(document.querySelector("iframe").contentDocument.querySelector(`[data-ninerr-id="${nodeId}"]`)).color, id);
  const classes = page.locator("#inspect-classes");
  assert.equal(await colour(plain), "rgb(1, 2, 3)");

  // From the keyboard: select the paragraph in the layers tree, type its classes, leave the field.
  await page.locator(`[id="layer-${plain}"] > .row`).click();
  assert.equal(await classes.inputValue(), "");
  await classes.focus();
  await page.keyboard.type("loud  extra loud");
  await page.keyboard.press("Tab");
  await waitRevision(page, imported + 1);
  assert.equal(nodes()[plain].props.attributes.class, "loud extra", "each class once, in the order given");
  assert.equal(await classes.inputValue(), "loud extra");
  assert.equal(await colour(plain), "rgb(200, 0, 0)", "the page's stylesheet styles it at once");
  assert.equal(await page.locator("#history li .intent").first().textContent(), "Change classes");

  // The heading's class is shown; clearing it leaves no empty attribute behind.
  await page.locator(`[id="layer-${title}"] > .row`).click();
  assert.equal(await classes.inputValue(), "title");
  assert.equal(await colour(title), "rgb(78, 115, 223)");
  await classes.fill("");
  await classes.press("Enter");
  await waitRevision(page, imported + 2);
  assert.equal(nodes()[title].props.attributes?.class, undefined);
  assert.equal(await colour(title), "rgb(1, 2, 3)");

  // One undo each, in turn.
  await page.locator("#action-undo").click();
  await waitRevision(page, imported + 3);
  assert.equal(nodes()[title].props.attributes.class, "title");
  assert.equal(await colour(title), "rgb(78, 115, 223)");
  assert.equal(await classes.inputValue(), "title");
  await page.locator("#action-undo").click();
  await waitRevision(page, imported + 4);
  assert.equal(nodes()[plain].props.attributes?.class, undefined);
  assert.equal(await colour(plain), "rgb(1, 2, 3)");

  assert.deepEqual(editor.foreign, []);
  assert.deepEqual(editor.errors, []);
});
