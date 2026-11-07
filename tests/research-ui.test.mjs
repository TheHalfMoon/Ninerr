import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { hostPool, mcpClient, ok } from "./support/host-api.mjs";

// M05: the Research dialog. A person searches the project's local reference pack through what an
// agent's search_design_references uses, offline, with a pack's words shown as text, no link
// followed and no image fetched.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 7, 12, 0, 0) + clock++ * 1000).toISOString();
const at = "2026-11-07T00:00:00.000Z";
const verified = { status: "verified", license: "Apache-2.0", redistributable: true };
const restricted = { status: "restricted", license: null, redistributable: false };
const HOSTILE = "<img src=\"https://evil.example/x.png\" onerror=\"window.pwned=1\">";
const object = (id, overrides = {}) => ({
  id: `urn:ninerr:object:${id}`, kind: "pattern", title: `Pattern ${id} dashboard`, tags: ["dashboard"],
  sourceId: "urn:ninerr:source:one", assetSha256: null, confidence: "observed", visibility: "public", rights: verified, ...overrides,
});
const PACK = {
  schemaVersion: 1, packId: "urn:ninerr:pack:research", ownerScope: null, createdAt: at,
  sources: [{ id: "urn:ninerr:source:one", uri: "https://example.com/one", observedAt: at, rights: verified }],
  assets: [],
  objects: [
    object("a"),
    object("b", { kind: "screen", title: HOSTILE, tags: ["dashboard"], rights: restricted }),
    object("c", { kind: "token", title: "Colour token", tags: [] }),
    object("long", { kind: "flow", title: "L".repeat(200), tags: [] }),
  ],
};

async function research(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-research-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const projects = join(root, "projects");
  const packs = join(root, "packs");
  mkdirSync(projects);
  mkdirSync(packs);
  writeFileSync(join(packs, "pack.json"), JSON.stringify(PACK));
  const running = await pool.open(projects);
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  const editor = await openEditor(running.host);
  t.after(() => editor.close());
  const { page } = editor;
  await waitRevision(page, running.host.session.revision);
  const status = () => page.locator("#research-status").textContent();
  const rows = () => page.locator("#research-results button").evaluateAll((items) => items.map((item) => item.dataset.id));
  const readPack = async () => {
    await page.locator("#research-folder").fill(packs);
    await page.locator("#research-file").fill("pack.json");
    await page.locator("#research-file").press("Enter");
    await page.waitForFunction(() => document.getElementById("research-status").textContent.startsWith("Read ") || document.querySelector("#dialog .error").textContent !== "");
    assert.equal(await page.locator("#dialog .error").textContent(), "", "the pack is read");
  };
  return { running, editor, page, packs, status, rows, readPack };
}

test("with no pack read, the dialog says so, and a refused path changes nothing", browserTestOptions(), async (t) => {
  const { editor, page, packs, status, rows } = await research(t);
  await page.locator("#action-research").focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.getElementById("research-status")?.textContent !== "");
  assert.match(await status(), /No reference pack is read for this project.*does not look online/u);
  assert.deepEqual(await rows(), []);
  await page.locator("#research-folder").fill(packs);
  await page.locator("#research-file").fill("missing.json");
  await page.locator("#research-file").press("Enter");
  await page.locator("#dialog[open] .error[role=alert]").filter({ hasText: /\S/u }).waitFor();
  assert.match(await status(), /No reference pack is read/u);
  assert.deepEqual(editor.foreign, []);
});

test("search gives what an agent's search gives, and a pack's words stay text", browserTestOptions(), async (t) => {
  const { running, editor, page, status, rows, readPack } = await research(t);
  await page.locator("#action-research").click();
  await readPack();
  assert.match(await status(), /^Read pack\.json: 4 public references\. 4 references\.$/u);

  // The same references, in the same order, as MCP and the host's route.
  const { token } = await ok(running.call("POST", "/api/agents/create", { name: "Reader" }), "agent");
  const agent = mcpClient(running.host.mcpUrl, token);
  await agent.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  const idsOf = async (args) => (await agent.tool("search_design_references", args)).structuredContent.results.map(({ id }) => id);
  assert.deepEqual(await rows(), await idsOf({ query: "", limit: 100 }));

  await page.locator("#research-query").fill("dashboard");
  await page.locator("#research-query").press("Enter");
  await page.waitForFunction(() => document.getElementById("research-status").textContent === "2 references.");
  assert.deepEqual(await rows(), await idsOf({ query: "dashboard", limit: 100 }));

  await page.locator("#research-kind").selectOption("screen");
  await page.locator("#research-search").click();
  await page.waitForFunction(() => document.getElementById("research-status").textContent === "1 reference.");
  assert.deepEqual(await rows(), await idsOf({ query: "dashboard", kinds: ["screen"], limit: 100 }));
  assert.deepEqual(await rows(), ["urn:ninerr:object:b"]);

  // A hostile title is shown as words: no element, no script, no request.
  const row = page.locator("#research-results button");
  assert.ok((await row.textContent()).includes(HOSTILE));
  assert.match(await row.textContent(), /not cleared for reuse/u);
  await row.focus();
  await page.keyboard.press("Enter");
  await page.locator("#research-detail dl").waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.id), "research-detail", "focus follows to the detail");
  assert.equal(await page.locator("#dialog img").count(), 0);
  assert.equal(await page.locator("#dialog a").count(), 0, "the source is no link");
  assert.equal(await page.evaluate(() => window.pwned), undefined);

  // Its rights are as the host says. Nothing is offered as reusable.
  const { reference } = (await agent.tool("get_design_reference", { id: "urn:ninerr:object:b" })).structuredContent;
  const text = await page.locator("#research-detail").textContent();
  assert.ok(text.includes(reference.reuse.reason), text);
  assert.equal(reference.reuse.allowed, false);
  assert.match(text, /restricted, no license stated, not redistributable/u);
  assert.match(text, /https:\/\/example\.com\/one/u);
  assert.match(text, /This reference has no asset/u);
  assert.match(text, /Rights the pack states/u, "the pack's claim, named as one");
  assert.match(text, /^.*Not cleared for reuse: /u);
  assert.equal(await page.evaluate(() => {
    const element = document.activeElement;
    return element.matches(":focus-visible") && getComputedStyle(element).outlineStyle !== "none";
  }), true, "the detail shows it has the focus");
  assert.deepEqual(editor.foreign, [], "no request left the host");
  assert.deepEqual(editor.errors, []);
});

test("a nothing-found search says so, and another project starts with no pack", browserTestOptions(), async (t) => {
  const { page, status, rows, readPack } = await research(t);
  await page.locator("#action-research").click();
  await readPack();
  await page.locator("#research-query").fill("no such words");
  await page.locator("#research-query").press("Enter");
  await page.waitForFunction(() => document.getElementById("research-status").textContent === "No reference in this pack matches.");
  assert.deepEqual(await rows(), []);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("dialog").open);
  await page.locator("#action-projects").click();
  await page.locator("#new-project-name").fill("other");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.getElementById("project-name").textContent === "other" && !document.getElementById("dialog").open);
  await page.locator("#action-research").click();
  await page.waitForFunction(() => document.getElementById("research-status")?.textContent !== "");
  assert.match(await status(), /No reference pack is read/u);
});

test("a search that fails leaves no list, a read still says so, and focus stays on the button", browserTestOptions(), async (t) => {
  const { page, status, rows, packs } = await research(t);
  await page.locator("#action-research").click();
  await page.waitForFunction(() => document.getElementById("research-status")?.textContent !== "");
  // A query the host refuses: a tab is not a search's.
  await page.locator("#research-query").evaluate((input) => { input.value = "a\tb"; });
  await page.locator("#research-folder").fill(packs);
  await page.locator("#research-file").fill("pack.json");
  await page.locator("#research-file").press("Enter");
  await page.waitForFunction(() => document.getElementById("research-status").textContent.startsWith("Read pack.json"));
  assert.equal(await status(), "Read pack.json: 4 public references.", "it was read, and it does not say otherwise");
  assert.notEqual(await page.locator("#dialog .error").textContent(), "", "and the failure shows");
  assert.deepEqual(await rows(), []);

  await page.locator("#research-query").fill("");
  await page.locator("#research-search").focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.getElementById("research-status").textContent === "4 references.");
  assert.equal(await page.evaluate(() => document.activeElement.id), "research-search", "Search keeps the keyboard's focus");
  assert.equal(await page.locator("#dialog .error").textContent(), "");

  // With rows showing, a search that fails takes them down.
  assert.equal((await rows()).length, 4);
  await page.locator("#research-query").evaluate((input) => { input.value = "a\tb"; });
  await page.locator("#research-search").click();
  await page.locator("#dialog .error").filter({ hasText: /\S/u }).waitFor();
  assert.deepEqual(await rows(), [], "no list stands for it");
  await page.locator("#research-query").fill("");
  await page.locator("#research-search").click();
  await page.waitForFunction(() => document.getElementById("research-status").textContent === "4 references.");

  // A choice of reference does not cancel a search under way, nor an old failure show over it.
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/references?*", async (route) => {
    await held;
    await route.continue();
  });
  await page.locator("#research-query").fill("dashboard");
  await page.locator("#research-query").press("Enter");
  await page.locator('#research-results button[data-id="urn:ninerr:object:c"]').click();
  await page.locator("#research-detail dl").waitFor();
  release();
  await page.waitForFunction(() => document.getElementById("research-status").textContent === "2 references.");
  assert.equal(await page.locator("#research-detail dl").count(), 0, "the search's answer stands");
  await page.unroute("**/api/references?*");
});

test("while a search runs, a row chosen stays out of the new list, and another search is not swallowed", browserTestOptions(), async (t) => {
  const { page, rows, status, readPack } = await research(t);
  await page.locator("#action-research").click();
  await readPack();
  const heldRoute = async (pattern) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route(pattern, async (route) => {
      await held;
      await route.continue();
    });
    return release;
  };
  // A row chosen while a search runs, whose answer comes after the search's: it is dropped.
  const releaseFirst = await heldRoute("**/api/references?*");
  const releaseDetail = await heldRoute("**/api/references/**");
  await page.locator("#research-query").fill("Colour");
  await page.locator("#research-query").press("Enter");
  const asked = page.waitForRequest((request) => request.url().includes("/api/references/"));
  await page.locator('#research-results button[data-id="urn:ninerr:object:a"]').click();
  await asked;
  releaseFirst();
  await page.waitForFunction(() => document.getElementById("research-status").textContent === "1 reference.");
  assert.deepEqual(await rows(), ["urn:ninerr:object:c"]);
  const answered = page.waitForResponse((response) => response.url().includes("/api/references/"));
  releaseDetail();
  await answered;
  await page.waitForTimeout(200);
  assert.equal(await page.locator("#research-detail dl").count(), 0, "the old row's detail does not land");
  await page.unroute("**/api/references/**");
  await page.unroute("**/api/references?*");

  // A second search while the first runs is sent, and is the one that shows.
  const releaseSearch = await heldRoute("**/api/references?*");
  await page.locator("#research-query").fill("dashboard");
  await page.locator("#research-query").press("Enter");
  const second = page.waitForRequest((request) => request.url().includes("query=no+such"));
  await page.locator("#research-query").fill("no such");
  await page.locator("#research-query").press("Enter");
  await second;
  releaseSearch();
  await page.waitForFunction(() => document.getElementById("research-status").textContent === "No reference in this pack matches.");
  await page.unroute("**/api/references?*");
  assert.deepEqual(await rows(), []);

  // A search that lands while a row has the focus keeps it in the list, or in the field.
  await page.locator("#research-query").fill("");
  await page.locator("#research-query").press("Enter");
  await page.waitForFunction(() => document.getElementById("research-status").textContent === "4 references.");
  const releaseLast = await heldRoute("**/api/references?*");
  await page.locator("#research-query").fill("Colour");
  await page.locator("#research-query").press("Enter");
  await page.locator("#research-results button").first().focus();
  releaseLast();
  await page.waitForFunction(() => document.getElementById("research-status").textContent === "1 reference.");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), "urn:ninerr:object:c");
  assert.match(await status(), /1 reference/u);
});

test("the same project opened again starts with no pack, and an old row says so", browserTestOptions(), async (t) => {
  const { running, page, status, rows, readPack } = await research(t);
  await page.locator("#action-research").click();
  await readPack();
  // Revoked by the host, as closing and reopening does, with the dialog still showing its rows.
  await ok(running.call("POST", "/api/projects/create", { name: "other" }), "other");
  await ok(running.call("POST", "/api/projects/open", { name: "site" }), "back");
  await page.waitForFunction(() => document.getElementById("project-name").textContent === "site");
  await page.locator("#research-results button").first().click();
  await page.waitForFunction(() => /No reference pack is read/u.test(document.getElementById("research-status").textContent) || !document.getElementById("dialog").open);
  if (await page.evaluate(() => document.getElementById("dialog").open)) {
    assert.match(await status(), /No reference pack is read/u);
    assert.deepEqual(await rows(), []);
  }
});

test("the dialog closes when its project is no longer the open one", browserTestOptions(), async (t) => {
  const { running, page, readPack } = await research(t);
  await page.locator("#action-research").click();
  await readPack();
  await ok(running.call("POST", "/api/projects/create", { name: "other" }), "another project");
  await page.waitForFunction(() => document.getElementById("project-name").textContent === "other", null, { timeout: 5000 });
  // A row left from the old project, chosen now, closes the dialog and shows nothing.
  await page.locator("#research-results button").first().click();
  await page.waitForFunction(() => !document.getElementById("dialog").open, null, { timeout: 5000 });
  assert.equal(await page.locator("#research-detail dl").count(), 0);
});

test("Read pack after the project changed closes the dialog", browserTestOptions(), async (t) => {
  const { running, page, readPack } = await research(t);
  await page.locator("#action-research").click();
  await readPack();
  await ok(running.call("POST", "/api/projects/create", { name: "other" }), "another project");
  await page.waitForFunction(() => document.getElementById("project-name").textContent === "other", null, { timeout: 5000 });
  await page.locator("#research-file").press("Enter");
  await page.waitForFunction(() => !document.getElementById("dialog").open, null, { timeout: 5000 });
  const answer = await ok(running.call("GET", "/api/references"), "search");
  assert.equal(answer.status, "not-loaded", "and nothing was read for the other project");
});

test("the dialog fits at 1440, 768 and 320 px, with its targets, and is used by the keyboard", browserTestOptions(), async (t) => {
  const { editor, page, readPack } = await research(t);
  await page.locator("#action-research").click();
  await readPack();
  await page.locator('#research-results button[data-id="urn:ninerr:object:long"]').click();
  await page.locator("#research-detail dl").waitFor();
  for (const width of [1440, 768, 320]) {
    await page.setViewportSize({ width, height: 720 });
    const fit = await page.evaluate(() => {
      const dialog = document.getElementById("dialog");
      const box = dialog.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        inner: innerWidth,
        sideways: dialog.scrollWidth > dialog.clientWidth,
        small: [...dialog.querySelectorAll("button, input, select")].map((item) => [item.id || item.textContent.slice(0, 20), item.getBoundingClientRect()]).filter(([, rect]) => rect.width < 24 || rect.height < 24).map(([name]) => name),
      };
    });
    assert.ok(fit.left >= 0 && fit.right <= fit.inner, `fits at ${width}: ${JSON.stringify(fit)}`);
    assert.equal(fit.sideways, false, `no sideways scrolling at ${width}`);
    assert.deepEqual(fit.small, [], `targets at ${width}`);
  }
  // Every control shows focus, in order, and Tab stays in the dialog.
  await page.locator("#research-folder").focus();
  const seen = [];
  for (let press = 0; press < 12; press += 1) {
    const now = await page.evaluate(() => {
      const element = document.activeElement;
      const style = getComputedStyle(element);
      return { name: element.id || element.textContent.slice(0, 16), body: element === document.body, inDialog: Boolean(element.closest("#dialog")), ring: element.matches(":focus-visible") && style.outlineStyle !== "none" };
    });
    if (now.name !== "") assert.ok(now.inDialog || now.body, `${now.name} is outside the dialog`);
    if (now.inDialog) {
      seen.push(now.name);
      if (press > 0) assert.ok(now.ring, `${now.name} shows focus`);
    }
    await page.keyboard.press("Tab");
  }
  for (const name of ["research-file", "research-query", "research-kind", "research-search", "Close"]) assert.ok(seen.includes(name), `${name}: ${seen.join(", ")}`);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("dialog").open);
  assert.equal(await page.evaluate(() => document.activeElement.id), "action-research", "focus returns");
  assert.deepEqual(editor.errors, []);
});
