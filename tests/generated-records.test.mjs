import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// scripts/check-generated-records.mjs, which `npm run check` runs: a generated component-records
// file is data only, has a components list, and has the sha256 the license register pins.

const SCRIPT = fileURLToPath(new URL("../scripts/check-generated-records.mjs", import.meta.url));
const PATH = "packages/component-sources/src/x-records.mjs";
const DATA = `// Generated.\n// Do not edit by hand.\nexport default {"source":"x","commit":"abc","components":[{"id":"x:A"}]};\n`;

function check(content, pinned) {
  const root = mkdtempSync(join(tmpdir(), "ninerr-records-"));
  try {
    mkdirSync(join(root, "packages/component-sources/src"), { recursive: true });
    mkdirSync(join(root, "docs/provenance"), { recursive: true });
    writeFileSync(join(root, PATH), content);
    const sha = createHash("sha256").update(content).digest("hex");
    writeFileSync(join(root, "docs/provenance/LICENSE_REGISTER.json"), JSON.stringify({ entries: [{ id: "x", vendored: { [PATH]: pinned ?? sha } }] }));
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "-A"], { cwd: root });
    const run = spawnSync(process.execPath, [SCRIPT, root], { encoding: "utf8" });
    return { status: run.status, out: run.stdout, err: run.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a generated records file that is data and pinned passes, with a line saying what was checked", () => {
  const result = check(DATA);
  assert.equal(result.status, 0, result.err);
  assert.match(result.out, new RegExp(`^${PATH} bytes=${Buffer.byteLength(DATA)} sha256=[0-9a-f]{64} source=x commit=abc components=1\\n$`, "u"));
});

test("an unpinned file, code beside the data, a default export that is not JSON, or no components list fails", () => {
  assert.match(check(DATA, "0".repeat(64)).err, /is not the one the license register pins/u);
  assert.match(check(`${DATA}globalThis.x = 1;\n`).err, /not comment lines then export default <JSON>;/u);
  assert.match(check(DATA.replace("export default {", "export default (() => 1)() || {")).err, /not comment lines then export default <JSON>;/u);
  assert.match(check(`export default {"source":"x"};\n`).err, /has no components list/u);
  for (const bad of [DATA, `${DATA}x`]) assert.equal(check(bad, bad === DATA ? "0".repeat(64) : undefined).status, 1);
});

test("the repository's own records pass, and npm run check runs the check", () => {
  const run = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^packages\/component-sources\/src\/astryx-records\.mjs bytes=\d+ sha256=[0-9a-f]{64} source=astryx commit=2309691dba9533635259113316a2cb14ec832933 components=\d+$/mu);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.check, /node scripts\/check-generated-records\.mjs && node --test/u);
});
