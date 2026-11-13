import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { designToMarkup } from "../packages/code-ir/src/index.ts";
import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { TEST_ORIGIN, browserTestOptions, launchPage } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { client, hostPool, ok } from "./support/host-api.mjs";

// A layer as a standalone HTML page: its markup, the design tokens it uses and its page's
// stylesheet, drawn in a browser as the canvas draws it, loading and running nothing.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 13, 12, 0, 0) + clock++ * 1000).toISOString();

test("the design subset as HTML: escaped, void elements unclosed, React names as HTML ones, code as a comment", () => {
  const markup = designToMarkup({ componentName: "Card", root: { tag: "section", props: { className: "card", "data-x": "a\"b&c" }, style: { padding: "8px", "--brand": "#fff" }, children: [
    { tag: "h2", props: {}, text: "<Hi> & bye" },
    { tag: "label", props: { htmlFor: "email" }, text: "Email" },
    { tag: "input", props: { id: "email", disabled: true, readOnly: false } },
    { tag: "#expression", props: {}, code: "{items.map(--x)}" },
  ] } });
  assert.equal(markup, '<section class="card" data-x="a&quot;b&amp;c" style="padding: 8px; --brand: #fff"><h2>&lt;Hi&gt; &amp; bye</h2><label for="email">Email</label><input id="email" disabled><!-- code: {items.map(- -x)} --></section>');
  for (const tag of ["script", "style", "iframe"]) assert.throws(() => designToMarkup({ componentName: "X", root: { tag, props: {} } }), /is not exported as HTML/u, tag);
  assert.throws(() => designToMarkup({ componentName: "X", root: { tag: "div", props: { onclick: "x()" } } }), /event handler onclick is not exported/u);
});

const PAGE = `<!doctype html><html><head><style>
body{color:rgb(1, 2, 3);font-family:serif}
.title{color:rgb(78, 115, 223);font-weight:800;letter-spacing:0.5px}
body > .title{text-transform:uppercase}
.note{padding:12px;background:rgb(240, 240, 240);border-radius:6px}
</style></head><body><h1 class="title">Dashboard</h1><p class="note">Welcome &amp; hello</p><p>Plain</p></body></html>`;

test("the host exports a layer as a page that loads and runs nothing, with its stylesheet scoped to it", async (t) => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ninerr-html-export-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const { call } = await pool.open(root);
  await ok(call("POST", "/api/projects/create", { name: "site" }), "create");
  const review = await ok(call("POST", "/api/import", { html: PAGE, name: "Dashboard" }), "review");
  const event = await ok(call("POST", "/api/import/commit", { proposalId: review.proposalId }), "commit");
  const page = await ok(call("POST", "/api/code/export-html", { nodeId: event.frameId }), "export");
  assert.equal(page.layers, 4);
  assert.match(page.html, /^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">/u);
  assert.match(page.html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">/u);
  assert.match(page.html, /<title>Dashboard<\/title>/u);
  assert.match(page.html, /@scope \(\[data-ninerr-page\]\) \{\n:scope\{color:rgb\(1, 2, 3\);font-family:serif\}/u);
  // The layer that holds the stylesheet is its scope itself, with no wrapper around it.
  assert.match(page.html, /<body>\n<[a-z]+ [^>]*data-ninerr-page=""/u);
  assert.doesNotMatch(page.html, /<div data-ninerr-page>/u);
  assert.match(page.html, /@layer ninerr-canvas \{\nbody \{ margin: 0; font-family: system-ui, sans-serif; \}\n\}/u);
  assert.match(page.html, /<p class="note">Welcome &amp; hello<\/p>/u);
  assert.doesNotMatch(page.html, /<script|url\(|@import/iu);
  assert.equal((await call("POST", "/api/code/export-html", { nodeId: "no-such-layer" })).status, 404);
});

// For each named text, the look of the element that holds it: on the canvas a text is in a layer
// of its own inside that element, so with `tags` the holder is the nearest element of that tag.
const LOOK = (doc, texts, tags = null) => Object.fromEntries(texts.map((text) => {
  let element = [...doc.querySelectorAll("body *")].find((candidate) => candidate.children.length === 0 && candidate.textContent.trim() === text);
  if (tags !== null) while (element && element.tagName !== tags[text]) element = element.parentElement;
  if (!element) return [text, null];
  const style = doc.defaultView.getComputedStyle(element);
  const box = element.getBoundingClientRect();
  return [text, { tag: element.tagName, transform: style.textTransform, color: style.color, fontFamily: style.fontFamily, fontWeight: style.fontWeight, letterSpacing: style.letterSpacing, padding: style.padding, background: style.backgroundColor, radius: style.borderRadius, height: Math.round(box.height) }];
}));
const TEXTS = ["Dashboard", "Welcome & hello", "Plain"];

test("the exported page draws in a browser as the canvas draws the layer", browserTestOptions(), async () => {
  const projects = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-html-parity-")));
  const host = await startStudioHost({ projectsRoot: projects, now });
  const editor = await openEditor(host);
  let exported;
  let drawn;
  let shown;
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("site");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    const call = client(host.url, host.token);
    const review = await ok(call("POST", "/api/import", { html: PAGE, name: "Dashboard" }), "review");
    const event = await ok(call("POST", "/api/import/commit", { proposalId: review.proposalId }), "commit");
    await waitRevision(page, 1);
    exported = (await ok(call("POST", "/api/code/export-html", { nodeId: event.frameId }), "export")).html;
    // The exported page in a plain browser page; then the canvas, measuring the same elements.
    const browser = await launchPage({ extraRoutes: { "/exported.html": { status: 200, contentType: "text/html", body: exported } } });
    try {
      await browser.page.goto(`${TEST_ORIGIN}/exported.html`);
      shown = await browser.page.evaluate(`(${LOOK})(document, ${JSON.stringify(TEXTS)})`);
    } finally {
      await browser.close();
    }
    const tags = Object.fromEntries(TEXTS.map((text) => [text, shown[text].tag]));
    drawn = await page.evaluate(`(${LOOK})(document.querySelector("iframe").contentDocument, ${JSON.stringify(TEXTS)}, ${JSON.stringify(tags)})`);
    // The editor's button copies the same page.
    await page.locator('#layers [role=treeitem][data-node-id="' + event.frameId + '"] > .row').click();
    await page.locator("#action-code").click();
    await page.locator("#code-export-html").click();
    await page.waitForFunction(() => /HTML page copied|code box/u.test(document.getElementById("status").textContent));
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(projects, { recursive: true, force: true });
  }
  // The canvas gives every page system-ui where a browser's default is its own; this page sets
  // its own font, so the two agree on everything measured (heights within a pixel of rounding).
  for (const text of TEXTS) {
    const { height: shownHeight, ...shownLook } = shown[text];
    const { height: drawnHeight, ...drawnLook } = drawn[text];
    assert.deepEqual(shownLook, drawnLook, text);
    assert.ok(Math.abs(shownHeight - drawnHeight) <= 1, `${text}: ${shownHeight} exported, ${drawnHeight} on the canvas`);
  }
  assert.equal(drawn.Dashboard.color, "rgb(78, 115, 223)");
  assert.equal(drawn.Dashboard.transform, "uppercase", "a rule for the page's own children applies");
  assert.equal(drawn["Welcome & hello"].padding, "12px");
  assert.equal(drawn.Plain.color, "rgb(1, 2, 3)", "the page's body colour reaches it, on the canvas and in the export");
});
