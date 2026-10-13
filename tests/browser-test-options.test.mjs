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
  // A port that was just free: nothing listens there. Not one fetch refuses to use at all (the
  // Fetch standard's bad ports, such as 6000), which fails before any connection with "bad
  // port": the system hands those out too, now and then.
  const { BROWSER_BLOCKED_PORTS } = await import("../packages/studio-host/src/index.ts");
  let port;
  do {
    port = await new Promise((resolve) => {
      const server = createServer().listen(0, "127.0.0.1", () => {
        const { port: free } = server.address();
        server.close(() => resolve(free));
      });
    });
  } while (BROWSER_BLOCKED_PORTS.has(port));
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
  // An editor that stops short of ready says why on its page, and the timeout repeats it.
  const { editorReady } = await import("./support/editor.mjs");
  await page.setContent('<span id="status">Ninerr could not start: refused</span><dialog open><h2>This Ninerr session has ended</h2></dialog>', { waitUntil: "domcontentloaded" });
  const stopped = await editorReady(page, pending, { timeout: 500 }).then(() => null, (error) => error);
  assert.match(stopped?.message ?? "", /^the editor becoming ready timed out; still loading: .*; the page showed: status "Ninerr could not start: refused", dialog "This Ninerr session has ended", page \/page (?:loading|interactive|complete)$/u);
  await page.setContent('<p>blank</p><span id="revision">Revision 2</span>', { waitUntil: "domcontentloaded" });
  const quiet = await editorReady(page, null, { timeout: 200 }).then(() => null, (error) => error);
  assert.match(quiet?.message ?? "", /^the editor becoming ready timed out; the page showed: status "nothing", revision "Revision 2", page \/page (?:loading|interactive|complete)$/u);
  // A page that cannot say what it shows does not hold the failure back, or hide it.
  const silent = await step("waiting for the title", null, () => page.waitForFunction(() => document.title === "never", null, { timeout: 200 }), { describe: () => page.evaluate(() => new Promise(() => {})) }).then(() => null, (error) => error);
  assert.equal(silent?.message, "waiting for the title timed out; the page showed: not known (no answer in 2 s)");
  assert.equal(silent.cause?.name, "TimeoutError");
  const failing = await step("waiting for the title", null, () => page.waitForFunction(() => document.title === "never", null, { timeout: 200 }), { describe: () => { throw new Error("first line\nsecond line"); } }).then(() => null, (error) => error);
  assert.equal(failing?.message, "waiting for the title timed out; the page showed: not known (first line)");
  // A step with no watch names itself and nothing more.
  const unwatched = await step("waiting for the title", null, () => page.waitForFunction(() => document.title === "never", null, { timeout: 200 })).then(() => null, (error) => error);
  assert.equal(unwatched?.message, "waiting for the title timed out");
  // Other failures pass through as they are.
  const other = await step("a step", pending, () => Promise.reject(new TypeError("not a timeout"))).then(() => null, (error) => error);
  assert.equal(other?.message, "not a timeout");
});
