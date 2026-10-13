import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hostPool, ok } from "./support/host-api.mjs";

// #306: the tests run the host in their own process, and some (the store fuzz) do seconds of
// synchronous file work between requests. Past the host's 5 s keep-alive, Node 22's fetch
// reused the connection the host had just closed, and the next request was reset
// (ECONNRESET). The test client opens a connection per request instead.
test("a host request after more than the keep-alive of synchronous work is answered (#306)", { timeout: 60_000 }, async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-keepalive-")));
  let clock = 0;
  const pool = hostPool(() => new Date(Date.UTC(2026, 9, 14, 12) + clock++ * 1000).toISOString());
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const { call } = await pool.open(root);
  const block = (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // the event loop cannot see the host close the idle connection meanwhile
    }
  };
  // It failed on the second pause every time it failed (6 of 6 runs on Node 22), so two suffice.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await ok(call("GET", "/api/session"), `before the pause, attempt ${attempt}`);
    block(6_000);
    await ok(call("GET", "/api/session"), `after the pause, attempt ${attempt}`);
  }
});
