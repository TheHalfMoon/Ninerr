import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { hostPool, ok } from "./support/host-api.mjs";

// #291 item 3 (from the reviews of #289): in the Code dialog, a conflict's choice that fails
// half-way left a state to act on wrongly. While one choice is under way, the conflict's other
// button is disabled too; a Keep whose review fails is not kept; and after a Take whose
// review fails, the plan shown, now out of date, is taken down.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 12, 12, 0, 0) + clock++ * 1000).toISOString();
const CARD = `export function PriceCard() {
  return (
    <section className="card">
      <h2 title="Plan">Pro</h2>
      <p>Everything in Free.</p>
    </section>
  );
}
`;

test("a conflict's choice that fails half-way leaves nothing to act on wrongly", browserTestOptions(), async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-code-dialog-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "projects"));
  mkdirSync(join(root, "app"));
  const file = join(root, "app", "Card.jsx");
  writeFileSync(file, CARD);
  const running = await pool.open(join(root, "projects"));
  const { call } = running;
  await ok(call("POST", "/api/projects/create", { name: "site" }), "create");
  await ok(call("POST", "/api/codebase/connect", { folder: join(root, "app") }), "connect");
  const brought = await ok(call("POST", "/api/codebase/import", { file: "Card.jsx", component: "PriceCard" }), "bring in");
  const { document, revision } = await ok(call("GET", "/api/document"), "document");
  const section = document.nodes[brought.frameId].children[0];
  const [heading] = document.nodes[section].children;
  // The heading's text and title, changed differently here and in the file.
  await ok(call("POST", "/api/edit", { baseRevision: revision, intent: "Edit", operations: [{ type: "set-props", nodeId: heading, set: { text: "Team", attributes: { title: "Teams" } } }] }), "edit");
  writeFileSync(file, CARD.replace(">Pro<", ">Business<").replace("title=\"Plan\"", "title=\"Plans\""));

  const editor = await openEditor(running.host);
  t.after(() => editor.close());
  const { page } = editor;
  await waitRevision(page, revision + 1);
  await page.locator(`[role=treeitem][data-node-id="${section}"] > .row`).click();
  await page.locator("#action-code").click();
  await page.locator("#codebase-review").click();
  const conflict = (field) => page.locator("#codebase-preview li", { hasText: `${field}: here` });
  await conflict("text").waitFor();

  // Keep, with its review held and then failed: the conflict's Take is disabled meanwhile,
  // and afterwards the field is not kept.
  let hold = null;
  let failNext = false;
  await page.route("**/api/codebase/preview", async (route) => {
    if (hold !== null) await hold;
    if (failNext) {
      failNext = false;
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "test-failure", message: "the review failed (test)" } }) });
    }
    return route.continue();
  });
  let release;
  hold = new Promise((resolve) => (release = resolve));
  failNext = true;
  await conflict("text").locator("button.keep-here").click();
  await page.waitForFunction(() => document.querySelector("#codebase-preview li button.keep-here")?.disabled === true);
  assert.equal(await conflict("text").locator("button.take-file").isDisabled(), true, "the other choice waits");
  assert.equal(await conflict("title").locator("button.take-file").isDisabled(), true, "and so do the other conflicts'");
  assert.equal(await page.locator("#codebase-review").isDisabled(), true, "and the review");
  hold = null;
  release();
  await page.locator("#dialog[open] .error[role=alert]", { hasText: "the review failed (test)" }).waitFor();
  assert.equal(await conflict("text").locator("button.take-file").isDisabled(), false);
  assert.equal(await conflict("text").locator("button.keep-here").isDisabled(), false);
  assert.equal(await page.locator("#codebase-review").isDisabled(), false);
  const again = page.waitForRequest("**/api/codebase/preview");
  await page.locator("#codebase-review").click();
  assert.deepEqual((await again).postDataJSON().keep, [], "a Keep whose review failed is not kept");
  await page.waitForFunction(() => document.getElementById("codebase-preview").textContent.includes("text: here"));

  // Take, with the review after it failed: taken once, and the plan shown is taken down.
  failNext = true;
  await conflict("title").locator("button.take-file").click();
  await waitRevision(page, revision + 2);
  await page.locator("#codebase-preview", { hasText: "Took the file's title. Review the write-back again" }).waitFor();
  assert.equal(await page.locator("#codebase-preview button").count(), 0, "nothing left to act on");
  const after = await ok(call("GET", "/api/document"), "document");
  assert.equal(after.document.nodes[heading].props.attributes.title, "Plans");
  assert.deepEqual(editor.foreign, []);
});

// #291 item 4: a conflict whose value here cannot be written (text with < or >) can only be
// taken from the file, and the editor offers only that, with the reason.
test("a conflict that cannot be kept offers only Take, and says why", browserTestOptions(), async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-code-dialog-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "projects"));
  mkdirSync(join(root, "app"));
  const file = join(root, "app", "Card.jsx");
  writeFileSync(file, CARD);
  const running = await pool.open(join(root, "projects"));
  const { call } = running;
  await ok(call("POST", "/api/projects/create", { name: "site" }), "create");
  await ok(call("POST", "/api/codebase/connect", { folder: join(root, "app") }), "connect");
  const brought = await ok(call("POST", "/api/codebase/import", { file: "Card.jsx", component: "PriceCard" }), "bring in");
  const { document, revision } = await ok(call("GET", "/api/document"), "document");
  const section = document.nodes[brought.frameId].children[0];
  const [heading] = document.nodes[section].children;
  await ok(call("POST", "/api/edit", { baseRevision: revision, intent: "Edit", operations: [{ type: "set-props", nodeId: heading, set: { text: "Team <b>" } }] }), "edit");
  writeFileSync(file, CARD.replace(">Pro<", ">Business<"));
  const editor = await openEditor(running.host);
  t.after(() => editor.close());
  const { page } = editor;
  await waitRevision(page, revision + 1);
  await page.locator(`[role=treeitem][data-node-id="${section}"] > .row`).click();
  await page.locator("#action-code").click();
  await page.locator("#codebase-review").click();
  const item = page.locator("#codebase-preview li", { hasText: "text: here" });
  await item.waitFor();
  assert.equal(await item.locator("button.take-file").count(), 1);
  assert.equal(await item.locator("button.keep-here").count(), 0, "nothing to keep");
  assert.match(await item.textContent(), /— text with \{ \} < or > is not written as JSX text/u);
  assert.deepEqual(editor.foreign, []);
});
