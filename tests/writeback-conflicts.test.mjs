import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hostPool, ok } from "./support/host-api.mjs";

// #236 (P08 workflow gap, confirmed by P08-G11 dogfooding): a field changed both in Ninerr
// and in its file is a conflict. The conflict says what each side is, and the person picks:
// take the file's value (the layer changes, its base settles) or keep Ninerr's (it is written
// over the file's change, after review). Nothing else can be overridden.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 11, 12, 0, 0) + clock++ * 1000).toISOString();
const CARD = `export function PriceCard() {
  return (
    <section className="card">
      <h2 title="Plan">Pro</h2>
      <p>Everything in Free.</p>
    </section>
  );
}
`;

async function conflicted(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ninerr-conflicts-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "projects"));
  mkdirSync(join(root, "app"));
  const file = join(root, "app", "Card.jsx");
  writeFileSync(file, CARD);
  const { call } = await pool.open(join(root, "projects"));
  await ok(call("POST", "/api/projects/create", { name: "site" }), "create");
  await ok(call("POST", "/api/codebase/connect", { folder: join(root, "app") }), "connect");
  const brought = await ok(call("POST", "/api/codebase/import", { file: "Card.jsx", component: "PriceCard" }), "bring in");
  const { document, revision } = await ok(call("GET", "/api/document"), "document");
  const section = document.nodes[brought.frameId].children[0];
  const [heading, paragraph] = document.nodes[section].children;
  // The heading's text and title, changed differently here and in the file.
  await ok(call("POST", "/api/edit", { baseRevision: revision, intent: "Edit", operations: [
    { type: "set-props", nodeId: heading, set: { text: "Team", attributes: { title: "Teams" } } },
  ] }), "edit");
  writeFileSync(file, CARD.replace(">Pro<", ">Business<").replace("title=\"Plan\"", "title=\"Plans\""));
  return { call, file, section, heading, paragraph };
}

test("a conflict carries Ninerr's value, the file's and the base", async (t) => {
  const { call, section, heading } = await conflicted(t);
  const plan = await ok(call("POST", "/api/codebase/preview", { nodeId: section }), "preview");
  assert.deepEqual(plan.changes, []);
  assert.deepEqual(plan.conflicts.map(({ nodeId, field, here, file, base, overridable, keepable }) => ({ nodeId, field, here, file, base, overridable, keepable })).sort((a, b) => a.field.localeCompare(b.field)), [
    { nodeId: heading, field: "text", here: "Team", file: "Business", base: "Pro", overridable: true, keepable: true },
    { nodeId: heading, field: "title", here: "Teams", file: "Plans", base: "Plan", overridable: true, keepable: true },
  ]);
});

test("keeping Ninerr's writes it over the file's change, after review, and settles the base", async (t) => {
  const { call, file, section, heading } = await conflicted(t);
  const before = readFileSync(file, "utf8");
  const keep = [{ nodeId: heading, field: "text", file: "Business" }];
  const plan = await ok(call("POST", "/api/codebase/preview", { nodeId: section, keep }), "preview with keep");
  assert.deepEqual(plan.changes.map(({ field, from, to }) => [field, from, to]), [["text", "Business", "Team"]]);
  assert.deepEqual(plan.conflicts.map((conflict) => conflict.field), ["title"], "only the kept field is written");
  assert.equal(readFileSync(file, "utf8"), before, "previewing writes nothing");
  // The plan is for this choice: written without it, it is refused.
  const refused = await call("POST", "/api/codebase/write", { nodeId: section, token: plan.token });
  assert.deepEqual([refused.status, refused.json?.error?.code], [409, "plan-changed"]);
  await ok(call("POST", "/api/codebase/write", { nodeId: section, token: plan.token, keep }), "write");
  assert.equal(readFileSync(file, "utf8"), before.replace(">Business<", ">Team<"));
  const again = await ok(call("POST", "/api/codebase/preview", { nodeId: section }), "preview again");
  assert.deepEqual([again.changes, again.conflicts.map((conflict) => conflict.field)], [[], ["title"]], "the text agrees now");
});

test("a kept field whose file value changed again is a conflict again, and is not written over", async (t) => {
  const { call, file, section, heading } = await conflicted(t);
  const keep = [{ nodeId: heading, field: "text", file: "Business" }];
  await ok(call("POST", "/api/codebase/preview", { nodeId: section, keep }), "preview with keep");
  // The file changes once more while the dialog is open: the person never saw this value.
  writeFileSync(file, readFileSync(file, "utf8").replace(">Business<", ">Business important<"));
  const plan = await ok(call("POST", "/api/codebase/preview", { nodeId: section, keep }), "preview again");
  assert.deepEqual(plan.changes, []);
  assert.deepEqual(plan.conflicts.filter((conflict) => conflict.field === "text").map(({ here, file: value }) => [here, value]), [["Team", "Business important"]]);
  const write = await call("POST", "/api/codebase/write", { nodeId: section, token: plan.token, keep });
  assert.deepEqual([write.status, write.json?.error?.code], [409, "nothing-to-write"]);
  assert.match(readFileSync(file, "utf8"), />Business important</u, "the unseen value is kept in the file");
});

test("taking the file's value is refused when the file changed since it was shown", async (t) => {
  const { call, file, heading } = await conflicted(t);
  writeFileSync(file, readFileSync(file, "utf8").replace(">Business<", ">Unseen<"));
  const refused = await call("POST", "/api/codebase/resolve", { nodeId: heading, field: "text", file: "Business" });
  assert.deepEqual([refused.status, refused.json?.error?.code], [409, "no-conflict"]);
  const { document } = await ok(call("GET", "/api/document"), "document");
  assert.equal(document.nodes[heading].props.text, "Team", "the layer keeps Ninerr's value");
  const missing = await call("POST", "/api/codebase/resolve", { nodeId: heading, field: "text" });
  assert.deepEqual([missing.status, missing.json?.error?.code], [400, "invalid-resolve"]);
});

test("a value Ninerr cannot write stays a conflict that can only be taken from the file", async (t) => {
  const { call, section, heading } = await conflicted(t);
  const { revision } = await ok(call("GET", "/api/document"), "document");
  await ok(call("POST", "/api/edit", { baseRevision: revision, intent: "Edit", operations: [{ type: "set-props", nodeId: heading, set: { text: "Team <b>" } }] }), "edit");
  const keep = [{ nodeId: heading, field: "text", file: "Business" }];
  const plan = await ok(call("POST", "/api/codebase/preview", { nodeId: section, keep }), "preview");
  const conflict = plan.conflicts.find((entry) => entry.field === "text");
  assert.deepEqual([conflict?.overridable, conflict?.keepable], [true, false], JSON.stringify(plan.conflicts));
  assert.match(conflict.reason, /not written as JSX text/u);
  assert.deepEqual(plan.changes, []);
});

test("taking the file's value changes the layer and its base in one change, and writes nothing", async (t) => {
  const { call, file, section, heading } = await conflicted(t);
  const before = readFileSync(file, "utf8");
  const event = await ok(call("POST", "/api/codebase/resolve", { nodeId: heading, field: "title", file: "Plans" }), "resolve title");
  assert.equal(event.intent, "Take title from Card.jsx");
  // A take is one change: undone, the layer and its base go back and the conflict returns.
  await ok(call("POST", "/api/undo"), "undo");
  const undone = await ok(call("POST", "/api/codebase/preview", { nodeId: section }), "preview after undo");
  assert.deepEqual(undone.conflicts.map((conflict) => conflict.field).sort(), ["text", "title"]);
  await ok(call("POST", "/api/codebase/resolve", { nodeId: heading, field: "title", file: "Plans" }), "resolve title again");
  await ok(call("POST", "/api/codebase/resolve", { nodeId: heading, field: "text", file: "Business" }), "resolve text");
  const { document } = await ok(call("GET", "/api/document"), "document");
  const layer = document.nodes[heading];
  assert.deepEqual([layer.props.text, layer.props.attributes.title, layer.props.codeSource.base], ["Business", "Plans", { text: "Business", props: { title: "Plans" } }]);
  const plan = await ok(call("POST", "/api/codebase/preview", { nodeId: section }), "preview");
  assert.deepEqual([plan.changes, plan.conflicts, plan.matched, plan.diff], [[], [], [], ""]);
  assert.equal(readFileSync(file, "utf8"), before, "the file is never written");
  // A later change to the field is written, not seen as a conflict.
  const { revision } = await ok(call("GET", "/api/document"), "document");
  await ok(call("POST", "/api/edit", { baseRevision: revision, intent: "Edit", operations: [{ type: "set-props", nodeId: heading, set: { text: "Business plus" } }] }), "edit");
  const next = await ok(call("POST", "/api/codebase/preview", { nodeId: section }), "preview");
  assert.deepEqual(next.changes.map(({ field, from, to }) => [field, from, to]), [["text", "Business", "Business plus"]]);
  // Nothing left in conflict: resolving again is refused.
  const refused = await call("POST", "/api/codebase/resolve", { nodeId: heading, field: "title", file: "Plans" });
  assert.deepEqual([refused.status, refused.json?.error?.code], [409, "no-conflict"]);
});

test("only a field changed in both places can be kept; other conflicts and bad requests are refused", async (t) => {
  const { call, file, section, heading, paragraph } = await conflicted(t);
  // The file's elements shift: the heading no longer lines up. Keeping it changes nothing.
  writeFileSync(file, readFileSync(file, "utf8").replace("<h2 title", "<hr />\n      <h2 title"));
  const plan = await ok(call("POST", "/api/codebase/preview", { nodeId: section, keep: [{ nodeId: heading, field: "text", file: "Business" }, { nodeId: heading, field: "title", file: "Plans" }, { nodeId: paragraph, field: "text", file: "Everything in Free." }] }), "preview");
  assert.deepEqual(plan.changes, []);
  assert.ok(plan.conflicts.every((conflict) => conflict.field === "structure" && conflict.overridable === undefined), JSON.stringify(plan.conflicts));
  const refused = await call("POST", "/api/codebase/resolve", { nodeId: heading, field: "text", file: "Business" });
  assert.deepEqual([refused.status, refused.json?.error?.code], [409, "no-conflict"]);
  const entry = { nodeId: heading, field: "text", file: "Business" };
  for (const keep of ["text", [1], ["a:b"], [{ ...entry, file: 1 }], [{ ...entry, file: "x".repeat(64 * 1024 + 1) }], Array.from({ length: 5001 }, () => entry)]) {
    const bad = await call("POST", "/api/codebase/preview", { nodeId: section, keep });
    assert.deepEqual([bad.status, bad.json?.error?.code], [400, "invalid-keep"], JSON.stringify(keep).slice(0, 40));
  }
});
