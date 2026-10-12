// Launch a local Chromium through playwright-core for browser end-to-end tests (PC phase).
// The executable comes from NINERR_TEST_BROWSER, a system Chrome or Chromium, or the
// Playwright browser cache. Locally a missing browser skips the test; in CI (CI=true) it fails.
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { closeAfterTest } from "./cleanup.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const TEST_ORIGIN = "http://ninerr.test";

export function findBrowser() {
  // The Chromium build matched to playwright-core comes first; a system Chrome is the fallback.
  const candidates = [process.env.NINERR_TEST_BROWSER];
  for (const cache of [process.env.PLAYWRIGHT_BROWSERS_PATH, "/opt/pw-browsers", join(homedir(), ".cache", "ms-playwright")]) {
    if (typeof cache !== "string" || !existsSync(cache)) continue;
    const builds = readdirSync(cache).filter((entry) => /^chromium-\d+$/u.test(entry)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
    for (const name of builds) candidates.push(join(cache, name, "chrome-linux", "chrome"));
  }
  candidates.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser");
  // Where Windows and macOS keep Chrome and Edge (P08-G7): what their CI runners have.
  for (const programs of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"]]) {
    if (typeof programs !== "string") continue;
    candidates.push(join(programs, "Google", "Chrome", "Application", "chrome.exe"), join(programs, "Microsoft", "Edge", "Application", "msedge.exe"));
  }
  candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
  return candidates.find((path) => typeof path === "string" && path !== "" && existsSync(path)) ?? null;
}

/**
 * Options for node:test: skip locally when no browser exists; never skip in CI. A browser test
 * that waits without end fails, by its name, after `timeout` (10 minutes by default; the
 * slowest takes about a minute in CI), so the log names it (#305). What it opened is closed
 * after it however it ends, when opened with launchBrowser or startTestHost (cleanup.mjs).
 * (--test-force-exit would end the run instead, but on Windows it crashes Node with a libuv
 * assertion while handles are closing.)
 */
export function browserTestOptions({ timeout = 600_000 } = {}) {
  const found = findBrowser();
  if (found === null && process.env.CI !== "true") return { skip: "no Chromium found (set NINERR_TEST_BROWSER)" };
  return { timeout };
}

/** chromium.launch, the browser closed after the current test (closeAfterTest). */
export async function launchBrowser(options) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch(options);
  browser.close = closeAfterTest(browser.close.bind(browser), "a browser");
  return browser;
}

/**
 * The requests `page` has started and not finished, as a function that lists them: method,
 * path (never the query, which can hold a launch ticket), kind and age. A load that times out
 * can then say what it was still waiting on (#300).
 */
export function watchRequests(page) {
  const open = new Map();
  page.on("request", (request) => open.set(request, Date.now()));
  for (const event of ["requestfinished", "requestfailed"]) page.on(event, (request) => open.delete(request));
  return () => [...open].map(([request, at]) => `${request.method()} ${new URL(request.url()).pathname} (${request.resourceType()}, ${Math.round((Date.now() - at) / 1000)} s)`);
}

/**
 * Run one step of a browser test (a load, a reload, a wait); if it times out, fail with the
 * step's name, given `pending` (watchRequests) what was still loading, and given `describe`
 * what the page showed then (#300).
 */
export async function step(what, pending, action, { describe } = {}) {
  try {
    return await action();
  } catch (error) {
    if (error?.name !== "TimeoutError") throw error;
    // Without a watch, what was loading is not known, and is not said.
    const open = pending?.() ?? null;
    const loading = open === null ? "" : `; still loading: ${open.length === 0 ? "nothing" : open.join(", ")}`;
    // What the page showed, if it can still say within a moment: it is a clue, not a step.
    const shown = describe === undefined ? null : await Promise.race([describe().catch((failure) => `not known (${failure?.message ?? failure})`), new Promise((resolve) => setTimeout(resolve, 2_000, "not known (no answer in 2 s)"))]);
    throw new Error(`${what} timed out${loading}${shown === null ? "" : `; the page showed: ${shown}`}`, { cause: error });
  }
}

const TYPES = { ".mjs": "text/javascript", ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json" };

/**
 * Launch Chromium with every request answered from the repository under TEST_ORIGIN (or by
 * `extraRoutes`), and every other request aborted, so tests never touch the network.
 */
export async function launchPage({ extraRoutes = {} } = {}) {
  const executablePath = findBrowser();
  if (executablePath === null) throw new Error("no Chromium found for the browser test (set NINERR_TEST_BROWSER)");
  const browser = await launchBrowser({ executablePath, headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext();
  const requests = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    if (url.origin !== TEST_ORIGIN) return route.abort();
    if (Object.hasOwn(extraRoutes, url.pathname)) return route.fulfill(extraRoutes[url.pathname]);
    // Confinement is checked on the decoded, normalized path: only package sources are served.
    const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!/^packages\/[a-z-]+\/src\/[^]+$/u.test(relative(ROOT, path).split("\\").join("/"))) return route.fulfill({ status: 404, body: "" });
    try {
      return route.fulfill({ status: 200, contentType: TYPES[extname(path)] ?? "application/octet-stream", body: await readFile(path) });
    } catch {
      return route.fulfill({ status: 404, body: "" });
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { browser, page, requests, errors, close: () => browser.close() };
}
