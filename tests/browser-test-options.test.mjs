import test from "node:test";
import assert from "node:assert/strict";

import { browserTestOptions, findBrowser } from "./support/browser.mjs";

// #305: a Windows CI job hung for 36 minutes inside a browser test and was cancelled at its
// time limit, with no test named. Browser tests now carry a timeout, so a hang fails that one
// test, by its name.
test("browser tests carry a timeout, so a hang fails by name", () => {
  const options = browserTestOptions();
  if (findBrowser() === null && process.env.CI !== "true") {
    assert.match(options.skip, /no Chromium/u);
    return;
  }
  assert.deepEqual(options, { timeout: 600_000 });
  assert.deepEqual(browserTestOptions({ timeout: 5_000 }), { timeout: 5_000 });
});

// #306: a host request that fails before any answer names itself and its cause.
test("a host request that gets no answer says which request and why", async () => {
  const { createServer } = await import("node:net");
  const { client } = await import("./support/host-api.mjs");
  // A port that was just free: nothing listens there.
  const port = await new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port: free } = server.address();
      server.close(() => resolve(free));
    });
  });
  await assert.rejects(client(`http://127.0.0.1:${port}`, "t")("GET", "/api/session"), (error) => {
    assert.match(error.message, /^GET \/api\/session failed before an answer: ECONNREFUSED/u);
    assert.ok(error.cause instanceof Error);
    return true;
  });
});
