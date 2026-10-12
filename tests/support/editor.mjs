import { findBrowser, launchBrowser, step, watchRequests } from "./browser.mjs";

// Open the Ninerr editor of a running studio host in Chromium, as a person would from its
// launch link. Every request outside the host's origin is aborted and recorded, and page
// errors are collected, so a test can assert the editor stayed local and clean.
export async function openEditor(host, { beforeOpen } = {}) {
  const browser = await launchBrowser({ executablePath: findBrowser(), headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const foreign = [];
  const errors = [];
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(`${host.url}/`)) return route.continue();
    foreign.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  const pending = watchRequests(page);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // A test may route the page first, for example to hold back the change stream.
  if (beforeOpen !== undefined) await beforeOpen(page);
  await step("opening the editor", pending, () => page.goto(host.launchUrl()));
  await editorReady(page, pending);
  return { browser, page, pending, foreign, errors, close: () => browser.close() };
}

/**
 * What the editor shows, for a step that timed out: its status line and any open dialog. The
 * editor stops short of ready, saying why there, when its link is refused or its first load
 * fails (#300).
 */
export const editorShows = (page) => page.evaluate(() => {
  const status = document.getElementById("status")?.textContent.trim() || "nothing";
  const dialog = document.querySelector("dialog[open] h2")?.textContent.trim();
  const revision = document.getElementById("revision")?.textContent.trim();
  return [`status ${JSON.stringify(status)}`, ...(dialog === undefined ? [] : [`dialog ${JSON.stringify(dialog)}`]), ...(revision === undefined ? [] : [`revision ${JSON.stringify(revision)}`])].join(", ");
});

/** Wait for the editor to say it is ready; `pending` (watchRequests) names what still loads. */
export const editorReady = (page, pending, { timeout } = {}) => step("the editor becoming ready", pending, () => page.waitForFunction(() => document.documentElement.dataset.ready === "true", null, { timeout }), { describe: () => editorShows(page) });

/** Reload the editor and wait until it is ready again. */
export async function reloadEditor(page, pending) {
  await step("reloading the editor", pending, () => page.reload());
  await editorReady(page, pending);
}

export const waitRevision = (page, revision) => step(`waiting for revision ${revision}`, null, () => page.waitForFunction((r) => document.getElementById("revision").textContent === `Revision ${r}`, revision), { describe: () => editorShows(page) });
export const layerCount = (page) => page.locator("#layers [role=treeitem]").count();
export const rendered = (page, id, read) => page.evaluate(({ nodeId, property }) => {
  const element = document.querySelector("iframe").contentDocument.querySelector(`[data-ninerr-id="${nodeId}"]`);
  if (element === null) return null;
  return property === "text" ? element.textContent : property === "tag" ? element.localName : element.style.getPropertyValue(property);
}, { nodeId: id, property: read });
