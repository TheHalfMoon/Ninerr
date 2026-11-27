import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NINERR_COMPONENTS,
  NINERR_COMPONENT_CATEGORIES,
  buildComponentOperations,
  getNinerrComponent,
  searchNinerrComponents,
} from "@ninerr/component-sources";
import {
  compileTokens,
  createDesignSystem,
  createDocument,
  setToken,
} from "@ninerr/document-model";
import { applyTransaction as historyApply } from "@ninerr/history";
import { auditAccessibility } from "@ninerr/design-assurance";
import { planElement } from "@ninerr/renderer";
import { createProject } from "@ninerr/persistence";
import { exportHtml, exportJsx, exportTailwind } from "../packages/studio-host/src/code.ts";
import { runCliCommand } from "../packages/studio-host/src/cli.ts";
import {
  auditDesignSystem,
  compileBreakpointsStylesheet,
  generateHighContrastMode,
  planRegistryItemUpdate,
  planThemeMigration,
} from "../packages/studio-host/src/design-system-ops.ts";

function commit(doc, operations, intent = "test") {
  return historyApply(doc, {
    id: `tx-${doc.revision + 1}`,
    baseRevision: doc.revision,
    actor: "test",
    actorKind: "agent",
    intent,
    timestamp: "2026-11-27T00:00:00.000Z",
    operations,
  }).document;
}

function toNeutralTree(doc, nodeId) {
  const node = doc.nodes[nodeId];
  const style = node.props?.style
    ? Object.entries(node.props.style).map(([k, v]) => `${k}: ${v}`).join("; ")
    : undefined;
  return {
    id: node.id,
    tag: node.props?.tag ?? "div",
    attributes: node.props?.attributes ?? {},
    ...(node.props?.text !== undefined ? { text: node.props.text } : {}),
    ...(style ? { style } : {}),
    children: (node.children ?? []).map((cid) => toNeutralTree(doc, cid)),
  };
}

test("Ninerr Native Component Library covers all 8 categories with 41 valid, accessible, exportable blueprints", () => {
  assert.equal(NINERR_COMPONENT_CATEGORIES.length, 8);
  assert.equal(NINERR_COMPONENTS.length, 41);
  for (const cat of NINERR_COMPONENT_CATEGORIES) {
    const matches = searchNinerrComponents({ category: cat });
    assert.ok(matches.length >= 4, `category ${cat} has at least 4 components (got ${matches.length})`);
  }
  assert.equal(getNinerrComponent("nonexistent"), null);

  for (const comp of NINERR_COMPONENTS) {
    let doc = createDocument({ id: `doc-${comp.id}`, name: comp.name });
    const built = buildComponentOperations(comp.id, { idPrefix: `c-${comp.id}` });
    assert.ok(built.nodeCount >= 1);
    doc = commit(doc, built.operations);

    // Every generated node passes renderer planElement with 0 dropped tags/attributes/styles.
    for (const node of Object.values(doc.nodes)) {
      const planned = planElement(node);
      assert.equal(planned.dropped, 0, `${comp.id} node ${node.id} (${node.props?.tag}) dropped ${planned.dropped} items`);
    }

    // Zero major accessibility errors across all 41 components.
    const a11y = auditAccessibility(toNeutralTree(doc, built.rootNodeId));
    const majors = a11y.findings.filter((f) => f.severity === "major");
    assert.deepEqual(majors, [], `${comp.id} major a11y findings: ${JSON.stringify(majors)}`);

    // Cleanly exports to HTML, JSX, and Tailwind.
    const html = exportHtml(doc, built.rootNodeId);
    assert.match(html.html, /^<!doctype html>/u);
    const jsx = exportJsx(doc, built.rootNodeId);
    assert.match(jsx.code, /export function/u);
    const tw = exportTailwind(doc, built.rootNodeId);
    assert.match(tw.code, /export function/u);

    // Also builds cleanly as a reusable schema v2 component-definition.
    let defDoc = createDocument({ id: `def-${comp.id}`, name: comp.name });
    const asDef = buildComponentOperations(comp.id, { idPrefix: `d-${comp.id}`, asDefinition: true });
    defDoc = commit(defDoc, asDef.operations);
    assert.equal(defDoc.nodes[asDef.definitionId].type, "component-definition");
  }
});

test("Design System Health Audit, High-Contrast Mode, Atomic Theme Migration, Breakpoints, and 3-Way Update work end-to-end", () => {
  let doc = createDocument({ id: "doc-sys", name: "Systems" });
  doc = commit(doc, createDesignSystem(doc, { id: "ds-1", name: "Core DS" }));
  doc = commit(doc, setToken(doc, { name: "--bg-surface", type: "color", collection: "base", values: { default: "#ffffff" } }));
  doc = commit(doc, setToken(doc, { name: "--bg-canvas", type: "color", collection: "base", values: { default: "#ffffff" } }));
  doc = commit(doc, setToken(doc, { name: "--text-primary", type: "color", collection: "base", values: { default: "#999999" } }));
  doc = commit(doc, setToken(doc, { name: "--unused-accent", type: "color", collection: "base", values: { default: "#0f766e" } }));
  doc = commit(doc, [{
    type: "insert-node",
    parentId: null,
    index: 1,
    node: { id: "box-1", type: "element", props: { tag: "div", style: { color: "#0f766e", "background-color": "var(--bg-surface)" } } },
  }]);

  const audit = auditDesignSystem(doc);
  assert.equal(audit.hasDesignSystem, true);
  assert.ok(audit.summary.duplicateGroups >= 1, "detects duplicate #ffffff between --bg-surface and --bg-canvas");
  assert.ok(audit.summary.unusedTokens >= 1, "detects unused --unused-accent");
  assert.ok(audit.summary.hardcodedMatches >= 1, "detects hardcoded #0f766e matching --unused-accent");
  assert.ok(audit.summary.contrastFailures >= 1, "detects #999999 on #ffffff contrast failure");

  // Atomic theme migration repairs contrast and adds dark mode in 1 undoable tx.
  const migrated = planThemeMigration(doc, {
    themeName: "Midnight Slate",
    tokens: [
      { name: "--bg-canvas", light: "#f8fafc", dark: "#0b0f14" },
      { name: "--bg-surface", light: "#ffffff", dark: "#121821" },
      { name: "--text-primary", light: "#0f172a", dark: "#f1f5f9" },
      { name: "--accent-primary", light: "#0f766e", dark: "#2dd4bf" },
      { name: "--accent-contrast", light: "#ffffff", dark: "#042f2e" },
    ],
  });
  assert.equal(migrated.updated.length, 3);
  assert.equal(migrated.added.length, 2);
  doc = commit(doc, migrated.operations);

  // High-contrast WCAG AAA mode generation.
  const hc = generateHighContrastMode(doc);
  doc = commit(doc, hc.operations);
  const afterAudit = auditDesignSystem(doc);
  assert.equal(afterAudit.hasHighContrastMode, true);
  assert.equal(afterAudit.summary.contrastFailures, 0, "0 contrast failures across light, dark, and high-contrast");
  assert.match(compileTokens(doc), /\[data-ninerr-mode~="base:high-contrast"\]/u);

  // Breakpoint CSS compiles cleanly for frame props.stylesheet.
  const bpCss = compileBreakpointsStylesheet(
    [{ id: "mobile", maxWidth: 639 }, { id: "desktop", minWidth: 1024 }],
    { mobile: ".grid { grid-template-columns: 1fr; }", desktop: ".grid { grid-template-columns: 1fr 1fr; }" },
  );
  assert.match(bpCss, /@media \(max-width: 639px\)/u);
  assert.match(bpCss, /@media \(min-width: 1024px\)/u);

  // 3-way component update merges clean non-overlapping edits and flags real conflicts.
  const base = "export function Btn() {\n  const a = 1;\n  const b = 2;\n  return <button>Go</button>;\n}\n";
  const local = "export function Btn() {\n  const a = 10;\n  const b = 2;\n  return <button>Go</button>;\n}\n";
  const upstream = "export function Btn() {\n  const a = 1;\n  const b = 2;\n  return <button type=\"button\">Go</button>;\n}\n";
  const cleanMerge = planRegistryItemUpdate({ baseContent: base, localContent: local, upstreamContent: upstream });
  assert.equal(cleanMerge.status, "merged");
  assert.match(cleanMerge.mergedContent, /const a = 10;/u);
  assert.match(cleanMerge.mergedContent, /type="button"/u);

  const conflictUpstream = "export function Btn() {\n  const a = 99;\n  const b = 2;\n  return <button>Go</button>;\n}\n";
  const conflicted = planRegistryItemUpdate({ baseContent: base, localContent: local, upstreamContent: conflictUpstream });
  assert.equal(conflicted.status, "conflict");
  assert.equal(conflicted.mergedContent, null);
  assert.ok(conflicted.conflicts.length > 0);
});

test("breakpoint sanitizer, dark-as-default migration safety, and Ninerr components/tokens CLI subcommands", async () => {
  // Breakpoint CSS refuses unbalanced brace breakout and unsafe url().
  assert.throws(() => compileBreakpointsStylesheet(
    [{ id: "mobile", maxWidth: 639 }],
    { mobile: "} body { color: red; } @media (min-width: 1px) {" },
  ));
  assert.throws(() => compileBreakpointsStylesheet(
    [{ id: "mobile", maxWidth: 639 }],
    { mobile: ".card { background-image: url(https://evil.example/a.png); }" },
  ));

  // Dark-as-default & missing-defaultMode token safety in planThemeMigration.
  const darkDoc = createDocument({ id: "doc-dark-mig", name: "Dark Mig" });
  darkDoc.schemaVersion = 2;
  darkDoc.rootIds.push("ds-dark");
  darkDoc.nodes["ds-dark"] = {
    id: "ds-dark",
    type: "design-system",
    parentId: null,
    children: [],
    metadata: {},
    props: {
      name: "Dark DS",
      collections: [{ id: "base", name: "Base", modes: [{ id: "dark", name: "Dark" }, { id: "alt", name: "Alt" }], defaultMode: "dark" }],
      tokens: [{ name: "--only-alt", type: "color", collection: "base", values: { alt: "#123456" } }],
    },
  };
  const migratedDark = planThemeMigration(darkDoc, {
    themeName: "Dual",
    tokens: [{ name: "--bg-surface", light: "#ffffff", dark: "#0f172a" }],
  });
  const nextDarkDoc = commit(darkDoc, migratedDark.operations);
  const ds = nextDarkDoc.nodes["ds-dark"];
  assert.ok(ds.props.collections[0].modes.some((m) => m.id === "light"), "light mode created for dark-as-default migration");
  assert.deepEqual(ds.props.tokens.find((t) => t.name === "--only-alt").values, { alt: "#123456" });
  const bg = ds.props.tokens.find((t) => t.name === "--bg-surface");
  assert.equal(bg.values.light, "#ffffff");
  assert.equal(bg.values.dark, "#0f172a");

  // CLI: ninerr components list/show & ninerr tokens audit/merge.
  let out = "";
  const listCode = await runCliCommand("components", ["list", "--category", "forms", "--json"], {
    version: "0.1.0",
    stdout: (s) => { out += s; },
    stderr: () => {},
  });
  assert.equal(listCode, 0);
  const listed = JSON.parse(out);
  assert.equal(listed.components.length, 7);

  let showOut = "";
  const showCode = await runCliCommand("components", ["show", "ninerr:pricing-tiers", "--json"], {
    version: "0.1.0",
    stdout: (s) => { showOut += s; },
    stderr: () => {},
  });
  assert.equal(showCode, 0);
  assert.equal(JSON.parse(showOut).id, "pricing-tiers");

  const scratch = mkdtempSync(join(tmpdir(), "ninerr-cli-phase3-"));
  try {
    const projectDir = join(scratch, "proj");
    mkdirSync(projectDir, { recursive: true });
    createProject(projectDir, { projectId: "proj", document: nextDarkDoc, createdAt: "2026-11-27T00:00:00.000Z" });
    let auditOut = "";
    const auditCode = await runCliCommand("tokens", ["audit", projectDir, "--json"], {
      version: "0.1.0",
      stdout: (s) => { auditOut += s; },
      stderr: () => {},
    });
    assert.equal(auditCode, 0);
    assert.equal(JSON.parse(auditOut).hasDesignSystem, true);

    const baseF = join(scratch, "base.tsx");
    const localF = join(scratch, "local.tsx");
    const upF = join(scratch, "up.tsx");
    writeFileSync(baseF, "const a = 1;\nconst b = 2;\n");
    writeFileSync(localF, "const a = 10;\nconst b = 2;\n");
    writeFileSync(upF, "const a = 1;\nconst b = 20;\n");
    let mergeOut = "";
    const mergeCode = await runCliCommand("tokens", ["merge", "--base", baseF, "--local", localF, "--upstream", upF, "--json"], {
      version: "0.1.0",
      stdout: (s) => { mergeOut += s; },
      stderr: () => {},
    });
    assert.equal(mergeCode, 0);
    assert.equal(JSON.parse(mergeOut).status, "merged");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
