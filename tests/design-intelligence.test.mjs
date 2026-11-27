import test from "node:test";
import assert from "node:assert/strict";
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

  // Allowed tool surface: live catalog + Phase 1/2 tools + lifecycle tools.
  const validTools = new Set([
    ...MCP_TOOL_NAMES,
    "list_projects",
    "create_project",
    "open_project",
    "save_project",
    "close_project",
    "create_layers",
    "import_source",
    "design_intelligence",
    "set_design_brief",
    "apply_motion",
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
