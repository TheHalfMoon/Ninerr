import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startStudioHost } from "../packages/studio-host/src/index.ts";
import { MAX_JOURNAL_SUMMARIES } from "../packages/persistence/src/store.ts";
import { createDocument } from "../packages/document-model/src/index.mjs";
import { PROJECT_FILES, createProject, openProject } from "../packages/persistence/src/index.ts";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { hostPool, mcpClient, ok } from "./support/host-api.mjs";

// #231 (P08 workflow gap): after a project was reopened, the history panel was empty, so the
// person could not see who changed what before. The project's journal keeps every change
// with its actor, intent and tool; the panel now lists the journal's latest changes, marked
// as earlier. Undo and revert stay per session.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 11, 12, 0, 0) + clock++ * 1000).toISOString();
const page = { id: "page", type: "frame", parentId: null, children: [], props: { name: "Page" }, metadata: {} };

async function withHistory(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-history-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  let running = await pool.open(root);
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  const made = await ok(running.call("POST", "/api/edit", { baseRevision: 0, intent: "Add the page", operations: [{ type: "insert-node", parentId: null, index: 0, node: page }] }), "edit");
  const { token } = await ok(running.call("POST", "/api/agents/create", { name: "Copywriter" }), "connect an agent");
  const agent = mcpClient(running.host.mcpUrl, token);
  await agent.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "history", version: "1" } });
  const renamed = await agent.tool("rename_layers", { renames: [{ nodeId: "page", name: "Home" }] });
  assert.equal(renamed.isError, undefined, JSON.stringify(renamed));
  await ok(running.call("POST", "/api/projects/close"), "close");
  await pool.close(running.host);
  running = await pool.open(root);
  await ok(running.call("POST", "/api/projects/open", { name: "site" }), "reopen");
  return { root, pool, running, made };
}

test("after a reopen, the history lists the project's earlier changes: who, what and with what", async (t) => {
  const { running, made } = await withHistory(t);
  const { entries } = await ok(running.call("GET", "/api/history"), "history");
  assert.deepEqual(entries.map(({ revision, actorKind, actorName, intent, tool, earlier }) => ({ revision, actorKind, actorName, intent, tool, earlier })), [
    { revision: 1, actorKind: "user", actorName: "You", intent: "Add the page", tool: null, earlier: true },
    { revision: 2, actorKind: "agent", actorName: "Copywriter", intent: "Rename layer", tool: "rename_layers", earlier: true },
  ]);
  assert.equal(entries[0].transactionId, made.transactionId);
  // Undo and revert stay per session: an earlier change is listed, not reverted.
  const late = await running.call("POST", "/api/revert", { transactionId: entries[1].transactionId });
  assert.deepEqual([late.status, late.json?.error?.code], [409, "not-revertible"]);
  // A change made now follows them.
  await ok(running.call("POST", "/api/edit", { baseRevision: 2, intent: "Rename again", operations: [{ type: "set-props", nodeId: "page", set: { name: "Start" } }] }), "edit");
  const next = (await ok(running.call("GET", "/api/history"), "history")).entries;
  assert.deepEqual(next.map((entry) => [entry.revision, entry.earlier ?? false]), [[1, true], [2, true], [3, false]]);
});

test("the history kept from the journal is bounded", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-history-bound-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  let running = await pool.open(root);
  await ok(running.call("POST", "/api/projects/create", { name: "busy" }), "create");
  await ok(running.call("POST", "/api/edit", { baseRevision: 0, intent: "Add the page", operations: [{ type: "insert-node", parentId: null, index: 0, node: page }] }), "edit");
  const changes = MAX_JOURNAL_SUMMARIES + 20;
  for (let revision = 1; revision < changes; revision += 1) {
    await ok(running.call("POST", "/api/edit", { baseRevision: revision, intent: `Rename ${revision}`, operations: [{ type: "set-props", nodeId: "page", set: { name: `Page ${revision}` } }] }), "edit");
  }
  await ok(running.call("POST", "/api/projects/close"), "close");
  await pool.close(running.host);
  // The store itself keeps only the latest summaries, however long its journal.
  const store = openProject(join(root, "busy"), { owner: "history-test", at: now() });
  try {
    assert.equal(store.history.length, MAX_JOURNAL_SUMMARIES);
    assert.equal(store.history.at(-1).revision, changes);
  } finally {
    store.close();
  }
  running = await pool.open(root);
  await ok(running.call("POST", "/api/projects/open", { name: "busy" }), "reopen");
  const { entries } = await ok(running.call("GET", "/api/history"), "history");
  assert.equal(entries.length, MAX_JOURNAL_SUMMARIES);
  assert.deepEqual([entries[0].revision, entries.at(-1).revision], [changes - MAX_JOURNAL_SUMMARIES + 1, changes]);
});

// A rotation (#258) happens in the commit that crosses the segment size, so a reopen right
// after it finds a new, nearly empty segment: the earlier changes are read from the archives.
function rotatedProject(t, commits, rotateJournalAt) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-history-rotated-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  createProject(root, { projectId: "rotated", document: createDocument({ id: "doc", nodes: [{ id: "node", type: "frame", props: { name: "Before" } }] }), createdAt: now() });
  const store = openProject(root, { owner: "writer", at: now(), rotateJournalAt });
  for (let revision = 0; revision < commits; revision += 1) {
    store.commit({ id: `tx-${revision + 1}`, actor: "user-1", intent: `Rename ${revision + 1}`, baseRevision: revision, operations: [{ type: "set-props", nodeId: "node", set: { name: `Name ${revision + 1}` } }] });
  }
  store.close();
  return root;
}
const reopened = (root) => {
  const store = openProject(root, { owner: "reader", at: now() });
  try {
    return { revisions: store.history.map((summary) => summary.revision), revision: store.revision };
  } finally {
    store.close();
  }
};
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

test("after a journal rotation, the history is read back from the archived segments", (t) => {
  // Every commit starts a segment: each change is in an archive of its own.
  assert.deepEqual(reopened(rotatedProject(t, 30, 1)), { revisions: range(1, 30), revision: 30 });
  // Many segments: the latest MAX_JOURNAL_SUMMARIES changes, in order, none twice.
  const root = rotatedProject(t, MAX_JOURNAL_SUMMARIES + 100, 4096);
  const header = JSON.parse(readFileSync(join(root, PROJECT_FILES.directory, PROJECT_FILES.journal), "utf8").split("\n")[0]);
  assert.ok(header.segment.baseSeq > MAX_JOURNAL_SUMMARIES - 100, "the current segment alone does not hold the history");
  assert.deepEqual(reopened(root), { revisions: range(101, MAX_JOURNAL_SUMMARIES + 100), revision: MAX_JOURNAL_SUMMARIES + 100 });
});

test("a missing archive shortens the history and does not stop the project opening", (t) => {
  const root = rotatedProject(t, 6, 1);
  const journal = join(root, PROJECT_FILES.directory, PROJECT_FILES.journal);
  const object = (digest) => join(root, PROJECT_FILES.directory, PROJECT_FILES.objects, digest.slice(0, 2), digest.slice(2));
  // The current segment is empty (the last commit started it); its archive holds change 6.
  // The archive before that one is removed: the history stops there.
  const [newest] = JSON.parse(readFileSync(journal, "utf8").split("\n")[0]).segment.archive;
  const [older] = JSON.parse(readFileSync(object(newest), "utf8").split("\n")[0]).segment.archive;
  rmSync(object(older));
  assert.deepEqual(reopened(root), { revisions: [6], revision: 6 });
});

test("the editor shows the earlier changes after a reopen, without a Revert for them", browserTestOptions(), async (t) => {
  const { running } = await withHistory(t);
  const editor = await openEditor(running.host);
  t.after(() => editor.close());
  const { page: tab } = editor;
  await waitRevision(tab, 2);
  const rows = await tab.locator("#history li").evaluateAll((items) => items.map((item) => [item.className, item.querySelector(".intent")?.textContent, item.querySelector(".who")?.textContent, item.querySelector("button.revert") !== null]));
  assert.deepEqual(rows, [
    ["agent earlier", "Rename layer", "Copywriter · agent · rename_layers · revision 2 · before this session", false],
    ["user earlier", "Add the page", "You · revision 1 · before this session", false],
  ]);
  assert.deepEqual(editor.foreign, []);
  assert.deepEqual(editor.errors, []);
});
