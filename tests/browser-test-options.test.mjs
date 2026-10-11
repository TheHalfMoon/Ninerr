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

// #300: a page load that times out said only "Timeout 30000ms exceeded". It now names its
// step and what was still loading, by path only: a query can hold a launch ticket.
test("a load that times out names its step and what was still loading", browserTestOptions(), async (t) => {
  const { createServer } = await import("node:http");
  const { closeServerAfterTest } = await import("./support/cleanup.mjs");
  const { findBrowser, launchBrowser, step, watchRequests } = await import("./support/browser.mjs");
  const server = createServer((request, response) => {
    if (request.url.startsWith("/page")) response.end('<!doctype html><img src="/never?ticket=secret">');
    // /never is left unanswered.
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  closeServerAfterTest(server);
  const browser = await launchBrowser({ executablePath: findBrowser(), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const pending = watchRequests(page);
  const failure = await step("opening the page", pending, () => page.goto(`http://127.0.0.1:${server.address().port}/page?ticket=secret`, { timeout: 5_000 })).then(() => null, (error) => error);
  assert.match(failure?.message ?? "", /^opening the page timed out; still loading: GET \/never \(image, \d+ s\)$/u);
  assert.doesNotMatch(failure.message, /secret/u);
  assert.equal(failure.cause?.name, "TimeoutError");
  // A step with no watch names itself and nothing more.
  const unwatched = await step("waiting for the title", null, () => page.waitForFunction(() => document.title === "never", null, { timeout: 200 })).then(() => null, (error) => error);
  assert.equal(unwatched?.message, "waiting for the title timed out");
  // Other failures pass through as they are.
  const other = await step("a step", pending, () => Promise.reject(new TypeError("not a timeout"))).then(() => null, (error) => error);
  assert.equal(other?.message, "not a timeout");
});
