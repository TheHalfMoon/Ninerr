import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hostPool, ok } from "./support/host-api.mjs";

// #405: a registry item the person chose comes into the connected codebase as a plan first, then
// as new files exactly as planned. Nothing is fetched; nothing is replaced. The items are written
// for these tests in the shadcn registry-item shape; nothing is copied from a registry.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 9, 12, 0, 0) + clock++ * 1000).toISOString();

const PILL = `export function Pill() {
  return (
    <span className="pill">New</span>
  );
}
`;
const item = (fields = {}) => JSON.stringify({
  name: "pill",
  type: "registry:ui",
  dependencies: ["@base-ui/react@^1", "clsx"],
  registryDependencies: ["utils"],
  files: [
    { path: "registry/ui/pill.tsx", type: "registry:ui", content: PILL },
    { path: "registry/ui/pill.css", type: "registry:ui", content: ".pill { border-radius: 999px; }\n" },
  ],
  cssVars: { light: { pill: "oklch(0.9 0.05 250)" }, dark: { pill: "oklch(0.3 0.05 250)" } },
  ...fields,
});

async function setup(t, { manifest = { dependencies: { "@base-ui/react": "^1.9.0", react: "^19.0.0" } }, components = { aliases: { components: "@/components", ui: "@/components/ui", lib: "@/lib", hooks: "@/hooks" } } } = {}) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ninerr-component-import-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const app = join(root, "app");
  mkdirSync(join(root, "projects"));
  mkdirSync(app);
  if (manifest) writeFileSync(join(app, "package.json"), JSON.stringify(manifest));
  if (components) writeFileSync(join(app, "components.json"), JSON.stringify(components));
  const { call } = await pool.open(join(root, "projects"));
  await ok(call("POST", "/api/projects/create", { name: "site" }), "create");
  await ok(call("POST", "/api/codebase/connect", { folder: app }), "connect");
  return { app, call };
}

test("an item is planned without writing, then created exactly as planned, and its component comes in as one undoable change", async (t) => {
  const { app, call } = await setup(t);
  const plan = await ok(call("POST", "/api/components/plan", { item: item(), origin: { url: "https://magicui.design/r/pill.json" } }), "plan");
  assert.equal(plan.source.id, "magic-ui");
  assert.equal(plan.decision.allowed, true);
  assert.deepEqual(plan.files.map(({ path, status }) => [path, status]), [["components/ui/pill.tsx", "new"], ["components/ui/pill.css", "new"]]);
  assert.deepEqual(plan.dependencies, { missing: [{ name: "clsx", range: null }], present: ["@base-ui/react"] });
  assert.deepEqual(plan.registryDependencies, ["utils"]);
  assert.deepEqual(plan.tokens, { theme: [], light: ["pill"], dark: ["pill"] });
  assert.equal(plan.primitives.family, "base");
  assert.equal(plan.project.family, "base");
  assert.equal(plan.project.layoutFrom, "components.json");
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.appliable, true);
  assert.equal(plan.writes, undefined, "the editor is never sent file contents");
  assert.equal(existsSync(join(app, "components")), false, "planning writes nothing");

  const applied = await ok(call("POST", "/api/components/apply", { item: item(), origin: { url: "https://magicui.design/r/pill.json" }, token: plan.token }), "apply");
  assert.deepEqual(applied.written, ["components/ui/pill.tsx", "components/ui/pill.css"]);
  assert.deepEqual(applied.components, [{ file: "components/ui/pill.tsx", component: "Pill" }]);
  const written = readFileSync(join(app, "components", "ui", "pill.tsx"), "utf8");
  assert.equal(written, "// Imported by Ninerr from https://magicui.design/r/pill.json.\n// Magic UI: MIT.\n" + PILL, "the upstream text follows its notice unchanged");
  assert.match(readFileSync(join(app, "components", "ui", "pill.css"), "utf8"), /^\/\*\n \* Imported by Ninerr from https:\/\/magicui\.design\/r\/pill\.json\.\n \* Magic UI: MIT\.\n \*\/\n\.pill \{/u);

  // The component comes onto the canvas through the codebase's own Bring in: one transaction.
  const before = (await ok(call("GET", "/api/document"), "document")).revision;
  await ok(call("POST", "/api/codebase/import", { file: "components/ui/pill.tsx", component: "Pill" }), "bring in");
  const after = await ok(call("GET", "/api/document"), "document");
  assert.equal(after.revision, before + 1);
  assert.ok(Object.values(after.document.nodes).some((node) => node.props?.text === "New" || node.props?.className === "pill" || node.props?.attributes?.class === "pill"));
  await ok(call("POST", "/api/undo", {}), "undo");
  const undone = await ok(call("GET", "/api/document"), "document");
  assert.equal(undone.document.rootIds.length, 0, "undo takes the component off the canvas");

  // Planned again, the same item is already there: nothing new to write.
  const again = await ok(call("POST", "/api/components/plan", { item: item(), origin: { url: "https://magicui.design/r/pill.json" } }), "plan again");
  assert.deepEqual(again.files.map(({ status }) => status), ["same", "same"]);
  assert.equal(again.appliable, false);
});

test("an existing file is never replaced, and a codebase that changed after the plan is refused", async (t) => {
  const { app, call } = await setup(t);
  mkdirSync(join(app, "components", "ui"), { recursive: true });
  writeFileSync(join(app, "components", "ui", "pill.tsx"), "export const Pill = () => null;\n");
  const blocked = await ok(call("POST", "/api/components/plan", { item: item() }), "plan");
  assert.deepEqual(blocked.files.map(({ status }) => status), ["conflict", "new"]);
  assert.equal(blocked.appliable, false);
  assert.match(blocked.blockers[0], /components\/ui\/pill\.tsx already exists with other content/u);
  const refused = await call("POST", "/api/components/apply", { item: item(), token: blocked.token });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.error.code, "import-blocked");
  assert.equal(readFileSync(join(app, "components", "ui", "pill.tsx"), "utf8"), "export const Pill = () => null;\n");
  assert.equal(existsSync(join(app, "components", "ui", "pill.css")), false);

  rmSync(join(app, "components"), { recursive: true });
  const plan = await ok(call("POST", "/api/components/plan", { item: item() }), "plan");
  // A file appears where the plan creates one: the plan no longer holds.
  mkdirSync(join(app, "components", "ui"), { recursive: true });
  writeFileSync(join(app, "components", "ui", "pill.css"), "/* mine */\n");
  const changed = await call("POST", "/api/components/apply", { item: item(), token: plan.token });
  assert.equal(changed.status, 409);
  assert.equal(changed.json.error.code, "plan-changed");
  assert.equal(existsSync(join(app, "components", "ui", "pill.tsx")), false, "nothing was written");
  const forged = await call("POST", "/api/components/apply", { item: item(), token: "0".repeat(64) });
  assert.equal(forged.status, 409);
});

test("one primitive family per project: a Radix project is not given a Base UI item", async (t) => {
  const { call } = await setup(t, { manifest: { dependencies: { "radix-ui": "^1.4.0" } } });
  const plan = await ok(call("POST", "/api/components/plan", { item: item() }), "plan");
  assert.equal(plan.project.family, "radix");
  assert.equal(plan.appliable, false);
  assert.match(plan.blockers.join(" "), /The project builds on Radix, and this item on Base UI/u);
  const radix = item({ dependencies: ["radix-ui@^1.4"] });
  assert.equal((await ok(call("POST", "/api/components/plan", { item: radix }), "radix plan")).appliable, true);
});

test("each source's import policy decides, and an unknown registry URL is refused", async (t) => {
  const { app, call } = await setup(t);
  const aceternity = await ok(call("POST", "/api/components/plan", { item: item(), origin: { url: "https://ui.aceternity.com/registry/pill.json" } }), "aceternity");
  assert.equal(aceternity.decision.allowed, false);
  assert.equal(aceternity.appliable, false);
  assert.equal((await call("POST", "/api/components/apply", { item: item(), origin: { url: "https://ui.aceternity.com/registry/pill.json" }, token: aceternity.token })).status, 409);
  const unknown = await call("POST", "/api/components/plan", { item: item(), origin: { url: "https://registry.example.com/r/pill.json" } });
  assert.equal(unknown.status, 403);
  assert.equal(unknown.json.error.code, "unknown-registry");
  assert.equal((await call("POST", "/api/components/plan", { item: item(), origin: { url: "http://magicui.design/r/pill.json" } })).status, 400);

  const notchset = { item: item(), origin: { url: "https://beautiful-ui.dev/r/pill.json" } };
  assert.equal((await ok(call("POST", "/api/components/plan", notchset), "notchset")).appliable, false, "a free-only source needs the person's word");
  assert.equal((await ok(call("POST", "/api/components/plan", { ...notchset, freeItemConfirmed: true }), "notchset free")).appliable, true);

  const swami = { item: item(), origin: { url: "https://raw.githubusercontent.com/swamimalode07/rare-ui/main/public/r/pill.json" } };
  const plan = await ok(call("POST", "/api/components/plan", swami), "swami");
  assert.equal(plan.decision.attribution, "https://rareui.com");
  await ok(call("POST", "/api/components/apply", { ...swami, token: plan.token }), "apply");
  assert.match(readFileSync(join(app, "components", "ui", "pill.tsx"), "utf8"), /^\/\/ Imported by Ninerr from https:\/\/raw\.githubusercontent\.com\/swamimalode07\/rare-ui\/main\/public\/r\/pill\.json\.\n\/\/ Rare UI \(Swami\): MIT \+ Commons Clause \+ Attribution\.\n\/\/ Its license requires a visible link to https:\/\/rareui\.com in any project that ships it\.\n/u);
});

test("unsafe items, build configuration, links and a missing codebase are refused before anything is written", async (t) => {
  const { app, call } = await setup(t);
  const refusedWith = async (body, status, code) => {
    const result = await call("POST", "/api/components/plan", body);
    assert.equal(result.status, status, JSON.stringify(result.json));
    assert.equal(result.json.error.code, code);
  };
  await refusedWith({ item: item({ files: [{ path: "../escape.tsx", type: "registry:ui", content: "" }] }) }, 400, "item-unsafe-path");
  await refusedWith({ item: item({ files: [{ path: "x.tsx", type: "registry:file", target: "~/next.config.mjs", content: "" }] }) }, 400, "item-unwritable");
  await refusedWith({ item: item({ envVars: { SECRET: "x" } }) }, 400, "item-env-vars");
  await refusedWith({ item: item({ files: [{ path: "a.tsx", type: "registry:ui", content: "" }, { path: "b/a.tsx", type: "registry:ui", content: "" }] }) }, 400, "item-duplicate-target");
  await refusedWith({ item: 42 }, 400, "invalid-item");
  await refusedWith({ item: item(), origin: { fileName: "../x.json" } }, 400, "invalid-origin");

  let linked = false;
  try {
    mkdirSync(join(app, "elsewhere"));
    symlinkSync(join(app, "elsewhere"), join(app, "components"), "junction");
    linked = true;
  } catch {
    // Some systems refuse links to an ordinary user; the rule is still covered on the others.
  }
  if (linked) await refusedWith({ item: item() }, 409, "link-in-path");
  assert.equal(existsSync(join(app, "elsewhere", "ui")), false);

  await ok(call("POST", "/api/codebase/disconnect", {}), "disconnect");
  await refusedWith({ item: item() }, 409, "no-codebase");
});
