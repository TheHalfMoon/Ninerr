import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = new URL("../bin/ninerr.mjs", import.meta.url);

function withFakeEngine(behavior, run) {
  const root = mkdtempSync(join(tmpdir(), "ninerr-doctor-failure-"));
  try {
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "package.json"), '{"version":"0.1.0","type":"module"}');
    const source = readFileSync(CLI, "utf8").replace(
      '../packages/studio-host/src/index.ts', '../fake-engine.mjs',
    );
    writeFileSync(join(root, "bin", "ninerr.mjs"), source);
    writeFileSync(join(root, "fake-engine.mjs"), `
      import { mkdirSync } from "node:fs";
      export function resolveProjectsFolder(path) { return { path: path || process.cwd(), note: null }; }
      export function prepareProjectsFolder(path) { mkdirSync(path, { recursive: true }); return { note: null }; }
      export async function runHeadless({ input, output }) {
        ${behavior}
      }
    `);
    run(join(root, "bin", "ninerr.mjs"), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("doctor reports malformed MCP JSON as a failed check instead of crashing", () => {
  withFakeEngine('output.write("not json\\n"); await new Promise((resolve) => input.on("close", resolve));', (cli, root) => {
    const result = spawnSync(process.execPath, [cli, "doctor", "--projects", root], {
      encoding: "utf8", timeout: 5_000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /FAIL the engine creates a project/);
    assert.match(result.stdout, /invalid JSON/);
  });
});

test("doctor exits with a failed check if MCP initialize never answers", { timeout: 20_000 }, () => {
  withFakeEngine('await new Promise((resolve) => input.on("close", resolve));', (cli, root) => {
    const result = spawnSync(process.execPath, [cli, "doctor", "--projects", root], {
      encoding: "utf8", timeout: 15_000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /MCP initialize timed out/);
  });
});
