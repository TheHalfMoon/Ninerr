// Gate 13 on the reference machine (#275, the founder's decision of 2026-10-13).
//
//   node scripts/gate13-reference.mjs --power "<plugged in, best performance>" [--out <folder>]
//
// From a clean checkout of the exact candidate commit, on a quiet machine, it runs
// `node --test tests/editor-performance.test.mjs` five times, each recording its measurements
// (NINERR_GATE13_RECORD), and judges every budget: it passes when it holds in at least four of
// the five runs and the median of the five p95s is within it. The record, written by this
// script and not by hand, gives the commit and tree, the machine, Node and the browser, and all
// five runs' figures (p50, p95, maximum and sample count). The exit code is 0 when every budget
// passes on the reference machine, and 1 otherwise.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { cpus, platform, release, tmpdir, totalmem, version } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findBrowser } from "../tests/support/browser.mjs";
import { GATE13_BUDGETS, heldValue, judgeReference } from "../tests/support/gate13.mjs";

const REPO = fileURLToPath(new URL("../", import.meta.url));

/** The machine as the record states it. */
export function machineDescription() {
  return {
    os: `${platform()} ${release()} (${version()})`,
    cpu: cpus()[0]?.model.trim() ?? "unknown",
    logicalCores: cpus().length,
    memoryGiB: Math.round(totalmem() / 2 ** 30),
    node: process.version,
    // The browser the test itself will launch, found the same way.
    browserPath: findBrowser(),
  };
}

/**
 * Whether `machine` (with the browser version a run reported) is the reference configuration:
 * Windows 11, an i5-13420H with 12 logical cores, 16 GiB, Node 24 and Microsoft Edge. The power
 * mode and a quiet machine are the operator's statement; the script cannot see them.
 */
export function referenceProblems(machine) {
  const problems = [];
  // Windows 11 reports itself as Windows NT 10.0 with a build of 22000 or later.
  const build = Number(/^win32 10\.0\.(\d+)/u.exec(machine.os)?.[1]);
  if (!(build >= 22_000)) problems.push(`not Windows 11: ${machine.os}`);
  if (!/i5-13420H/u.test(machine.cpu)) problems.push(`not an Intel Core i5-13420H: ${machine.cpu}`);
  if (machine.logicalCores !== 12) problems.push(`${machine.logicalCores} logical cores, not 12`);
  if (machine.memoryGiB < 15 || machine.memoryGiB > 16) problems.push(`${machine.memoryGiB} GiB, not 16`);
  if (!/^v24\./u.test(machine.node)) problems.push(`Node ${machine.node}, not 24`);
  if (!/msedge(\.exe)?$/iu.test(machine.browserPath ?? "")) problems.push(`not Microsoft Edge: ${machine.browserPath}`);
  return problems;
}

/** The record as Markdown: the verdict per budget, then every run's figures. */
export function renderMarkdown(record) {
  const lines = [
    `# Gate 13 on the reference machine: \`${record.commit.slice(0, 7)}\``,
    "",
    `The record of \`scripts/gate13-reference.mjs\` (#275), written by the script. Commit \`${record.commit}\`, tree \`${record.tree}\`, ${record.date}.`,
    "",
    `**Verdict: ${record.verdict}.**${record.referenceProblems.length > 0 ? ` Not the reference configuration: ${record.referenceProblems.join("; ")}.` : ""}`,
    "",
    `- **Machine:** ${record.machine.os}; ${record.machine.cpu}, ${record.machine.logicalCores} logical cores; ${record.machine.memoryGiB} GiB; Node ${record.machine.node}; browser ${record.browser ?? "unknown"} (\`${record.machine.browserPath}\`).`,
    `- **Power and load, as the operator stated them:** ${record.power}.`,
    "",
    "| Budget | Held to | Budget | Runs within it | Median | Pass |",
    "|---|---|---:|---:|---:|---|",
    ...record.judgement.map((item) => `| ${item.label} | ${item.stat === "p95" ? "p95" : "the value"} | ${item.budget} ms | ${item.held} of 5 | ${item.median} ms | ${item.pass ? "yes" : "**no**"} |`),
    "",
    "**The five runs** (ms; p50 / p95 / max, with the sample count). *Open* is opening the 10,000-node project in an editor already running, to its drawn canvas: the browser was launched before it and its start is not counted.",
    "",
    `| Run | open | ${GATE13_BUDGETS.map((budget) => budget.key).join(" | ")} |`,
    `|---|---:|${GATE13_BUDGETS.map(() => "---:").join("|")}|`,
    ...record.runs.map((run) => `| ${run.index} | ${run.openWallMs ?? "—"} | ${GATE13_BUDGETS.map((budget) => cell(run.measures?.[budget.key], budget)).join(" | ")} |`),
    "",
  ];
  const failed = record.runs.filter((run) => run.failure !== null);
  if (failed.length > 0) lines.push(`**Runs that failed** (their figures above are kept): ${failed.map((run) => `run ${run.index} (exit ${run.status}: ${run.failure})`).join("; ")}. The JSON record has each one's last lines of output.`, "");
  return `${lines.join("\n")}`;
}

/** One measure in the runs table: "—" when the run did not reach it. */
function cell(measure, budget) {
  if (measure === undefined) return "—";
  if (budget.stat === "value") return `${measure.value}`;
  return `${measure.p50} / ${measure.p95} / ${measure.max} (n ${measure.n})`;
}

function git(...args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

function main() {
  const args = process.argv.slice(2);
  const value = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const power = value("--power");
  if (!power) throw new Error('state the power mode and load, e.g. --power "plugged in, best performance; nothing else running"');
  const out = resolve(value("--out") ?? join(REPO, "docs", "evidence"));
  // A clean checkout of the exact commit: nothing modified or untracked (ignored files aside).
  const dirty = git("status", "--porcelain");
  if (dirty !== "") throw new Error(`the checkout is not clean:\n${dirty}`);
  const commit = git("rev-parse", "HEAD");
  const tree = git("rev-parse", "HEAD^{tree}");
  const machine = machineDescription();
  const scratch = mkdtempSync(join(tmpdir(), "ninerr-gate13-"));
  const runs = [];
  try {
    for (let index = 1; index <= 5; index += 1) {
      const file = join(scratch, `run-${index}.json`);
      // CI=true makes a missing browser fail the run rather than skip it; record mode decides
      // before the test's CI branch, so the figures are recorded, not reported as information.
      const env = { ...process.env, NINERR_GATE13_RECORD: file, CI: "true" };
      const started = Date.now();
      const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "tests/editor-performance.test.mjs"], { cwd: REPO, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      let recorded;
      try {
        recorded = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        recorded = undefined;
      }
      // A run that failed keeps whatever it measured, and says why it failed.
      const failed = result.status !== 0 || recorded === undefined;
      runs.push({
        index,
        status: result.status,
        seconds: Math.round((Date.now() - started) / 1000),
        failure: failed ? failureOf(result) : null,
        ...(failed ? { outputTail: `${result.stdout}\n${result.stderr}`.trim().split("\n").slice(-40).join("\n") } : {}),
        ...(recorded === undefined ? {} : { measures: recorded.measures, openWallMs: recorded.openWallMs, browser: recorded.browser, node: recorded.node }),
      });
      process.stdout.write(`run ${index}: ${failed ? `failed (${failureOf(result)})` : "recorded"}\n`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const browser = runs.find((run) => run.browser)?.browser ?? null;
  const judgement = judgeRuns(runs);
  const problems = referenceProblems(machine);
  const verdict = verdictOf(problems, runs, judgement);
  const record = { schema: "ninerr-gate13-reference/1", commit, tree, date: new Date().toISOString(), machine, browser, power, referenceProblems: problems, runs, judgement, verdict };
  mkdirSync(out, { recursive: true });
  // Named to the second and never overwritten: a second run is a second record.
  const base = join(out, `GATE13_REFERENCE_${record.date.slice(0, 19).replace(/[-:]/gu, "")}_${commit.slice(0, 7)}`);
  writeFileSync(`${base}.json`, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  writeFileSync(`${base}.md`, renderMarkdown(record), { flag: "wx" });
  process.stdout.write(`${verdict}\nwrote ${base}.json and .md\n`);
  return verdict.startsWith("pass") ? 0 : 1;
}

/** The first assertion error a failed TAP run reports, reading past a YAML block marker. */
export function failureOf(result) {
  const lines = String(result.stdout ?? "").split("\n");
  const at = lines.findIndex((line) => /^\s*error: /u.test(line));
  if (at < 0) return result.status === 0 ? "the run recorded nothing" : `exit ${result.status}`;
  const value = lines[at].replace(/^\s*error: /u, "").trim();
  return /^[|>]-?$/u.test(value) ? (lines[at + 1] ?? "").trim() : value;
}

/** Each budget judged: by the protocol when all five runs measured, otherwise as far as they did. */
export function judgeRuns(runs) {
  if (runs.every((run) => run.measures !== undefined)) return judgeReference(runs.map((run) => run.measures));
  const measured = runs.filter((run) => run.measures !== undefined);
  return GATE13_BUDGETS.map((budget) => ({
    key: budget.key,
    label: budget.label,
    stat: budget.stat,
    budget: budget.budget,
    values: measured.map((run) => heldValue(run.measures, budget)),
    held: measured.filter((run) => heldValue(run.measures, budget) <= budget.budget).length,
    median: "—",
    pass: false,
  }));
}

/** The record's verdict: not judged off the reference machine; failed by any failed run. */
export function verdictOf(problems, runs, judgement) {
  if (problems.length > 0) return "no verdict: not the reference machine";
  const failedRuns = runs.filter((run) => run.failure !== null);
  if (failedRuns.length > 0) return `fail: run(s) ${failedRuns.map((run) => run.index).join(", ")} failed`;
  const over = judgement.filter((item) => !item.pass);
  if (over.length > 0) return `fail: ${over.map((item) => item.label).join(", ")}`;
  return "pass: every budget holds";
}

// Run only as a script; the tests import its functions. Paths compared through realpath, as a
// drive letter may differ in case on Windows.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main();
