import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeCodebase,
  applyRedesignPlan,
  planRedesign,
  rollbackRedesign,
  verifyFunctionalInvariance,
} from "../packages/studio-host/src/redesign.ts";

function withTempWorkspace(run) {
  const dir = mkdtempSync(join(tmpdir(), "ninerr-redesign-"));
  const journal = mkdtempSync(join(tmpdir(), "ninerr-redesign-journal-"));
  try {
    return run(dir, journal);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    rmSync(journal, { recursive: true, force: true, maxRetries: 5 });
  }
}

test("analyzeCodebase discovers framework, styling, CSS tokens, routes, and functional contracts offline", () => withTempWorkspace((root) => {
  mkdirSync(join(root, "src", "app"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "sample-app",
    dependencies: { next: "15.0.0", react: "19.0.0", tailwindcss: "4.0.0" },
  }));
  writeFileSync(join(root, "src", "app", "globals.css"), ":root { --bg-canvas: #ffffff; --accent-primary: #3b82f6; }\n");
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

test("Whole-File AST Invariance Gate approves styling-only changes and blocks logic/handler/directive/testid mutations", () => {
  const before = `"use client";
import { useState } from "react";
export function BillingForm({ onSave }) {
  const [amount, setAmount] = useState("100");
  return (
    <form onSubmit={onSave} className="p-4 bg-gray-100">
      <input name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="amount-input" />
      <button type="submit" className={cn("bg-blue-500 px-3", amount === "" && "opacity-50")}>Pay {amount}</button>
    </form>
  );
}
`;

  const validStyleRedesign = `"use client";
import { useState } from "react";
export function BillingForm({ onSave }) {
  const [amount, setAmount] = useState("100");
  return (
    <form onSubmit={onSave} className="p-8 bg-slate-50 rounded-xl border">
      <input name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="amount-input" />
      <button type="submit" className={cn("bg-teal-700 px-5", amount === "" && "opacity-50")}>Pay {amount}</button>
    </form>
  );
}
`;
  const ok = verifyFunctionalInvariance(before, validStyleRedesign, "BillingForm.tsx");
  assert.equal(ok.ok, true, JSON.stringify(ok.violations));

  // Dropping "use client" directive is blocked.
  const noDirective = validStyleRedesign.replace('"use client";\n', "");
  assert.equal(verifyFunctionalInvariance(before, noDirective, "BillingForm.tsx").ok, false);

  // Altering onSubmit handler is blocked.
  const badHandler = validStyleRedesign.replace("onSubmit={onSave}", "onSubmit={() => {}}");
  assert.equal(verifyFunctionalInvariance(before, badHandler, "BillingForm.tsx").ok, false);

  // Dropping data-testid is blocked.
  const noTestId = validStyleRedesign.replace(' data-testid="amount-input"', "");
  assert.equal(verifyFunctionalInvariance(before, noTestId, "BillingForm.tsx").ok, false);

  // Mutating state initializer business logic is blocked.
  const badState = validStyleRedesign.replace('useState("100")', 'useState("0")');
  assert.equal(verifyFunctionalInvariance(before, badState, "BillingForm.tsx").ok, false);
});

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
