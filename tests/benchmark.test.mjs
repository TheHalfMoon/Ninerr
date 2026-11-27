import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocument, newDesignSystemProps } from "@ninerr/document-model";
import {
  BENCHMARK_CATEGORIES,
  BENCHMARK_RUBRIC,
  auditDesignSystem,
  runBenchmarkSuite,
  runCliCommand,
} from "../packages/studio-host/src/index.ts";
import * as sdk from "../packages/studio-host/src/sdk.ts";

function withTempDir(run) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-bench-test-")));
  const finish = () => rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  try {
    const out = run(dir);
    if (out && typeof out.then === "function") return out.finally(finish);
    finish();
    return out;
  } catch (error) {
    finish();
    throw error;
  }
}

test("BENCHMARK_CATEGORIES and BENCHMARK_RUBRIC define 14 categories and a 100-point rubric (65 automated + 35 human-blinded)", () => {
  assert.equal(BENCHMARK_CATEGORIES.length, 14);
  const ids = new Set(BENCHMARK_CATEGORIES.map((c) => c.id));
  assert.equal(ids.size, 14);
  assert.ok(BENCHMARK_CATEGORIES.some((c) => c.kind === "authoring"));
  assert.ok(BENCHMARK_CATEGORIES.some((c) => c.kind === "theme-migration"));
  assert.ok(BENCHMARK_CATEGORIES.some((c) => c.kind === "existing-app-redesign"));

  assert.equal(BENCHMARK_RUBRIC.length, 9);
  const totalWeight = BENCHMARK_RUBRIC.reduce((sum, dim) => sum + dim.weight, 0);
  const automatedWeight = BENCHMARK_RUBRIC.filter((d) => d.automated).reduce((sum, dim) => sum + dim.weight, 0);
  const humanWeight = BENCHMARK_RUBRIC.filter((d) => !d.automated).reduce((sum, dim) => sum + dim.weight, 0);
  assert.equal(totalWeight, 100);
  assert.equal(automatedWeight, 65);
  assert.equal(humanWeight, 35);
});

test("runBenchmarkSuite executes all 14 categories offline and keeps blinded human rubrics strictly null", async () => {
  const report = await runBenchmarkSuite();
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.networkAttempts, 0);
  assert.equal(report.visionUsed, false);
  assert.equal(report.categoryCount, 14);
  assert.equal(report.summary.automatedMaxPoints, 65);
  assert.equal(report.summary.humanMaxPoints, 35);
  assert.equal(report.summary.humanRubricStatus, "pending-blinded-human-review");
  assert.ok(report.summary.automatedMeanPercent >= 95, `expected >= 95%, got ${report.summary.automatedMeanPercent}%`);

  for (const cat of report.categories) {
    assert.equal(cat.automated.maxPoints, 65);
    assert.ok(cat.automated.percent >= 90, `${cat.id} scored ${cat.automated.percent}%`);
    assert.equal(cat.humanRubric.status, "pending-blinded-human-review");
    assert.equal(cat.humanRubric.maxPoints, 35);
    assert.equal(cat.humanRubric.dimensions.aesthetic, null);
    assert.equal(cat.humanRubric.dimensions.ux, null);
    if (cat.kind === "existing-app-redesign") {
      assert.equal(cat.details.validInvariancePassed, true);
      assert.equal(cat.details.hostileHandlerBlocked, true);
      assert.equal(cat.details.directiveDropBlocked, true);
      assert.equal(cat.details.restoredByteIdentical, true);
    } else {
      assert.equal(cat.details.directionsPlanned, 3);
      assert.equal(cat.details.allSixFrameworkExportsValid, true);
      assert.equal(cat.details.reducedMotionCompliant, true);
      assert.equal(cat.details.a11yErrors, 0);
    }
  }
});

test("auditDesignSystem matches hardcoded literals only against compatible token types", () => {
  const dsProps = newDesignSystemProps();
  dsProps.collections = [{ id: "theme", name: "Theme", modes: [{ id: "light", name: "Light" }], defaultMode: "light" }];
  dsProps.tokens = [
    { name: "--radius-lg", type: "radius", collection: "theme", values: { light: "16px" } },
    { name: "--space-4", type: "spacing", collection: "theme", values: { light: "16px" } },
    { name: "--text-base", type: "fontSize", collection: "theme", values: { light: "16px" } },
  ];
  const doc = createDocument({
    id: "doc-prop-type",
    name: "Property Type Match Test",
    nodes: [
      { id: "ds", type: "design-system", props: dsProps },
      {
        id: "box",
        type: "element",
        props: {
          tag: "div",
          name: "Box",
          style: {
            "font-size": "16px",
            "border-radius": "16px",
            gap: "16px",
          },
        },
        children: [],
      },
    ],
  });
  const audit = auditDesignSystem(doc);
  const byField = new Map(
    audit.findings
      .filter((f) => f.ruleId === "system:hardcoded-literal-matches-token")
      .map((f) => [f.evidence.field, f.evidence.matchingTokens]),
  );
  assert.deepEqual(byField.get("style.font-size"), ["--text-base"]);
  assert.deepEqual(byField.get("style.border-radius"), ["--radius-lg"]);
  assert.deepEqual(byField.get("style.gap"), ["--space-4"]);
});

test("ninerr benchmark CLI supports list, category filtering, --out overwrite/symlink guards, and SDK export parity", async () => {
  assert.equal(sdk.BENCHMARK_CATEGORIES.length, 14);
  assert.equal(sdk.BENCHMARK_RUBRIC.length, 9);
  assert.equal(typeof sdk.runBenchmarkSuite, "function");

  await withTempDir(async (dir) => {
    const listOut = [];
    const listErr = [];
    const listCode = await runCliCommand("benchmark", ["list", "--json"], {
      version: "0.1.0",
      stdout: (s) => listOut.push(s),
      stderr: (s) => listErr.push(s),
    });
    assert.equal(listCode, 0, listErr.join(""));
    const listed = JSON.parse(listOut.join(""));
    assert.equal(listed.categories.length, 14);
    assert.equal(listed.rubric.length, 9);

    // Reject empty or comma-only --category
    const emptyErr = [];
    const emptyCode = await runCliCommand("benchmark", ["run", "--category", ""], {
      version: "0.1.0",
      stdout: () => {},
      stderr: (s) => emptyErr.push(s),
    });
    assert.equal(emptyCode, 2);
    assert.match(emptyErr.join(""), /non-empty value/u);

    const commaErr = [];
    const commaCode = await runCliCommand("benchmark", ["run", "--category", " , "], {
      version: "0.1.0",
      stdout: () => {},
      stderr: (s) => commaErr.push(s),
    });
    assert.equal(commaCode, 2);
    assert.match(commaErr.join(""), /at least one category/u);

    // Write report to --out
    const outFile = join(dir, "bench-report.json");
    const runOut = [];
    const runErr = [];
    const runCode = await runCliCommand("benchmark", ["run", "--category", "fintech-ledger", "--out", outFile, "--json"], {
      version: "0.1.0",
      stdout: (s) => runOut.push(s),
      stderr: (s) => runErr.push(s),
    });
    assert.equal(runCode, 0, runErr.join(""));
    const parsedOut = JSON.parse(runOut.join(""));
    assert.equal(parsedOut.categoryCount, 1);
    assert.equal(parsedOut.categories[0].id, "fintech-ledger");
    const onDisk = JSON.parse(readFileSync(outFile, "utf8"));
    assert.equal(onDisk.categories[0].id, "fintech-ledger");
    assert.equal(onDisk.categories[0].humanRubric.dimensions.aesthetic, null);

    // Refuse overwriting existing --out without --replace
    const dupErr = [];
    const dupCode = await runCliCommand("benchmark", ["run", "--category", "fintech-ledger", "--out", outFile], {
      version: "0.1.0",
      stdout: () => {},
      stderr: (s) => dupErr.push(s),
    });
    assert.equal(dupCode, 2);
    assert.match(dupErr.join(""), /already exists/u);

    // Allow overwrite with --replace
    const repCode = await runCliCommand("benchmark", ["run", "--category", "fintech-ledger", "--out", outFile, "--replace"], {
      version: "0.1.0",
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(repCode, 0);

    // Refuse symlink --out target (where OS allows symlinks)
    const targetFile = join(dir, "real-target.json");
    writeFileSync(targetFile, "{}");
    const linkFile = join(dir, "link-report.json");
    let linkCreated = false;
    try {
      symlinkSync(targetFile, linkFile);
      linkCreated = true;
    } catch {
      linkCreated = false;
    }
    if (linkCreated) {
      const symErr = [];
      const symCode = await runCliCommand("benchmark", ["run", "--category", "fintech-ledger", "--out", linkFile, "--replace"], {
        version: "0.1.0",
        stdout: () => {},
        stderr: (s) => symErr.push(s),
      });
      assert.equal(symCode, 2);
      assert.match(symErr.join(""), /symlink/iu);
    }
  });
});
