#!/usr/bin/env node
// P08-G11: fetch the dogfooding projects at their pinned commits.
//
//   node scripts/dogfood/fetch.mjs <folder>
//
// Each project in scripts/dogfood/projects.json is fetched into <folder>/<name> at exactly
// its commit, with one-commit history, no tags and Git hooks disabled. Nothing in it is
// built, installed or run: Ninerr only reads its files. A folder already at the commit is
// left as it is.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const target = process.argv[2];
if (typeof target !== "string" || target === "") {
  process.stderr.write("usage: node scripts/dogfood/fetch.mjs <folder>\n");
  process.exit(2);
}
const { projects } = JSON.parse(readFileSync(new URL("./projects.json", import.meta.url), "utf8"));
// Hooks off and no credential helper: a public clone needs neither.
const git = (cwd, ...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "credential.helper=", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
mkdirSync(target, { recursive: true });
for (const project of projects) {
  const folder = join(target, project.name);
  if (existsSync(join(folder, ".git"))) {
    const head = git(folder, "rev-parse", "HEAD");
    if (head === project.commit) {
      process.stdout.write(`${project.name}: already at ${head}\n`);
      continue;
    }
    throw new Error(`${folder} is at ${head}, not ${project.commit}; remove it to fetch again`);
  }
  mkdirSync(folder, { recursive: true });
  git(folder, "init", "-q");
  git(folder, "fetch", "-q", "--depth", "1", "--no-tags", `${project.repository}.git`, project.commit);
  git(folder, "checkout", "-q", "--detach", "FETCH_HEAD");
  const head = git(folder, "rev-parse", "HEAD");
  if (head !== project.commit) throw new Error(`${project.name}: fetched ${head}, expected ${project.commit}`);
  if (!existsSync(join(folder, project.licenseFile))) throw new Error(`${project.name}: ${project.licenseFile} is missing`);
  process.stdout.write(`${project.name}: ${head}\n`);
}
