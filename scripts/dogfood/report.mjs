#!/usr/bin/env node
// P08-G11 (#230): the dogfooding results as Markdown tables, written from the result files
// scripts/dogfood/run.mjs leaves, so that no figure in the evidence is copied by hand.
//
//   node scripts/dogfood/report.mjs <work folder>
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [work] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(new URL("./projects.json", import.meta.url), "utf8"));
if (!work) {
  process.stderr.write("usage: node scripts/dogfood/report.mjs <work folder>\n");
  process.exit(2);
}
const results = manifest.projects.map((project) => {
  const path = join(work, project.name, "result.json");
  return { project, result: existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null };
});
const JOURNEYS = ["A", "B", "C", "D", "E", "F"];
const out = [];
const line = (text = "") => out.push(text);
const cell = (text) => String(text).replace(/\|/gu, "\\|").replace(/\n/gu, " ");

// Each journey: its status, and its checks passed out of those that apply.
line("| Project | Ninerr commit | " + JOURNEYS.join(" | ") + " | Findings |");
line("|---|---|" + JOURNEYS.map(() => "---").join("|") + "|---:|");
for (const { project, result } of results) {
  if (result === null) {
    line(`| ${project.name} | not run |${JOURNEYS.map(() => " ").join("|")}| |`);
    continue;
  }
  const cells = JOURNEYS.map((key) => {
    const journey = result.journeys[key];
    if (journey === undefined) return "not run";
    const applied = journey.checks.filter((check) => check.unsupported === undefined);
    const passed = applied.filter((check) => check.passed).length;
    const notApplicable = journey.checks.length - applied.length;
    return `${journey.status} ${passed}/${applied.length}${notApplicable > 0 ? ` (${notApplicable} n/a)` : ""}`;
  });
  line(`| ${project.name} | \`${result.ninerr.commit.slice(0, 7)}\`${result.ninerr.dirty ? " (dirty)" : ""} | ${cells.join(" | ")} | ${result.findings.length} |`);
}
line();

// What a journey did not apply to, and why.
line("**Not applicable:**");
for (const { project, result } of results) {
  for (const [key, journey] of Object.entries(result?.journeys ?? {})) {
    for (const check of journey.checks.filter((entry) => entry.unsupported !== undefined)) line(`- ${project.name}, ${key}: ${check.what}: ${cell(check.unsupported)}`);
  }
}
line();

// Codebase scan and breadth: every component brought in through the host.
line("| Project | Source files read | Components found | Brought in | Refused | Refusal reasons |");
line("|---|---:|---:|---:|---:|---|");
for (const { project, result } of results) {
  if (!result?.scan) continue;
  const breadth = result.breadth ?? {};
  const reasons = Object.entries(breadth.reasons ?? {}).map(([reason, count]) => [reason.replace(/^\S+ (?=does not return)/u, "a component "), count]);
  const merged = new Map();
  for (const [reason, count] of reasons) merged.set(reason, (merged.get(reason) ?? 0) + count);
  line(`| ${project.name} | ${result.scan.files} | ${result.scan.components} | ${breadth.importable ?? ""} | ${breadth.refused ?? ""} | ${cell([...merged].map(([reason, count]) => `${count} × ${reason}`).join("; "))} |`);
}
line();

// Findings, as each run recorded them.
line("**Findings recorded by the runs:**");
for (const { project, result } of results) {
  for (const entry of result?.findings ?? []) line(`- ${project.name} (${entry.category}): ${cell(entry.summary)}`);
}
if (results.every(({ result }) => (result?.findings ?? []).length === 0)) line("- none");
line();

// Timings (journey G): the steps every project has, then each project's own.
const steps = [...new Set(results.flatMap(({ result }) => Object.keys(result?.timings ?? {})))];
line("| Step | " + results.filter(({ result }) => result !== null).map(({ project }) => project.name).join(" | ") + " |");
line("|---|" + results.filter(({ result }) => result !== null).map(() => "---:").join("|") + "|");
for (const step of steps) {
  const cells = results.filter(({ result }) => result !== null).map(({ result }) => {
    const timing = result.timings[step];
    if (timing === undefined) return "";
    return timing.n === 1 ? `${timing.p50} ms` : `${timing.p50} / ${timing.p95} / ${timing.max} ms (n ${timing.n})`;
  });
  line(`| ${cell(step)} | ${cells.join(" | ")} |`);
}
line();
const machines = [...new Set(results.filter(({ result }) => result !== null).map(({ result }) => `${result.machine.platform} ${result.machine.arch}, ${result.machine.cpu} (${result.machine.cores} threads), ${result.machine.memoryGiB} GiB, Node ${result.machine.node}`))];
line(`Machine: ${machines.join("; ")}. A step measured once shows its time; a repeated step shows p50 / p95 / max and its sample count.`);
process.stdout.write(`${out.join("\n")}\n`);
