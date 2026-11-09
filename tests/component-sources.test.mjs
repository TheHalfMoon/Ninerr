import test from "node:test";
import assert from "node:assert/strict";
import {
  REGISTRY_ITEM_LIMITS,
  RegistryItemError,
  importDecision,
  parseDependency,
  parseRegistryItem,
  primitiveFamily,
  registryClosure,
  resolveTarget,
  sourceForRegistryUrl,
  unsafePathReason,
  unwritableReason,
} from "../packages/component-sources/src/index.mjs";

// Registry items in the shadcn registry-item shape. The file contents are written for these
// tests; nothing is copied from any registry.
const item = (fields) => JSON.stringify({ name: "badge", type: "registry:ui", files: [{ path: "ui/badge.tsx", type: "registry:ui", content: "export function Badge() { return null }\n" }], ...fields });
const refused = (text, code) => assert.throws(() => parseRegistryItem(text), (error) => error instanceof RegistryItemError && error.code === code, code);

test("a registry item is read into a frozen, bounded copy", () => {
  const parsed = parseRegistryItem(item({
    title: "Badge",
    dependencies: ["@base-ui/react@^1", "class-variance-authority"],
    registryDependencies: ["utils", "@magicui/marquee", "https://magicui.design/r/marquee.json"],
    cssVars: { light: { badge: "oklch(0.7 0.1 250)" }, dark: { badge: "oklch(0.4 0.1 250)" } },
    css: { "@keyframes pulse": { "50%": { opacity: "0.5" } } },
    tailwind: { config: {} },
    unknownField: true,
  }));
  assert.equal(parsed.name, "badge");
  assert.equal(parsed.title, "Badge");
  assert.deepEqual(parsed.dependencies, [{ name: "@base-ui/react", range: "^1" }, { name: "class-variance-authority", range: null }]);
  assert.deepEqual(parsed.registryDependencies, ["utils", "@magicui/marquee", "https://magicui.design/r/marquee.json"]);
  assert.deepEqual(parsed.cssVars, { light: { badge: "oklch(0.7 0.1 250)" }, dark: { badge: "oklch(0.4 0.1 250)" } });
  assert.equal(parsed.cssRules, 3);
  assert.deepEqual(parsed.ignored, ["tailwind", "unknownField"], "fields this module does not act on are reported");
  assert.equal(parsed.primitives.family, "base");
  assert.equal(parsed.files[0].bytes, 40);
  for (const value of [parsed, parsed.files, parsed.files[0], parsed.dependencies, parsed.cssVars, parsed.cssVars.light]) assert.ok(Object.isFrozen(value));
});

test("one component builds on one primitive family", () => {
  const files = (content) => [{ content }];
  assert.equal(primitiveFamily({ dependencies: [parseDependency("radix-ui")], files: [] }).family, "radix");
  assert.equal(primitiveFamily({ files: files('import { Dialog } from "@radix-ui/react-dialog";') }).family, "radix");
  assert.equal(primitiveFamily({ files: files('import { Menu } from "@base-ui/react/menu";') }).family, "base");
  assert.equal(primitiveFamily({ files: files('const m = await import("@base-ui-components/react");') }).family, "base");
  assert.equal(primitiveFamily({ files: files('import { Button } from "react-aria-components";') }).family, "aria");
  assert.equal(primitiveFamily({ files: files('import { cn } from "@/lib/utils";') }).family, "none");
  // Icons and colours from Radix are not primitives; React Aria's packages are.
  assert.equal(primitiveFamily({ dependencies: [parseDependency("@base-ui/react"), parseDependency("@radix-ui/react-icons"), parseDependency("@radix-ui/colors")], files: [] }).family, "base");
  assert.equal(primitiveFamily({ files: files('import { useButton } from "@react-aria/button";') }).family, "aria");
  assert.equal(primitiveFamily({ dependencies: [parseDependency("react-aria-modal")], files: [] }).family, "none");
  const mixed = primitiveFamily({ dependencies: [parseDependency("@base-ui/react")], files: files('import "@radix-ui/react-slot";') });
  assert.equal(mixed.family, "mixed");
  assert.deepEqual(mixed.evidence, ["base:@base-ui/react", "radix:@radix-ui/react-slot"]);
});

test("a path that could leave the project, hide or name a device is refused, however it is encoded", () => {
  for (const path of ["../x.tsx", "a/../../x.tsx", "%2e%2e/x.tsx", "%252e%252e/x.tsx", "a/%2E%2E/b.tsx", "/etc/passwd", "C:/x.tsx", "c:x.tsx", "a\\b.tsx", ".env", "~/.env", "a/.git/config", "node_modules/x/index.js", "con.tsx", "a/AUX/b.tsx", "a /b.tsx", "a./b.tsx", "x\u0000.tsx", "x\u001b.tsx", "a//b.tsx", "a/./b.tsx", "a?.tsx", "%zz.tsx", "", "x".repeat(201)]) {
    assert.ok(unsafePathReason(path), `${JSON.stringify(path)} is refused`);
    refused(item({ files: [{ path, type: "registry:ui", content: "" }] }), "unsafe-path");
    refused(item({ files: [{ path: "ui/ok.tsx", type: "registry:file", target: path, content: "" }] }), path === "" ? "invalid-file" : "unsafe-path");
  }
  for (const path of ["components/ui/badge.tsx", "app/[...slug]/page.tsx", "~/lib/utils.ts", "src/hooks/use-thing.ts", "app/@modal/page.tsx"]) assert.equal(unsafePathReason(path), null, path);
  // Names a case-blind or short-name-answering file system would read as something else.
  for (const path of ["NODE_MODULES/react/index.mjs", "Node_Modules/x.js", "STORYB~1/preview.tsx", "GITHUB~1/workflows/x.ts", "a/NODE_M~1/x.js", "a b.tsx", "a b.tsx", "ab.tsx", "café.tsx"]) {
    assert.ok(unsafePathReason(path), `${JSON.stringify(path)} is refused`);
  }
});

test("an item never writes build configuration or anything but component source", () => {
  for (const path of ["gatsby-node.js", "lint-staged.config.js", "commitlint.config.js", "vitest.workspace.ts", "drizzle.config.ts", "react-router.config.ts", "sentry.client.config.ts", "electron.vite.config.ts", "jsconfig.base.json", "pnpm-workspace.yaml", "package.json", "tsconfig.json", "tsconfig.app.json", "components.json", "next.config.mjs", "src/vite.config.ts", "tailwind.config.js", "postcss.config.cjs", "pnpm-lock.yaml", "scripts/install.sh", "README.md", "public/logo.svg"]) {
    assert.ok(unwritableReason(path), `${path} is never written`);
  }
  for (const path of ["components/ui/badge.tsx", "lib/utils.ts", "app/globals.css", "hooks/use-x.js"]) assert.equal(unwritableReason(path), null, path);
  const file = (target, type = "registry:file") => parseRegistryItem(item({ files: [{ path: "x/y.tsx", type, target, content: "" }] })).files[0];
  assert.equal(resolveTarget(file("~/next.config.mjs")).refused, "next.config.mjs configures how the project builds");
  assert.equal(resolveTarget(file("~/notes.md")).refused, "notes.md is not a component source or stylesheet");
});

test("targets resolve through the project's folders, and placeholders only begin a target", () => {
  const layout = { components: "src/components", ui: "src/components/ui", lib: "src/lib", hooks: "src/hooks" };
  const files = parseRegistryItem(item({ files: [
    { path: "registry/ui/badge.tsx", type: "registry:ui", content: "" },
    { path: "registry/lib/format.ts", type: "registry:lib", content: "" },
    { path: "registry/hooks/use-count.ts", type: "registry:hook", content: "" },
    { path: "registry/x.tsx", type: "registry:component", target: "@ui/notchset/button.tsx", content: "" },
    { path: "registry/y.tsx", type: "registry:page", target: "~/app/demo/page.tsx", content: "" },
    { path: "registry/z.tsx", type: "registry:component", target: "components/rareui/Tab/Tab.tsx", content: "" },
  ] })).files;
  assert.deepEqual(files.map((file) => resolveTarget(file, layout).path), [
    "src/components/ui/badge.tsx", "src/lib/format.ts", "src/hooks/use-count.ts", "src/components/ui/notchset/button.tsx", "app/demo/page.tsx", "components/rareui/Tab/Tab.tsx",
  ]);
  assert.ok(files.every((file) => resolveTarget(file, layout).refused === null));
  refused(item({ files: [{ path: "x.tsx", type: "registry:file", target: "@acme/x.tsx", content: "" }] }), "unsafe-path");
  // An @ later in a target is a folder name, such as a Next.js parallel route.
  const route = parseRegistryItem(item({ files: [{ path: "x.tsx", type: "registry:page", target: "~/app/@modal/page.tsx", content: "" }] })).files[0];
  assert.deepEqual(resolveTarget(route), { path: "app/@modal/page.tsx", refused: null });
  assert.throws(() => resolveTarget(files[0], { ui: "../outside" }), /the ui folder/u);
});

test("dependencies are npm names with plain version ranges, never URLs, git, files or aliases", () => {
  assert.deepEqual(parseDependency("radix-ui@1.4.2"), { name: "radix-ui", range: "1.4.2" });
  assert.deepEqual(parseDependency("@number-flow/react@^0.6"), { name: "@number-flow/react", range: "^0.6" });
  for (const spec of ["evil@git+https://example.com/x.git", "x@file:../y", "x@https://example.com/x.tgz", "x@npm:other", "x@link:../y", "x@workspace:*", "x@github:o/r", "UPPER", "a b", "", "@scope", "x@" + "1".repeat(65)]) {
    assert.throws(() => parseDependency(spec), RegistryItemError, spec);
  }
  refused(item({ registryDependencies: ["http://example.com/x.json"] }), "invalid-registry-dependency");
  refused(item({ registryDependencies: ["https://user:pass@example.com/x.json"] }), "invalid-registry-dependency");
  refused(item({ registryDependencies: ["javascript:alert(1)"] }), "invalid-registry-dependency");
  refused(item({ registryDependencies: ["../escape"] }), "invalid-registry-dependency");
});

test("an item that reconfigures a project, asks for secrets, or hides markup in its styles is refused", () => {
  refused(item({ type: "registry:style" }), "project-item");
  refused(item({ type: "registry:base" }), "project-item");
  refused(item({ type: "registry:widget" }), "invalid-type");
  refused(item({ envVars: { API_KEY: "x" } }), "env-vars");
  refused('{"name":"x","type":"registry:ui","__proto__":{"polluted":true},"files":[]}', "invalid-field");
  refused(item({ cssVars: { light: { bg: "red; } body { display: none" } } }), "invalid-css-vars");
  refused(item({ cssVars: { light: { bg: "url(https://example.com/t.png)" } } }), "invalid-css-vars");
  refused(item({ cssVars: { print: { bg: "red" } } }), "invalid-css-vars");
  refused(item({ css: { "@import url(x)": {} } }), "invalid-css");
  refused(item({ css: { body: { background: "url(https://example.com/t.png)" } } }), "invalid-css");
  refused(item({ name: "../x" }), "invalid-name");
  refused(item({ files: [] }), "empty-item");
  refused("not json", "not-json");
  refused("[]", "not-an-item");
  refused(item({ files: [{ path: "a.tsx", type: "registry:ui", content: "x".repeat(REGISTRY_ITEM_LIMITS.fileBytes + 1) }] }), "invalid-file");
  refused(item({ files: Array.from({ length: REGISTRY_ITEM_LIMITS.files + 1 }, (_, index) => ({ path: `ui/f${index}.tsx`, type: "registry:ui", content: "" })) }), "invalid-field");
  refused(" ".repeat(REGISTRY_ITEM_LIMITS.bytes + 1), "too-large");
  // A theme item carries tokens and no files.
  assert.equal(parseRegistryItem(JSON.stringify({ name: "ocean", type: "registry:theme", cssVars: { light: { primary: "#0af" } } })).files.length, 0);
});

test("an item's registry dependencies come first, and a cycle or an unknown item is reported", () => {
  const make = (name, registryDependencies = []) => parseRegistryItem(item({ name, registryDependencies }));
  const held = new Map([["utils", make("utils")], ["button", make("button", ["utils"])], ["dialog", make("dialog", ["button", "utils", "missing-one"])]]);
  const closure = registryClosure(make("form", ["dialog", "button"]), (name) => held.get(name) ?? null);
  assert.deepEqual(closure.order.map((entry) => entry.name), ["utils", "button", "dialog", "form"]);
  assert.deepEqual(closure.missing, ["missing-one"]);
  const loop = new Map([["a", make("a", ["b"])], ["b", make("b", ["a"])]]);
  assert.throws(() => registryClosure(loop.get("a"), (name) => loop.get(name) ?? null), /depends on itself/u);
  assert.throws(() => registryClosure(make("root", ["button"]), () => make("not-button")), /answered by an item named/u);
  // A cycle through a namespaced name or a URL is a cycle, and an item reached by two names is
  // ordered once.
  const named = new Map([["@acme/a", make("a", ["https://acme.example/r/b.json"])], ["https://acme.example/r/b.json", make("b", ["@acme/a"])]]);
  assert.throws(() => registryClosure(make("root", ["@acme/a"]), (name) => named.get(name) ?? null), /depends on itself/u);
  const twice = new Map([["utils", make("utils")], ["@acme/utils", make("utils")]]);
  assert.deepEqual(registryClosure(make("root", ["utils", "@acme/utils"]), (name) => twice.get(name) ?? null).order.map((entry) => entry.name), ["utils", "root"]);
  const deep = (depth) => make(`d${depth}`, depth < 20 ? [`d${depth + 1}`] : []);
  assert.throws(() => registryClosure(deep(0), (name) => deep(Number(name.slice(1)))), /nest more than/u);
});

test("a registry URL belongs to its catalog source, whose import policy decides", () => {
  assert.equal(sourceForRegistryUrl("https://magicui.design/r/marquee.json").id, "magic-ui");
  assert.equal(sourceForRegistryUrl("https://ui.shadcn.com/r/styles/base-nova/button.json").id, "shadcn");
  assert.equal(sourceForRegistryUrl("https://www.beautifului.dev/r/button.json").id, "beautiful-ui");
  assert.equal(sourceForRegistryUrl("https://raw.githubusercontent.com/swamimalode07/rare-ui/main/public/r/folder-component.json").id, "rareui-swami");
  // Sources with no license to import from are still recognized, so their policy refuses them.
  assert.equal(sourceForRegistryUrl("https://ui.aceternity.com/registry/3d-card.json").id, "aceternity");
  assert.equal(sourceForRegistryUrl("https://21st.dev/r/someone/button").id, "21st");
  assert.equal(sourceForRegistryUrl("https://MagicUI.design./r/marquee.json").id, "magic-ui", "host case and a trailing dot");
  assert.equal(sourceForRegistryUrl("https://beautifului.dev/r/button.json").id, "beautiful-ui", "with or without www");
  assert.equal(parseRegistryItem(item({ type: "registry:example" })).type, "registry:example");
  for (const url of ["https://magicui.design:8443/r/marquee.json", "https://raw.githubusercontent.com/swamimalode07/rare-ui-fork/main/public/r/x.json", "http://magicui.design/r/marquee.json", "https://user:pw@magicui.design/r/marquee.json", "https://magicui.design.evil.example/r/x.json", "https://example.com/r/x.json", "not a url"]) {
    assert.equal(sourceForRegistryUrl(url), null, url);
  }
  assert.equal(importDecision(sourceForRegistryUrl("https://magicui.design/r/marquee.json")).allowed, true);
  assert.equal(importDecision(sourceForRegistryUrl("https://ui.aceternity.com/registry/3d-card.json")).allowed, false);
  assert.equal(importDecision(sourceForRegistryUrl("https://21st.dev/r/someone/button")).allowed, false);
  const notchset = sourceForRegistryUrl("https://beautiful-ui.dev/r/button.json");
  assert.equal(importDecision(notchset).allowed, false, "a free-only source needs the person's word");
  assert.equal(importDecision(notchset, { freeItemConfirmed: true }).allowed, true);
  assert.equal(importDecision(sourceForRegistryUrl("https://raw.githubusercontent.com/swamimalode07/rare-ui/main/public/r/x.json")).attribution, "https://rareui.com");
  assert.equal(importDecision(null).allowed, true, "a file the person chose is theirs to judge");
});
