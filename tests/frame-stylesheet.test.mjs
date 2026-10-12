import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { frameStylesheet } from "../packages/import-stack/src/index.ts";
import { designViewportLengths, drawnSelector, planElement } from "../packages/renderer/src/index.mjs";
import { exportJsx } from "../packages/studio-host/src/code.ts";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, reloadEditor, waitRevision } from "./support/editor.mjs";
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
  await reloadEditor(page, editor.pending);
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
  assert.ok(review.notes.includes("Linked stylesheet read from the files chosen with the page: SITE.css."), JSON.stringify(review.notes));
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

// #299 item 2: a link is matched to a chosen file by name only, so a link to another site is
// answered by the file, and two links with one name by the same file: the review says both.
test("the review says when a chosen file answers a link at a web address, or more than one link", async (t) => {
  const running = await host(t);
  const html = '<link rel="stylesheet" href="HTTPS://CDN.Example/x/Site.css"><link rel="stylesheet" href="css/site.css"><link rel="stylesheet" href="theme.css"><p class="lead">Hi</p>';
  const review = await ok(running.call("POST", "/api/import", { html, name: "Page", stylesheets: [{ name: "site.css", css: SITE_CSS }, { name: "theme.css", css: ".lead{font-weight:700}" }] }), "review");
  assert.ok(review.notes.includes("Read in place of a stylesheet at a web address, which is never fetched: site.css for https://cdn.example/x/Site.css."), JSON.stringify(review.notes));
  assert.ok(review.notes.includes("Chosen file read for more than one link: site.css (2 links)."), JSON.stringify(review.notes));
  // Each chosen file is named once, as chosen, however its links spell it.
  assert.ok(review.notes.includes("Linked stylesheets read from the files chosen with the page: site.css, theme.css."), JSON.stringify(review.notes));
  // A local link answered once by its own file is said as before, and nothing more.
  const plain = await ok(running.call("POST", "/api/import", { html: '<link rel="stylesheet" href="theme.css"><p>Hi</p>', name: "Plain", stylesheets: [{ name: "theme.css", css: ".lead{font-weight:700}" }] }), "review");
  assert.ok(!plain.notes.some((note) => /in place of|more than one link/u.test(note)), JSON.stringify(plain.notes));
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
  const { findBrowser, launchBrowser } = await import("./support/browser.mjs");
  const browser = await launchBrowser({ executablePath: findBrowser(), headless: true });
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

// #297, found dogfooding sb-admin-2 with #283: the canvas never drew an element's id, so a
// page's #id rules matched nothing (sb-admin-2's #wrapper{display:flex} put the sidebar beside
// the content). The canvas draws an id as data-ninerr-html-id and its sheet's id selectors as
// that attribute, keeping an id's specificity; the document and the export keep #id.
test("an id is drawn under the canvas's own name, and id selectors are drawn to match it", () => {
  const plan = planElement({ id: "w", type: "element", props: { tag: "div", attributes: { id: "wrapper", "data-ninerr-html-id": "spoof", class: "a" } } });
  assert.deepEqual(plan.attributes, { "data-ninerr-html-id": "wrapper", class: "a" }, "an authored data-ninerr-html-id is refused");
  for (const [selector, drawn] of [
    ["#wrapper", '[data-ninerr-html-id="wrapper"]:not(#_)'],
    ["#content-wrapper .x", '[data-ninerr-html-id="content-wrapper"]:not(#_) .x'],
    ["#a#b:not(#c)", '[data-ninerr-html-id="a"]:not(#_)[data-ninerr-html-id="b"]:not(#_):not([data-ninerr-html-id="c"]:not(#_))'],
    ["#\\31 23 .a", '[data-ninerr-html-id="\\31 23"]:not(#_) .a'],
    ["#a\\:b", '[data-ninerr-html-id="a\\:b"]:not(#_)'],
    ['[id="a"]', '[data-ninerr-html-id="a"]'],
    ['[ID^="a"]', '[data-ninerr-html-id^="a"]'],
    ['a[href="#x"]', 'a[href="#x"]'],
    ["[idx]", "[idx]"],
    ['[*|id="a"]', '[data-ninerr-html-id="a"]'],
    ["[*|idx]", "[*|idx]"],
    ['[title="[*|id"]', '[title="[*|id"]'],
    [".plain > p", ".plain > p"],
  ]) assert.equal(drawnSelector(selector), drawn, selector);
  // The code carries no drawn id: a control a label names keeps its id, as before (review of #297).
  const node = (id, parentId, children, props) => ({ id, type: parentId === null ? "frame" : "element", parentId, children, props, metadata: {} });
  const doc = { id: "doc", rootIds: ["wrapper"], nodes: {
    wrapper: node("wrapper", null, ["label", "input"], { tag: "div", attributes: { id: "wrapper", class: "x" } }),
    label: node("label", "wrapper", [], { tag: "label", text: "Email", attributes: { for: "email" } }),
    input: node("input", "wrapper", [], { tag: "input", attributes: { id: "email", type: "text" } }),
  } };
  const { code } = exportJsx(doc, "wrapper");
  assert.doesNotMatch(code, /data-ninerr/u, code);
  assert.match(code, /htmlFor="email"[\s\S]*id="email"/u, code);
});

test("on the canvas, a page's id rules apply with an id's specificity, nested and after edits", browserTestOptions(), async () => {
  const { readFileSync } = await import("node:fs");
  const { findBrowser, launchBrowser } = await import("./support/browser.mjs");
  const browser = await launchBrowser({ executablePath: findBrowser(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><head></head><body><div id=\"root\"></div></body></html>");
    const source = readFileSync(new URL("../packages/renderer/src/index.mjs", import.meta.url), "utf8");
    await page.addScriptTag({ type: "module", content: `${source}\nwindow.rendererForTest = createRenderer(document.getElementById("root"));` });
    await page.waitForFunction(() => window.rendererForTest !== undefined);
    const drawn = (wrapperId) => page.evaluate((wrapperId) => {
      const node = (id, parentId, children, props) => ({ id, type: parentId === null ? "frame" : "element", parentId, children, props, metadata: {} });
      const sheet = [
        "#wrapper{display:flex}",
        // Written first, yet it beats the two classes after it, as an id does; and an id in
        // :where() weighs nothing, so the class after it wins.
        "#title{color:rgb(255, 0, 0)}",
        ".t.t{color:rgb(0, 0, 255)}",
        ":where(#inner){color:rgb(255, 0, 0)}",
        "p{color:rgb(0, 0, 128)}",
        "[id=\"note\"]{color:rgb(0, 128, 0)}",
        ".card{#inner{font-weight:700}}",
        ".side:has(#title){border-left:3px solid rgb(1, 2, 3)}",
        // The same id in another frame's sheet: each frame's sheet stays in its frame.
      ].join("\n");
      const doc = {
        rootIds: ["page", "other"],
        nodes: {
          page: node("page", null, ["wrapper"], { tag: "div", stylesheet: sheet }),
          wrapper: node("wrapper", "page", ["side", "card"], { tag: "div", attributes: wrapperId === null ? {} : { id: wrapperId } }),
          side: node("side", "wrapper", ["title", "note"], { tag: "div", attributes: { class: "side" } }),
          title: node("title", "side", [], { tag: "p", text: "Title", attributes: { id: "title", class: "t" } }),
          note: node("note", "side", [], { tag: "p", text: "Note", attributes: { id: "note" } }),
          card: node("card", "wrapper", ["inner"], { tag: "div", attributes: { class: "card" } }),
          inner: node("inner", "card", [], { tag: "p", text: "Inner", attributes: { id: "inner" } }),
          other: node("other", null, ["other-title"], { tag: "div" }),
          "other-title": node("other-title", "other", [], { tag: "p", text: "Elsewhere", attributes: { id: "title" } }),
        },
      };
      window.rendererForTest.render(doc);
      const style = (id) => getComputedStyle(document.querySelector(`[data-ninerr-id="${id}"]`));
      return {
        wrapper: style("wrapper").display,
        title: style("title").color,
        note: style("note").color,
        inner: style("inner").fontWeight,
        innerColour: style("inner").color,
        side: style("side").borderLeftColor,
        elsewhere: style("other-title").color,
        ids: document.querySelectorAll("[id]").length,
      };
    }, wrapperId);
    const expected = { wrapper: "flex", title: "rgb(255, 0, 0)", note: "rgb(0, 128, 0)", inner: "700", innerColour: "rgb(0, 0, 128)", side: "rgb(1, 2, 3)", elsewhere: "rgb(0, 0, 0)", ids: 1 };
    assert.deepEqual(await drawn("wrapper"), expected, "the root div is the page's only real id");
    assert.deepEqual(await drawn(null), { ...expected, wrapper: "block" }, "an id taken away stops matching");
    assert.deepEqual(await drawn("wrapper"), expected, "and matches again when it comes back");
  } finally {
    await browser.close();
  }
});

// #310 (from the review of #309): a nested @scope's start and limit are selectors the
// browser keeps read-only, so their ids were never drawn: @scope (#card) matched nothing and
// "to (#inner)" was no limit. [*|id] was not drawn either.
test("a page's @scope with ids, and [*|id], apply on the canvas", browserTestOptions(), async () => {
  const { readFileSync } = await import("node:fs");
  const { findBrowser, launchBrowser } = await import("./support/browser.mjs");
  const browser = await launchBrowser({ executablePath: findBrowser(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><head></head><body><div id=\"root\"></div></body></html>");
    const source = readFileSync(new URL("../packages/renderer/src/index.mjs", import.meta.url), "utf8");
    await page.addScriptTag({ type: "module", content: `${source}\nwindow.rendererForTest = createRenderer(document.getElementById("root"));` });
    await page.waitForFunction(() => window.rendererForTest !== undefined);
    const drawn = await page.evaluate(() => {
      const node = (id, parentId, children, props) => ({ id, type: parentId === null ? "frame" : "element", parentId, children, props, metadata: {} });
      const sheet = "@scope (#card) to (#inner) { p { color: rgb(255, 0, 0) } }\n@media (min-width: 1px) { @scope (#card) { .deep { font-weight: 700 } } }\n[*|id=\"note\"] { color: rgb(0, 128, 0) }";
      const doc = {
        rootIds: ["page"],
        nodes: {
          page: node("page", null, ["card", "note"], { tag: "div", stylesheet: sheet }),
          card: node("card", "page", ["outer", "inner"], { tag: "div", attributes: { id: "card" } }),
          outer: node("outer", "card", [], { tag: "p", text: "Outer", attributes: { class: "deep" } }),
          inner: node("inner", "card", ["kept"], { tag: "div", attributes: { id: "inner" } }),
          kept: node("kept", "inner", [], { tag: "p", text: "Inside the limit" }),
          note: node("note", "page", [], { tag: "p", text: "Note", attributes: { id: "note" } }),
        },
      };
      window.rendererForTest.render(doc);
      const style = (id) => getComputedStyle(document.querySelector(`[data-ninerr-id="${id}"]`));
      return { outer: style("outer").color, deep: style("outer").fontWeight, kept: style("kept").color, note: style("note").color, sheets: document.querySelectorAll("style[data-ninerr-sheet]").length, dropped: window.rendererForTest.stats.dropped };
    });
    assert.deepEqual(drawn, { outer: "rgb(255, 0, 0)", deep: "700", kept: "rgb(0, 0, 0)", note: "rgb(0, 128, 0)", sheets: 1, dropped: 0 });
    // Each rebuild parses what the scope holds again, so only the first levels are rebuilt:
    // a page nesting hundreds of id scopes around thousands of rules does not stall the canvas.
    const deep = await page.evaluate(() => {
      let sheet = Array.from({ length: 6000 }, (_, i) => `.c${i}{color:blue}`).join("");
      for (let level = 0; level < 400; level += 1) sheet = `@scope (#s${level}) {${sheet}}`;
      const started = performance.now();
      const dropped = window.rendererForTest.stats.dropped;
      window.rendererForTest.render({ rootIds: ["deep"], nodes: { deep: { id: "deep", type: "frame", parentId: null, children: [], props: { tag: "div", stylesheet: sheet }, metadata: {} } } });
      return { elapsed: performance.now() - started, kept: document.querySelector('style[data-ninerr-sheet="deep"]') !== null, dropped: window.rendererForTest.stats.dropped - dropped };
    });
    assert.deepEqual([deep.kept, deep.dropped], [true, 0], "the sheet is drawn, not dropped");
    assert.ok(deep.elapsed < 5_000, `400 nested id scopes around 6,000 rules drawn in ${Math.round(deep.elapsed)} ms`);
  } finally {
    await browser.close();
  }
});

// #299 item 1: @keyframes are global even inside @scope, so frames' animations of one name
// would meet, and the canvas removed them: an imported page's animations never ran. Each
// frame's keyframes are now kept under a name of its own, and its animations name them so.
test("each frame's @keyframes apply to that frame alone, under a name of its own", browserTestOptions(), async () => {
  const { readFileSync } = await import("node:fs");
  const { findBrowser, launchBrowser } = await import("./support/browser.mjs");
  const browser = await launchBrowser({ executablePath: findBrowser(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><head></head><body><div id=\"root\"></div></body></html>");
    const source = readFileSync(new URL("../packages/renderer/src/index.mjs", import.meta.url), "utf8");
    await page.addScriptTag({ type: "module", content: `${source}\nwindow.rendererForTest = createRenderer(document.getElementById("root"));` });
    await page.waitForFunction(() => window.rendererForTest !== undefined);
    const drawn = await page.evaluate(() => {
      const node = (id, parentId, children, props) => ({ id, type: parentId === null ? "frame" : "element", parentId, children, props, metadata: {} });
      // Paused at its start, an animation draws its first keyframe.
      const sheet = (opacity) => `@keyframes pulse { from { opacity: ${opacity} } to { opacity: ${opacity} } } .p { animation: pulse 10s paused }`;
      const doc = {
        rootIds: ["a", "b", "c"],
        nodes: {
          a: node("a", null, ["a-p"], { tag: "div", stylesheet: sheet(0.25) }),
          "a-p": node("a-p", "a", [], { tag: "p", text: "A", attributes: { class: "p" } }),
          b: node("b", null, ["b-p"], { tag: "div", stylesheet: sheet(0.75) }),
          "b-p": node("b-p", "b", [], { tag: "p", text: "B", attributes: { class: "p" } }),
          // Inside a scope rebuilt for its id, and named once.
          c: node("c", null, ["card"], { tag: "div", stylesheet: "@scope (#card) { @keyframes pulse { from { opacity: 0.5 } to { opacity: 0.5 } } .p { animation-name: pulse; animation-duration: 10s; animation-play-state: paused } }" }),
          card: node("card", "c", ["c-p"], { tag: "div", attributes: { id: "card" } }),
          "c-p": node("c-p", "card", [], { tag: "p", text: "C", attributes: { class: "p" } }),
        },
      };
      window.rendererForTest.render(doc);
      const opacity = (id) => getComputedStyle(document.querySelector(`[data-ninerr-id="${id}"]`)).opacity;
      const names = [...document.querySelectorAll("style[data-ninerr-sheet]")].flatMap((element) => [...element.textContent.matchAll(/@keyframes ([\w-]+)/gu)].map((match) => match[1]));
      const live = [...document.querySelectorAll("style[data-ninerr-sheet]")].flatMap((element) => {
        const walk = (rules) => [...rules].flatMap((rule) => (rule instanceof CSSKeyframesRule ? [rule.name] : rule.cssRules ? walk(rule.cssRules) : []));
        return walk(element.sheet.cssRules);
      });
      return { a: opacity("a-p"), b: opacity("b-p"), c: opacity("c-p"), written: names, live, dropped: window.rendererForTest.stats.dropped };
    });
    assert.deepEqual([drawn.a, drawn.b, drawn.c, drawn.dropped], ["0.25", "0.75", "0.5", 0]);
    assert.deepEqual(drawn.written, ["pulse", "pulse", "pulse"], "the sheets keep what was written");
    assert.equal(new Set(drawn.live).size, 3, `one name per frame: ${drawn.live}`);
    assert.ok(drawn.live.every((name) => /^pulse--n[0-9a-z]+$/u.test(name)), String(drawn.live));
    // From the review: a keyframes name that is also an animation keyword (running) renames
    // only the name in a shorthand, which the browser writes with its keywords; and two frames
    // whose ids a 32-bit hash would confuse still get names of their own.
    const more = await page.evaluate(() => {
      const node = (id, parentId, children, props) => ({ id, type: parentId === null ? "frame" : "element", parentId, children, props, metadata: {} });
      const sheet = (opacity) => `@keyframes running { from { opacity: ${opacity} } to { opacity: ${opacity} } } @keyframes spin { from { opacity: 0.4 } to { opacity: 0.4 } } .p { animation: spin 10s linear paused } .q { animation-name: running; animation-duration: 10s; animation-play-state: paused }`;
      const doc = { rootIds: ["import-node:53e8f", "import-node:ce5f0"], nodes: {} };
      for (const [id, opacity] of [["import-node:53e8f", 0.25], ["import-node:ce5f0", 0.75]]) {
        doc.nodes[id] = node(id, null, [`${id}/p`, `${id}/q`], { tag: "div", stylesheet: sheet(opacity) });
        doc.nodes[`${id}/p`] = node(`${id}/p`, id, [], { tag: "p", text: "P", attributes: { class: "p" } });
        doc.nodes[`${id}/q`] = node(`${id}/q`, id, [], { tag: "p", text: "Q", attributes: { class: "q" } });
      }
      window.rendererForTest.render(doc);
      const opacity = (id) => getComputedStyle(document.querySelector(`[data-ninerr-id="${CSS.escape(id)}"]`)).opacity;
      return ["import-node:53e8f", "import-node:ce5f0"].flatMap((id) => [opacity(`${id}/p`), opacity(`${id}/q`)]);
    });
    assert.deepEqual(more, ["0.4", "0.25", "0.4", "0.75"]);
  } finally {
    await browser.close();
  }
});
