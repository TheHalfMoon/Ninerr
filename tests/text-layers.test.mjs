import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isCodePart, textLayerOf } from "../packages/document-model/src/index.mjs";
import { exportJsx } from "../packages/studio-host/src/code.ts";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { hostPool, mcpClient, ok } from "./support/host-api.mjs";

// #235 (decided in P09, criterion 5): an element's own words have two shapes. Code import keeps
// them in the element's own text; HTML import gives the element a bare text layer. Both mean
// the same words: the inspector's Text field and an agent's set_text edit the words a person
// sees, and code export writes the same JSX, either way.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 13, 12, 0, 0) + clock++ * 1000).toISOString();
const node = (id, type, parentId, children, props) => ({ id, type, parentId, children, props, metadata: {} });

test("the layer holding an element's words: its own text, or its only bare text layer", () => {
  const document = { id: "d", revision: 0, rootIds: ["page"], nodes: {
    page: node("page", "frame", null, ["code", "html", "mixed", "styled"], { tag: "main" }),
    // Code import's shape.
    code: node("code", "element", "page", [], { tag: "p", text: "First" }),
    // HTML import's shape.
    html: node("html", "element", "page", ["html-text"], { tag: "p" }),
    "html-text": node("html-text", "text", "html", [], { text: "First" }),
    // Mixed content: no one layer holds the element's words.
    mixed: node("mixed", "element", "page", ["mixed-text", "mixed-b"], { tag: "p" }),
    "mixed-text": node("mixed-text", "text", "mixed", [], { text: "Hello " }),
    "mixed-b": node("mixed-b", "element", "mixed", [], { tag: "b", text: "you" }),
    // A styled text layer is a layer of its own, not the element's words.
    styled: node("styled", "element", "page", ["styled-text"], { tag: "p" }),
    "styled-text": node("styled-text", "text", "styled", [], { tag: "span", text: "First", style: { color: "red" } }),
    // A {…} part of imported code is code, not words; a bound run of text is words.
    expr: node("expr", "element", "page", ["expr-code"], { tag: "p" }),
    "expr-code": node("expr-code", "text", "expr", [], { name: "Code", text: "{title}", codeSource: { tag: "#expression" } }),
    run: node("run", "element", "page", ["run-text"], { tag: "p" }),
    "run-text": node("run-text", "text", "run", [], { text: "Hi", codeSource: { tag: "#text" } }),
  } };
  assert.equal(textLayerOf(document, "code"), "code");
  assert.equal(textLayerOf(document, "html"), "html-text");
  assert.equal(textLayerOf(document, "html-text"), "html-text");
  assert.equal(textLayerOf(document, "mixed"), null);
  assert.equal(textLayerOf(document, "styled"), null);
  assert.equal(textLayerOf(document, "expr"), null);
  assert.equal(textLayerOf(document, "run"), "run-text");
  assert.equal(textLayerOf(document, "page"), null);
  assert.equal(textLayerOf(document, "missing"), null);
  // Both shapes export the same JSX.
  assert.equal(exportJsx(document, "code").code.replace(/function \w+/u, "function X"), exportJsx(document, "html").code.replace(/function \w+/u, "function X"));
});

test("an agent's set_text on an HTML-imported paragraph changes the words a person sees", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-text-layers-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const running = await pool.open(root);
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  const review = await ok(running.call("POST", "/api/import", { html: "<main><p>First</p></main>", name: "Page" }), "review");
  await ok(running.call("POST", "/api/import/commit", { proposalId: review.proposalId }), "commit");
  const nodes = () => running.host.session.document.nodes;
  const words = Object.values(nodes()).find((each) => each.props?.text === "First");
  const paragraph = words.parentId;
  const { token } = await ok(running.call("POST", "/api/agents/create", { name: "Writer" }), "connect an agent");
  const agent = mcpClient(running.host.mcpUrl, token);
  await agent.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  const result = await agent.tool("set_text", { nodeId: paragraph, text: "Second" });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.equal(nodes()[words.id].props.text, "Second", "the paragraph's text layer holds the new words");
  assert.equal(nodes()[paragraph].props.text, undefined, "no second copy on the element");
  const details = await agent.tool("layer_details", { nodeId: paragraph });
  assert.equal(details.structuredContent.text, "Second", "an agent reads the words where it writes them");
  assert.match((await ok(running.call("POST", "/api/code/export", { nodeId: paragraph }), "export")).code, /<p>Second<\/p>/u);
});

test("the inspector's Text field edits an HTML-imported paragraph's words", browserTestOptions(), async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-text-inspector-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const running = await pool.open(root);
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  const review = await ok(running.call("POST", "/api/import", { html: "<main><p>First</p></main>", name: "Page" }), "review");
  const { revision } = await ok(running.call("POST", "/api/import/commit", { proposalId: review.proposalId }), "commit");
  const editor = await openEditor(running.host);
  t.after(() => editor.close());
  const { page } = editor;
  await waitRevision(page, revision);
  const nodes = () => running.host.session.document.nodes;
  const words = Object.values(nodes()).find((each) => each.props?.text === "First");
  // The paragraph itself, not its text layer, is selected: its Text field shows its words.
  await page.locator(`[id="layer-${words.parentId}"] > .row`).click();
  const field = page.locator("#inspect-text");
  assert.equal(await field.inputValue(), "First");
  await field.fill("Second");
  await page.locator("#inspect-name").focus();
  await waitRevision(page, revision + 1);
  assert.equal(nodes()[words.id].props.text, "Second");
  const drawn = await page.evaluate((id) => document.querySelector("iframe").contentDocument.querySelector(`[data-ninerr-id="${id}"]`).textContent, words.parentId);
  assert.equal(drawn, "Second", "the canvas draws the new words");
  assert.deepEqual(editor.foreign, []);
  assert.deepEqual(editor.errors, []);
});

// #370: a {…} part is code. Its text is only what the canvas shows of it, so editing that copy
// would change nothing in the code and block its export: both ways in refuse.
const CODE = "export function A() { return <main><p>{title}</p><p>Words</p></main>; }";

const refusedAsCode = (result) => {
  assert.equal(result.isError, true, JSON.stringify(result));
  assert.match(result.content[0].text, /shows \{…\} code from its source/u);
};

async function withCode(t, prefix) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const running = await pool.open(root);
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  await ok(running.call("POST", "/api/code/import", { code: CODE }), "import");
  const nodes = () => running.host.session.document.nodes;
  const part = Object.values(nodes()).find((each) => each.props?.text === "{title}");
  const words = Object.values(nodes()).find((each) => each.props?.text === "Words");
  return { running, nodes, part, words };
}

test("a code part is known by its source, recorded or bound; a run of words is not", () => {
  assert.equal(isCodePart({ props: { codeExpression: "{a}" } }), true);
  assert.equal(isCodePart({ props: { codeSource: { tag: "#expression" } } }), true, "bound before the source was recorded");
  assert.equal(isCodePart({ props: { codeSource: { tag: "#text" } } }), false);
  assert.equal(isCodePart({ props: { text: "{a}" } }), false, "braces a person typed");
  assert.equal(isCodePart(undefined), false);
});

test("set_text refuses an element holding a code part beside other content, and export keeps it", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-code-part-mixed-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const running = await pool.open(root);
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  await ok(running.call("POST", "/api/code/import", { code: "export function A() { return <main><p>Hi {a}</p><p>{b}{c}</p></main>; }" }), "import");
  const nodes = () => running.host.session.document.nodes;
  const { token } = await ok(running.call("POST", "/api/agents/create", { name: "Writer" }), "agent");
  const agent = mcpClient(running.host.mcpUrl, token);
  await agent.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  const holders = [...new Set(Object.values(nodes()).filter(isCodePart).map((part) => part.parentId))];
  assert.equal(holders.length, 2);
  for (const nodeId of holders) refusedAsCode(await agent.tool("set_text", { nodeId, text: "Replaced" }));
  const code = (await ok(running.call("POST", "/api/code/export", { nodeId: nodes()[holders[0]].parentId }), "export")).code;
  assert.ok(!code.includes("Replaced"));
  assert.match(code, /\{a\}/u);
  assert.match((await agent.tool("guide", {})).structuredContent.guide, /codeExpression/u, "the guide says so beforehand");
});

test("set_text refuses a code part, and an element holding only one, and export still works", async (t) => {
  const { running, nodes, part, words } = await withCode(t, "ninerr-code-part-text-");
  const { token } = await ok(running.call("POST", "/api/agents/create", { name: "Writer" }), "agent");
  const agent = mcpClient(running.host.mcpUrl, token);
  await agent.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  const revision = running.host.session.revision;
  for (const nodeId of [part.id, part.parentId]) {
    refusedAsCode(await agent.tool("set_text", { nodeId, text: "Replaced" }));
  }
  assert.equal(running.host.session.revision, revision, "nothing changed");
  assert.equal(nodes()[part.id].props.text, "{title}");
  assert.equal(nodes()[part.parentId].props.text, undefined);
  assert.equal((await agent.tool("set_text", { nodeId: words.id, text: "Still words" })).isError, undefined, "words stay editable");
  assert.equal(nodes()[words.id].props.text, "Still words");
  const main = nodes()[part.parentId].parentId;
  assert.match((await ok(running.call("POST", "/api/code/export", { nodeId: main }), "export")).code, /<p>\{title\}<\/p>/u);
});

test("the inspector has no Text field for a code part or an element holding only one", browserTestOptions(), async (t) => {
  const { running, part, words } = await withCode(t, "ninerr-code-part-inspector-");
  const editor = await openEditor(running.host);
  t.after(() => editor.close());
  const { page } = editor;
  await waitRevision(page, running.host.session.revision);
  const select = async (id) => {
    await page.locator(`[id="layer-${id}"] > .row`).click();
    await page.waitForFunction((nodeId) => document.getElementById(`layer-${nodeId}`)?.getAttribute("aria-selected") === "true", id);
  };
  await select(words.id);
  assert.equal(await page.locator("#inspect-text").count(), 1, "words have a Text field");
  assert.equal(await page.locator("#inspect-code-note").count(), 0, "and no note about code");
  await select(part.parentId);
  assert.equal(await page.locator("#inspect-text").count(), 0, "the element holding only code has none");
  assert.match(await page.locator("#inspect-code-note").textContent(), /code from its source/u, "and says why");
  await select(part.id);
  assert.equal(await page.locator("#inspect-text").count(), 0, "the code part has none");
  assert.match(await page.locator("#inspect-code-note").textContent(), /code from its source/u);
  assert.deepEqual(editor.errors, []);
});
