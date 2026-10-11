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
// Hooks off, no credential helper, no prompt, and no symbolic links checked out (a link could
// lead a later write out of the copy): a public clone needs none of them.
const git = (cwd, ...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "credential.helper=", "-c", "core.askPass=", "-c", "core.symlinks=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
// Two sentences of each declared license's text, which a similar license (MIT-0, BSL-1.0) lacks.
const LICENSE_TEXT = { MIT: [/Permission is hereby granted, free of charge, to any person obtaining a copy/u, /The above copyright notice and this permission notice shall be included/u] };
/** The project's license file is there and carries its declared license's text. */
function checkLicense(project, folder) {
  const file = join(folder, project.licenseFile);
  if (!existsSync(file)) throw new Error(`${project.name}: ${project.licenseFile} is missing`);
  const expected = LICENSE_TEXT[project.license];
  const text = readFileSync(file, "utf8").replace(/\s+/gu, " ");
  if (expected === undefined || !expected.every((sentence) => sentence.test(text))) throw new Error(`${project.name}: ${project.licenseFile} is not the ${project.license} license text`);
}
mkdirSync(target, { recursive: true });
for (const project of projects) {
  const folder = join(target, project.name);
  if (existsSync(join(folder, ".git"))) {
    const head = git(folder, "rev-parse", "HEAD");
    if (head === project.commit) {
      checkLicense(project, folder);
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
  checkLicense(project, folder);
  process.stdout.write(`${project.name}: ${head}\n`);
}
