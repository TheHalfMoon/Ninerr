import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocument } from "../packages/document-model/src/index.mjs";
import { PROJECT_FILES, createProject, openProject } from "../packages/persistence/src/index.ts";

// #244 (found by the review of #243, measured by the P08-G5 soak): every checkpoint, and so
// every session that changes a project (its close checkpoints), stored the whole document as
// a new object, and nothing removed the one the previous snapshot named. The objects grew by
// a document per session. A checkpoint now removes the document it replaced.

const AT = "2026-10-11T12:00:00.000Z";

function project(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-object-gc-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  createProject(root, { projectId: "gc", document: createDocument({ id: "doc", nodes: [{ id: "node", type: "frame", props: { name: "Start" } }] }), createdAt: AT });
  return root;
}
const objects = (root) => {
  const store = join(root, PROJECT_FILES.directory, PROJECT_FILES.objects);
  return readdirSync(store).flatMap((fanOut) => readdirSync(join(store, fanOut)).map((rest) => `${fanOut}${rest}`)).sort();
};
const snapshotObject = (root) => JSON.parse(readFileSync(join(root, PROJECT_FILES.directory, PROJECT_FILES.snapshot), "utf8")).documentObject;
const rename = (store, name) => store.commit({ id: `tx-${store.revision + 1}`, actor: "user-1", baseRevision: store.revision, operations: [{ type: "set-props", nodeId: "node", set: { name } }] });

test("sessions that change a project keep one document object, the snapshot's", (t) => {
  const root = project(t);
  for (let session = 1; session <= 20; session += 1) {
    const store = openProject(root, { owner: "writer", at: AT });
    rename(store, `Session ${session}`);
    if (session % 5 === 0) store.checkpoint();
    rename(store, `Session ${session} again`);
    store.close(); // a close after a change checkpoints (#243)
  }
  assert.deepEqual(objects(root), [snapshotObject(root)]);
  // The project opens from it, with every change.
  const store = openProject(root, { owner: "reader", at: AT });
  try {
    assert.equal(store.document.nodes.node.props.name, "Session 20 again");
    assert.equal(store.revision, 40);
  } finally {
    store.close();
  }
});

test("an object stored with putObject is not removed, even when it is an old snapshot's bytes", (t) => {
  const root = project(t);
  const store = openProject(root, { owner: "writer", at: AT });
  try {
    const first = snapshotObject(root);
    // An asset whose bytes are the document the snapshot names now.
    const asset = store.putObject(readFileSync(join(root, PROJECT_FILES.directory, PROJECT_FILES.objects, first.slice(0, 2), first.slice(2))));
    assert.equal(asset, first);
    rename(store, "Changed");
    store.checkpoint();
    assert.deepEqual(objects(root), [first, snapshotObject(root)].sort());
    assert.equal(store.getObject(asset).length > 0, true);
  } finally {
    store.close();
  }
});

test("journal archives are kept when their segment's snapshot is replaced", (t) => {
  const root = project(t);
  const store = openProject(root, { owner: "writer", at: AT, rotateJournalAt: 1 });
  try {
    for (let index = 0; index < 5; index += 1) rename(store, `Name ${index}`);
  } finally {
    store.close();
  }
  // Each commit rotated (rotateJournalAt 1): five archives, plus the snapshot's document.
  const header = JSON.parse(readFileSync(join(root, PROJECT_FILES.directory, PROJECT_FILES.journal), "utf8").split("\n")[0]);
  assert.ok(objects(root).includes(header.segment.archive[0]));
  assert.equal(objects(root).length, 5 + 1);
  const reopened = openProject(root, { owner: "reader", at: AT });
  try {
    assert.deepEqual(reopened.history.map((summary) => summary.revision), [1, 2, 3, 4, 5]);
  } finally {
    reopened.close();
  }
});

test("checkpoints with no change in between keep the snapshot's document", (t) => {
  const root = project(t);
  const store = openProject(root, { owner: "writer", at: AT });
  rename(store, "Once");
  store.checkpoint();
  store.checkpoint();
  store.checkpoint();
  store.close();
  assert.deepEqual(objects(root), [snapshotObject(root)]);
  const reopened = openProject(root, { owner: "reader", at: AT });
  try {
    assert.equal(reopened.document.nodes.node.props.name, "Once");
  } finally {
    reopened.close();
  }
});

test("a checkpoint whose snapshot reference cannot be written removes nothing", (t) => {
  const root = project(t);
  const store = openProject(root, { owner: "writer", at: AT });
  const snapshotPath = join(root, PROJECT_FILES.directory, PROJECT_FILES.snapshot);
  const reference = readFileSync(snapshotPath);
  const previous = snapshotObject(root);
  rename(store, "Changed");
  // The reference cannot be replaced: a directory stands in its place.
  rmSync(snapshotPath);
  mkdirSync(snapshotPath);
  assert.throws(() => store.checkpoint());
  assert.ok(objects(root).includes(previous), "the document the reference names is still there");
  rmSync(snapshotPath, { recursive: true });
  writeFileSync(snapshotPath, reference);
  store.close();
  const reopened = openProject(root, { owner: "reader", at: AT, breakStaleLock: { reason: "the test replaced the snapshot reference" } });
  try {
    assert.deepEqual([reopened.revision, reopened.document.nodes.node.props.name], [1, "Changed"]);
  } finally {
    reopened.close();
  }
});
