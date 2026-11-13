import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCodeIr, codeToDesign } from "../packages/code-ir/src/index.ts";
import { accessibilityTreeFromDesignDoc, auditAccessibility } from "../packages/design-assurance/src/index.mjs";
import { exportJsx, importJsx } from "../packages/studio-host/src/index.ts";
import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions } from "./support/browser.mjs";
import { client, ok } from "./support/host-api.mjs";
import { layerCount, openEditor, waitRevision } from "./support/editor.mjs";
import { PROJECT_FILES } from "../packages/persistence/src/index.ts";

// PC8 (#146): accessibility qualification of the editor UI and its generated output. Every
// editor state is audited with design-assurance's auditAccessibility, using the colours the
// browser actually paints; every editor action is done from the keyboard; the layout
// reflows at 320 px; targets are at least 24 px; exported code audits clean. Closes PC gate
// 12 with docs/evidence/PC8A_WCAG22_AA_CHECKLIST_2026-10-07.md.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 7, 12, 0, 0) + clock++ * 1000).toISOString();

// The page's body as auditAccessibility's tree, skipping the canvas frame's content (it is
// inert and not exposed; the layers tree is its accessible form) and closed dialogs.
const snapshot = (page) => page.evaluate(() => {
  // Colours the contrast check cannot resolve (gradients, images, translucency, colour
  // spaces other than rgb) are reported, so a finding can never be masked by them.
  const unresolved = [];
  const opaque = (value) => value && value !== "transparent" && !/rgba\([^)]*,\s*0\)$/u.test(value);
  const backgroundOf = (element) => {
    for (let node = element; node; node = node.parentElement) {
      const background = getComputedStyle(node).backgroundColor;
      if (opaque(background)) return background;
    }
    return "rgb(255, 255, 255)";
  };
  const visit = (element) => {
    const attributes = {};
    for (const attribute of element.attributes) attributes[attribute.name] = attribute.value;
    const computed = getComputedStyle(element);
    if (computed.display === "none" || computed.visibility === "hidden" || (element.localName === "dialog" && !element.open)) attributes.hidden = "";
    if (!attributes.hidden && (computed.backgroundImage !== "none" || Number(computed.opacity) < 1 || !/^rgba?\(/u.test(computed.color) || !/^rgba?\(/u.test(computed.backgroundColor))) unresolved.push(`${element.localName}#${element.id} ${computed.backgroundImage} ${computed.opacity} ${computed.color}`);
    if (element.inert || element.closest("[inert]")) attributes.hidden = "";
    const node = { tag: element.localName, attributes, children: [], style: `color: ${computed.color}; background-color: ${backgroundOf(element)}; font-size: ${computed.fontSize}; font-weight: ${computed.fontWeight}` };
    let text = "";
    for (const child of element.childNodes) {
      if (child.nodeType === 3) text += child.textContent;
      else if (child.nodeType === 1 && !["iframe", "script", "style"].includes(child.localName)) node.children.push(visit(child));
    }
    if (text.trim() !== "") node.text = text.trim();
    return node;
  };
  const tree = visit(document.body);
  return { tree, unresolved };
});

async function audit(page, state) {
  const { tree, unresolved } = await snapshot(page);
  assert.deepEqual(unresolved, [], `every colour is resolvable in: ${state}`);
  const { findings } = auditAccessibility(tree);
  assert.deepEqual(findings.map((finding) => `${finding.ruleId} at ${finding.path}: ${finding.message}`), [], `no findings in: ${state}`);
}

test("every editor state audits clean, with the colours actually painted", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-a11y-")));
  const host = await startStudioHost({ projectsRoot: root, now, confirmationWaitMs: 20_000 });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await audit(page, "the projects dialog");
    await page.locator("#new-project-name").fill("a11y");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    await audit(page, "an empty project");
    await page.locator("#action-insert-box").click();
    await waitRevision(page, 1);
    await page.locator("#action-insert-text").click();
    await waitRevision(page, 2);
    await audit(page, "layers, inspector and history");
    await page.locator("#action-agents").click();
    await audit(page, "the agents dialog");
    await page.locator("#agent-name").fill("Checker");
    await page.keyboard.press("Enter");
    await audit(page, "the agent credential dialog");
    const token = await page.locator("#agent-credential").inputValue();
    await page.locator("#dialog[open] button.primary").click();
    await page.locator("#action-import").click();
    await audit(page, "the import dialog");
    await page.locator("#import-html").fill("<main><h1>Hi</h1><img src=\"https://example.com/x.png\"></main>");
    await page.locator("#dialog[open] button.primary").click();
    await page.locator("#import-review").waitFor();
    await audit(page, "the import review");
    await page.locator("#dialog[open] button", { hasText: "Discard" }).click();
    await page.locator("#layers [role=treeitem] > .row").first().click();
    await page.locator("#action-code").click();
    await page.locator("#code-export").waitFor();
    await audit(page, "the code dialog");
    await page.keyboard.press("Escape");
    // An agent's request for approval.
    const box = Object.values(host.session.document.nodes).find((node) => node.id.startsWith("box-")).id;
    // Like an MCP client, the agent connects first (#260).
    await fetch(host.mcpUrl, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }) });
    const pending = fetch(host.mcpUrl, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "delete_layers", arguments: { nodeIds: [box] } } }) });
    await page.waitForFunction(() => /asks for your approval/u.test(document.getElementById("dialog-title")?.textContent ?? ""));
    await audit(page, "the approval dialog");
    await page.locator("#dialog[open] button", { hasText: "Decline" }).click();
    await pending;
    // An agent's change, offered for undo next to Undo (P09).
    await fetch(host.mcpUrl, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "set_styles", arguments: { updates: [{ nodeId: box, styles: { background: "#123456" } }] } } }) });
    await page.waitForFunction(() => !document.getElementById("action-undo-agent").hidden);
    await audit(page, "an agent's change offered for undo");
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the lock and recovery dialogs audit clean", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-a11y-lock-")));
  const setup = await startStudioHost({ projectsRoot: root, now });
  await fetch(`${setup.url}/api/projects/create`, { method: "POST", headers: { authorization: `Bearer ${setup.token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "locked" }) });
  await setup.close();
  writeFileSync(join(root, "locked", PROJECT_FILES.directory, "lock"), JSON.stringify({ owner: "gone", pid: 2 ** 22 + 4321, at: "2026-10-07T11:00:00.000Z", nonce: "dead" }));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#dialog[open] [data-project=locked]").click();
    await page.locator("#lock-reason").waitFor();
    await audit(page, "the lock dialog");
    await page.locator("#lock-reason").fill("crashed");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.getElementById("dialog-title")?.textContent === "Ninerr recovered this project");
    await audit(page, "the recovery report");
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("every editor action works from the keyboard, with visible focus", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-a11y-keys-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    const focused = () => page.evaluate(() => {
      const element = document.activeElement;
      const style = getComputedStyle(element);
      return { id: element.id, label: element.getAttribute("aria-label") ?? element.textContent.trim().slice(0, 30), outline: style.outlineStyle !== "none" && style.outlineWidth !== "0px" };
    });
    // The projects dialog takes focus; create a project by typing.
    assert.equal((await focused()).id, "new-project-name");
    await page.keyboard.type("keys");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    // Tab reaches every toolbar control in order, each with a visible focus ring.
    await page.evaluate(() => document.activeElement.blur());
    const order = [];
    for (let index = 0; index < 16; index += 1) {
      await page.keyboard.press("Tab");
      const now = await focused();
      order.push(now.id || now.label);
      if (now.id !== "") assert.ok(now.outline, `${now.id} shows focus`);
    }
    for (const id of ["action-projects", "action-insert-box", "action-insert-text", "action-zoom-out", "action-zoom-in", "action-fit", "action-save", "action-import", "action-code", "action-agents"]) {
      assert.ok(order.includes(id), `${id} is reachable by Tab (order: ${order.join(", ")})`);
    }
    // Insert from the toolbar, then work in the layers tree.
    await page.locator("#action-insert-box").focus();
    await page.keyboard.press("Enter");
    await waitRevision(page, 1);
    await page.locator("#action-insert-text").focus();
    await page.keyboard.press("Enter");
    await waitRevision(page, 2);
    await page.locator("#layers [role=treeitem][tabindex='0']").focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowLeft"); // collapse the page
    assert.equal(await layerCount(page), 1);
    await page.keyboard.press("ArrowRight"); // expand it again
    assert.equal(await layerCount(page), 3);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    // The inspector by Tab: rename, then move with the step buttons (no dragging).
    await page.locator("#inspect-name").focus();
    await page.keyboard.type("Card");
    await page.keyboard.press("Tab");
    await waitRevision(page, 3);
    await page.locator("[aria-label='Move right 10 pixels']").focus();
    await page.keyboard.press("Enter");
    await waitRevision(page, 4);
    await page.locator(".steps button", { hasText: "Wider" }).focus();
    await page.keyboard.press("Space");
    await waitRevision(page, 5);
    const card = Object.values(host.session.document.nodes).find((node) => node.props.name === "Card");
    assert.deepEqual([card.props.style.left, card.props.style.width], ["42px", "170px"]);
    // The skip link reaches the canvas; arrows nudge; Delete removes; undo restores.
    // The skip link is the first thing in the tab order, is shown when focused, and lands
    // on the canvas, which shows its focus.
    const first = await page.evaluate(() => [...document.querySelectorAll("a[href], button, input, textarea, [tabindex]")].find((element) => element.tabIndex >= 0 && element.getClientRects().length > 0)?.className);
    assert.equal(first, "skip-link");
    await page.locator(".skip-link").focus();
    assert.ok(await page.evaluate(() => document.querySelector(".skip-link").getBoundingClientRect().top >= 0), "visible on focus");
    await page.keyboard.press("Enter");
    const landed = await page.evaluate(() => ({ role: document.activeElement.getAttribute("role") }));
    assert.deepEqual(landed, { role: "application" }, "focus lands on the canvas");
    // The ring is painted on top of the design, even zoomed in so the design fills the canvas.
    for (let index = 0; index < 6; index += 1) await page.keyboard.press("Control+=");
    const stageBox = await page.locator("[role=application]").boundingBox();
    const shot = await page.screenshot({ clip: { x: stageBox.x, y: stageBox.y + stageBox.height / 2, width: 2, height: 1 } });
    const { PNG } = await import("./support/png.mjs");
    const pixel = PNG.firstPixel(shot);
    assert.deepEqual(pixel, [26, 95, 208], `the ring is visible at the canvas edge (got ${pixel})`);
    // The design frame is not a tab stop: Tab leaves the canvas for the next control.
    await page.keyboard.press("Tab");
    assert.notEqual(await page.evaluate(() => document.activeElement.localName), "iframe", "Tab does not stop on the design frame");
    await page.locator("[role=application]").focus();
    // With nothing selected, the arrows pan the view.
    await page.keyboard.press("Escape");
    const before = await page.evaluate(() => document.querySelector("[role=application] > div").style.transform);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    assert.notEqual(await page.evaluate(() => document.querySelector("[role=application] > div").style.transform), before, "arrow keys pan the canvas");
    // Select the card again from the tree, then nudge it on the canvas.
    await page.locator(`#layers [role=treeitem][data-node-id="${card.id}"]`).focus();
    await page.keyboard.press("Enter");
    await page.locator(".skip-link").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await waitRevision(page, 6);
    await page.keyboard.press("Delete");
    await waitRevision(page, 7);
    await page.keyboard.press("Control+z");
    await waitRevision(page, 8);
    await page.keyboard.press("Control+Shift+z");
    await waitRevision(page, 9);
    await page.keyboard.press("Control+z");
    await waitRevision(page, 10);
    // Dialogs: open from the keyboard, Escape closes, focus returns to the opener.
    await page.locator("#action-agents").focus();
    await page.keyboard.press("Enter");
    await page.locator("#dialog[open]").waitFor();
    assert.equal((await focused()).id, "agent-name", "the dialog takes focus");
    await page.keyboard.press("Escape");
    assert.equal((await focused()).id, "action-agents", "focus returns to the opener");
    await page.keyboard.press("Control+s");
    await page.waitForFunction(() => document.getElementById("status").textContent.startsWith("Saved."));
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the editor reflows at 320 px and every target is at least 24 by 24 px", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-a11y-reflow-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("small");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    await page.locator("#action-insert-box").click();
    await waitRevision(page, 1);
    await page.setViewportSize({ width: 320, height: 640 });
    const layout = await page.evaluate(() => {
      const visible = (id) => {
        const rect = document.getElementById(id).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= 321;
      };
      const rects = JSON.stringify(["layers","inspector","history","canvas"].map((id) => document.getElementById(id).getBoundingClientRect()));
      return { rects, scroll: document.documentElement.scrollWidth, layers: visible("layers"), inspector: visible("inspector"), history: visible("history"), canvas: visible("canvas") };
    });
    assert.ok(layout.scroll <= 320, `no horizontal scrolling at 320 px (width ${layout.scroll}) ${layout.rects}`);
    assert.deepEqual([layout.layers, layout.inspector, layout.history, layout.canvas], [true, true, true, true], `every panel is reachable without horizontal scrolling ${layout.rects}`);
    // Every dialog fits too.
    const fits = async (name) => {
      const box = await page.evaluate(() => {
        const dialog = document.querySelector("dialog[open]");
        return { scroll: dialog.scrollWidth, client: dialog.clientWidth, right: Math.max(...[...dialog.querySelectorAll("*")].map((element) => element.getBoundingClientRect().right)) };
      });
      assert.ok(box.scroll <= box.client && box.right <= 320, `${name} fits at 320 px: ${JSON.stringify(box)}`);
      await page.keyboard.press("Escape");
    };
    for (const [button, name] of [["#action-import", "import"], ["#action-agents", "agents"], ["#action-code", "code"], ["#action-projects", "projects"]]) {
      await page.locator(button).click();
      await page.locator("dialog[open]").waitFor();
      await fits(name);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    const small = await page.evaluate(() => [...document.querySelectorAll("button, input, textarea, [role=treeitem] > .row, a[href]")]
      .filter((element) => element.getClientRects().length > 0 && !element.closest("dialog:not([open])"))
      .map((element) => ({ name: element.id || element.getAttribute("aria-label") || element.textContent.trim().slice(0, 20), rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width < 24 || rect.height < 24)
      .map(({ name, rect }) => `${name} ${Math.round(rect.width)}x${Math.round(rect.height)}`));
    assert.deepEqual(small, [], "WCAG 2.5.8 target size");
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Research dialog audits clean, empty and with a reference shown", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-a11y-research-")));
  const at = "2026-11-07T00:00:00.000Z";
  const verified = { status: "verified", license: "Apache-2.0", redistributable: true };
  writeFileSync(join(root, "pack.json"), JSON.stringify({
    schemaVersion: 1, packId: "urn:ninerr:pack:a11y", ownerScope: null, createdAt: at,
    sources: [{ id: "urn:ninerr:source:one", uri: "https://example.com/one", observedAt: at, rights: verified }],
    assets: [],
    objects: [{ id: "urn:ninerr:object:a", kind: "pattern", title: "A dashboard", tags: ["dashboard"], sourceId: "urn:ninerr:source:one", assetSha256: null, confidence: "observed", visibility: "public", rights: verified }],
  }));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("research");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    await page.locator("#action-research").click();
    await page.waitForFunction(() => document.getElementById("research-status")?.textContent !== "");
    await audit(page, "the Research dialog with no pack");
    await page.locator("#research-folder").fill(root);
    await page.locator("#research-file").fill("pack.json");
    await page.locator("#research-file").press("Enter");
    await page.waitForFunction(() => document.getElementById("research-status").textContent.startsWith("Read "));
    await page.locator("#research-results button").click();
    await page.locator("#research-detail dl").waitFor();
    await audit(page, "the Research dialog with a reference shown");
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("generated output audits clean: exported code and code brought into the design", () => {
  // A design made accessibly exports to code whose design audits clean.
  const { operations } = importJsx(`export function Signup() {
  return (
    <form aria-label="Sign up">
      <h1>Join</h1>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" />
      <button type="submit">Create account</button>
      <img src="data:image/png;base64,AA==" alt="Logo" />
    </form>
  );
}`);
  const document = { schemaVersion: 1, id: "d", name: "d", revision: 0, rootIds: [operations[0].rootId], nodes: Object.fromEntries(operations[0].nodes.map((node) => [node.id, node])), metadata: {} };
  const formId = operations[0].nodes[1].id;
  const { code } = exportJsx(document, formId);
  const ir = buildCodeIr([{ path: "Signup.jsx", content: code }]);
  const design = codeToDesign(ir, ir.rootIds[0], "Signup");
  assert.deepEqual(auditAccessibility(accessibilityTreeFromDesignDoc(design)).findings, []);
  // The audit is live: a missing alt and an unnamed button are found in exported output.
  const bad = importJsx("export function Bad() { return <div><img src=\"data:image/png;base64,AA==\" /><button></button></div>; }");
  const badDocument = { ...document, rootIds: [bad.operations[0].rootId], nodes: Object.fromEntries(bad.operations[0].nodes.map((node) => [node.id, node])) };
  const badCode = exportJsx(badDocument, bad.operations[0].nodes[1].id).code;
  const badIr = buildCodeIr([{ path: "Bad.jsx", content: badCode }]);
  const rules = auditAccessibility(accessibilityTreeFromDesignDoc(codeToDesign(badIr, badIr.rootIds[0], "Bad"))).findings.map((finding) => finding.ruleId).sort();
  assert.deepEqual(rules, ["a11y/button-name", "a11y/image-alt"]);
  // Two copies of the form under one parent export each id at most once.
  const twice = { ...document, rootIds: ["both"], nodes: { ...document.nodes, both: { id: "both", type: "element", parentId: null, children: [formId], props: { tag: "div" }, metadata: {} } } };
  const second = importJsx(`export function Again() { return (<form aria-label="Again"><label htmlFor="email">Email</label><input id="email" /></form>); }`).operations[0].nodes.slice(1);
  for (const node of second) twice.nodes[node.id] = { ...node, parentId: node.parentId.startsWith("page-code") ? "both" : node.parentId };
  twice.nodes.both.children.push(second[0].id);
  twice.nodes[formId] = { ...twice.nodes[formId], parentId: "both" };
  const exported = exportJsx(twice, "both").code;
  assert.equal((exported.match(/ id="email"/gu) ?? []).length, 1, "an id appears once");
  assert.match(exported, /htmlFor="email"[\s\S]*id="email"[\s\S]*htmlFor="email-2"[\s\S]*id="email-2"/u, "each copy's label names its own control");
});

test("pairing labels with controls is linear, and an export too large is refused before any work", () => {
  // Alternating labels and inputs that all share one id, so every label has many
  // candidates; in rows of 50 pairs (code-ir bounds the children of one element).
  const flat = (pairs) => {
    const nodes = [{ id: "form", type: "element", parentId: null, children: [], props: { tag: "form" }, metadata: {} }];
    let row = null;
    for (let index = 0; index < pairs; index += 1) {
      if (index % 50 === 0) {
        row = { id: `row${index}`, type: "element", parentId: "form", children: [], props: { tag: "div" }, metadata: {} };
        nodes.push(row);
        nodes[0].children.push(row.id);
      }
      nodes.push({ id: `l${index}`, type: "element", parentId: row.id, children: [], props: { tag: "label", text: "Email", attributes: { for: "x" } }, metadata: {} });
      nodes.push({ id: `i${index}`, type: "element", parentId: row.id, children: [], props: { tag: "input", attributes: { id: "x" } }, metadata: {} });
      row.children.push(`l${index}`, `i${index}`);
    }
    return { id: "doc", rootIds: ["form"], nodes: Object.fromEntries(nodes.map((node) => [node.id, node])) };
  };
  const started = performance.now();
  const code = exportJsx(flat(2_000), "form").code;
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 2_000, `2,000 label/control pairs export in ${elapsed.toFixed(0)} ms`);
  assert.match(code, /htmlFor="x-2000"[\s\S]*id="x-2000"/u, "each label still names its own (next) control");
  assert.equal((code.match(/ id="x-2000"/gu) ?? []).length, 1);
  // 10,000 layers: refused at once, as the limit says, not after pairing them.
  const refusedAt = performance.now();
  assert.throws(() => exportJsx(flat(5_000), "form"), /at most 5000 layers/u);
  assert.ok(performance.now() - refusedAt < 1_000, "refused before the pairing work");
});

// P09 criterion 4: the controls P09 added meet the same bar. Each is audited while it shows,
// reached and used from the keyboard alone with a visible focus ring, and measured at 320 px and
// for target size.
const row = (page, id) => page.locator(`[id="layer-${id}"] > .row`);

/** Press Tab until `id` has the focus, and require a visible ring on it. */
async function tabTo(page, id) {
  for (let index = 0; index < 60; index += 1) {
    await page.keyboard.press("Tab");
    const now = await page.evaluate(() => {
      const element = document.activeElement;
      const style = getComputedStyle(element);
      const opaque = !/^rgba\([^)]*,\s*0\)$/u.test(style.outlineColor) && style.outlineColor !== "transparent";
      return { id: element.id, ring: element.matches(":focus-visible") && style.outlineStyle !== "none" && style.outlineWidth !== "0px" && opaque };
    });
    if (now.id === id) {
      assert.ok(now.ring, `${id} shows focus`);
      return;
    }
  }
  assert.fail(`${id} is not reachable by Tab`);
}

async function threeBoxes(page, host) {
  await page.locator("#new-project-name").fill("p09");
  await page.keyboard.press("Enter");
  await waitRevision(page, 0);
  const ids = [];
  for (let made = 0; made < 3; made += 1) {
    if (made > 0) await row(page, host.session.document.rootIds[0]).click();
    await page.locator("#action-insert-box").click();
    await waitRevision(page, made + 1);
    ids.push(host.session.document.nodes[host.session.document.rootIds[0]].children.at(-1));
  }
  return ids;
}

/** An agent's change through MCP, so Undo agent change shows. */
async function agentChange(host) {
  const created = await fetch(`${host.url}/api/agents/create`, { method: "POST", headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "Checker" }) });
  const { token } = await created.json();
  const post = (body) => fetch(host.mcpUrl, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", ...body }) });
  await post({ id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  await post({ id: 1, method: "tools/call", params: { name: "create_frame", arguments: { name: "Landing", width: 640, height: 400 } } });
}

test("what P09 added audits clean while it shows: classes, a selection, a group, a drag under way", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-a11y-p09-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    const [a, b, c] = await threeBoxes(page, host);
    await row(page, a).click();
    assert.equal(await page.locator("#inspect-classes").isVisible(), true, "the Classes field shows for a selected layer");
    await audit(page, "the inspector with its Classes field");

    await row(page, c).click({ modifiers: ["ControlOrMeta"] });
    await page.waitForFunction((id) => document.getElementById(`layer-${id}`)?.getAttribute("aria-selected") === "true", c);
    assert.equal(await page.locator("#action-group").isEnabled(), true);
    await audit(page, "two layers selected, Group enabled");

    await page.keyboard.press("ControlOrMeta+g");
    await waitRevision(page, 4);
    const group = host.session.document.nodes[host.session.document.rootIds[0]].children.find((id) => id.startsWith("group-"));
    assert.ok(group);
    await audit(page, "a group layer");
    await page.keyboard.press("ControlOrMeta+z");
    await waitRevision(page, 5);

    // A drop mark, in the middle of a drag.
    const from = await row(page, a).boundingBox();
    const over = await row(page, b).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(over.x + over.width / 2, over.y + over.height / 2 - 2, { steps: 5 });
    await page.mouse.move(over.x + over.width / 2, over.y + over.height / 2, { steps: 2 });
    await page.locator("#layers .drop-inside, #layers .drop-before, #layers .drop-after").first().waitFor();
    await audit(page, "a drag under way");
    // The audit reads text and backgrounds, not a mark's box-shadow, so its paint is checked here.
    const mark = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector("#layers .drop-inside, #layers .drop-before, #layers .drop-after"));
      return `${style.boxShadow} ${style.outlineStyle} ${style.borderTopStyle} ${style.borderBottomStyle} ${style.backgroundColor}`;
    });
    const unmarked = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector("#layers .row:not(.drop-inside):not(.drop-before):not(.drop-after):not([aria-selected])") ?? document.querySelector("#layers .row"));
      return `${style.boxShadow} ${style.outlineStyle} ${style.borderTopStyle} ${style.borderBottomStyle} ${style.backgroundColor}`;
    });
    assert.notEqual(mark, unmarked, "a drop mark is painted");
    await page.keyboard.press("Escape");
    await page.mouse.up();

    await agentChange(host);
    await page.waitForFunction(() => !document.getElementById("action-undo-agent").hidden);
    await audit(page, "Undo agent change beside Undo");
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Group, Classes and Undo agent change are reached and used by Tab and Enter alone", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-a11y-p09-keys-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    const [a, , c] = await threeBoxes(page, host);
    let revision = 3;
    // Into the layers tree by Tab, and on to the first box: the page, then its first child.
    const toFirstBox = async () => {
      await page.evaluate(() => document.activeElement.blur());
      for (let index = 0; index < 60 && !(await page.evaluate(() => document.activeElement.getAttribute("role") === "treeitem")); index += 1) await page.keyboard.press("Tab");
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowDown");
    };
    await toFirstBox();
    await page.keyboard.press("Enter");
    await page.waitForFunction((id) => document.getElementById(`layer-${id}`)?.getAttribute("aria-selected") === "true", a);

    await tabTo(page, "inspect-classes");
    await page.keyboard.type("loud");
    await page.keyboard.press("Tab");
    await waitRevision(page, ++revision);
    assert.equal(host.session.document.nodes[a].props.attributes.class, "loud");

    // Two layers selected from the keyboard, then grouped: the hint and the tree both say how.
    assert.match(await page.locator("#layers-keys").textContent(), /Shift\+Enter adds a layer to the selection or takes it out/u);
    assert.match(await page.locator("#layers").getAttribute("aria-keyshortcuts"), /Shift\+Enter/u);
    await toFirstBox();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Shift+Enter");
    await page.waitForFunction((id) => document.getElementById(`layer-${id}`)?.getAttribute("aria-selected") === "true", c);
    await tabTo(page, "action-group");
    await page.keyboard.press("Enter");
    await waitRevision(page, ++revision);
    assert.match(host.session.document.nodes[a].parentId, /^group-/u);
    assert.deepEqual(host.session.document.nodes[host.session.document.nodes[a].parentId].children, [a, c]);

    await agentChange(host);
    await waitRevision(page, ++revision);
    await page.waitForFunction(() => !document.getElementById("action-undo-agent").hidden);
    const before = host.session.document.rootIds.length;
    await page.evaluate(() => document.activeElement.blur());
    await tabTo(page, "action-undo-agent");
    await page.keyboard.press("Enter");
    await waitRevision(page, ++revision);
    assert.equal(host.session.document.rootIds.length, before - 1, "the agent's frame is gone");
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("with every P09 control showing, the editor reflows at 320 px and each target is at least 24 px", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-a11y-p09-reflow-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    const [a] = await threeBoxes(page, host);
    await agentChange(host);
    await page.waitForFunction(() => !document.getElementById("action-undo-agent").hidden);
    // One layer selected: with two, the inspector does not show Classes.
    await row(page, a).click();
    const measured = ["action-undo-agent", "action-group", "inspect-classes"];
    const targets = () => page.evaluate(() => [...document.querySelectorAll("button, input, textarea, select, [role=treeitem] > .row, a[href]")]
      .filter((element) => element.getClientRects().length > 0 && !element.closest("dialog:not([open])"))
      .map((element) => ({ id: element.id, name: element.id || element.getAttribute("aria-label") || element.textContent.trim().slice(0, 20), rect: element.getBoundingClientRect() }))
      .map(({ id, name, rect }) => ({ id, name, width: rect.width, height: rect.height, right: rect.right })));

    const wide = await targets();
    for (const id of measured) assert.ok(wide.some((target) => target.id === id), `${id} is measured`);
    assert.deepEqual(wide.filter(({ width, height }) => width < 24 || height < 24).map(({ name, width, height }) => `${name} ${width}x${height}`), [], "WCAG 2.5.8 target size");

    await page.setViewportSize({ width: 320, height: 640 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 320, "no horizontal scrolling at 320 px");
    const narrow = await targets();
    const panel = await page.evaluate(() => {
      const element = document.querySelector(".side-panel");
      return { scroll: element.scrollWidth, client: element.clientWidth };
    });
    assert.ok(panel.scroll <= panel.client, `the inspector needs no sideways scrolling: ${JSON.stringify(panel)}`);
    for (const id of measured) {
      const target = narrow.find((each) => each.id === id);
      assert.ok(target, `${id} shows at 320 px`);
      assert.ok(target.right <= 321, `${id} fits at 320 px: ${target.right}`);
    }
    assert.deepEqual(narrow.filter(({ width, height }) => width < 24 || height < 24).map(({ name, width, height }) => `${name} ${width}x${height}`), [], "target size at 320 px");
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

/** What has the focus, and whether a ring shows on it: a tree row draws the ring for its item. */
const focusNow = (page) => page.evaluate(() => {
  const element = document.activeElement;
  const painted = element.getAttribute("role") === "treeitem" ? element.querySelector(":scope > .row") : element;
  const style = getComputedStyle(painted);
  const rect = painted.getBoundingClientRect();
  return {
    id: element.id,
    tag: element.tagName,
    role: element.getAttribute("role"),
    visible: element.matches(":focus-visible") && style.outlineStyle !== "none" && style.outlineWidth !== "0px" && !/^rgba\([^)]*,\s*0\)$/u.test(style.outlineColor),
    inView: rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight,
  };
});

test("at 320 px every Tab stop shows a ring, in view", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-a11y-p09-rings-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    const [a] = await threeBoxes(page, host);
    await agentChange(host);
    await page.waitForFunction(() => !document.getElementById("action-undo-agent").hidden);
    await row(page, a).click();
    await page.setViewportSize({ width: 320, height: 640 });
    await page.evaluate(() => document.activeElement.blur());
    const seen = new Set();
    let wrapped = false;
    for (let index = 0; index < 120; index += 1) {
      await page.keyboard.press("Tab");
      const now = await focusNow(page);
      // Out of the end of the page once, and round to its start.
      if (now.tag === "BODY") {
        if (wrapped) break;
        wrapped = true;
        continue;
      }
      const name = now.id || now.role || `${now.tag} at stop ${index}`;
      if (seen.has(name)) break;
      seen.add(name);
      if (now.role === "application") {
        // The canvas paints its ring over the design, so it is read from the pixels.
        const box = await page.locator("[role=application]").boundingBox();
        const { PNG } = await import("./support/png.mjs");
        const shot = await page.screenshot({ clip: { x: box.x, y: box.y + box.height / 2, width: 2, height: 1 } });
        assert.deepEqual(PNG.firstPixel(shot), [26, 95, 208], "the canvas shows focus at 320 px");
      } else assert.ok(now.visible, `${name} shows focus at 320 px`);
      assert.ok(now.inView, `${name} is in view at 320 px`);
    }
    for (const id of ["action-undo-agent", "action-group", "inspect-classes", `layer-${a}`, "application"]) assert.ok(seen.has(id), `${id} was reached: ${[...seen].join(" ")}`);
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("focus stays usable after Classes commits and after Group", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-a11y-p09-after-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    const [a, b] = await threeBoxes(page, host);
    let revision = 3;
    await row(page, a).click();

    // Enter commits and stays in the field; Tab commits and goes on to the next one.
    await page.locator("#inspect-classes").focus();
    await page.keyboard.type("loud");
    await page.keyboard.press("Enter");
    await waitRevision(page, ++revision);
    assert.equal((await focusNow(page)).id, "inspect-classes", "after Enter");
    await page.keyboard.type(" big");
    await page.keyboard.press("Tab");
    await waitRevision(page, ++revision);
    assert.equal(host.session.document.nodes[a].props.attributes.class, "loud big");
    const next = await focusNow(page);
    assert.notEqual(next.tag, "BODY", "after Tab, not lost");
    assert.notEqual(next.id, "inspect-classes", "after Tab, moved on");
    assert.ok(next.visible, `${next.id} shows focus after Tab`);

    // Group from its button: the focus is not lost, and a keyboard user goes on from there.
    await row(page, b).click({ modifiers: ["ControlOrMeta"] });
    await tabTo(page, "action-group");
    await page.keyboard.press("Enter");
    await waitRevision(page, ++revision);
    const group = host.session.document.nodes[a].parentId;
    const fromButton = await focusNow(page);
    assert.notEqual(fromButton.tag, "BODY", "after the Group button");
    assert.equal(fromButton.id, "action-group", "the button stays, enabled, with the group selected");
    assert.equal(await page.locator("#action-group").isDisabled(), false);
    // Undone, nothing is selected and Group is disabled: the focus goes to the layers.
    await page.keyboard.press("ControlOrMeta+z");
    await waitRevision(page, ++revision);
    await page.waitForFunction(() => document.getElementById("action-group").disabled);
    const afterUndo = await focusNow(page);
    assert.equal(afterUndo.role, "treeitem", `undoing it keeps the focus: ${afterUndo.id || afterUndo.tag}`);
    assert.ok(afterUndo.visible, "with its ring");

    // Delete from its button, the same way.
    await row(page, b).click();
    await tabTo(page, "action-delete");
    await page.keyboard.press("Enter");
    await waitRevision(page, ++revision);
    await page.waitForFunction(() => document.getElementById("action-delete").disabled);
    assert.equal((await focusNow(page)).role, "treeitem", "after Delete");
    // A held or further Enter runs no command: the layer stays deleted.
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    assert.equal(host.session.revision, revision, "Enter did not undo the delete");
    assert.equal(Object.hasOwn(host.session.document.nodes, b), false);
    await page.keyboard.press("ControlOrMeta+z");
    await waitRevision(page, ++revision);

    // Ctrl+G from the tree: on the new group's row.
    await row(page, a).click();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ControlOrMeta+g");
    await waitRevision(page, ++revision);
    const nodes = host.session.document.nodes;
    const grouped = Object.values(nodes).find((node) => node.type === "group")?.id;
    assert.notEqual(grouped, group);
    assert.deepEqual(nodes[grouped].children, [a], "the layer Enter selected, alone");
    const fromTree = await focusNow(page);
    assert.equal(fromTree.id, `layer-${grouped}`, "on the new group");
    assert.ok(fromTree.visible, "with its ring");

    // A dialog's opener disabled while it was open: on closing, focus goes to the layers.
    await page.locator("#action-code").click();
    await page.locator("#dialog[open]").waitFor();
    await page.evaluate(() => { document.getElementById("action-code").disabled = true; });
    await page.keyboard.press("Escape");
    // The dialog's close event comes a task after it closes.
    await page.waitForFunction(() => !document.getElementById("dialog").open && document.activeElement.getAttribute("role") === "treeitem", null, { timeout: 5000 });
    await page.evaluate(() => { document.getElementById("action-code").disabled = false; });
    // And one hidden meanwhile.
    await page.locator("#action-code").click();
    await page.locator("#dialog[open]").waitFor();
    await page.evaluate(() => { document.getElementById("action-code").hidden = true; });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("dialog").open && document.activeElement.getAttribute("role") === "treeitem", null, { timeout: 5000 });
    await page.evaluate(() => { document.getElementById("action-code").hidden = false; });

    // Undo pressed until nothing is left: not to Redo, which a further Enter would run.
    await tabTo(page, "action-undo");
    const undoAll = async () => {
      // The button follows /api/session, which answers after the revision moves.
      const session = page.waitForResponse("**/api/session");
      await page.keyboard.press("Enter");
      await waitRevision(page, ++revision);
      await session;
      await page.evaluate(() => new Promise(requestAnimationFrame));
    };
    while (!(await page.locator("#action-undo").isDisabled())) await undoAll();
    assert.equal(await page.locator("#layers [role=treeitem]").count(), 0, "the page is undone too");
    await page.waitForFunction(() => document.activeElement.getAttribute("role") === "application", null, { timeout: 5000 });
    const before = revision;
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => document.getElementById("dialog").open), false, "with no layers left, Enter opens nothing");
    assert.equal(revision, before);
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("deleting the last layer, or a project opened elsewhere, leaves the focus on the canvas", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-a11y-p09-last-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await threeBoxes(page, host);
    const onCanvas = () => page.waitForFunction(() => document.activeElement.getAttribute("role") === "application", null, { timeout: 5000 });
    await row(page, host.session.document.rootIds[0]).click();
    await tabTo(page, "action-delete");
    await page.keyboard.press("Enter");
    await waitRevision(page, 4);
    await onCanvas();
    const revision = host.session.revision;
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    assert.equal(host.session.revision, revision, "Enter changes nothing");
    assert.equal(await page.evaluate(() => document.getElementById("dialog").open), false, "and opens nothing");

    // Another project opened while Save has the focus.
    await tabTo(page, "action-save");
    // A selection shared after the host has moved on is refused (#377): let Delete's go first.
    await page.waitForTimeout(250);
    const created = await fetch(`${host.url}/api/projects/create`, { method: "POST", headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "elsewhere" }) });
    assert.equal(created.status < 300, true, `created: ${created.status}`);
    await page.waitForFunction(() => document.getElementById("project-name").textContent === "elsewhere");
    await page.waitForFunction(() => document.activeElement !== document.body, null, { timeout: 5000 });
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// #378: leaving Classes with Tab commits, and focus lands in the next field, where Ctrl+Z is that
// field's own. The inspector says so, and Undo in the toolbar undoes the change from there.
test("after Classes commits, Ctrl+Z in the next field is the field's, and Undo undoes the change", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-a11y-p09-undo-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    const [a] = await threeBoxes(page, host);
    let revision = 3;
    await row(page, a).click();
    assert.match(await page.locator("#inspect-undo-note").textContent(), /Ctrl\+Z undoes your typing.*use Undo in the toolbar/u);
    await page.locator("#inspect-classes").focus();
    await page.keyboard.type("loud");
    await page.keyboard.press("Tab");
    await waitRevision(page, ++revision);
    assert.equal(await page.evaluate(() => document.activeElement.tagName), "INPUT", "in the next field");

    await page.keyboard.press("ControlOrMeta+z");
    await page.waitForTimeout(300);
    assert.equal(host.session.revision, revision, "Ctrl+Z here does not reach the editor's Undo");
    assert.equal(host.session.document.nodes[a].props.attributes.class, "loud");

    await tabTo(page, "action-undo");
    await page.keyboard.press("Enter");
    await waitRevision(page, ++revision);
    assert.equal(host.session.document.nodes[a].props.attributes?.class, undefined, "Undo undoes it");
    await audit(page, "the inspector with its Undo note");
    await page.setViewportSize({ width: 320, height: 640 });
    const panel = await page.evaluate(() => {
      const element = document.querySelector(".side-panel");
      return { scroll: element.scrollWidth, client: element.clientWidth };
    });
    assert.ok(panel.scroll <= panel.client, `the note needs no sideways scrolling: ${JSON.stringify(panel)}`);
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the inspector's Text field is reached, edited and sized by the keyboard, at 320 px too", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-a11y-p09-text-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await threeBoxes(page, host);
    let revision = 3;
    await row(page, host.session.document.rootIds[0]).click();
    await page.locator("#action-insert-text").click();
    await waitRevision(page, ++revision);
    const text = host.session.document.nodes[host.session.document.rootIds[0]].children.at(-1);
    await page.waitForFunction((id) => document.getElementById(`layer-${id}`)?.getAttribute("aria-selected") === "true", text);
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 640 });
      await page.evaluate(() => document.activeElement.blur());
      await tabTo(page, "inspect-text");
      const words = `Words at ${width}`;
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type(words);
      await page.keyboard.press("Tab");
      await waitRevision(page, ++revision);
      assert.equal(host.session.document.nodes[text].props.text, words);
      assert.notEqual((await focusNow(page)).tag, "BODY", `focus is kept at ${width}`);
      const box = await page.locator("#inspect-text").boundingBox();
      assert.ok(box.width >= 24 && box.height >= 24, `its size at ${width}: ${JSON.stringify(box)}`);
      assert.ok(box.x + box.width <= width + 1, `it fits at ${width}: ${JSON.stringify(box)}`);
    }
    await audit(page, "the Text field at 320 px");
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Tokens dialog audits clean, with no design system and with tokens in two modes", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-a11y-tokens-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("tokens");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    await page.locator("#action-tokens").click();
    await page.locator("#tokens-create").waitFor();
    await audit(page, "the Tokens dialog with no design system");
    await page.locator("#tokens-create").click();
    await waitRevision(page, 1);
    await page.locator("#token-new-name").fill("--brand");
    await page.locator("#token-new-value").fill("#2255ff");
    await page.locator("#token-add").click();
    await waitRevision(page, 2);
    await page.locator('input[aria-label="New mode for Base"]').fill("Dark");
    await page.locator('section[aria-label="Base"] button', { hasText: "Add mode" }).click();
    await waitRevision(page, 3);
    await page.locator('[data-token-row="--brand"]').waitFor();
    await audit(page, "the Tokens dialog with a token in two modes");
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Components dialog audits clean, for a layer, a component and an instance", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-a11y-components-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("components");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    const call = client(host.url, host.token);
    const { document } = await ok(call("GET", "/api/document"), "document");
    await ok(call("POST", "/api/edit", { baseRevision: document.revision, operations: [{ type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: "card", type: "frame", props: { name: "Card", text: "Hi", style: { width: "120px", height: "40px" } } } }], intent: "Add card" }), "card");
    await waitRevision(page, 1);
    await page.locator('#layers [role=treeitem][data-node-id="card"] > .row').click();
    await page.locator("#action-components").click();
    await page.locator("#component-create").waitFor();
    await audit(page, "the Components dialog for a layer");
    await page.locator("#component-create").click();
    await waitRevision(page, 2);
    await page.locator("#property-add").waitFor();
    await audit(page, "the Components dialog for a component");
    // A slot on the component's root: its instances then choose a component for it.
    await page.locator("#property-name").fill("Content");
    await page.locator("#property-kind").selectOption("slot");
    await page.locator("#property-add").click();
    await waitRevision(page, 3);
    await page.locator("#components-list button").first().click();
    await waitRevision(page, 4);
    await page.locator("#components-detach").waitFor();
    await page.locator('select[data-property]').waitFor();
    await audit(page, "the Components dialog for an instance");
    await page.locator("#instance-layer").selectOption({ index: 1 });
    await page.locator("#instance-style").waitFor();
    await audit(page, "the Components dialog editing a layer inside an instance");
    // The slot offers no component that would draw Card inside Card: here, none but its own content.
    const slotOptions = () => page.locator("select[data-property] option").evaluateAll((options) => options.map((option) => [option.textContent, option.disabled]));
    assert.deepEqual(await slotOptions(), [["Its own content", false]]);
    // A value set elsewhere that draws Card in Card is shown, not offered, and the canvas marks it stale.
    const { document: now } = await ok(call("GET", "/api/document"), "document");
    const instance = Object.values(now.nodes).find((node) => node.type === "component-instance");
    const [slot] = now.nodes[instance.props.componentId].props.properties;
    await ok(call("POST", "/api/edit", { baseRevision: now.revision, operations: [{ type: "set-props", nodeId: instance.id, set: { propertyValues: { [slot.id]: instance.props.componentId } } }], intent: "Card in Card" }), "values");
    await waitRevision(page, now.revision + 1);
    await page.waitForFunction(() => document.querySelectorAll("select[data-property] option").length === 2);
    assert.deepEqual(await slotOptions(), [["Its own content", false], ["A component that is gone, or would draw this one in itself", true]]);
    assert.equal(await page.evaluate((id) => document.querySelector("iframe").contentDocument.querySelector(`[data-ninerr-id="${id}"]`).hasAttribute("data-ninerr-stale"), instance.id), true);
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Component sources dialog audits clean, browsing an Astryx component's record", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-a11y-sources-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("sources");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    await page.locator("#action-component-sources").click();
    await page.locator('#component-source-results [data-source-id="astryx"]').click();
    await page.locator("#source-component-query").fill("dialog");
    await page.locator('#source-component-results [data-component-id="astryx:Dialog"]').click();
    await page.locator("#source-component-props").waitFor();
    await audit(page, "the Component sources dialog with an Astryx component's record");
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
