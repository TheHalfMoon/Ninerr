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
