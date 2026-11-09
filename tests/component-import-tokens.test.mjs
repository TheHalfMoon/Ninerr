import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hostPool, ok } from "./support/host-api.mjs";

// #405 with ADR-0004: an imported item's CSS variables become the project's design tokens, as one
// undoable transaction. A token whose name is taken with another value is kept as it is.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 9, 17, 0, 0) + clock++ * 1000).toISOString();
const PILL = "export function Pill() {\n  return <span className=\"pill\">New</span>;\n}\n";
const item = (cssVars, fields = {}) => JSON.stringify({ name: "pill", type: "registry:ui", files: [{ path: "ui/pill.tsx", type: "registry:ui", content: PILL }], cssVars, ...fields });

async function setup(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ninerr-item-tokens-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const app = join(root, "app");
  mkdirSync(join(root, "projects"));
  mkdirSync(app);
  writeFileSync(join(app, "package.json"), JSON.stringify({ dependencies: { react: "^19.0.0" } }));
  const { call } = await pool.open(join(root, "projects"));
  await ok(call("POST", "/api/projects/create", { name: "site" }), "create");
  await ok(call("POST", "/api/codebase/connect", { folder: app }), "connect");
  const documentNow = async () => (await ok(call("GET", "/api/document"), "document")).document;
  const edit = async (operations) => {
    const { revision } = await ok(call("GET", "/api/document"), "document");
    return ok(call("POST", "/api/edit", { baseRevision: revision, operations, intent: "test" }), "edit");
  };
  return { app, call, documentNow, edit };
}

test("an item's light and dark variables become tokens in a new design system, in one undoable transaction", async (t) => {
  const { app, call, documentNow } = await setup(t);
  const body = { item: item({ light: { pill: "oklch(0.9 0.05 250)", radius: "0.5rem" }, dark: { pill: "oklch(0.3 0.05 250)" } }), addTokens: true };
  const plan = await ok(call("POST", "/api/components/plan", body), "plan");
  assert.deepEqual(plan.designTokens, [
    { name: "--pill", type: "color", values: { default: "oklch(0.9 0.05 250)", dark: "oklch(0.3 0.05 250)" }, status: "new" },
    { name: "--radius", type: "radius", values: { default: "0.5rem" }, status: "new" },
  ]);
  assert.equal(plan.tokenOperations, undefined, "the editor is not sent the operations");
  const applied = await ok(call("POST", "/api/components/apply", { ...body, token: plan.token }), "apply");
  assert.ok(existsSync(join(app, "components", "ui", "pill.tsx")));
  assert.match(applied.tokens.intent, /^Add 2 tokens from pill$/u);
  const document = await documentNow();
  assert.equal(document.schemaVersion, 2);
  const system = Object.values(document.nodes).find((node) => node.type === "design-system");
  assert.deepEqual(system.props.collections[0].modes.map((mode) => mode.id), ["default", "dark"], "a Dark mode is added for the item's dark values");
  assert.deepEqual(system.props.tokens.map((token) => [token.name, token.values]), [
    ["--pill", { default: "oklch(0.9 0.05 250)", dark: "oklch(0.3 0.05 250)" }],
    ["--radius", { default: "0.5rem", dark: "0.5rem" }],
  ]);
  // Undo takes the tokens back; the files stay, as the editor says.
  await ok(call("POST", "/api/undo", {}), "undo");
  assert.equal(Object.values((await documentNow()).nodes).some((node) => node.type === "design-system"), false);
  assert.ok(existsSync(join(app, "components", "ui", "pill.tsx")));
});

test("a token already there is left alone: the same value is skipped, another value is kept, never overwritten", async (t) => {
  const { call, documentNow, edit } = await setup(t);
  const { rootIds } = await documentNow();
  await edit([{ type: "insert-node", parentId: null, index: rootIds.length, node: { id: "ds", type: "design-system", props: { name: "Site", collections: [{ id: "base", name: "Base", modes: [{ id: "default", name: "Default" }], defaultMode: "default" }], tokens: [{ name: "--pill", type: "color", collection: "base", values: { default: "red" } }, { name: "--ring", type: "color", collection: "base", values: { default: "blue" } }] } } }]);
  const body = { item: item({ light: { pill: "green", ring: "blue", gap: "calc(1px" } }), addTokens: true };
  const plan = await ok(call("POST", "/api/components/plan", body), "plan");
  assert.deepEqual(plan.designTokens.map(({ name, status }) => [name, status]), [["--pill", "conflict"], ["--ring", "same"], ["--gap", "refused"]]);
  assert.match(plan.designTokens[2].reason, /brackets do not balance/u);
  await ok(call("POST", "/api/components/apply", { ...body, token: plan.token }), "apply");
  const tokens = (await documentNow()).nodes.ds.props.tokens;
  assert.deepEqual(tokens.map((token) => [token.name, token.values.default]), [["--pill", "red"], ["--ring", "blue"]], "nothing overwritten, nothing refused added");
});

test("without addTokens nothing joins the design system; a theme item with only tokens is applied by adding them", async (t) => {
  const { call, documentNow, edit } = await setup(t);
  const body = { item: item({ light: { pill: "green" } }) };
  const plan = await ok(call("POST", "/api/components/plan", body), "plan");
  const applied = await ok(call("POST", "/api/components/apply", { ...body, token: plan.token }), "apply");
  assert.equal(applied.tokens, undefined);
  assert.equal(Object.values((await documentNow()).nodes).some((node) => node.type === "design-system"), false);

  const theme = { item: JSON.stringify({ name: "ocean", type: "registry:theme", cssVars: { light: { primary: "#0af", accent: "#f0a" } } }) };
  assert.equal((await ok(call("POST", "/api/components/plan", theme), "theme plan")).appliable, false, "nothing to do unless the tokens are added");
  const withTokens = await ok(call("POST", "/api/components/plan", { ...theme, addTokens: true }), "theme plan with tokens");
  assert.equal(withTokens.appliable, true);
  // The design system changes after the plan (--primary now taken; --accent still new): the plan no longer holds.
  const { rootIds } = await documentNow();
  await edit([{ type: "insert-node", parentId: null, index: rootIds.length, node: { id: "ds", type: "design-system", props: { name: "Site", collections: [{ id: "base", name: "Base", modes: [{ id: "default", name: "Default" }], defaultMode: "default" }], tokens: [{ name: "--primary", type: "color", collection: "base", values: { default: "red" } }] } } }]);
  const stale = await call("POST", "/api/components/apply", { ...theme, addTokens: true, token: withTokens.token });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, "plan-changed");
});

test("one bad token is refused alone: its files still come in, and without adding tokens nothing blocks", async (t) => {
  const { call, documentNow } = await setup(t);
  // --sidebar-ring aliases --ring, which this item refuses (unbalanced), so it is refused too.
  const vars = { light: { ring: "calc(1px", "sidebar-ring": "var(--ring)", accent: "#f0a" } };
  const plan = await ok(call("POST", "/api/components/plan", { item: item(vars), addTokens: true }), "plan");
  assert.deepEqual(plan.designTokens.map(({ name, status }) => [name, status]), [["--ring", "refused"], ["--sidebar-ring", "refused"], ["--accent", "new"]]);
  assert.match(plan.designTokens[1].reason, /refers to --ring, which is not a token and is not one this import adds/u);
  assert.equal(plan.appliable, true, "the good token and the files still come in");
  await ok(call("POST", "/api/components/apply", { item: item(vars), addTokens: true, token: plan.token }), "apply");
  const system = Object.values((await documentNow()).nodes).find((node) => node.type === "design-system");
  assert.deepEqual(system.props.tokens.map((token) => token.name), ["--accent"]);
  // A whole-set problem (an alias cycle among the item's own tokens) blocks only an import that adds them.
  const cycle = { light: { a: "var(--b)", b: "var(--a)" } };
  const blocked = await ok(call("POST", "/api/components/plan", { item: item(cycle, { name: "loop" }), addTokens: true }), "cycle with tokens");
  assert.match(blocked.blockers.join(" "), /cannot be added to the design system: .*cycle.*Import without adding its tokens/u);
  const fine = await ok(call("POST", "/api/components/plan", { item: item(cycle, { name: "loop" }) }), "cycle without tokens");
  assert.deepEqual(fine.blockers, []);
});

test("the item's dark values fill the modes an agreeing token lacks; adding Dark never turns a token white-on-white", async (t) => {
  const { call, documentNow, edit } = await setup(t);
  const { rootIds } = await documentNow();
  await edit([{ type: "insert-node", parentId: null, index: rootIds.length, node: { id: "ds", type: "design-system", props: { name: "Site", collections: [{ id: "base", name: "Base", modes: [{ id: "default", name: "Default" }], defaultMode: "default" }], tokens: [{ name: "--background", type: "color", collection: "base", values: { default: "white" } }, { name: "--keep", type: "color", collection: "base", values: { default: "grey" } }] } } }]);
  const vars = { light: { background: "white", foreground: "black" }, dark: { background: "black", foreground: "white" } };
  const plan = await ok(call("POST", "/api/components/plan", { item: item(vars), addTokens: true }), "plan");
  assert.deepEqual(plan.designTokens.map(({ name, status }) => [name, status]), [["--background", "extended"], ["--foreground", "new"]]);
  await ok(call("POST", "/api/components/apply", { item: item(vars), addTokens: true, token: plan.token }), "apply");
  const tokens = Object.fromEntries((await documentNow()).nodes.ds.props.tokens.map((token) => [token.name, token.values]));
  assert.deepEqual(tokens["--background"], { default: "white", dark: "black" }, "its Dark value comes from the item, which agrees with it");
  assert.deepEqual(tokens["--foreground"], { default: "black", dark: "white" });
  assert.deepEqual(tokens["--keep"], { default: "grey", dark: "grey" }, "a token the item does not name takes its own default in Dark");
});

test("a design system whose default mode is Dark has no mode for light values; a Dark mode under another id is used", async (t) => {
  const { call, documentNow, edit } = await setup(t);
  const { rootIds } = await documentNow();
  await edit([{ type: "insert-node", parentId: null, index: rootIds.length, node: { id: "ds", type: "design-system", props: { name: "Site", collections: [{ id: "base", name: "Base", modes: [{ id: "night", name: "Dark" }, { id: "day", name: "Day" }], defaultMode: "night" }], tokens: [] } } }]);
  const plan = await ok(call("POST", "/api/components/plan", { item: item({ light: { x: "red" }, dark: { x: "blue" } }), addTokens: true }), "plan");
  assert.equal(plan.designTokens[0].status, "refused");
  assert.match(plan.designTokens[0].reason, /default mode is its Dark one/u);
  const { revision } = await documentNow();
  await ok(call("POST", "/api/edit", { baseRevision: revision, operations: [{ type: "set-props", nodeId: "ds", set: { collections: [{ id: "base", name: "Base", modes: [{ id: "day", name: "Day" }, { id: "night", name: "Dark" }], defaultMode: "day" }] } }], intent: "test" }), "default day");
  const second = await ok(call("POST", "/api/components/plan", { item: item({ light: { x: "red" }, dark: { x: "blue" } }), addTokens: true }), "plan");
  assert.deepEqual(second.designTokens[0].values, { day: "red", night: "blue" }, "the existing Dark mode, by name, is used");
});

test("a plan made to add tokens is not applied without them, nor one made without them with them", async (t) => {
  const { app, call } = await setup(t);
  const body = { item: item({ light: { pill: "green" } }), addTokens: true };
  const plan = await ok(call("POST", "/api/components/plan", body), "plan");
  assert.equal((await call("POST", "/api/components/apply", { ...body, addTokens: false, token: plan.token })).status, 409);
  const without = await ok(call("POST", "/api/components/plan", { ...body, addTokens: false }), "plan without");
  assert.equal((await call("POST", "/api/components/apply", { ...body, token: without.token })).status, 409);
  assert.equal(existsSync(join(app, "components")), false, "neither wrote anything");
});
