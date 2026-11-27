import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TOKEN_TYPES,
  compileTokens,
  createDesignSystem,
  createDocument,
  designSystemOf,
  setBreakpoints,
  setDesignBrief,
  setMotionSystem,
  setToken,
} from "@ninerr/document-model";
import { applyTransaction } from "@ninerr/history";
import { planElement } from "@ninerr/renderer";
import {
  ARCHETYPE_IDS,
  DOMAIN_ARCHETYPES,
  MOTION_PRESETS,
  MOTION_PRESET_IDS,
  MOTION_TOKENS,
  OFFICIAL_SKILLS,
  SKILL_IDS,
  compileMotionReact,
  compileMotionStylesheet,
  evaluateMotionFrequency,
  evaluateTaste,
  getDomainArchetype,
  getSkill,
  lintMotionCss,
  listSkills,
  normalizeDesignBrief,
  planDesignDirections,
  renderSkillMarkdown,
} from "@ninerr/design-intelligence";
import { contrastRatio, parseOpaqueColor } from "@ninerr/design-assurance";
import { MCP_TOOL_NAMES } from "@ninerr/mcp-protocol";
import { runCliCommand } from "../packages/studio-host/src/cli.ts";

function commit(doc, operations, intent = "test") {
  const result = applyTransaction(doc, {
    id: `tx-${doc.revision + 1}`,
    baseRevision: doc.revision,
    actor: "test",
    actorKind: "agent",
    intent,
    timestamp: "2026-11-27T00:00:00.000Z",
    operations,
  });
  return result.document;
}

test("schema v2 supports duration/easing tokens and undoable brief, breakpoints, and motion on design-system without breaking compileTokens", () => {
  assert.ok(TOKEN_TYPES.includes("duration"));
  assert.ok(TOKEN_TYPES.includes("easing"));

  let doc = createDocument({ id: "doc-1", name: "App" });
  doc = commit(doc, createDesignSystem(doc, { id: "ds-1", name: "App DS" }));
  doc = commit(doc, setToken(doc, { name: "--duration-fast", type: "duration", collection: "base", values: { default: "150ms" } }));
  doc = commit(doc, setToken(doc, { name: "--ease-out", type: "easing", collection: "base", values: { default: "cubic-bezier(0.23, 1, 0.32, 1)" } }));

  const brief = {
    productName: "Helios Ledger",
    domain: "fintech",
    audience: "Treasury teams",
    brandTone: ["precise", "authoritative"],
    density: "balanced",
    themePreference: "light",
    constraints: ["WCAG AA", "Tabular numerals"],
  };
  doc = commit(doc, setDesignBrief(doc, brief));
  doc = commit(doc, setBreakpoints(doc, [
    { id: "mobile", name: "Mobile", maxWidth: 639 },
    { id: "tablet", name: "Tablet", minWidth: 640, maxWidth: 1023 },
    { id: "desktop", name: "Desktop", minWidth: 1024 },
  ]));
  doc = commit(doc, setMotionSystem(doc, {
    reducedMotion: "respect",
    defaultDuration: "220ms",
    defaultEasing: "cubic-bezier(0.23, 1, 0.32, 1)",
    allowAmbient: false,
    presets: [{ id: "enter", trigger: "mount", duration: "220ms", easing: "cubic-bezier(0.23, 1, 0.32, 1)", properties: ["opacity", "transform"] }],
  }));

  const ds = designSystemOf(doc);
  assert.equal(ds.props.brief.productName, "Helios Ledger");
  assert.equal(ds.props.breakpoints.length, 3);
  assert.equal(ds.props.motion.reducedMotion, "respect");

  // compileTokens MUST emit only :root / mode custom properties (never @media or @keyframes).
  const compiled = compileTokens(doc);
  assert.match(compiled, /--duration-fast: 150ms;/u);
  assert.match(compiled, /--ease-out: cubic-bezier\(0\.23, 1, 0\.32, 1\);/u);
  assert.doesNotMatch(compiled, /@media|@keyframes|@container/iu);

  // Invalid briefs, breakpoints, and motion configs fail closed.
  assert.throws(() => setDesignBrief(doc, { productName: "", domain: "fintech" }));
  assert.throws(() => setDesignBrief(doc, { productName: "Ok", domain: "Not Kebab" }));
  assert.throws(() => setDesignBrief(doc, { productName: "Ok", domain: "fintech", extraField: true }));
  assert.throws(() => setBreakpoints(doc, [{ id: "bad", name: "Bad", minWidth: 900, maxWidth: 400 }]));
  assert.throws(() => setMotionSystem(doc, { reducedMotion: "invalid" }));
  assert.throws(() => setMotionSystem(doc, { reducedMotion: "respect", defaultDuration: "url(https://evil.example)" }));
});

test("all 9 domain archetypes and multi-direction planner generate 3 distinct WCAG-AA token directions", () => {
  assert.equal(ARCHETYPE_IDS.length, 9);
  for (const id of ARCHETYPE_IDS) {
    assert.equal(getDomainArchetype(id).id, id);
    const plan = planDesignDirections({ productName: `Product ${id}`, domain: id });
    assert.equal(plan.directions.length, 3);
    const ids = new Set(plan.directions.map((d) => d.id));
    assert.equal(ids.size, 3, `${id} has 3 distinct directions`);

    for (const dir of plan.directions) {
      const byName = new Map(dir.tokens.map((t) => [t.name, t]));
      for (const mode of ["light", "dark"]) {
        const bg = parseOpaqueColor(byName.get("--bg-surface")[mode]);
        const fg = parseOpaqueColor(byName.get("--text-primary")[mode]);
        const accent = parseOpaqueColor(byName.get("--accent-primary")[mode]);
        const onAccent = parseOpaqueColor(byName.get("--accent-contrast")[mode]);
        assert.ok(contrastRatio(fg, bg) >= 7.0, `${dir.id} ${mode} text contrast >= 7`);
        assert.ok(contrastRatio(onAccent, accent) >= 4.5, `${dir.id} ${mode} accent contrast >= 4.5`);
      }
    }
  }
  const normalized = normalizeDesignBrief({ productName: "Custom App", domain: "civic-tech" });
  assert.equal(normalized.archetypeId, "enterprise-saas");
});

test("Ninerr Taste Engine classifies deterministic defects, brief-aware heuristics, and subjective suggestions", () => {
  let doc = createDocument({ id: "doc-taste", name: "Taste" });
  doc = commit(doc, createDesignSystem(doc, { id: "ds-1", name: "DS" }));
  doc = commit(doc, setDesignBrief(doc, { productName: "OpsConsole", domain: "developer-tools", density: "compact" }));
  doc = commit(doc, [
    {
      type: "insert-node",
      parentId: null,
      index: 1,
      node: {
        id: "frame-1",
        type: "frame",
        props: {
          tag: "main",
          style: { padding: "48px", background: "linear-gradient(135deg, #6366f1, #ec4899)" },
          stylesheet: ".card { transition: width 500ms ease; }",
        },
      },
    },
    {
      type: "insert-node",
      parentId: "frame-1",
      index: 0,
      node: {
        id: "h1-1",
        type: "element",
        props: { tag: "h1", text: "Title", style: { fontSize: "18px", color: "#999999", backgroundColor: "#aaaaaa" } },
      },
    },
    {
      type: "insert-node",
      parentId: "frame-1",
      index: 1,
      node: {
        id: "btn-1",
        type: "element",
        props: { tag: "button", text: "Go", style: { height: "18px", width: "60px", padding: "13px" } },
      },
    },
    {
      type: "insert-node",
      parentId: "frame-1",
      index: 2,
      node: {
        id: "card-outer",
        type: "element",
        props: { tag: "div", style: { borderRadius: "12px", border: "1px solid #ddd", boxShadow: "0 20px 60px rgba(0, 0, 0, 0.45)" } },
      },
    },
    {
      type: "insert-node",
      parentId: "card-outer",
      index: 0,
      node: {
        id: "card-inner",
        type: "element",
        props: { tag: "div", style: { borderRadius: "8px", border: "1px solid #ccc" } },
      },
    },
  ]);

  const report = evaluateTaste(doc);
  const ids = new Set(report.findings.map((f) => f.ruleId));
  assert.ok(ids.has("taste:color-low-contrast"), "deterministic low contrast caught");
  assert.ok(ids.has("taste:interactive-target-size"), "deterministic <24px target caught");
  assert.ok(ids.has("taste:anti-slop-gratuitous-gradient"), "gratuitous gradient caught for compact devtool");
  assert.ok(ids.has("taste:anti-slop-nested-cards"), "nested card caught");
  assert.ok(ids.has("taste:anti-slop-heavy-shadow"), "heavy shadow caught");
  assert.ok(ids.has("taste:spacing-off-grid"), "13px off-grid spacing caught");
  assert.ok(ids.has("taste:density-mismatch"), "48px padding contradicts compact density brief");
  assert.ok(ids.has("motion:gpu-composited-only"), "width transition caught");
  assert.ok(ids.has("motion:duration-cap"), "500ms duration caught");
  assert.ok(ids.has("motion:missing-reduced-motion"), "missing prefers-reduced-motion caught");
  assert.ok(report.summary.deterministicDefects >= 4);
  assert.ok(report.summary.heuristicObservations >= 4);

  // Brief-aware exemption: allowing editorial gradients suppresses gratuitous-gradient warning.
  const relaxed = evaluateTaste(doc, {
    brief: { productName: "Editorial", domain: "creative-portfolio", allowEditorialGradients: true },
  });
  assert.ok(!relaxed.findings.some((f) => f.ruleId === "taste:anti-slop-gratuitous-gradient"));
});

test("Ninerr Motion System covers all 13 presets, frequency gate, GPU linter, and reduced-motion output", () => {
  assert.equal(MOTION_TOKENS.length, 8);
  assert.equal(MOTION_PRESET_IDS.length, 13);

  const highFreq = evaluateMotionFrequency({ trigger: "command-palette", presetId: "modal" });
  assert.equal(highFreq.allowed, false);
  assert.equal(highFreq.ruleId, "motion:high-frequency-restraint");

  const okFreq = evaluateMotionFrequency({ trigger: "dialog-open", presetId: "modal" });
  assert.equal(okFreq.allowed, true);

  const compiled = compileMotionStylesheet({ presetIds: ["hover", "focus", "press", "enter"], selector: ".hero-btn" });
  assert.match(compiled.css, /@keyframes ninerr-enter/u);
  assert.match(compiled.css, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(compiled.css, /@media \(hover: hover\)/u);
  assert.deepEqual(lintMotionCss(compiled.css), [], "compiled Ninerr motion stylesheet has zero lint defects");

  const react = compileMotionReact("modal");
  assert.equal(react.presetId, "modal");
  assert.ok(react.durationSec <= 0.3);
  assert.ok(MOTION_PRESETS.modal.properties.includes("transform"));
});

test("all 19 official Ninerr skills exist, render SKILL.md cleanly, and reference only real MCP tools", () => {
  assert.equal(SKILL_IDS.length, 19);
  assert.equal(OFFICIAL_SKILLS.length, 19);
  assert.ok(listSkills("motion").some((s) => s.id === "motion"));
  assert.equal(getSkill("nonexistent"), null);

  // Allowed tool surface: live MCP_TOOL_NAMES + the 5 headless lifecycle tools (zero drift).
  const validTools = new Set([
    ...MCP_TOOL_NAMES,
    "list_projects",
    "create_project",
    "open_project",
    "save_project",
    "close_project",
  ]);
  for (const skill of OFFICIAL_SKILLS) {
    assert.ok(skill.recommendedTools.length > 0, `${skill.id} has tools`);
    for (const tool of skill.recommendedTools) {
      assert.ok(validTools.has(tool), `skill ${skill.id} cites unknown MCP tool "${tool}"`);
    }
    const md = renderSkillMarkdown(skill);
    assert.match(md, new RegExp(`^---\\nname: ninerr-${skill.id}\\n`, "u"));
    assert.match(md, /## Recommended Ninerr MCP tools/u);
  }
});

test("PR 484 review regressions: renderer-safe motion CSS, selector validation, motion linter accuracy, Taste edge cases, strict schema-v2, and CLI flag parsing", async () => {
  // 1. Every compiled motion stylesheet (all 13 presets, both respect & minimal) passes planElement with 0 drops and non-null stylesheet.
  for (const mode of ["respect", "minimal"]) {
    const compiled = compileMotionStylesheet({ presetIds: [...MOTION_PRESET_IDS, "hover"], selector: ":scope", reducedMotion: mode });
    assert.equal(compiled.presetIds.length, MOTION_PRESET_IDS.length, "duplicate presetIds are deduplicated");
    assert.doesNotMatch(compiled.css, /scroll-behavior/iu, "never emits scroll-behavior which renderer UNSAFE_STYLESHEET rejects");
    const planned = planElement({ id: "node-motion", type: "frame", props: { stylesheet: compiled.css } });
    assert.equal(planned.dropped, 0, `${mode} motion stylesheet has 0 renderer drops`);
    assert.equal(planned.stylesheet, compiled.css, `${mode} motion stylesheet survives renderer sanitizer verbatim`);
  }
  const minimal = compileMotionStylesheet({ presetIds: ["enter"], selector: ":scope", reducedMotion: "minimal" });
  const respect = compileMotionStylesheet({ presetIds: ["enter"], selector: ":scope", reducedMotion: "respect" });
  assert.notEqual(minimal.css, respect.css, "minimal and respect reducedMotion modes emit distinct CSS");
  assert.match(minimal.css, /transition-property:\s*opacity !important;/u);

  // 2. Selector validation rejects unbalanced brackets/quotes, control chars, and unsafe schemes.
  for (const badSelector of [
    'foo[bar="unclosed',
    "foo[[bar]]",
    'foo"bar"',
    "foo]bar",
    "foo\nbar",
    "a[href=javascript:alert]",
    "behavior:url",
  ]) {
    assert.throws(() => compileMotionStylesheet({ presetIds: ["hover"], selector: badSelector }), `rejects bad selector ${JSON.stringify(badSelector)}`);
  }

  // 3. Motion frequency rejects unknown presets; compileMotionReact differentiates drawer & curves.
  assert.throws(() => evaluateMotionFrequency({ trigger: "click", presetId: "nonexistent-preset" }));
  const drawerReact = compileMotionReact("drawer");
  assert.deepEqual(drawerReact.reactProps.initial, { opacity: 0, x: 24 });
  assert.deepEqual(drawerReact.reactProps.animate, { opacity: 1, x: 0 });
  assert.deepEqual(drawerReact.reactProps.transition.ease, [0.32, 0.72, 0, 1]);

  // 4. lintMotionCss handles static CSS, comments, decimal seconds, reverse shorthand order, and @keyframes accurately.
  assert.deepEqual(lintMotionCss(".transition-panel { color: #111; --my-transition: 500ms; transition: none; /* transition: all 900ms; */ }"), []);
  assert.deepEqual(lintMotionCss(".btn { transition: opacity .15s ease; } @media (prefers-reduced-motion: reduce) { .btn { transition-duration: 0.01ms; } }"), []);
  const decimalSlow = lintMotionCss(".btn { transition: opacity .5s ease; } @media (prefers-reduced-motion: reduce) {}");
  assert.ok(decimalSlow.some((f) => f.ruleId === "motion:duration-cap"), ".5s (500ms) triggers duration cap");
  const reversedWidth = lintMotionCss(".box { transition: 200ms width ease; } @media (prefers-reduced-motion: reduce) {}");
  assert.ok(reversedWidth.some((f) => f.ruleId === "motion:gpu-composited-only" && f.evidence.property === "width"), "transition: 200ms width catches layout prop");
  const keyframesNoReduce = lintMotionCss("@keyframes slide { from { opacity: 0; } to { opacity: 1; } }");
  assert.ok(keyframesNoReduce.some((f) => f.ruleId === "motion:missing-reduced-motion"), "@keyframes at column 0 requires reduced-motion");

  // 5. Taste engine: kebab-case spacing, WCAG bold large text, dark --shadow-sm calibration, nested var() fallback.
  let doc = createDocument({ id: "doc-taste-reg", name: "Reg" });
  doc = commit(doc, createDesignSystem(doc, { id: "ds-1", name: "DS" }));
  doc = commit(doc, setToken(doc, { name: "--fg-fallback", type: "color", collection: "base", values: { default: "#767676" } }));
  doc = commit(doc, [
    {
      type: "insert-node",
      parentId: null,
      index: 1,
      node: { id: "root", type: "frame", props: { tag: "main", style: { backgroundColor: "#0b1120" } } },
    },
    {
      type: "insert-node",
      parentId: "root",
      index: 0,
      node: {
        id: "kebab-box",
        type: "element",
        props: {
          tag: "div",
          style: {
            "padding-top": "13px",
            boxShadow: "0 1px 2px rgba(0, 0, 0, 0.45)",
          },
        },
      },
    },
    {
      type: "insert-node",
      parentId: "root",
      index: 1,
      node: {
        id: "bold-large",
        type: "element",
        props: {
          tag: "h2",
          text: "Bold Large Heading",
          style: {
            "font-size": "19px",
            "font-weight": "700",
            color: "var(--missing, var(--fg-fallback, #767676))",
            "background-color": "#ffffff",
          },
        },
      },
    },
  ]);
  const taste = evaluateTaste(doc);
  assert.ok(taste.findings.some((f) => f.ruleId === "taste:spacing-off-grid" && f.nodeId === "kebab-box"), "kebab-case padding-top: 13px caught");
  assert.ok(!taste.findings.some((f) => f.ruleId === "taste:anti-slop-heavy-shadow" && f.nodeId === "kebab-box"), "Ninerr dark --shadow-sm does not self-flag");
  assert.ok(!taste.findings.some((f) => f.ruleId === "taste:color-low-contrast" && f.nodeId === "bold-large"), "19px bold with ~4.54:1 ratio passes WCAG 2.1 large text");

  // 6. Strict schema-v2 validation rejects whitespace-only brief text and unknown keys in breakpoints/motion.
  assert.throws(() => setDesignBrief(doc, { productName: "   ", domain: "fintech" }));
  assert.throws(() => setDesignBrief(doc, { productName: "Valid", domain: "fintech", audience: "   " }));
  assert.throws(() => setBreakpoints(doc, [{ id: "sm", name: "Small", minWidth: 640, bogus: true }]));
  assert.throws(() => setBreakpoints(doc, [{ id: "sm", name: "   ", minWidth: 640 }]));
  assert.throws(() => setMotionSystem(doc, { reducedMotion: "respect", presets: [{ id: "enter", extra: 1 }] }));

  // 7. CLI boolean flag parsing & strict archetype/file checks.
  const scratch = mkdtempSync(join(tmpdir(), "ninerr-cli-reg-"));
  try {
    const cssFile = join(scratch, "anim.css");
    writeFileSync(cssFile, ".orb { animation: float 200ms infinite; } @media (prefers-reduced-motion: reduce) { .orb { animation: none; } }\n");
    let out = "";
    let err = "";
    const code = await runCliCommand("motion", ["lint", "--allow-ambient", cssFile], {
      version: "0.1.0",
      stdout: (s) => { out += s; },
      stderr: (s) => { err += s; },
    });
    assert.equal(code, 0, `boolean --allow-ambient before file path succeeds: ${err}`);
    assert.match(out, /0 motion issues/u);

    let errUnknown = "";
    const badArch = await runCliCommand("design", ["archetype", "not-a-domain"], {
      version: "0.1.0",
      stdout: () => {},
      stderr: (s) => { errUnknown += s; },
    });
    assert.equal(badArch, 2, "unknown explicit archetype exits 2");
    assert.match(errUnknown, /unknown domain id/u);

    const dirLint = await runCliCommand("motion", ["lint", scratch], {
      version: "0.1.0",
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(dirLint, 2, "passing a directory to motion lint exits 2");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
