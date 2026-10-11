// Run by tests/test-cleanup.test.mjs under node --test: a browser test that hangs, with its
// cleanup only in a `finally` that never runs. Not a test of its own (not *.test.mjs).
import test from "node:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findBrowser, launchBrowser } from "../../support/browser.mjs";
import { startTestHost } from "../../support/cleanup.mjs";

test("hangs with a host and a browser open", { timeout: 3_000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-hung-")));
  const host = await startTestHost({ projectsRoot: root });
  const browser = await launchBrowser({ executablePath: findBrowser(), headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(host.url);
    await new Promise(() => {});
  } finally {
    await browser.close();
    await host.close();
  }
});

test("a later test still runs", () => {});
