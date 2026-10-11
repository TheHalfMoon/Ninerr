import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { frameStylesheet } from "../packages/import-stack/src/index.ts";
import { designViewportLengths, planElement } from "../packages/renderer/src/index.mjs";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { hostPool, ok } from "./support/host-api.mjs";

// #283 step 2 (found by P08-G11 dogfooding): the design model had no stylesheets, so an
// imported page's CSS was dropped and a real site came in unstyled. An import's sanitized
// stylesheets now go to its page frame, the canvas applies them to that frame alone, and the
// host refuses a stylesheet that loads or executes anything, whoever sets it.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 11, 12, 0, 0) + clock++ * 1000).toISOString();
const PAGE = `<!doctype html><html><head><style>
body{color:rgb(1, 2, 3);font-family:serif}
.title{color:rgb(78, 115, 223);font-weight:800}
.hero{background:url(hero.png);padding:16px}
@media (min-width:1px){.note{color:rgb(10, 20, 30)}}
</style></head><body><h1 class="title">Dashboard</h1><p class="hero note">Welcome</p><p>Plain</p></body></html>`;

async function host(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-frame-css-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const running = await pool.open(root);
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  return running;
}

async function imported(running, html = PAGE) {
  const review = await ok(running.call("POST", "/api/import", { html, name: "Dashboard" }), "review");
  const event = await ok(running.call("POST", "/api/import/commit", { proposalId: review.proposalId }), "commit");
  return { review, event };
}

test("the selectors that name the page are renamed to the frame", () => {
  assert.equal(
    frameStylesheet(["html{margin:0}body .a{color:red}:root{--x:1}html body,html>body.dark{color:blue}.body{color:green}@media print{body{display:none}}"]),
    ":scope{margin:0}:scope .a{color:red}:scope{--x:1}:scope,:scope.dark{color:blue}.body{color:green}@media print{:scope{display:none}}",
  );
  assert.equal(frameStylesheet([".a{color:red}", ".b{color:blue}"]), ".a{color:red}\n.b{color:blue}", "in document order");
});

test("an import's stylesheets go to its page frame, sanitized and scoped", async (t) => {
  const running = await host(t);
  const { review, event } = await imported(running);
  assert.ok(review.notes.some((note) => /1 stylesheet is carried into the page frame/u.test(note)), JSON.stringify(review.notes));
  const { document } = await ok(running.call("GET", "/api/document"), "document");
  const sheet = document.nodes[event.frameId].props.stylesheet;
  assert.match(sheet, /^\s*:scope\{color:rgb\(1, 2, 3\);font-family:serif\}/u);
  assert.match(sheet, /\.hero\{padding:16px\}/u, "the loading declaration is removed, the rest kept");
  assert.doesNotMatch(sheet, /url\(/u);
  // Code export carries it beside the code, for the frame and for a layer inside it.
  const inside = document.nodes[event.frameId].children[0];
  for (const nodeId of [event.frameId, inside]) assert.equal((await ok(running.call("POST", "/api/code/export", { nodeId }), "export")).stylesheet, sheet);
});

test("a stylesheet that loads or executes is refused, whoever sets it", async (t) => {
  const running = await host(t);
  const { event } = await imported(running);
  let revision = event.revision;
  for (const stylesheet of [".a{background:url(x.png)}", "@import \"x.css\";", ".a{background:\\75rl(x)}", ".a{width:expression(1)}", 42, "a".repeat(1024 * 1024 + 1)]) {
    for (const operation of [
      { type: "set-props", nodeId: event.frameId, set: { stylesheet } },
      { type: "insert-node", parentId: event.frameId, index: 0, node: { id: `n-${revision}`, type: "frame", parentId: event.frameId, children: [], props: { stylesheet }, metadata: {} } },
    ]) {
      const refused = await running.call("POST", "/api/edit", { baseRevision: revision, intent: "Style", operations: [operation] });
      // Past 1 MiB the request itself is too large for the host; either way it is refused.
      const expected = typeof stylesheet === "string" && stylesheet.length > 1024 * 1024 ? [413, "too-large"] : [400, "unsafe-stylesheet"];
      assert.deepEqual([refused.status, refused.json?.error?.code], expected, `${operation.type}: ${String(stylesheet).slice(0, 40)}`);
    }
  }
  // A safe one is taken.
  await ok(running.call("POST", "/api/edit", { baseRevision: revision, intent: "Style", operations: [{ type: "set-props", nodeId: event.frameId, set: { stylesheet: ".title{color:red}" } }] }), "safe stylesheet");
  revision += 1;
  const { document } = await ok(running.call("GET", "/api/document"), "document");
  assert.equal(document.nodes[event.frameId].props.stylesheet, ".title{color:red}");
});

test("the renderer draws a stylesheet only when it loads and executes nothing", () => {
  const node = (stylesheet) => ({ id: "f", type: "frame", props: { stylesheet } });
  assert.equal(planElement(node(".a{color:red}")).stylesheet, ".a{color:red}");
  for (const unsafe of [".a{background:url(x)}", ".a{background:\\75rl(x)}", "@import 'x';", ".a{background:image-set('a' 1x)}", "</style><b>", 7]) {
    const plan = planElement(node(unsafe));
    assert.deepEqual([plan.stylesheet, plan.dropped], [null, 1], String(unsafe));
  }
  assert.equal(planElement({ id: "f", type: "frame", props: {} }).stylesheet, null);
});

test("the canvas applies an imported page's stylesheet to its frame alone, live and after a reload", browserTestOptions(), async (t) => {
  const running = await host(t);
  const editor = await openEditor(running.host);
  t.after(() => editor.close());
  const { page } = editor;
  const { event } = await imported(running);
  // A second frame with the same class names, outside the import: the sheet must not reach it.
  const other = { id: "other", type: "frame", parentId: null, children: ["other-title"], props: { tag: "div", name: "Other" }, metadata: {} };
  const otherTitle = { id: "other-title", type: "text", parentId: "other", children: [], props: { tag: "h1", text: "Elsewhere", attributes: { class: "title" } }, metadata: {} };
  await ok(running.call("POST", "/api/edit", { baseRevision: event.revision, intent: "Another frame", operations: [{ type: "restore-subtree", rootId: "other", parentId: null, nodes: [other, otherTitle] }] }), "other frame");
  await waitRevision(page, event.revision + 1);
  const colours = () => page.evaluate(({ frameId }) => {
    const frame = document.querySelector("iframe").contentDocument;
    const colour = (selector) => {
      const element = frame.querySelector(selector);
      return element === null ? null : getComputedStyle(element).color;
    };
    return { title: colour(`[data-ninerr-id="${frameId}"] .title`), note: colour(`[data-ninerr-id="${frameId}"] .note`), body: colour(`[data-ninerr-id="${frameId}"] p:not(.note)`), elsewhere: colour('[data-ninerr-id="other"] .title') };
  }, { frameId: event.frameId });
  const expected = { title: "rgb(78, 115, 223)", note: "rgb(10, 20, 30)", body: "rgb(1, 2, 3)", elsewhere: "rgb(0, 0, 0)" };
  assert.deepEqual(await colours(), expected);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  await waitRevision(page, event.revision + 1);
  assert.deepEqual(await colours(), expected, "the same after a reload");
  // Undoing the import removes its stylesheet with it.
  await ok(running.call("POST", "/api/undo"), "undo the other frame");
  await ok(running.call("POST", "/api/undo"), "undo the import");
  await waitRevision(page, event.revision + 3);
  assert.equal(await page.evaluate(() => document.querySelector("iframe").contentDocument.querySelectorAll("style[data-ninerr-sheet]").length), 0);
  assert.deepEqual(editor.foreign, []);
  assert.deepEqual(editor.errors, []);
});

// #283 step 3: the page's linked stylesheets are read from the files chosen with it.
const LINKED = `<!doctype html><html><head>
<link rel="stylesheet" href="css/site.css">
<link rel="stylesheet" href="https://fonts.example/css?family=Nunito">
<style>.title{font-weight:800}</style>
</head><body><h1 class="title">Dashboard</h1><p class="lead">Welcome</p></body></html>`;
const SITE_CSS = "body{color:rgb(1, 2, 3)}.title{color:rgb(78, 115, 223)}.lead{background:url(lead.png);color:rgb(5, 6, 7)}";

test("a page's linked stylesheets are read from the files chosen with it, and nothing is fetched", async (t) => {
  const running = await host(t);
  const review = await ok(running.call("POST", "/api/import", { html: LINKED, name: "Dashboard", stylesheets: [{ name: "SITE.css", css: SITE_CSS }, { name: "unused.css", css: ".x{color:red}" }] }), "review");
  assert.ok(review.notes.includes("Linked stylesheet read from the files chosen with the page: site.css."), JSON.stringify(review.notes));
  assert.ok(review.notes.includes("Linked stylesheet not chosen with the page, so not read: https://fonts.example/css?family=Nunito."), JSON.stringify(review.notes));
  assert.ok(review.notes.some((note) => /2 stylesheets are carried into the page frame/u.test(note)), JSON.stringify(review.notes));
  const event = await ok(running.call("POST", "/api/import/commit", { proposalId: review.proposalId }), "commit");
  const { document } = await ok(running.call("GET", "/api/document"), "document");
  // The linked sheet first (sanitized, its page selector renamed), then the inline one.
  assert.equal(document.nodes[event.frameId].props.stylesheet, ":scope{color:rgb(1, 2, 3)}.title{color:rgb(78, 115, 223)}.lead{color:rgb(5, 6, 7)}\n.title{font-weight:800}");
  for (const stylesheets of ["site.css", [{ name: "", css: "" }], [{ name: "a.css", css: 1 }], Array.from({ length: 65 }, (_, index) => ({ name: `${index}.css`, css: "" }))]) {
    const refused = await running.call("POST", "/api/import", { html: LINKED, stylesheets });
    assert.deepEqual([refused.status, refused.json?.error?.code], [400, "invalid-import"], JSON.stringify(stylesheets).slice(0, 40));
  }
});

test("in the editor, a page imported with its stylesheet file is drawn styled", browserTestOptions(), async (t) => {
  const running = await host(t);
  const editor = await openEditor(running.host);
  t.after(() => editor.close());
  const { page } = editor;
  await page.locator("#action-import").click();
  await page.locator("#import-file").setInputFiles([
    { name: "index.html", mimeType: "text/html", buffer: Buffer.from(LINKED) },
    { name: "site.css", mimeType: "text/css", buffer: Buffer.from(SITE_CSS) },
  ]);
  await page.locator("#dialog[open] button[type=submit]").click();
  await page.locator("#dialog[open]", { hasText: "read from the files chosen with the page: site.css" }).waitFor();
  await page.locator("#dialog[open] button.primary").click();
  await waitRevision(page, 1);
  const colour = await page.evaluate(() => getComputedStyle(document.querySelector("iframe").contentDocument.querySelector(".title")).color);
  assert.equal(colour, "rgb(78, 115, 223)");
  assert.deepEqual(editor.foreign, []);
  assert.deepEqual(editor.errors, []);
});

// #298 review: a "}" a sheet did not open would end the frame's @scope on the canvas.
test("a stylesheet that closes a block it did not open is refused, and left out of an import", async (t) => {
  const running = await host(t);
  const { event } = await imported(running);
  for (const stylesheet of [".a{color:red}}[data-ninerr-root] *{visibility:hidden}", "}@scope ([data-ninerr-id=\"x\"]){*{display:none}}", "}", ".t{}\"\f}\n.u{color:red}", ".t{}\"\r}\n.u{color:red}", ".t{}\"\\\r\n{\"}\n.u{color:red}"]) {
    const refused = await running.call("POST", "/api/edit", { baseRevision: event.revision, intent: "Style", operations: [{ type: "set-props", nodeId: event.frameId, set: { stylesheet } }] });
    assert.deepEqual([refused.status, refused.json?.error?.code], [400, "unsafe-stylesheet"], stylesheet);
  }
  // Braces inside strings, comments and url() are not structure.
  await ok(running.call("POST", "/api/edit", { baseRevision: event.revision, intent: "Style", operations: [{ type: "set-props", nodeId: event.frameId, set: { stylesheet: ".a::after{content:\"}\"}/* } */" } }] }), "braces in a string and a comment");
  const page = "<style>.a{color:red}}*{visibility:hidden}</style><style>.b{color:blue}</style><p class=\"a b\">x</p>";
  const second = await imported(running, page);
  const { document } = await ok(running.call("GET", "/api/document"), "document");
  assert.equal(document.nodes[second.event.frameId].props.stylesheet, ".b{color:blue}");
});

test("an import near the CSS limit commits, though renaming its page selectors makes it longer", async (t) => {
  const running = await host(t);
  const rules = "body{color:red}".repeat(66_000);
  // imported() commits it: the review was not blocked, and the frame's limit took it.
  const { event } = await imported(running, `<style>${rules}</style><p>x</p>`);
  const { document } = await ok(running.call("GET", "/api/document"), "document");
  assert.ok(document.nodes[event.frameId].props.stylesheet.length > rules.length);
  // And the canvas draws it.
  assert.equal(planElement(document.nodes[event.frameId]).stylesheet, document.nodes[event.frameId].props.stylesheet);
});

test("two chosen stylesheet files with the same name are refused", async (t) => {
  const running = await host(t);
  const refused = await running.call("POST", "/api/import", { html: LINKED, stylesheets: [{ name: "site.css", css: ".a{}" }, { name: "SITE.CSS", css: ".b{}" }] });
  assert.deepEqual([refused.status, refused.json?.error?.code], [400, "invalid-import"]);
  const review = await ok(running.call("POST", "/api/import", { html: LINKED, stylesheets: [{ name: "site.css", css: SITE_CSS }] }), "review");
  assert.ok(review.notes.includes("1 linked resource is not fetched: imports work offline."), JSON.stringify(review.notes));
});

test("the canvas drops a stylesheet that would end its frame's scope, even one written by hand", browserTestOptions(), async () => {
  const { readFileSync } = await import("node:fs");
  const { chromium } = await import("playwright-core");
  const { findBrowser } = await import("./support/browser.mjs");
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><head></head><body><div id=\"root\"></div></body></html>");
    const source = readFileSync(new URL("../packages/renderer/src/index.mjs", import.meta.url), "utf8");
    await page.addScriptTag({ type: "module", content: `${source}\nwindow.renderForTest = (doc) => { const renderer = createRenderer(document.getElementById("root")); renderer.render(doc); return renderer.stats.dropped; };` });
    await page.waitForFunction(() => typeof window.renderForTest === "function");
    const result = await page.evaluate(() => {
      const node = (id, parentId, children, props) => ({ id, type: parentId === null ? "frame" : "text", parentId, children, props, metadata: {} });
      const doc = {
        rootIds: ["a", "b", "c"],
        nodes: {
          a: node("a", null, ["a-t"], { tag: "div", stylesheet: "}\n.t{color:rgb(255, 0, 0)}" }),
          "a-t": node("a-t", "a", [], { tag: "p", text: "A", attributes: { class: "t" } }),
          b: node("b", null, ["b-t"], { tag: "div", stylesheet: ":scope{--c:rgb(0, 0, 255)} .u{color:var(--c)}" }),
          // Global even inside @scope: it would turn b's --c red.
          c: node("c", null, [], { tag: "div", stylesheet: "@property --c{syntax:\"<color>\";inherits:false;initial-value:rgb(255, 0, 0)}.x{color:red}" }),
          "b-t": node("b-t", "b", [], { tag: "p", text: "B", attributes: { class: "t u" } }),
        },
      };
      const dropped = window.renderForTest(doc);
      const colour = (id) => getComputedStyle(document.querySelector(`[data-ninerr-id="${id}"]`)).color;
      return { dropped, sheets: document.querySelectorAll("style[data-ninerr-sheet]").length, a: colour("a-t"), b: colour("b-t") };
    });
    // a's sheet is removed; c's @property rule is removed, c's own rule kept.
    assert.deepEqual(result, { dropped: 2, sheets: 2, a: "rgb(0, 0, 0)", b: "rgb(0, 0, 255)" });
  } finally {
    await browser.close();
  }
});

// Found dogfooding sb-admin-2 with #283: on the canvas, 100vh is the canvas frame's height,
// which the canvas sets to fit the content: a page with min-height:100vh outgrew the frame on
// every resize, and what lay below was out of reach. The renderer draws viewport lengths as
// pixels of the design viewport (1024 × 768); the document keeps what was written.
test("viewport lengths are drawn as pixels of the design viewport, strings and names aside", () => {
  for (const [value, drawn] of [
    ["100vh", "768px"],
    ["calc(100vh - 2*10vw)", "calc(768px - 2*102.4px)"],
    ["-10dvh 0", "-76.8px 0"],
    ["10vb 5VI", "76.8px 51.2px"],
    ["10vmin 10vmax", "76.8px 102.4px"],
    ["1e2vh", "768px"],
    ["\"100vh tall\" 10vh", "\"100vh tall\" 76.8px"],
    ["10vhx", "10vhx"],
    ["var(--h-100vh)", "var(--h-100vh)"],
  ]) assert.equal(designViewportLengths(value), drawn, value);
});

test("a page using viewport heights fits on the canvas, and stays fitted after an edit", browserTestOptions(), async (t) => {
  const running = await host(t);
  const html = `<style>.side{min-height:100vh;background:#4e73df}.pad{padding:var(--p,0px) 0 20vh 0}.pair{margin-block-start:10vh;padding-top:10vh;margin-top:3px}@scope (.side){.inner{height:10vb}}.card{&:hover{color:red}.body{height:10vh}}</style><div class="side">Menu<span class="inner">x</span></div><p style="height:50vh">Tall</p><div class="card"><p class="body">b</p></div>${"<p>Row</p>".repeat(30)}<p class="pad">p</p><p class="pair">q</p><p class="last">The end</p>`;
  // Imported before the editor opens, so the editor loads it.
  const { event } = await imported(running, html);
  const editor = await openEditor(running.host);
  t.after(() => editor.close());
  const { page } = editor;
  await waitRevision(page, event.revision);
  const fit = () => page.evaluate(() => {
    const iframe = document.querySelector("iframe");
    const last = iframe.contentDocument.querySelector(".last").getBoundingClientRect();
    return { frame: iframe.offsetHeight, lastBottom: Math.ceil(last.bottom), side: Math.round(iframe.contentDocument.querySelector(".side").getBoundingClientRect().height) };
  });
  const first = await fit();
  assert.equal(first.side, 768);
  assert.ok(first.lastBottom <= first.frame, JSON.stringify(first));
  // The document keeps what was written.
  const { document } = await ok(running.call("GET", "/api/document"), "document");
  assert.match(document.nodes[event.frameId].props.stylesheet, /min-height:100vh/u);
  // A layer styled with a viewport height after the import fits too, and nothing grows again.
  await ok(running.call("POST", "/api/edit", { baseRevision: event.revision, intent: "Taller", operations: [{ type: "set-props", nodeId: event.frameId, set: { style: { ...document.nodes[event.frameId].props.style, "min-height": "100vh" } } }] }), "edit");
  await waitRevision(page, event.revision + 1);
  assert.deepEqual(await fit(), first, "the frame does not grow again");
  const nested = await page.evaluate(() => {
    const frame = document.querySelector("iframe").contentDocument;
    return [frame.querySelector(".inner"), frame.querySelector(".body")].map((element) => getComputedStyle(element).height);
  });
  // 10vh and 10vb of 768px, to the browser's layout precision.
  assert.ok(nested.every((height) => Math.abs(Number.parseFloat(height) - 76.8) < 0.1), `inside @scope and in a nested rule too: ${nested}`);
  // A shorthand waiting on var() is drawn against the design viewport too, and a logical and
  // physical pair keeps its order: the physical one, written last, wins.
  const drawn = await page.evaluate(() => {
    const frame = document.querySelector("iframe").contentDocument;
    const pad = getComputedStyle(frame.querySelector(".pad"));
    const pair = getComputedStyle(frame.querySelector(".pair"));
    return { padBottom: pad.paddingBottom, marginTop: pair.marginTop, paddingTop: pair.paddingTop };
  });
  assert.deepEqual(drawn, { padBottom: "153.6px", marginTop: "3px", paddingTop: "76.8px" });
  // Several changes in a row: the frame keeps its size.
  for (let step = 0; step < 5; step += 1) {
    await ok(running.call("POST", "/api/edit", { baseRevision: event.revision + 1 + step, intent: "Rename", operations: [{ type: "set-props", nodeId: event.frameId, set: { name: `Page ${step}` } }] }), "edit");
    await waitRevision(page, event.revision + 2 + step);
  }
  assert.deepEqual(await fit(), first, "the frame still fits, at the same size");
});
