import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";

import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { overruns, regressions, summarize } from "./support/gate13.mjs";

// PC8 (#168): large-document canvas and render performance through the editor, in headless
// Chromium against a real studio host, on a 10,000-node project. Budgets (MASTER_PLAN PC
// gate 13): first render at most 2 s; applying a single-node change at most 100 ms at p95,
// from receipt of the change-stream event; the end-to-end edit (request, persisted commit,
// event, patch) at most 750 ms at p95. Measured with the editor's own User Timing marks.
// Closes PC gate 13.
//
// Where the budgets are judged (#275, the founder's decision of 2026-10-13): on the reference
// machine, by scripts/gate13-reference.mjs, which runs this test five times with
// NINERR_GATE13_RECORD set and judges the records. In CI the figures are information: an
// overrun, or a measure 50% above the last recorded baseline for the runner's OS, is reported
// as a warning to investigate. Elsewhere the budgets are asserted, as before.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 7, 12, 0, 0) + clock++ * 1000).toISOString();
const NODES = 10_000;
// An edit's measure is recorded when its own response arrives, which can be just after the
// same change, sent on the event stream, has updated the revision shown.
const waitMeasures = (tab, name, count) => tab.waitForFunction(([measureName, expected]) => performance.getEntriesByName(measureName, "measure").length >= expected, [name, count]);

test("a 10,000-node project renders, applies changes and edits within the gate-13 budgets", browserTestOptions(), async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-perf-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const call = (path, body) => fetch(`${host.url}${path}`, { method: "POST", headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" }, body: JSON.stringify(body) }).then((response) => response.json());
  // A page of 9,999 absolutely positioned cards: 10,000 nodes in one transaction.
  await call("/api/projects/create", { name: "large" });
  const page = { id: "page", type: "frame", parentId: null, children: [], props: { tag: "div", name: "Large page", style: { position: "relative", width: "4000px", height: "6000px" } }, metadata: {} };
  const nodes = [page];
  for (let index = 1; index < NODES; index += 1) {
    const id = `n${index}`;
    page.children.push(id);
    nodes.push({ id, type: "element", parentId: "page", children: [], props: { tag: "div", text: `Card ${index}`, style: { position: "absolute", left: `${(index % 100) * 40}px`, top: `${Math.floor(index / 100) * 60}px`, width: "36px", height: "50px", background: "#eef" } }, metadata: {} });
  }
  // Requests are limited to 1 MiB, so the page is added in batches: the frame, then cards.
  let created = await call("/api/edit", { baseRevision: 0, intent: "Large page", operations: [{ type: "insert-node", node: { ...page, children: [] }, parentId: null, index: 0 }] });
  for (let start = 1; start < NODES; start += 2500) {
    const batch = nodes.slice(start, start + 2500).map((node, offset) => ({ type: "insert-node", node: { ...node, parentId: undefined, children: [] }, parentId: "page", index: start - 1 + offset }));
    created = await call("/api/edit", { baseRevision: created.revision, intent: "Cards", operations: batch });
    assert.ok(Number.isInteger(created.revision), JSON.stringify(created).slice(0, 200));
  }
  assert.equal(Object.keys(host.session.document.nodes).length, NODES);
  await call("/api/projects/close", {});
  const editor = await openEditor(host);
  try {
    const { page: tab } = editor;
    // First render: opening the project, from the request to the drawn canvas.
    const opening = Date.now();
    await tab.locator("#dialog[open] [data-project=large]").click();
    await waitRevision(tab, created.revision);
    // For the record: the whole open, including the host reading the project from disk.
    const openWall = Date.now() - opening;
    const rendered = await tab.evaluate(() => document.querySelector("iframe").contentDocument.querySelectorAll("[data-ninerr-id]").length);
    assert.equal(rendered, NODES);
    const firstRender = await tab.evaluate(() => performance.getEntriesByName("ninerr:render-project", "measure").at(-1).duration);

    // Changes from elsewhere (another client): applying each, from the event's arrival.
    let revision = created.revision;
    for (let index = 0; index < 40; index += 1) {
      const id = `n${1 + index * 37}`;
      const event = await call("/api/edit", { baseRevision: revision, intent: "Recolour", operations: [{ type: "set-props", nodeId: id, set: { style: { position: "absolute", left: "0px", top: `${index * 60}px`, width: "36px", height: "50px", background: index % 2 ? "#fde" : "#dfe" } } }] });
      revision = event.revision;
      await waitRevision(tab, revision);
    }
    const applied = await tab.evaluate(() => performance.getEntriesByName("ninerr:apply-change", "measure").map((entry) => entry.duration));
    // A change that lands while a refresh is in flight is replayed, not timed from arrival.
    assert.ok(applied.length >= 35, `${applied.length} changes measured`);

    // Structural changes from elsewhere: a card added, and a card removed.
    const structural = async (label, operationFor) => {
      await tab.evaluate(() => performance.clearMeasures("ninerr:apply-change"));
      for (let index = 0; index < 30; index += 1) {
        const event = await call("/api/edit", { baseRevision: revision, intent: label, operations: [operationFor(index)] });
        assert.ok(Number.isInteger(event.revision), JSON.stringify(event).slice(0, 200));
        revision = event.revision;
        await waitRevision(tab, revision);
      }
      const durations = await tab.evaluate(() => performance.getEntriesByName("ninerr:apply-change", "measure").map((entry) => entry.duration));
      assert.ok(durations.length >= 25, `${durations.length} ${label} changes measured`);
      return summarize(durations);
    };
    const inserts = await structural("insert", (index) => ({ type: "insert-node", node: { id: `added${index}`, type: "element", props: { tag: "div", text: `Added ${index}`, style: { position: "absolute", left: "0px", top: "0px", width: "36px", height: "50px" } }, metadata: {} }, parentId: "page", index: 500 + index }));
    const treeRows = () => tab.locator("#layers [role=treeitem]").count();
    assert.equal(await treeRows(), NODES + 30, "each added card has its row in the tree");
    assert.equal(await tab.locator("#layers [role=treeitem][data-node-id=page] [role=treeitem]").nth(500).getAttribute("data-node-id"), "added0", "in its place");
    const removes = await structural("remove", (index) => ({ type: "remove-node", nodeId: `added${index}` }));
    assert.equal(await tab.evaluate(() => document.querySelector("iframe").contentDocument.querySelectorAll("[data-ninerr-id]").length), NODES);
    assert.equal(await treeRows(), NODES, "and each removed card's row is gone");

    // Edits made in the editor: Shift+Arrow on the canvas moves the selected card 10 px.
    await tab.evaluate(() => window.scrollTo(0, 0));
    await tab.locator("#layers [role=treeitem][data-node-id=page] > .row").click();
    await tab.keyboard.press("ArrowRight");
    await tab.locator("#layers [role=treeitem][data-node-id=n1] > .row").click();
    await tab.locator("[role=application]").focus();
    for (let index = 0; index < 30; index += 1) {
      await tab.keyboard.press("Shift+ArrowRight");
      revision += 1;
      await waitRevision(tab, revision);
      await waitMeasures(tab, "ninerr:edit", index + 1);
    }
    const edits = await tab.evaluate(() => performance.getEntriesByName("ninerr:edit", "measure").map((entry) => entry.duration));
    assert.equal(edits.length, 30);
    assert.equal(host.session.document.nodes.n1.props.style.left, "300px", "the first recolour set left to 0px; 30 nudges of 10 px");

    // Layers deleted in the editor: select a card in the tree, press Delete.
    await tab.evaluate(() => performance.clearMeasures("ninerr:edit"));
    for (let index = 0; index < 20; index += 1) {
      await tab.locator(`#layers [role=treeitem][data-node-id=n${200 + index}] > .row`).click();
      await tab.keyboard.press("Delete");
      revision += 1;
      await waitRevision(tab, revision);
      await waitMeasures(tab, "ninerr:edit", index + 1);
    }
    const deletes = await tab.evaluate(() => performance.getEntriesByName("ninerr:edit", "measure").map((entry) => entry.duration));
    assert.equal(deletes.length, 20);
    assert.equal(Object.hasOwn(host.session.document.nodes, "n200"), false);
    assert.equal(await tab.locator("#layers [role=treeitem][data-node-id=n219]").count(), 0, "the deleted rows are gone from the tree");
    assert.equal(await tab.locator("#layers [role=treeitem][data-node-id=n220]").count(), 1, "and the rest stay");
    assert.deepEqual(editor.foreign, []);
    assert.deepEqual(editor.errors, []);

    // The measurements: every one is kept before any budget is judged, so an overrun does not
    // lose the rest.
    const measures = { firstRender: { value: Math.round(firstRender * 10) / 10 }, apply: summarize(applied), insert: inserts, remove: removes, edit: summarize(edits), delete: summarize(deletes) };
    process.stdout.write(`# PC8 gate 13: open ${openWall} ms end to end, first render ${firstRender.toFixed(0)} ms; apply p95 ${measures.apply.p95.toFixed(1)} ms over ${applied.length} (insert ${inserts.p95.toFixed(1)} over ${inserts.n}, remove ${removes.p95.toFixed(1)} over ${removes.n}); edit p95 ${measures.edit.p95.toFixed(0)} ms over ${edits.length}; delete p95 ${measures.delete.p95.toFixed(0)} ms over ${deletes.length}\n`);
    const record = process.env.NINERR_GATE13_RECORD;
    if (record) {
      writeFileSync(record, JSON.stringify({ measures, openWallMs: openWall, node: process.version, browser: await editor.browser.version() }, null, 2));
      return;
    }
    const over = overruns(measures);
    if (process.env.CI) {
      const baseline = JSON.parse(readFileSync(new URL("./fixtures/gate13-ci-baseline.json", import.meta.url), "utf8")).runners[platform()];
      for (const item of over) process.stdout.write(`::warning title=Gate 13 (information, issue 275)::${item.label}: ${item.value} ms, budget ${item.budget} ms on the reference machine\n`);
      for (const item of regressions(measures, baseline)) process.stdout.write(`::warning title=Gate 13 regression to investigate (issue 275)::${item.label}: ${item.value} ms, more than 50% above this runner OS's baseline of ${item.baseline} ms\n`);
      t.diagnostic(`gate 13 on a shared runner: information only; ${over.length} measure(s) over budget`);
      return;
    }
    assert.deepEqual(over.map((item) => `${item.label}: ${item.value} ms`), [], "every gate-13 budget holds");
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
