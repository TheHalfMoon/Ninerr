import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { browserTestOptions } from "./support/browser.mjs";

// #305: a browser test that hung on a CI runner held the job until its 40-minute limit. Since
// #307 a hung browser test fails by its name after its timeout, but node:test abandons its
// body, so a `finally` in it never runs: what it opened (a browser, a host) held the run.
// What launchBrowser and startTestHost open is now closed after its test however it ends.

const REPO = fileURLToPath(new URL("../", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/hung-test/hung.fixture.mjs", import.meta.url));
const LIMIT_MS = 90_000;

test("a test that hangs fails by its name, what it opened is closed, and the run ends", browserTestOptions(), async () => {
  // Run as a script: node:test refuses to start a run from inside another one.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const started = Date.now();
  const child = spawn(process.execPath, ["--test-reporter=tap", FIXTURE], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const held = setTimeout(() => child.kill("SIGKILL"), LIMIT_MS);
  const [code, signal] = await new Promise((resolve) => child.on("close", (...result) => resolve(result)));
  clearTimeout(held);
  const elapsed = Date.now() - started;
  assert.equal(signal, null, `the run was held until killed after ${elapsed} ms:\n${output.slice(-2000)}`);
  assert.equal(code, 1, output.slice(-2000));
  assert.match(output, /^not ok 1 - hangs with a host and a browser open$/mu);
  assert.match(output, /test timed out after 10000ms/u);
  assert.match(output, /^ok 2 - a later test still runs$/mu);
  assert.doesNotMatch(output, /did not close/u);
});
