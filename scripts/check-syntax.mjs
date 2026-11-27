#!/usr/bin/env node
// Syntax-checks every runtime and script module under bin/, scripts/, and packages/*/src/.
// Replaces a single long command chain in package.json so adding new modules never hits
// Windows cmd.exe's 8,191-character command-line limit or re-triggers release workflows.
// For .ts files, runs Node's built-in stripTypeScriptTypes({ mode: "strip" }) (matching
// scripts/build-engine.mjs) before syntax checking so non-erasable TS fails immediately.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

function collect(dir, pattern, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === "fixtures") continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) collect(full, pattern, out);
    else if (pattern.test(name)) out.push(full);
  }
}

const files = [];
collect(join(ROOT, "bin"), /\.(?:mjs|js|cjs)$/u, files);
collect(join(ROOT, "scripts"), /\.(?:mjs|js|cjs)$/u, files);
const packagesDir = join(ROOT, "packages");
if (existsSync(packagesDir)) {
  for (const pkg of readdirSync(packagesDir).sort()) {
    const src = join(packagesDir, pkg, "src");
    if (existsSync(src) && statSync(src).isDirectory()) {
      collect(src, /\.(?:mjs|js|cjs|ts)$/u, files);
    }
  }
}

if (files.length === 0) {
  console.error("check-syntax: no checkable files found");
  process.exit(1);
}

let checked = 0;
const failures = [];
for (const full of files) {
  const rel = relative(ROOT, full).replace(/\\/gu, "/");
  try {
    if (full.endsWith(".ts")) {
      const stripped = stripTypeScriptTypes(readFileSync(full, "utf8"), { mode: "strip" });
      execFileSync(process.execPath, ["--check", "--input-type=module"], {
        input: stripped,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } else {
      execFileSync(process.execPath, ["--check", full], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    checked += 1;
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error && error.stderr
      ? String(error.stderr)
      : (error instanceof Error ? error.message : String(error));
    failures.push(`${rel}:\n${stderr.trim()}`);
  }
}

if (failures.length > 0) {
  console.error(`check-syntax: ${failures.length} of ${files.length} files failed:\n\n${failures.join("\n\n")}`);
  process.exit(1);
}
console.log(`check-syntax: ${checked} files ok`);
