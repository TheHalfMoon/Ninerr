import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The Jev exact-head workflow gives Jev each generated component-records file as a checked
// summary, not its text (it is past what Jev can read), and only when the file is data and its
// sha256 is the one the license register pins. This runs the workflow's own check.

const WORKFLOW = readFileSync(new URL("../.github/workflows/jev-exact-head.yml", import.meta.url), "utf8");
const step = WORKFLOW.slice(WORKFLOW.indexOf("- name: Check generated component records"), WORKFLOW.indexOf("- name: Build exact-head qualification state"));
const script = /node -e '\n([\s\S]*?)\n {10}'\n/u.exec(step)?.[1];
const PATH = "packages/component-sources/src/x-records.mjs";

function check(content, pinned) {
  const root = mkdtempSync(join(tmpdir(), "ninerr-jev-check-"));
  try {
    mkdirSync(join(root, "packages/component-sources/src"), { recursive: true });
    mkdirSync(join(root, "docs/provenance"), { recursive: true });
    writeFileSync(join(root, PATH), content);
    const sha = createHash("sha256").update(content).digest("hex");
    writeFileSync(join(root, "docs/provenance/LICENSE_REGISTER.json"), JSON.stringify({ entries: [{ id: "x", vendored: { [PATH]: pinned ?? sha } }] }));
    try {
      execFileSync(process.execPath, ["-e", script], { cwd: root, input: `${PATH}\0`, stdio: ["pipe", "pipe", "pipe"] });
      return { ok: true, summary: readFileSync(join(root, "jev-generated-data.txt"), "utf8") };
    } catch (error) {
      return { ok: false, message: String(error.stderr) };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const DATA = `// Generated.\n// Do not edit by hand.\nexport default {"source":"x","repository":"https://example.com/x","commit":"abc","generatedBy":"g.mjs","components":[{"id":"x:A"}]};\n`;

test("a generated records file that is data and pinned is summarised for Jev", () => {
  assert.ok(script, "the workflow has the check");
  const result = check(DATA);
  assert.equal(result.ok, true, result.message);
  assert.match(result.summary, new RegExp(`^${PATH} bytes=${Buffer.byteLength(DATA)} sha256=[0-9a-f]{64} source=x repository=https://example.com/x commit=abc generatedBy=g.mjs components=1\\n$`, "u"));
});

test("an unpinned file, code beside the data, or no components list fails the job", () => {
  assert.match(check(DATA, "0".repeat(64)).message, /is not the one the license register pins/u);
  assert.match(check(`${DATA}globalThis.x = 1;\n`).message, /not comment lines then export default <JSON>;/u);
  assert.match(check(DATA.replace("export default {", "export default (() => 1)() || {")).message, /not comment lines then export default <JSON>;|JSON/u);
  assert.match(check(`export default {"source":"x"};\n`).message, /has no components list/u);
});

test("only those files are left out of the diff, and Jev is told what was checked", () => {
  assert.match(WORKFLOW, /":\(exclude\).claude\/skills\/\*\*" ":\(exclude,glob\)packages\/component-sources\/src\/\*-records\.mjs" > jev-authored\.diff/u);
  assert.match(WORKFLOW, /echo "GENERATED_DATA \(checked: data only, sha256 pinned by docs\/provenance\/LICENSE_REGISTER\.json\)"\n {12}cat jev-generated-data\.txt/u);
  assert.match(WORKFLOW, /jev-generated-data\.txt\n {12}jev-authored\.diff/u, "the summary is kept with the evidence");
  assert.ok(WORKFLOW.indexOf("Check generated component records") < WORKFLOW.indexOf("Build exact-head qualification state"), "checked before the candidate is built");
});
