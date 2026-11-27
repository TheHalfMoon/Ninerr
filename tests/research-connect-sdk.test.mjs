import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocument } from "../packages/document-model/src/index.mjs";
import {
  HeadlessEngine,
  captureUrlReferenceMetrics,
  createLocalReferencePack,
  exportAstro,
  exportSvelte,
  exportVue,
  extractPatternsFromSource,
  isPrivateOrNonGlobalIp,
  listLocalReferencePacks,
  runCliCommand,
  sdk,
  writeLocalReferencePack,
} from "../packages/studio-host/src/index.ts";

function withTempDir(run) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-p6-")));
  let res;
  try {
    res = run(dir);
  } catch (err) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    throw err;
  }
  if (res && typeof res.then === "function") {
    return res.finally(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  return res;
}

test("extractPatternsFromSource extracts colors, typography, spacing, layout, and custom properties offline", () => {
  const html = `
    <header><nav><a href="#top">Home</a></nav></header>
    <main>
      <h1>Dashboard</h1>
      <section style="display: grid; gap: 16px; background: #0f766e;">
        <button>Create</button>
      </section>
    </main>
    <script>const x = "#ff00ff";</script>
  `;
  const css = `
    /* #123456 comment ignored */
    :root { --bg-canvas: #f8fafc; --accent-primary: #0f766e; }
    body { font-family: "Inter", sans-serif; font-size: 16px; font-weight: 500; line-height: 1.5; padding: 24px; border-radius: 12px; }
    @media (min-width: 768px) { main { display: flex; } }
  `;
  const patterns = extractPatternsFromSource({ html, css });
  assert.equal(patterns.rightsPolicy, "observed-inspiration-only");
  assert.ok(patterns.colors.some((c) => c.value === "#0f766e"));
  assert.ok(!patterns.colors.some((c) => c.value === "#123456"), "CSS comments are ignored");
  assert.ok(!patterns.colors.some((c) => c.value === "#ff00ff"), "script blocks are ignored");
  assert.ok(patterns.typography.fontFamilies.some((f) => f.value.includes("Inter")));
  assert.equal(patterns.customProperties.count, 2);
  assert.deepEqual(patterns.customProperties.names, ["--accent-primary", "--bg-canvas"]);
  assert.equal(patterns.layout.usesGrid, true);
  assert.equal(patterns.layout.usesFlex, true);
  assert.equal(patterns.layout.mediaQueries, 1);
  assert.equal(patterns.layout.landmarks.main, 1);
  assert.equal(patterns.layout.headings.h1, 1);
  assert.equal(patterns.layout.interactive.button, 1);
});

test("createLocalReferencePack defaults to restricted non-redistributable rights and writes/lists safely", () => withTempDir((dir) => {
  const refsDir = join(dir, "refs");
  // listLocalReferencePacks is read-only and never creates missing dirs.
  assert.deepEqual(listLocalReferencePacks(refsDir), []);
  assert.equal(existsSync(refsDir), false);

  const { pack, digest } = createLocalReferencePack({
    packId: "fintech-notes",
    entries: [{ kind: "pattern", title: "Ledger header", tags: ["fintech", "header"] }],
  });
  assert.equal(pack.objects[0].rights.status, "restricted");
  assert.equal(pack.objects[0].rights.redistributable, false);
  assert.match(digest, /^[a-f0-9]{64}$/u);

  const written = writeLocalReferencePack({ directory: refsDir, fileName: "fintech.json", pack });
  assert.equal(written.fileName, "fintech.json");
  assert.deepEqual(listLocalReferencePacks(refsDir), ["fintech.json"]);

  // Refuses silent overwrite without replace: true and refuses invalid filenames.
  assert.throws(() => writeLocalReferencePack({ directory: refsDir, fileName: "fintech.json", pack }), /already exists/u);
  assert.throws(() => writeLocalReferencePack({ directory: refsDir, fileName: "../escape.json", pack }), /fileName/u);
}));

test("captureUrlReferenceMetrics fails closed without allowNetwork and blocks private/loopback/non-HTTPS SSRF targets", async () => {
  await assert.rejects(() => captureUrlReferenceMetrics({ url: "https://example.com" }), /disabled by default/u);
  await assert.rejects(() => captureUrlReferenceMetrics({ url: "http://example.com", allowNetwork: true }), /https:\/\//u);
  await assert.rejects(() => captureUrlReferenceMetrics({ url: "https://user:pass@example.com", allowNetwork: true }), /credentials/u);
  await assert.rejects(() => captureUrlReferenceMetrics({ url: "https://example.com:8443", allowNetwork: true }), /standard-port/u);
  await assert.rejects(() => captureUrlReferenceMetrics({ url: "https://localhost/", allowNetwork: true }), /ssrf|local/iu);
  await assert.rejects(() => captureUrlReferenceMetrics({ url: "https://127.0.0.1/", allowNetwork: true }), /ssrf|local/iu);
  await assert.rejects(() => captureUrlReferenceMetrics({ url: "https://169.254.169.254/latest/meta-data/", allowNetwork: true }), /ssrf|local/iu);
  await assert.rejects(() => captureUrlReferenceMetrics({ url: "https://[::1]/", allowNetwork: true }), /ssrf|local/iu);

  for (const priv of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateOrNonGlobalIp(priv), true, priv);
  }
  assert.equal(isPrivateOrNonGlobalIp("93.184.216.34"), false);
  assert.equal(isPrivateOrNonGlobalIp("2606:2800:220:1:248:1893:25c8:1946"), false);
});

test("Vue, Svelte, and Astro static exporters preserve canvas sanitization, escape template braces, and include tokens", () => {
  const doc = createDocument({
    id: "doc-fw",
    name: "Framework Card",
    nodes: [
      {
        id: "ds-1",
        type: "design-system",
        props: {
          name: "Design System",
          collections: [{ id: "theme", name: "Theme", modes: [{ id: "light", name: "Light" }, { id: "dark", name: "Dark" }], defaultMode: "light" }],
          tokens: [{ name: "--accent", type: "color", collection: "theme", values: { light: "#0f766e", dark: "#2dd4bf" } }],
        },
      },
      {
        id: "card-1",
        type: "frame",
        props: {
          name: "MetricCard",
          tag: "section",
          style: { padding: "24px", color: "var(--accent)" },
          stylesheet: ".title { font-weight: 700; }",
        },
        children: ["h-1"],
      },
      {
        id: "h-1",
        type: "element",
        parentId: "card-1",
        props: { tag: "h2", attributes: { class: "title" } },
        children: ["t-1"],
      },
      {
        id: "t-1",
        type: "text",
        parentId: "h-1",
        props: { text: "Revenue {{2026}} {USD}" },
      },
    ],
  });

  const vue = exportVue(doc, "card-1");
  assert.match(vue.code, /^<template>\n/u);
  assert.match(vue.code, /&#123;&#123;2026&#125;&#125;/u);
  assert.match(vue.code, /--accent: #0f766e/u);
  assert.match(vue.code, /<style scoped>/u);

  const svelte = exportSvelte(doc, "card-1");
  assert.match(svelte.code, /&#123;&#123;2026&#125;&#125; &#123;USD&#125;/u);
  assert.match(svelte.code, /:global\(:root\)/u);
  assert.match(svelte.code, /:global\(\[data-ninerr-mode~="theme:dark"\]\)/u);

  const astro = exportAstro(doc, "card-1");
  assert.match(astro.code, /^---\n\/\/ Exported by Ninerr/u);
  assert.match(astro.code, /&#123;&#123;2026&#125;&#125; &#123;USD&#125;/u);
  assert.match(astro.code, /<style is:global>/u);
});

test("Headless MCP manage_references and vue/svelte/astro export_design work cleanly offline", async () => withTempDir(async (projectsRoot) => {
  const engine = new HeadlessEngine({ projectsRoot, write: () => {} });
  try {
    await engine.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test" } } });
    await engine.receive({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_project", arguments: { name: "p6" } } });

    const frame = await engine.receive({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_frame", arguments: { name: "Hero", width: 800, height: 400 } } });
    const frameId = frame.result.structuredContent.nodeId;

    for (const fmt of ["vue", "svelte", "astro"]) {
      const exp = await engine.receive({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "export_design", arguments: { nodeId: frameId, format: fmt } } });
      assert.notEqual(exp.result.isError, true, exp.result.content[0].text);
      assert.ok(existsSync(exp.result.structuredContent.path), fmt);
    }

    // dryRun create_pack creates nothing on disk.
    const dry = await engine.receive({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "manage_references",
        arguments: {
          dryRun: true,
          action: "create_pack",
          fileName: "notes.json",
          title: "Observed palette",
          css: ":root { --ink: #0f172a; }",
        },
      },
    });
    assert.notEqual(dry.result.isError, true);
    assert.equal(dry.result.structuredContent.dryRun, true);
    assert.equal(existsSync(join(projectsRoot, "p6", "references", "notes.json")), false);

    // Real create_pack writes to <project>/references/ and loads into ReferenceCatalog immediately.
    const created = await engine.receive({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: "manage_references",
        arguments: {
          action: "create_pack",
          fileName: "notes.json",
          title: "Observed dashboard rhythm",
          tags: ["dashboard", "spacing"],
          css: ":root { --ink: #0f172a; }",
        },
      },
    });
    assert.notEqual(created.result.isError, true, created.result.content[0].text);
    assert.equal(created.result.structuredContent.rightsPolicy, "observed-inspiration-only");

    const searched = await engine.receive({ jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "search_design_references", arguments: { query: "dashboard" } } });
    assert.equal(searched.result.structuredContent.status, "loaded");
    assert.equal(searched.result.structuredContent.results.length, 1);
    assert.equal(searched.result.structuredContent.results[0].reuse.allowed, false);
  } finally {
    engine.close();
  }
}));

test("CLI ninerr init, connect (--install-skills), export, research, and programmatic SDK work end to end", async () => withTempDir(async (dir) => {
  const projDir = join(dir, "my-app-design");
  const skillsDir = join(dir, "installed-skills");
  const refsDir = join(dir, "research-packs");
  const vueOut = join(dir, "Hero.vue");
  const sampleHtml = join(dir, "sample.html");
  writeFileSync(sampleHtml, "<main><h1>Pricing</h1><button style='background:#0f766e'>Buy</button></main>");

  let out = "";
  let err = "";
  const run = async (cmd, argv) => {
    out = "";
    err = "";
    return runCliCommand(cmd, argv, { version: "0.1.0", binPath: join(dir, "ninerr.mjs"), stdout: (s) => { out += s; }, stderr: (s) => { err += s; } });
  };

  assert.equal(await run("init", [projDir, "--name", "Pricing UI", "--json"]), 0, err);
  assert.equal(JSON.parse(out).title, "Pricing UI");

  assert.equal(await run("connect", ["all", "--projects", join(dir, "projects"), "--install-skills", skillsDir, "--json"]), 0, err);
  const conn = JSON.parse(out);
  assert.deepEqual(Object.keys(conn.clients).sort(), ["claude", "codex", "cursor", "gemini", "opencode"]);
  assert.equal(conn.installedSkillsCount, 19);
  assert.ok(conn.installedSkills.every((p) => existsSync(p) && readFileSync(p, "utf8").includes("name:")));

  assert.equal(await run("export", [projDir, "--format", "vue", "--out", vueOut, "--json"]), 0, err);
  assert.match(readFileSync(vueOut, "utf8"), /<template>/u);
  // Overwrite without --replace is refused.
  assert.equal(await run("export", [projDir, "--format", "vue", "--out", vueOut]), 2);
  assert.equal(await run("export", [projDir, "--format", "vue", "--out", vueOut, "--replace", "--json"]), 0, err);

  assert.equal(await run("research", ["extract", "--html", sampleHtml, "--json"]), 0, err);
  assert.equal(JSON.parse(out).rightsPolicy, "observed-inspiration-only");

  assert.equal(await run("research", ["create", refsDir, "--name", "pricing.json", "--title", "Pricing study", "--html", sampleHtml, "--json"]), 0, err);
  assert.equal(await run("research", ["list", refsDir, "--json"]), 0, err);
  assert.deepEqual(JSON.parse(out).packs, ["pricing.json"]);

  // capture without --allow-network fails closed.
  assert.equal(await run("research", ["capture", "https://example.com", "--out-dir", refsDir, "--name", "web.json"]), 2);
  assert.match(err, /disabled by default/u);

  // Programmatic local SDK sanity check.
  assert.equal(typeof sdk.planDesignDirections, "function");
  assert.equal(typeof sdk.exportVue, "function");
  assert.equal(typeof sdk.extractPatternsFromSource, "function");
  assert.equal(typeof sdk.verifyFunctionalInvariance, "function");
}));
