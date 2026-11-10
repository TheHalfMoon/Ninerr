import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { TEST_ORIGIN, browserTestOptions, launchPage } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { client, hostPool, ok } from "./support/host-api.mjs";
import { frameSrcdoc } from "../packages/renderer/src/index.mjs";

// Astryx milestone C: a page Astryx's own static renderer produced (its login-card template,
// rendered by @astryxdesign/cli 0.7.11; tests/fixtures/astryx/NOTICE.md) comes onto Ninerr's
// script-free canvas through the existing HTML import, and the canvas draws it as Astryx does.

const PAGE = readFileSync(new URL("./fixtures/astryx/login-card.html", import.meta.url), "utf8");
let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 10, 12, 0, 0) + clock++ * 1000).toISOString();

// For each named text, the box and look of the element that holds it, measured in `doc`. With
// `holders` (each text's holder in Astryx's page, by class), the holder is that element: the canvas
// holds a text in a layer of its own inside the element the page put it in.
const MEASURE = (doc, texts, holders = null) => {
  const found = {};
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim();
    if (!texts.includes(text) || found[text]) continue;
    let element = node.parentElement;
    if (holders !== null) while (element && element.getAttribute("class") !== holders[text]) element = element.parentElement;
    if (!element) continue;
    // What is visible of it: its box clipped by each ancestor that hides overflow (the canvas
    // holds a text in a layer of its own, inside the element the page put it in).
    let { left, top, right, bottom } = element.getBoundingClientRect();
    for (let clip = element.parentElement; clip; clip = clip.parentElement) {
      if (doc.defaultView.getComputedStyle(clip).overflow === "visible") continue;
      const edge = clip.getBoundingClientRect();
      [left, top, right, bottom] = [Math.max(left, edge.left), Math.max(top, edge.top), Math.min(right, edge.right), Math.min(bottom, edge.bottom)];
    }
    const box = { width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    const style = doc.defaultView.getComputedStyle(element);
    let painted = element;
    while (painted && doc.defaultView.getComputedStyle(painted).backgroundColor === "rgba(0, 0, 0, 0)") painted = painted.parentElement;
    found[text] = {
      holder: element.getAttribute("class"),
      width: Math.round(box.width), height: Math.round(box.height),
      color: style.color, fontSize: style.fontSize, fontWeight: style.fontWeight, fontFamily: style.fontFamily,
      background: painted ? doc.defaultView.getComputedStyle(painted).backgroundColor : null,
    };
  }
  return found;
};
const TEXTS = ["Welcome back", "Sign in to your account", "Login", "Login with Apple", "Email", "Or continue with", "Terms of Service"];

test("Astryx's rendered page imports as layers with its stylesheet, its source block removed", async (t) => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ninerr-astryx-page-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const { call } = await pool.open(root);
  await ok(call("POST", "/api/projects/create", { name: "astryx" }), "create");
  const review = await ok(call("POST", "/api/import", { html: PAGE, name: "Login card" }), "review");
  assert.equal(review.commitReady, true);
  assert.equal(review.security.scriptsRemoved, 1, "Astryx's embedded source block is not carried");
  assert.equal(review.counts.stylesheets, 1);
  const event = await ok(call("POST", "/api/import/commit", { proposalId: review.proposalId }), "commit");
  const { document } = await ok(call("GET", "/api/document"), "document");
  const nodes = Object.values(document.nodes);
  for (const text of TEXTS) assert.ok(nodes.some((node) => node.props.text === text), text);
  assert.ok(nodes.some((node) => /\bastryx-link\b/u.test(node.props.attributes?.class ?? "")), "its stable classes stay");
  const sheet = document.nodes[event.frameId].props.stylesheet;
  assert.match(sheet, /--color-accent:light-dark\(/u, "its tokens come with it, scoped to the page frame");
  assert.doesNotMatch(sheet, /url\(|@import/u);
});

// The canvas gives every page a base font (system-ui) where a browser's default is its own; a
// page that sets no font of its own, as this untheme'd template, shows the difference. Astryx's
// rendering is measured with the canvas's base font, so what is compared is how Ninerr draws
// Astryx's markup and CSS.
const BASE_FONT = "body{font-family:system-ui,sans-serif}";

test("the canvas draws Astryx's page as Astryx's own rendering does", browserTestOptions(), async () => {
  assert.ok(frameSrcdoc().includes(BASE_FONT), "the canvas's base font is the one compared with");
  const page = PAGE.replace("</head>", `<style>${BASE_FONT}</style></head>`);
  const original = await launchPage({ extraRoutes: { "/astryx.html": { status: 200, contentType: "text/html", body: page } } });
  let expected;
  try {
    await original.page.setViewportSize({ width: 1280, height: 900 });
    await original.page.goto(`${TEST_ORIGIN}/astryx.html`);
    expected = await original.page.evaluate(`(${MEASURE})(document, ${JSON.stringify(TEXTS)})`);
  } finally {
    await original.close();
  }
  assert.deepEqual(Object.keys(expected).sort(), [...TEXTS].sort(), "every text is on Astryx's page");

  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-astryx-canvas-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("astryx");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    const call = client(host.url, host.token);
    const review = await ok(call("POST", "/api/import", { html: PAGE, name: "Login card" }), "review");
    await ok(call("POST", "/api/import/commit", { proposalId: review.proposalId }), "commit");
    await waitRevision(page, 1);
    const holders = Object.fromEntries(Object.entries(expected).map(([text, entry]) => [text, entry.holder]));
    const drawn = await page.evaluate(`(${MEASURE})(document.querySelector("iframe").contentDocument, ${JSON.stringify(TEXTS)}, ${JSON.stringify(holders)})`);
    for (const text of TEXTS) {
      const [want, got] = [expected[text], drawn[text]];
      assert.ok(got, `${text} is drawn`);
      for (const property of ["color", "fontSize", "fontWeight", "fontFamily", "background"]) assert.equal(got[property], want[property], `${text}: ${property}`);
      assert.ok(Math.abs(got.width - want.width) <= 1 && Math.abs(got.height - want.height) <= 1, `${text}: ${got.width}x${got.height}, Astryx ${want.width}x${want.height}`);
    }
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
