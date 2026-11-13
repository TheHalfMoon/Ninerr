import test from "node:test";
import assert from "node:assert/strict";

import { positiveIntegerFromEnv } from "./support/prng.mjs";
import { platform, soak } from "./support/soak.mjs";

// P08-G5 (#230, founder section P08.5): a soak at CI size. The session in
// tests/support/soak.mjs keeps its size steady, so its latency, its heap after a full
// collection and its open resources should hold steady too; once it closes, it must leave
// nothing running and nothing on disk but the project's own files; and the same seed must
// end in the same document. The long run is `node tests/support/soak.mjs`, recorded in
// docs/evidence/P08_G5_SOAK_2026-10-10.md. NINERR_SOAK_ROUNDS sets the rounds here.

const ROUNDS = positiveIntegerFromEnv("NINERR_SOAK_ROUNDS", 600);
const SEED = 230_005;
const PROJECT_FILE = /^(?:\.ninerr-agents\.json|\.ninerr-codebases\.json|soak\/|soak\/\.ninerr\/(?:|journal\.log|project\.json|snapshot\.json|objects\/|objects\/[0-9a-f]{2}\/(?:[0-9a-f]{62})?))$/u;

/**
 * The edit latency a run ends at, for the drift check: the smaller of its last two windows. Real
 * drift raises both; one slow window on a shared runner raises one (#351: 9.5, 13.6, 60.3, 10.2,
 * 11.2 and 57.2 ms, two isolated spikes, failed a check that read the last window alone).
 */
function endingEditMs(windows) {
  return windows.length >= 3 ? Math.min(windows.at(-1).editMs, windows.at(-2).editMs) : windows.at(-1).editMs;
}

test("the drift check reads a run's ending past one slow window, and still sees steady growth", () => {
  const run = (...editMs) => editMs.map((value) => ({ editMs: value }));
  assert.equal(endingEditMs(run(9.5, 13.6, 60.3, 10.2, 11.2, 57.2)), 11.2, "#351's run: its last window was a spike");
  assert.equal(endingEditMs(run(9.5, 13.6, 20, 30, 45, 60)), 45, "growth shows in both last windows");
  assert.equal(endingEditMs(run(9.5, 13.6)), 13.6, "two windows: the last");
});

test("a long session holds steady, leaves nothing behind, and ends the same from the same seed", { timeout: 900_000 }, async (t) => {
  assert.ok(ROUNDS >= 200, "NINERR_SOAK_ROUNDS must be at least 200: the first window is a warm-up, compared with none");
  const first = await soak({ rounds: ROUNDS, seed: SEED, window: 100 });
  t.diagnostic(`${platform()}, ${ROUNDS} rounds: ${JSON.stringify(first.tally)}`);
  for (const window of first.windows) t.diagnostic(JSON.stringify(window));

  // The first window warms up (modules load, caches fill); later windows are compared with the
  // second. At CI size these are tripwires for a gross regression, not measures of slow drift:
  // the long run in the evidence is what shows that.
  const [, early] = first.windows;
  const late = first.windows.at(-1);
  const ending = endingEditMs(first.windows);
  assert.ok(ending <= Math.max(2 * early.editMs, early.editMs + 25), `edit latency drifted: ${early.editMs} ms to ${ending} ms (the smaller of the last two windows)`);
  assert.ok(late.heapMiB <= early.heapMiB + 16, `the heap after a full collection grew: ${early.heapMiB} MiB to ${late.heapMiB} MiB`);
  assert.ok(late.resources <= early.resources, `open resources grew: ${early.resources} to ${late.resources}`);

  assert.ok(first.streamed > 0, "the editor's event stream carried the session's changes");
  // Closed, the hosts leave nothing running, and on disk only the project's own files.
  assert.deepEqual(first.left.resourcesAfter, first.left.resourcesBefore, "what is running after every host closed");
  for (const path of first.left.projectFiles) assert.match(path, PROJECT_FILE, "nothing but the project's own files");
  assert.deepEqual(first.left.codeFiles, ["Notice.jsx"], "write-back leaves no temporary file in the codebase");

  // The same seed again: the same actions, the same outcomes, the same document.
  const second = await soak({ rounds: ROUNDS, seed: SEED, window: 100 });
  assert.deepEqual(second.tally, first.tally, "the same actions and outcomes");
  assert.deepEqual(second.document, first.document, "the same document");
  const disk = (run) => run.windows.map(({ round, layers, journalKiB, objectsKiB }) => ({ round, layers, journalKiB, objectsKiB }));
  assert.deepEqual(disk(second), disk(first), "the same layers, journal and objects at every window");
});
