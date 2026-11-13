#!/usr/bin/env node
// Generated component records (packages/component-sources/src/<source>-records.mjs) are data
// generated from a pinned upstream source and committed. Each must be nothing but data (comment
// lines, then `export default <JSON>;`), have a components list, and have the sha256 the license
// register pins, so no code can hide in one and none can change without its pin changing. Run by
// `npm run check` (CI's Foundation checks); prints one line per file it checked.
//
//   node scripts/check-generated-records.mjs [repository root]
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] ?? fileURLToPath(new URL("../", import.meta.url)));
const paths = execFileSync("git", ["-C", root, "ls-files", "-z", "--", "packages/component-sources/src/*-records.mjs"], { encoding: "utf8" }).split("\0").filter(Boolean);
const register = JSON.parse(readFileSync(join(root, "docs/provenance/LICENSE_REGISTER.json"), "utf8"));
const pinned = new Map(register.entries.flatMap((entry) => Object.entries(entry.vendored ?? {})));
const problems = [];
for (const path of paths) {
  const bytes = readFileSync(join(root, path));
  const sha = createHash("sha256").update(bytes).digest("hex");
  const match = /^(?:\/\/[^\n]*\n)*export default (\{[\s\S]*\});\n$/u.exec(bytes.toString("utf8"));
  let data = null;
  try {
    data = match === null ? null : JSON.parse(match[1]);
  } catch {
    data = null;
  }
  if (pinned.get(path) !== sha) problems.push(`${path}: its sha256 ${sha} is not the one the license register pins`);
  else if (data === null) problems.push(`${path}: not comment lines then export default <JSON>;`);
  else if (!Array.isArray(data.components)) problems.push(`${path}: has no components list`);
  else console.log(`${path} bytes=${bytes.length} sha256=${sha} source=${data.source} commit=${data.commit} components=${data.components.length}`);
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
