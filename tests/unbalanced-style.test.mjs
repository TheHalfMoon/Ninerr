import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { planElement, styleDeclarationProblem } from "../packages/renderer/src/index.mjs";
import { hostPool, ok } from "./support/host-api.mjs";

// A style value that leaves a quote or bracket open (#382): `calc(1px` or `"a`. A browser draws
// none of them, and joined with other declarations one swallows those after it. The canvas, the
// write-back and the export each leave such a value out, and say so where they report.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 13, 12, 0, 0) + clock++ * 1000).toISOString();

test("a value that leaves a quote or bracket open is never drawn, saying why", () => {
  for (const value of ["calc(1px", "\"a", "'a", "calc(1px))", "attr(x]", "[a", "var(--a", "a)"]) {
    assert.match(styleDeclarationProblem("width", value) ?? "", /leaves a quote or bracket open/u, value);
    assert.deepEqual(planElement({ id: "n", type: "element", props: { tag: "div", style: { width: value, top: "1px" } } }).style, { top: "1px" }, value);
  }
  for (const value of ["calc(1px + (2px * 3))", "\"a(b\"", "'[x'", "\"it's\"", "repeat(2, [a] 1fr)", "1px"]) assert.equal(styleDeclarationProblem("width", value), null, value);
  // image( and src( are refused in a value as in a stylesheet (#383); a name ending in src is not.
  for (const value of ["image(red)", "IMAGE (red)", "src(x)", "a src(x)"]) assert.match(styleDeclarationProblem("background", value) ?? "", /could fetch/u, value);
  assert.equal(styleDeclarationProblem("--a", "my-src(x)"), null);
});

async function broughtIn(t, source, component) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ninerr-unbalanced-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "projects"));
  mkdirSync(join(root, "app"));
  const file = join(root, "app", "Part.jsx");
  writeFileSync(file, source);
  const { call } = await pool.open(join(root, "projects"));
  await ok(call("POST", "/api/projects/create", { name: "site" }), "create");
  await ok(call("POST", "/api/codebase/connect", { folder: join(root, "app") }), "connect");
  const brought = await ok(call("POST", "/api/codebase/import", { file: "Part.jsx", component }), "bring in");
  const { document, revision } = await ok(call("GET", "/api/document"), "document");
  return { call, file, element: document.nodes[brought.frameId].children[0], document, revision };
}

const BADGE = `export function Badge() {
  return <p style="color: green; top: 1px">New</p>;
}
`;

test("a layer's value that leaves a bracket open is not written back, and the file is untouched", async (t) => {
  const { call, file, element, revision } = await broughtIn(t, BADGE, "Badge");
  await ok(call("POST", "/api/edit", { baseRevision: revision, intent: "Edit", operations: [{ type: "set-props", nodeId: element, set: { style: { color: "calc(1px", top: "1px" } } }] }), "edit");
  const plan = await ok(call("POST", "/api/codebase/preview", { nodeId: element }), "preview");
  assert.deepEqual([plan.changes, plan.conflicts], [[], []], JSON.stringify(plan));
  assert.ok(plan.notWritten.some((entry) => /leaves a quote or bracket open/u.test(entry.reason)), JSON.stringify(plan.notWritten));
  assert.equal(readFileSync(file, "utf8"), BADGE);
});

test("an untouched style is not reported unwritten because its joined text reads differently", async (t) => {
  for (const style of ["top: 1px; font-family: \"a", "z-index: 1; width: calc(1px"]) {
    await t.test(style, async (t) => {
      const { call, element, document } = await broughtIn(t, BADGE.replace("\"color: green; top: 1px\"", `'${style}'`), "Badge");
      assert.ok(Object.keys(document.nodes[element].props.style).length >= 1);
      const plan = await ok(call("POST", "/api/codebase/preview", { nodeId: element }), "preview");
      assert.deepEqual([plan.changes, plan.conflicts, plan.notWritten], [[], [], []], JSON.stringify(plan));
    });
  }
});

test("export leaves out a value that leaves a bracket open, as the canvas does, and keeps what follows", async (t) => {
  const { call, element, revision } = await broughtIn(t, BADGE, "Badge");
  await ok(call("POST", "/api/edit", { baseRevision: revision, intent: "Edit", operations: [{ type: "set-props", nodeId: element, set: { style: { left: "9px", width: "calc(1px", "z-index": "1" } } }] }), "edit");
  const { code } = await ok(call("POST", "/api/code/export", { nodeId: element }), "export");
  assert.doesNotMatch(code, /calc\(1px/u, code);
  assert.match(code, /left: "9px"|left: 9px/u, code);
  assert.match(code, /zIndex|z-index/u, code);
});
