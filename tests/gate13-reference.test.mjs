import test from "node:test";
import assert from "node:assert/strict";

import { failureOf, judgeRuns, referenceProblems, renderMarkdown, verdictOf } from "../scripts/gate13-reference.mjs";
import { GATE13_BUDGETS, judgeReference, overruns, regressions, summarize } from "./support/gate13.mjs";

// #275, the founder's decision of 2026-10-13: gate 13's budgets are judged on the reference
// machine, five runs, a budget passing when it holds in at least four and the median of the
// five held values is within it. CI's figures are information, with regressions of more than
// 50% against the runner OS's baseline flagged for investigation.

const run = (overrides = {}) => ({
  firstRender: { value: 500 },
  apply: { n: 40, p50: 5, p95: 12, max: 14 },
  insert: { n: 30, p50: 10, p95: 30, max: 31 },
  remove: { n: 30, p50: 10, p95: 30, max: 31 },
  edit: { n: 30, p50: 80, p95: 120, max: 130 },
  delete: { n: 20, p50: 150, p95: 250, max: 260 },
  ...overrides,
});

test("the budgets are the unchanged PC gate-13 budgets", () => {
  assert.deepEqual(GATE13_BUDGETS.map((budget) => [budget.key, budget.stat, budget.budget]), [
    ["firstRender", "value", 2000], ["apply", "p95", 100], ["insert", "p95", 100], ["remove", "p95", 100], ["edit", "p95", 750], ["delete", "p95", 750],
  ]);
});

test("a run's samples are summarized by nearest rank, as the gate has always computed p95", () => {
  const samples = Array.from({ length: 30 }, (_, index) => index + 1);
  assert.deepEqual(summarize(samples), { n: 30, p50: 15, p95: 29, max: 30 });
  assert.deepEqual(summarize([7]), { n: 1, p50: 7, p95: 7, max: 7 });
  assert.throws(() => summarize([]), /at least one sample/u);
});

test("five runs pass a budget only when four hold it and the median is within it", () => {
  const editP95 = (values) => values.map((p95) => run({ edit: { n: 30, p50: 80, p95, max: p95 } }));
  const edit = (runs) => judgeReference(runs).find((item) => item.key === "edit");
  assert.deepEqual([edit(editP95([100, 200, 300, 400, 500])).pass, edit(editP95([100, 200, 300, 400, 500])).held], [true, 5]);
  // One run over the budget is allowed; two are not.
  assert.equal(edit(editP95([100, 200, 300, 400, 900])).pass, true);
  const two = edit(editP95([100, 200, 300, 800, 900]));
  assert.deepEqual([two.pass, two.held, two.median], [false, 3, 300]);
  // At the budget holds; over it does not.
  assert.equal(edit(editP95([750, 750, 750, 750, 751])).pass, true);
  assert.equal(edit(editP95([751, 751, 751, 100, 100])).pass, false);
  // The first render is held to its single value.
  const render = judgeReference([run(), run(), run(), run({ firstRender: { value: 2500 } }), run({ firstRender: { value: 2100 } })]).find((item) => item.key === "firstRender");
  assert.deepEqual([render.pass, render.held], [false, 3]);
  assert.throws(() => judgeReference([run(), run(), run(), run()]), /exactly five runs/u);
});

test("in CI, overruns and regressions above half again the runner's baseline are reported, not judged", () => {
  assert.deepEqual(overruns(run()), []);
  assert.deepEqual(overruns(run({ delete: { n: 20, p50: 500, p95: 800, max: 900 } })).map((item) => [item.key, item.value]), [["delete", 800]]);
  const baseline = { firstRender: 400, apply: 10, insert: 30, remove: 30, edit: 100, delete: 200 };
  assert.deepEqual(regressions(run(), baseline).map((item) => item.key), []);
  // 151 is more than 50% above 100; 150 is not.
  assert.deepEqual(regressions(run({ edit: { n: 30, p50: 90, p95: 151, max: 160 } }), baseline).map((item) => [item.key, item.value, item.baseline]), [["edit", 151, 100]]);
  assert.deepEqual(regressions(run({ edit: { n: 30, p50: 90, p95: 150, max: 160 } }), baseline), []);
  assert.deepEqual(regressions(run(), undefined), [], "no baseline for this OS: nothing to compare");
});

test("a record says whether it was taken on the reference configuration", () => {
  const reference = { os: "win32 10.0.26300 (Windows 11 Home)", cpu: "13th Gen Intel(R) Core(TM) i5-13420H", logicalCores: 12, memoryGiB: 16, node: "v24.19.0", browserPath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" };
  assert.deepEqual(referenceProblems(reference), []);
  assert.deepEqual(referenceProblems({ ...reference, os: "win32 10.0.19045 (Windows 10 Pro)" }), ["not Windows 11: win32 10.0.19045 (Windows 10 Pro)"]);
  assert.equal(referenceProblems({ ...reference, cpu: "Apple M1", logicalCores: 8, node: "v22.23.3", browserPath: "/usr/bin/chromium" }).length, 4);
  assert.deepEqual(referenceProblems({ ...reference, browserPath: "C:/Program Files/Google/Chrome/Application/chrome.exe" }), ["not Microsoft Edge: C:/Program Files/Google/Chrome/Application/chrome.exe"]);
  assert.deepEqual(referenceProblems({ ...reference, browserPath: null }), ["not Microsoft Edge: null"]);
});

test("the record's Markdown gives the verdict, each budget and all five runs", () => {
  const runs = [run(), run(), run(), run(), run({ delete: { n: 20, p50: 500, p95: 800, max: 900 } })];
  const record = {
    commit: "1987c771882fd93cdb682c4b3cb301dbf7cf9bd1", tree: "0".repeat(40), date: "2026-10-13T00:00:00.000Z",
    machine: { os: "win32 10.0.26300 (Windows 11 Home)", cpu: "i5-13420H", logicalCores: 12, memoryGiB: 16, node: "v24.19.0", browserPath: "msedge.exe" },
    browser: "141.0", power: "plugged in, best performance", referenceProblems: [],
    runs: runs.map((measures, index) => ({ index: index + 1, status: 0, failure: null, openWallMs: 1500, measures })), judgement: judgeReference(runs), verdict: "pass: every budget holds",
  };
  const text = renderMarkdown(record);
  assert.match(text, /^# Gate 13 on the reference machine: `1987c77`/u);
  assert.match(text, /\*\*Verdict: pass: every budget holds\.\*\*/u);
  assert.match(text, /\| deleting a layer in the editor \| p95 \| 750 ms \| 4 of 5 \| 250 ms \| yes \|/u);
  assert.match(text, /\| 5 \| 1500 \| 500 \| 5 \/ 12 \/ 14 \(n 40\) \|.*\| 500 \/ 800 \/ 900 \(n 20\) \|/u);
  assert.match(text, /already running.*its start is not counted/u);
  assert.doesNotMatch(text, /Runs that failed/u);
});

test("a failed run keeps what it measured, says why, and fails the record", () => {
  // TAP puts a multi-line assertion message on the line after its block marker.
  assert.equal(failureOf({ status: 1, stdout: "not ok 1 - x\n  error: |-\n    every gate-13 budget holds\n" }), "every gate-13 budget holds");
  assert.equal(failureOf({ status: 1, stdout: "  error: 'the editor becoming ready timed out'\n" }), "'the editor becoming ready timed out'");
  assert.equal(failureOf({ status: 7, stdout: "" }), "exit 7");
  assert.equal(failureOf({ status: 0, stdout: "" }), "the run recorded nothing");
  const all = [run(), run(), run(), run(), run()].map((measures, index) => ({ index: index + 1, failure: null, measures }));
  assert.equal(verdictOf([], all, judgeRuns(all)), "pass: every budget holds");
  // A run failed after recording: its figures still count, and the record fails.
  const late = all.map((item) => (item.index === 3 ? { ...item, failure: "editor.errors" } : item));
  assert.equal(judgeRuns(late).every((item) => item.pass), true);
  assert.equal(verdictOf([], late, judgeRuns(late)), "fail: run(s) 3 failed");
  // A run that measured nothing: the others are still shown, and nothing passes.
  const missing = all.map((item) => (item.index === 2 ? { index: 2, failure: "exit 1" } : item));
  const partial = judgeRuns(missing);
  assert.deepEqual(partial.map((item) => [item.held, item.pass]), partial.map(() => [4, false]));
  assert.equal(verdictOf(["not Windows 11"], all, judgeRuns(all)), "no verdict: not the reference machine");
  const over = [run(), run(), run({ edit: { n: 30, p50: 700, p95: 800, max: 900 } }), run({ edit: { n: 30, p50: 700, p95: 800, max: 900 } }), run()].map((measures, index) => ({ index: index + 1, failure: null, measures }));
  assert.equal(verdictOf([], over, judgeRuns(over)), "fail: end-to-end edit in the editor");
});
