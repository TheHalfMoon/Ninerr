import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The dependency audit runs on every change to the locked dependencies and every week, fails on
// any advisory, and installs or runs nothing from the repository or its dependencies.
const workflow = readFileSync(new URL("../.github/workflows/dependency-audit.yml", import.meta.url), "utf8");
const steps = workflow.replace(/^ *#.*$/gm, "");

test("the audit runs on dependency changes, weekly and by hand", () => {
  for (const path of ["package.json", "package-lock.json"]) {
    assert.match(workflow, new RegExp(`^  pull_request:\\n    paths:\\n(?:      - .*\\n)*      - ${path.replace(".", "\\.")}\\n`, "m"), `pull requests that change ${path}`);
    assert.match(workflow, new RegExp(`^  push:\\n    branches: \\[main\\]\\n    paths:\\n(?:      - .*\\n)*      - ${path.replace(".", "\\.")}\\n`, "m"), `main when ${path} changes`);
  }
  assert.match(workflow, /^  schedule:\n    - cron: "[^"]+"\n/m);
  assert.match(workflow, /^  workflow_dispatch:\n/m);
});

test("any advisory fails it, and it reads the lockfile only", () => {
  assert.match(steps, /^        run: npm audit --package-lock-only --audit-level=low\n/m);
  assert.doesNotMatch(steps, /--omit|--production|continue-on-error|\|\| true/, "no dependency or failure is left out");
  assert.doesNotMatch(steps, /npm (ci|install)|\bnode \w|npx/, "nothing is installed or run");
  assert.match(workflow, /^permissions:\n  contents: read\n/m);
  for (const uses of workflow.match(/uses: \S+/g)) assert.match(uses, /@[0-9a-f]{40}$/, `${uses} is pinned to a commit`);
});
