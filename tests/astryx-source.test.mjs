import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { UI_COMPONENT_SOURCES } from "../packages/component-sources/src/catalog.mjs";
import { ASTRYX, COMPONENT_RECORD_FIELDS, RECORD_SOURCES, componentRecordProblem, loadComponentRecords, searchComponents } from "../packages/component-sources/src/records.mjs";

// Meta Astryx as a first-class source (docs/provenance/ASTRYX_SOURCE_AUDIT.md): records of its
// components at a pinned commit, in the one record schema every source uses, with its license.

const snapshot = await loadComponentRecords(ASTRYX.id);
const byName = new Map(snapshot.components.map((record) => [record.name, record]));

test("the records come from the pinned commit, under Astryx's MIT license", () => {
  assert.deepEqual([snapshot.source, snapshot.repository, snapshot.commit], [ASTRYX.id, ASTRYX.repository, ASTRYX.commit]);
  assert.match(ASTRYX.commit, /^[0-9a-f]{40}$/u);
  const catalog = UI_COMPONENT_SOURCES.find((source) => source.id === ASTRYX.id);
  assert.deepEqual([catalog.source, catalog.license, catalog.importPolicy, catalog.group], [ASTRYX.repository, "MIT", "allowed", "Foundation"]);
  assert.deepEqual(snapshot.license, { spdx: "MIT", copyright: catalog.copyright });
  const license = readFileSync(new URL("../packages/component-sources/src/ASTRYX_LICENSE", import.meta.url), "utf8");
  assert.ok(license.startsWith(`MIT License\n\n${catalog.copyright}\n`), "the license is copied beside the records");
  assert.deepEqual(snapshot.package.name, "@astryxdesign/core");
  assert.deepEqual(RECORD_SOURCES, [ASTRYX.id]);
});

test("every record is a normalized component record, and ids are unique", () => {
  assert.ok(snapshot.components.length >= 150, `${snapshot.components.length} components`);
  for (const record of snapshot.components) assert.equal(componentRecordProblem(record, ASTRYX.id), null);
  assert.equal(new Set(snapshot.components.map((record) => record.id)).size, snapshot.components.length);
  assert.ok(snapshot.components.every((record) => record.doc.path.startsWith("packages/core/src/") && record.doc.path.endsWith(".doc.mjs")));
});

test("records say what the source says: Button's variants, Dialog's required props, what needs a client", () => {
  const button = byName.get("Button");
  assert.equal(button.importPath, "@astryxdesign/core/Button");
  assert.deepEqual(button.variants.find((variant) => variant.prop === "variant").values, ["primary", "secondary", "ghost", "destructive"]);
  assert.deepEqual(button.variants.find((variant) => variant.prop === "size").values, ["sm", "md", "lg"]);
  assert.equal(button.props.find((prop) => prop.name === "label").required, true);
  assert.ok(button.sourceFiles.includes("packages/core/src/Button/Button.tsx"));
  assert.ok(button.tests.some((path) => path.includes("a11y")), "its accessibility tests are named");
  assert.ok(button.accessibility.some((item) => item.criterion === "1.4.3 Contrast (Minimum)"));
  assert.ok(button.themes.includes("@astryxdesign/theme-matcha"));
  const dialog = byName.get("Dialog");
  assert.deepEqual(dialog.props.filter((prop) => prop.required).map((prop) => prop.name).sort(), ["children", "isOpen", "onOpenChange"]);
  // Overlays need React on the client; Badge renders on the server alone.
  assert.equal(byName.get("CommandPalette").rendering, "client");
  assert.ok(byName.get("CommandPalette").limitations.some((text) => /script-free canvas/u.test(text)));
  assert.equal(byName.get("Badge").rendering, "server-safe");
  // A part of a component lists only its own file; its parent lists the folder.
  const part = snapshot.components.find((record) => record.subComponentOf === "CommandPalette");
  assert.deepEqual(part.tests, []);
});

test("search finds components by intent, best first, bounded", () => {
  const names = (query, options) => searchComponents(snapshot.components, { query, ...options }).map((record) => record.name);
  assert.equal(names("command palette")[0], "CommandPalette");
  assert.equal(names("BUTTON")[0], "Button");
  assert.ok(names("date picker").includes("DateInput"));
  assert.ok(names("table sort").includes("Table"));
  assert.deepEqual(names("no such widget anywhere"), []);
  assert.ok(names("", { category: "Overlay" }).every((name) => byName.get(name).category === "Overlay"));
  assert.ok(names("", { category: "Overlay" }).includes("Dialog"));
  assert.equal(names("", { limit: 3 }).length, 3);
  const many = Array.from({ length: 250 }, (_, index) => ({ ...byName.get("Badge"), name: `Badge${index}` }));
  assert.equal(searchComponents(many, { limit: 10_000 }).length, 200, "at most 200 at once");
});

test("the record schema refuses what is not a record", () => {
  const button = byName.get("Button");
  const problem = (change) => componentRecordProblem({ ...button, ...change }, ASTRYX.id);
  assert.equal(COMPONENT_RECORD_FIELDS.length, Object.keys(button).length);
  assert.match(componentRecordProblem((({ props: _props, ...rest }) => rest)(button), ASTRYX.id), /missing props/u);
  assert.match(problem({ extra: 1 }), /unknown extra/u);
  assert.match(problem({ id: "shadcn:Button" }), /its id is astryx:<name>/u);
  assert.match(componentRecordProblem(button, "shadcn"), /its id is shadcn:<name>/u);
  assert.match(problem({ rendering: "maybe" }), /rendering is/u);
  assert.match(problem({ sourceFiles: ["../outside.tsx"] }), /paths inside the source/u);
  assert.match(problem({ variants: [{ prop: "label", values: ["a"] }] }), /each variant is a prop with listed values/u);
  assert.match(problem({ doc: { path: "x", sha256: "nope" } }), /sha256/u);
  assert.match(problem({ props: [{ name: "x" }] }), /a prop has/u);
});

test("only sources with records load", async () => {
  await assert.rejects(() => loadComponentRecords("shadcn"), /No component records for shadcn/u);
  await assert.rejects(() => loadComponentRecords("__proto__"), /No component records/u);
  assert.equal(await loadComponentRecords(ASTRYX.id), snapshot, "loaded once");
});
