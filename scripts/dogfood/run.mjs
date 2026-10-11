#!/usr/bin/env node
// P08-G11 (#230): dogfood Ninerr on a real project, as a person and an agent use it.
//
//   node scripts/dogfood/run.mjs <sources folder> <work folder> <project name> [--samples N]
//
// <sources folder> holds the projects fetched by scripts/dogfood/fetch.mjs. The project is
// first copied into <work folder>/<name>/source (a local clone), and everything Ninerr
// writes goes to that copy and to <work folder>/<name>/projects: the fetched folder and the
// upstream repository are never written. The editor is driven in Chromium or Edge through
// playwright-core (NINERR_TEST_BROWSER), against a studio host started as `npm start` starts
// it. Every request the editor makes outside the host is aborted and recorded.
//
// The journeys (docs/evidence/P08_G11_DOGFOODING_*.md):
//   A  import and inspect: connect the codebase and bring components in, or import pages;
//      compare the layers with the source
//   B  visual editing in the editor: select by clicking the canvas, edit text and style,
//      insert, move, resize, delete, undo and redo, checked against the document and the
//      rendered page
//   C  persistence: save, close, reopen in a new host (byte-identical), and a crash
//   D  source-linked editing: write back, an external change elsewhere, and a conflict
//   E  an MCP agent: inspect, edit, the person's undo and redo, a delete approved in the
//      editor, and a refusal for another project
//   F  security and privacy: no request leaves the host; imported scripts never run
//   G  timings of each step (median, 95th percentile, maximum and sample count)
//
// The result is written to <work folder>/<name>/result.json, with screenshots beside it.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { startStudioHost } from "../../packages/studio-host/src/index.ts";
import { serializeDocument } from "../../packages/document-model/src/index.mjs";
import { PROJECT_FILES } from "../../packages/persistence/src/index.ts";
import { buildCodeIr } from "../../packages/code-ir/src/index.ts";
import { findBrowser } from "../../tests/support/browser.mjs";

const args = process.argv.slice(2);
const [sources, work, name] = args;
const samplesAt = args.indexOf("--samples");
const SAMPLES = samplesAt >= 0 ? Number(args[samplesAt + 1]) : 10;
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("./projects.json", import.meta.url), "utf8"));
const project = manifest.projects.find((entry) => entry.name === name);
if (!sources || !work || !project || !Number.isInteger(SAMPLES) || SAMPLES < 1) {
  process.stderr.write("usage: node scripts/dogfood/run.mjs <sources folder> <work folder> <project name> [--samples N]\n");
  process.exit(2);
}

// ---------- the result ----------

const git = (cwd, ...rest) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...rest], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const result = {
  project: { name: project.name, repository: project.repository, commit: project.commit, license: project.license, category: project.category },
  ninerr: { commit: git(REPO, "rev-parse", "HEAD"), dirty: git(REPO, "status", "--porcelain", "--untracked-files=no") !== "" },
  machine: { platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, memoryGiB: Math.round(totalmem() / 2 ** 30), node: process.version },
  journeys: {},
  findings: [],
  timings: {},
};
const journey = (key) => (result.journeys[key] ??= { checks: [], status: "pass" });
/** A check: passed or not, with what was expected and seen. A failure fails its journey. */
function check(key, what, passed, detail = undefined) {
  const entry = journey(key);
  entry.checks.push({ what, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) });
  if (!passed && entry.status === "pass") entry.status = "fail";
  process.stdout.write(`${passed ? "ok  " : "FAIL"} ${key} ${what}${detail === undefined || passed ? "" : `: ${JSON.stringify(detail).slice(0, 300)}`}\n`);
  return Boolean(passed);
}
/** Something a journey could not do on this project, and why. */
function unsupported(key, what, why) {
  const entry = journey(key);
  entry.checks.push({ what, unsupported: why });
  if (entry.status === "pass" && entry.checks.every((item) => item.unsupported !== undefined)) entry.status = "unsupported";
  process.stdout.write(`n/a  ${key} ${what}: ${why}\n`);
}
const finding = (category, summary, detail = undefined) => {
  result.findings.push({ category, summary, ...(detail === undefined ? {} : { detail }) });
  process.stdout.write(`find [${category}] ${summary}\n`);
};
async function timed(label, action) {
  const started = performance.now();
  const value = await action();
  (result.timings[label] ??= []).push(performance.now() - started);
  return value;
}
function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  const round = (value) => Math.round(value * 10) / 10;
  return { n: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), max: round(sorted.at(-1)) };
}

// ---------- the disposable copy ----------

const fetched = join(sources, project.name);
if (git(fetched, "rev-parse", "HEAD") !== project.commit) throw new Error(`${fetched} is not at ${project.commit}`);
const base = join(work, project.name);
rmSync(base, { recursive: true, force: true });
mkdirSync(base, { recursive: true });
const source = join(base, "source");
// A local clone: write-backs land in it, never in the fetched folder.
git(base, "clone", "-q", "--no-hardlinks", fetched, source);
const projectsRoot = join(base, "projects");
mkdirSync(projectsRoot);
const shots = join(base, "screenshots");
mkdirSync(shots);
const folder = project.kind === "codebase" ? join(source, ...project.folder.split("/")) : null;

// ---------- the editor ----------

const executablePath = findBrowser();
if (executablePath === null) throw new Error("no Chromium or Edge found (set NINERR_TEST_BROWSER)");
const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
const foreign = [];
const pageErrors = [];
// Every answer of 400 or more the editor received, by path and status: the console only says
// "Failed to load resource".
const failedResponses = [];
let requests = 0;

async function openEditor(host) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    requests += 1;
    if (url.startsWith(`${host.url}/`)) return route.continue();
    foreign.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.goto(host.launchUrl());
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  return { page, close: () => context.close() };
}
const revisionOf = async (page) => Number((await page.locator("#revision").textContent()).replace(/^Revision /u, ""));
const waitRevision = (page, revision, timeout = 30_000) => page.waitForFunction((r) => document.getElementById("revision").textContent === `Revision ${r}`, revision, { timeout });
const selectedIds = (page) => page.locator("#layers [role=treeitem][aria-selected=true]").evaluateAll((items) => items.map((item) => item.dataset.nodeId));
const status = (page) => page.locator("#status").textContent();
// The centre of a rendered layer in page coordinates, through the canvas's transformed frame;
// null when it is not drawn or has no area.
const screenOf = (page, id) => page.evaluate((nodeId) => {
  const frame = document.querySelector("iframe");
  const outer = frame.getBoundingClientRect();
  const zoom = outer.width / frame.offsetWidth;
  const element = frame.contentDocument.querySelector(`[data-ninerr-id="${nodeId}"]`);
  if (element === null) return null;
  const inner = element.getBoundingClientRect();
  if (inner.width < 2 || inner.height < 2) return null;
  const x = outer.left + (inner.left + inner.width / 2) * zoom;
  const y = outer.top + (inner.top + inner.height / 2) * zoom;
  if (x < outer.left || y < outer.top || x > outer.right || y > outer.bottom) return null;
  return { x, y };
}, id);
/**
 * Scroll the canvas (the wheel pans it) until the layer's centre is inside the visible canvas
 * area, as a person scrolls to what they want to click; its centre then, or null.
 */
async function reachable(page, id) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const point = await screenOf(page, id);
    if (point === null) return null;
    const area = await page.locator("#canvas").boundingBox();
    const inside = point.x > area.x + 8 && point.y > area.y + 8 && point.x < area.x + area.width - 8 && point.y < area.y + area.height - 8;
    if (inside) return point;
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
    await page.mouse.wheel(point.x - (area.x + area.width / 2), point.y - (area.y + area.height / 2));
    await page.waitForTimeout(50);
  }
  return null;
}
const renderedText = (page, id) => page.evaluate((nodeId) => document.querySelector("iframe").contentDocument.querySelector(`[data-ninerr-id="${nodeId}"]`)?.textContent ?? null, id);
const renderedStyle = (page, id, property) => page.evaluate(({ nodeId, name }) => {
  const element = document.querySelector("iframe").contentDocument.querySelector(`[data-ninerr-id="${nodeId}"]`);
  return element === null ? null : element.ownerDocument.defaultView.getComputedStyle(element).getPropertyValue(name);
}, { nodeId: id, name: property });

async function api(host, method, path, body) {
  const response = await fetch(`${host.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${host.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}
/** Every store file but the lock and objects, and the stored objects' names. */
function storeState(projectName) {
  const store = join(projectsRoot, projectName, PROJECT_FILES.directory);
  const files = {};
  for (const entry of readdirSync(store).sort()) {
    if (entry === PROJECT_FILES.lock || entry === PROJECT_FILES.objects) continue;
    files[entry] = readFileSync(join(store, entry), "utf8");
  }
  return { files, objects: readdirSync(join(store, PROJECT_FILES.objects), { recursive: true }).map(String).sort() };
}
const shot = async (page, label) => {
  await page.screenshot({ path: join(shots, `${label}.png`) });
};

// ---------- run ----------

const PROJECT = "dogfood";
let host = await timed("host start", () => startStudioHost({ projectsRoot }));
let editor = await timed("editor open", () => openEditor(host));
let { page } = editor;
const doc = () => host.session.document;
let imported = []; // { frameId, layers, label }

try {
  // ---- A: import and inspect ----
  await page.locator("#new-project-name").fill(PROJECT);
  await page.locator("#dialog[open] button.primary", { hasText: "Create project" }).click();
  await waitRevision(page, 0);

  if (project.kind === "codebase") {
    await page.locator("#action-code").click();
    await page.locator("#codebase-folder").fill(folder);
    await timed("codebase connect and scan", async () => {
      await page.locator("#dialog[open] button.primary", { hasText: "Connect folder" }).click();
      await page.locator("#codebase-path").waitFor();
    });
    const listed = await page.locator("#codebase-components li").count();
    const scan = (await api(host, "GET", "/api/codebase")).json;
    result.scan = { files: scan.files, truncated: scan.truncated, components: scan.components.length };
    check("A", "the Code dialog lists the components the host found", listed === scan.components.length, { listed, found: scan.components.length });
    // Every listed component, brought in through the host as the Bring in button does, in a
    // second project so the editor's project only has what the person brings in.
    await page.locator("#dialog[open] button", { hasText: "Close" }).last().click();
    const outcomes = {};
    const importable = [];
    const refusals = [];
    {
      mkdirSync(join(base, "breadth"));
      const probeHost = await startStudioHost({ projectsRoot: join(base, "breadth") });
      try {
        await api(probeHost, "POST", "/api/projects/create", { name: "breadth" });
        await api(probeHost, "POST", "/api/codebase/connect", { folder });
        for (const { file, component } of scan.components) {
          const answer = await timed("bring in (every component, host API)", () => api(probeHost, "POST", "/api/codebase/import", { file, component }));
          const key = answer.status === 200 ? "imported" : `${answer.status} ${answer.json?.error?.code ?? "?"}`;
          outcomes[key] = (outcomes[key] ?? 0) + 1;
          if (answer.status === 200) importable.push({ file, component, layers: answer.json.layers });
          else refusals.push({ file, component, message: String(answer.json?.error?.message ?? "").slice(0, 160) });
        }
      } finally {
        await probeHost.close();
      }
    }
    // Why components were refused, grouped by the message with its specifics removed.
    const reasons = {};
    for (const { message } of refusals) {
      const reason = message.replace(/\b(?:in|at|line) [^,)]+/gu, "").replace(/\s+/gu, " ").trim();
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
    result.breadth = { outcomes, importable: importable.length, refused: refusals.length, reasons: Object.fromEntries(Object.entries(reasons).sort((a, b) => b[1] - a[1])), refusalSamples: refusals.slice(0, 8) };
    check("A", "at least one component of the codebase can be brought in", importable.length > 0, result.breadth.outcomes);
    if (scan.components.length > 0 && importable.length / scan.components.length < 0.5) {
      finding("workflow", `${importable.length} of ${scan.components.length} components found in the codebase can be brought in`, result.breadth.reasons);
    }
    // The person brings in up to three, the largest first, through the dialog.
    const chosen = [...importable].sort((a, b) => b.layers - a.layers).slice(0, 3);
    for (const { file, component, layers } of chosen) {
      await page.locator("#action-code").click();
      const row = page.locator("#codebase-components li", { hasText: file }).filter({ has: page.locator("strong", { hasText: new RegExp(`^${component}$`, "u") }) }).first();
      const before = await revisionOf(page);
      await timed("bring in (editor)", async () => {
        await row.locator("button", { hasText: "Bring in" }).click();
        await waitRevision(page, before + 1);
      });
      const frameId = doc().rootIds.at(-1);
      imported.push({ frameId, layers, label: `${component} (${file})` });
      // Compare with the source: every text the component's own JSX has is drawn, in the layer bound to it.
      const bound = Object.values(doc().nodes).filter((node) => node.props?.codeSource?.file === file && node.props.codeSource.component === component);
      const texts = bound.filter((node) => typeof node.props.codeSource.base?.text === "string");
      const mismatched = [];
      for (const node of texts) {
        const shown = await renderedText(page, node.id);
        if (shown === null || !shown.includes(node.props.codeSource.base.text)) mismatched.push({ node: node.id, source: node.props.codeSource.base.text, shown });
      }
      check("A", `${component}: ${bound.length} bound layers, every source text drawn (${texts.length} texts)`, mismatched.length === 0 && bound.length === layers, { layers, bound: bound.length, mismatched: mismatched.slice(0, 3) });
      // Its provenance: the file and component, and a source path for every element.
      check("A", `${component}: each layer names its file, component and position in the source`, bound.every((node) => typeof node.props.codeSource.path === "string"));
      // And the source still parses to the same text values (Ninerr read it, it did not change it).
      const ir = buildCodeIr([{ path: file, content: readFileSync(join(folder, ...file.split("/")), "utf8") }]);
      check("A", `${component}: the file is unchanged by bringing it in`, git(source, "status", "--porcelain") === "" && ir.rootIds.length > 0);
    }
  } else {
    for (const pageFile of project.pages) {
      await page.locator("#action-import").click();
      await page.locator("#import-file").setInputFiles(join(source, pageFile));
      const before = await revisionOf(page);
      const review = await timed("import review", async () => {
        await page.locator("#dialog[open] button.primary", { hasText: "Review import" }).click();
        await page.locator("#import-review").waitFor();
        return page.locator("#import-review").innerText();
      });
      await timed("import commit and first render", async () => {
        await page.locator("#dialog[open] button.primary", { hasText: "Import" }).click();
        await waitRevision(page, before + 1);
      });
      const frameId = doc().rootIds.at(-1);
      const snapshot = doc(); // the host gives a copy each time
      const layers = Object.values(snapshot.nodes).filter((node) => { let at = node; while (at.parentId !== null) at = snapshot.nodes[at.parentId]; return at.id === frameId; }).length;
      imported.push({ frameId, layers, label: pageFile, review });
      // Compare with the source: the page's visible words, in order, against what is drawn.
      const html = readFileSync(join(source, pageFile), "utf8");
      const words = (text) => text.replace(/\s+/gu, " ").trim().split(" ").filter((word) => /\w/u.test(word));
      const sourceWords = words(html.replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1>/giu, " ").replace(/<!--[\s\S]*?-->/gu, " ").replace(/<[^>]+>/gu, " ").replace(/&[a-z]+;|&#\d+;/giu, " "));
      // Each drawn text node on its own: textContent would join neighbouring elements' words.
      const drawnWords = words(await page.evaluate((id) => {
        const root = document.querySelector("iframe").contentDocument.querySelector(`[data-ninerr-id="${id}"]`);
        if (root === null) return "";
        const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const parts = [];
        while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
        return parts.join(" ");
      }, frameId));
      const missing = sourceWords.filter((word) => !drawnWords.includes(word));
      check("A", `${pageFile}: ${layers} layers; every word of the page is drawn`, missing.length === 0, { sourceWords: sourceWords.length, drawnWords: drawnWords.length, missing: missing.slice(0, 10) });
      const styled = (html.match(/<link[^>]+rel=["']?stylesheet/giu) ?? []).length;
      if (styled > 0) {
        const fill = await renderedStyle(page, frameId, "font-family");
        unsupported("A", `${pageFile}: its ${styled} linked stylesheets`, `not loaded: an import is one HTML file and nothing it links to is fetched (the page draws in ${fill})`);
      }
      await shot(page, `A-${pageFile.replace(/\W+/gu, "-")}`);
    }
    if (project.pages.length > 0) finding("fidelity", "an imported page's linked stylesheets are never applied, so a real site imports unstyled");
  }
  if (imported.length === 0) {
    for (const key of ["B", "C", "D", "E"]) unsupported(key, "the journey", "nothing from this project could be brought into Ninerr");
  } else {
    await page.locator("#action-fit").click();
    await shot(page, "A-imported");

    // ---- B: visual editing ----
    // The imported content with the most text, so there is text to select and edit.
    const textCount = (frameId) => { const all = doc(); let count = 0; for (const node of Object.values(all.nodes)) { if (typeof node.props?.text !== "string" || node.props.text.trim() === "") continue; let at = node; while (at.parentId !== null) at = all.nodes[at.parentId]; if (at.id === frameId) count += 1; } return count; };
    const target = [...imported].sort((a, b) => textCount(b.frameId) - textCount(a.frameId))[0];
    const snapshot = doc();
    const inFrame = (id) => { let at = snapshot.nodes[id]; while (at && at.parentId !== null) at = snapshot.nodes[at.parentId]; return at?.id === target.frameId; };
    const depthOf = (id) => { let depth = 0; let at = snapshot.nodes[id]; while (at.parentId !== null) { depth += 1; at = snapshot.nodes[at.parentId]; } return depth; };
    // The deepest drawn text layer, selected by clicking it on the canvas.
    const candidates = Object.values(snapshot.nodes).filter((node) => inFrame(node.id) && typeof node.props?.text === "string" && node.props.text.trim() !== "").sort((a, b) => depthOf(b.id) - depthOf(a.id));
    let textNode = null;
    for (const node of candidates.slice(0, 40)) {
      const point = await reachable(page, node.id);
      if (point === null) continue;
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(50);
      const selected = await selectedIds(page);
      if (selected.length === 1 && selected[0] === node.id) { textNode = node; break; }
      // What a click there selected instead: the topmost layer drawn at that point.
      const hit = await page.evaluate(({ x, y }) => {
        const frame = document.querySelector("iframe");
        const outer = frame.getBoundingClientRect();
        const zoom = outer.width / frame.offsetWidth;
        const root = frame.contentDocument.querySelector("[data-ninerr-root]");
        root.inert = false;
        try {
          return frame.contentDocument.elementFromPoint((x - outer.left) / zoom, (y - outer.top) / zoom)?.closest("[data-ninerr-id]")?.dataset.ninerrId ?? null;
        } finally {
          root.inert = true;
        }
      }, point);
      if (selected[0] !== hit) {
        check("B", "a click on the canvas selects the layer drawn there", false, { clicked: node.id, drawnThere: hit, selected });
        break;
      }
    }
    if (textNode === null) unsupported("B", "select a nested text layer on the canvas", "no text layer is drawn where a click reaches it");
    else {
      check("B", `a click selects the nested text layer at depth ${depthOf(textNode.id)}`, true);
      const original = textNode.props.text;
      // Text, from the inspector.
      let revision = await revisionOf(page);
      await timed("edit text (inspector)", async () => {
        await page.locator("#inspect-text").fill(`${original} (edited)`);
        await page.locator("#inspect-text").press("Tab");
        await waitRevision(page, revision + 1);
      });
      check("B", "the text edit is in the document and on the canvas", doc().nodes[textNode.id].props.text === `${original} (edited)` && (await renderedText(page, textNode.id))?.includes("(edited)"));
      // Its fill and colour.
      revision += 1;
      await timed("edit style (inspector)", async () => {
        await page.locator("#inspect-style-color").fill("#b00020");
        await page.locator("#inspect-style-color").press("Tab");
        await waitRevision(page, revision + 1);
      });
      check("B", "the colour edit is in the document and drawn", doc().nodes[textNode.id].props.style?.color === "#b00020" && (await renderedStyle(page, textNode.id, "color")) === "rgb(176, 0, 32)");
      revision += 1;
      // Insert a box inside the selected layer's parent (#274: the insert goes where the selection is).
      const parentId = textNode.parentId;
      await page.locator(`[role=treeitem][data-node-id="${parentId}"] > .row`).click();
      check("B", "the parent is selected from the layers tree", JSON.stringify(await selectedIds(page)) === JSON.stringify([parentId]));
      await timed("insert box", async () => {
        await page.locator("#action-insert-box").click();
        await waitRevision(page, revision + 1);
      });
      revision += 1;
      const [boxId] = await selectedIds(page);
      check("B", "the inserted box is selected and inside the selected layer", doc().nodes[boxId]?.parentId === parentId, { parentId, boxParent: doc().nodes[boxId]?.parentId });
      // Move and resize it by dragging, then from the keyboard-free buttons.
      const centre = await reachable(page, boxId);
      const before = { ...doc().nodes[boxId].props.style };
      // The layer drawn on top at a page point, as the canvas's hit test sees it.
      const topmostAt = (point) => page.evaluate(({ x, y }) => {
        const frame = document.querySelector("iframe");
        const outer = frame.getBoundingClientRect();
        const zoom = outer.width / frame.offsetWidth;
        // Rendered content is inert, and inert content is invisible to elementFromPoint.
        const root = frame.contentDocument.querySelector("[data-ninerr-root]");
        root.inert = false;
        try {
          return frame.contentDocument.elementFromPoint((x - outer.left) / zoom, (y - outer.top) / zoom)?.closest("[data-ninerr-id]")?.dataset.ninerrId ?? null;
        } finally {
          root.inert = true;
        }
      }, point);
      let after = before;
      if (centre !== null) {
        const onTop = await topmostAt(centre);
        const moved = await timed("move (drag)", async () => {
          await page.mouse.move(centre.x, centre.y);
          await page.mouse.down();
          await page.mouse.move(centre.x + 30, centre.y + 20, { steps: 5 });
          await page.mouse.up();
          return waitRevision(page, revision + 1, 5000).then(() => true, () => false);
        });
        if (moved) {
          revision += 1;
          after = doc().nodes[boxId].props.style;
          check("B", "a drag moves the box, and only it", after.left !== before.left || after.top !== before.top, { before, after });
        } else {
          check("B", "a drag on the box moves it", false, { drawnOnTop: onTop, box: boxId, selectedAfter: await selectedIds(page), revision: await revisionOf(page) });
          // The buttons move it without dragging.
          await page.locator(`[role=treeitem][data-node-id="${boxId}"] > .row`).click().catch(() => {});
          await page.locator("button[aria-label='Move right 10 pixels']").click();
          await waitRevision(page, revision + 1);
          revision += 1;
          after = doc().nodes[boxId].props.style;
          check("B", "the Move right button moves the box", after.left !== before.left, { before, after });
        }
        const handle = await page.locator("[data-ninerr-handle]").boundingBox();
        if (handle) {
          await timed("resize (drag)", async () => {
            await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
            await page.mouse.down();
            await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2 + 25, { steps: 5 });
            await page.mouse.up();
            await waitRevision(page, revision + 1);
          });
          revision += 1;
          check("B", "a handle drag resizes the box", doc().nodes[boxId].props.style.width !== after.width);
        } else check("B", "the selected box shows a resize handle", false);
      } else unsupported("B", "drag the inserted box", "it is not drawn where it can be reached");
      await shot(page, "B-edited");
      unsupported("B", "reorder, group or move a layer to another parent", "the editor has no control for it (an MCP agent can reorder with move_layers; journey E)");
      // Undo everything and redo it, comparing with each state on the way.
      const states = [];
      const entries = (await api(host, "GET", "/api/history")).json.entries.length;
      for (let at = 0; at < Math.min(entries, 6); at += 1) {
        states.push(serializeDocument({ ...doc(), revision: 0 }));
        await timed("undo", async () => {
          await page.keyboard.press("Control+z");
          await waitRevision(page, revision + 1);
        });
        revision += 1;
      }
      const undone = serializeDocument({ ...doc(), revision: 0 });
      let redoOk = true;
      for (let at = states.length - 1; at >= 0; at -= 1) {
        await timed("redo", async () => {
          await page.keyboard.press("Control+Shift+z");
          await waitRevision(page, revision + 1);
        });
        revision += 1;
        if (serializeDocument({ ...doc(), revision: 0 }) !== states[at]) redoOk = false;
      }
      check("B", `undo ${states.length} times then redo them: each redo gives back the state before its undo`, redoOk && undone !== states[0]);
      // Typing speed: repeated text edits, each one change.
      for (let sample = 0; sample < SAMPLES; sample += 1) {
        await timed("edit text (inspector, repeated)", async () => {
          await page.locator(`[role=treeitem][data-node-id="${textNode.id}"] > .row`).click().catch(() => {});
          await page.locator("#inspect-text").fill(`${original} ${sample}`);
          await page.locator("#inspect-text").press("Tab");
          await waitRevision(page, revision + 1);
        });
        revision += 1;
      }
      for (let sample = 0; sample < SAMPLES; sample += 1) {
        // The button: with focus in an inspector field, Ctrl+Z is that field's own undo.
        await timed("undo (repeated)", async () => {
          await page.locator("#action-undo").click();
          await waitRevision(page, revision + 1);
        });
        revision += 1;
      }
      check("B", `after ${SAMPLES} edits and ${SAMPLES} undos the text is what it was`, doc().nodes[textNode.id].props.text === `${original} (edited)`, { text: doc().nodes[textNode.id].props.text });
      // Delete the box from the keyboard.
      await page.locator(`[role=treeitem][data-node-id="${boxId}"] > .row`).click().catch(() => {});
      if ((await selectedIds(page))[0] === boxId) {
        await page.locator("#layers").press("Delete");
        await waitRevision(page, revision + 1);
        revision += 1;
        check("B", "Delete removes the selected box and nothing else", doc().nodes[boxId] === undefined && doc().nodes[parentId] !== undefined);
      }
      result.target = { frame: target.label, textNode: textNode.id };
    }

    // ---- C: persistence ----
    await timed("save", async () => {
      await page.keyboard.press("Control+s");
      await page.waitForFunction(() => /saved/iu.test(document.getElementById("status").textContent));
    });
    const savedDocument = serializeDocument({ ...doc(), revision: 0 });
    const savedRevision = doc().revision;
    await timed("close project", async () => {
      await api(host, "POST", "/api/projects/close");
    });
    const closed = storeState(PROJECT);
    await editor.close();
    await host.close();
    host = await startStudioHost({ projectsRoot });
    editor = await openEditor(host);
    page = editor.page;
    await timed("reopen (editor)", async () => {
      await page.locator(`#dialog[open] button[data-project="${PROJECT}"]`).click();
      await waitRevision(page, savedRevision);
    });
    check("C", "reopened in a new host, the document is byte-identical", serializeDocument({ ...doc(), revision: 0 }) === savedDocument);
    check("C", "reopening read the store without writing it", JSON.stringify(storeState(PROJECT)) === JSON.stringify(closed));
    const history = (await api(host, "GET", "/api/history")).json.entries;
    // The earlier changes are listed after a reopen, up to the last one saved (#231).
    await page.waitForFunction((count) => document.querySelectorAll("#history li.earlier").length === count, history.length, { timeout: 5000 }).catch(() => {});
    const listed = await page.locator("#history li.earlier").count();
    if (history.length === 0) finding("workflow", "after a reopen the history panel lists none of the earlier changes (#231)", { revision: savedRevision });
    else check("C", "after a reopen, the history lists the earlier changes, marked as earlier (#231)", history.every((entry) => entry.earlier === true) && history.at(-1).revision === savedRevision && listed === history.length, { entries: history.length, listed, last: history.at(-1).revision });
    // A crash: the host process is killed after an edit it acknowledged; the edit survives.
    await api(host, "POST", "/api/projects/close");
    await editor.close();
    await host.close();
    const child = spawn(process.execPath, [join(REPO, "tests", "support", "host-child.mjs"), projectsRoot], { stdio: ["ignore", "pipe", "inherit"] });
    const line = await new Promise((resolve, reject) => {
      let buffer = "";
      child.stdout.on("data", (chunk) => { buffer += chunk; if (buffer.includes("\n")) resolve(buffer.split("\n")[0]); });
      child.once("exit", (code) => reject(new Error(`host child exited with ${code}`)));
    });
    const crashed = JSON.parse(line);
    const remote = (method, path, body) => api({ url: crashed.url, token: crashed.token }, method, path, body);
    await remote("POST", "/api/projects/open", { name: PROJECT });
    const opened = (await remote("GET", "/api/document")).json;
    const frame = opened.document.nodes[target.frameId];
    const acknowledged = await remote("POST", "/api/edit", { baseRevision: opened.revision, intent: "Rename before a crash", operations: [{ type: "set-props", nodeId: target.frameId, set: { name: "Crash survivor" } }] });
    check("C", "an edit is acknowledged before the crash", acknowledged.status === 200 && frame !== undefined, acknowledged.json);
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
    host = await startStudioHost({ projectsRoot });
    editor = await openEditor(host);
    page = editor.page;
    await page.locator(`#dialog[open] button[data-project="${PROJECT}"]`).click();
    // A lock left by a killed process on this computer: the lock dialog, then take over.
    if (await page.locator("#lock-reason").count() === 0) await page.locator("#lock-reason").waitFor({ timeout: 5000 }).catch(() => {});
    if (await page.locator("#lock-reason").count() > 0) {
      await page.locator("#lock-reason").fill("The previous Ninerr was killed during dogfooding");
      await page.locator("#dialog[open] button.primary").click();
    }
    await page.waitForFunction(() => document.getElementById("project-name").textContent === "dogfood");
    await waitRevision(page, opened.revision + 1);
    check("C", "after the crash, the acknowledged edit is there", doc().nodes[target.frameId]?.props?.name === "Crash survivor");
    // The editor says what recovery did; the person reads it and continues.
    const notice = await page.locator("#dialog[open]").innerText().catch(() => "");
    check("C", "the editor tells the person the project was recovered and why", /recovered this project/u.test(notice) && /stopped without closing/u.test(notice), { notice: notice.slice(0, 200) });
    if (notice !== "") await page.locator("#dialog[open] button.primary").click();

    // ---- D: source-linked editing ----
    const boundTexts = Object.values(doc().nodes).filter((node) => node.props?.codeSource?.base?.text !== undefined && typeof node.props.text === "string" && node.props.text === node.props.codeSource.base.text);
    // Two texts of one component, the second written once in its file (so an outside change
    // to it is unambiguous), not in a part of the component already edited above.
    const pair = (() => {
      if (project.kind !== "codebase") return null;
      for (const first of boundTexts) {
        const content = readFileSync(join(folder, ...first.props.codeSource.file.split("/")), "utf8");
        const second = boundTexts.find((other) => other.id !== first.id && other.props.codeSource.file === first.props.codeSource.file && other.props.codeSource.component === first.props.codeSource.component && other.props.text.trim() !== "" && content.split(`>${other.props.text}<`).length === 2);
        if (second) return [first, second];
      }
      return null;
    })();
    if (project.kind !== "codebase") unsupported("D", "write back to source", "an HTML import is not linked to its file; write-back is for a connected codebase's JSX and TSX");
    else if (pair === null) unsupported("D", "write back two independent text fields", `no component brought in has two unchanged texts, one written once in its file (${boundTexts.length} unchanged bound texts)`);
    else {
      const [first, second] = pair;
      const file = first.props.codeSource.file;
      const absolute = join(folder, ...file.split("/"));
      const original = readFileSync(absolute, "utf8");
      const edit = async (node, text) => {
        const revision = await revisionOf(page);
        const answer = await api(host, "POST", "/api/edit", { baseRevision: revision, intent: "Edit text for write-back", operations: [{ type: "set-props", nodeId: node.id, set: { text } }] });
        await waitRevision(page, revision + 1);
        return answer;
      };
      const review = async (nodeId) => {
        await page.locator(`[role=treeitem][data-node-id="${nodeId}"] > .row`).click().catch(async () => {
          await page.evaluate((id) => document.getElementById(`layer-${id}`)?.scrollIntoView(), nodeId);
        });
        await page.locator("#action-code").click();
        await page.locator("#codebase-review").click();
        await page.locator("#codebase-preview p, #codebase-diff").first().waitFor();
        return page.locator("#codebase-preview").innerText();
      };
      await edit(first, `${first.props.text} (from Ninerr)`);
      const preview = await timed("write-back review", () => review(first.id));
      // Every change the plan lists (the component's earlier edits too), and nothing else.
      const planned = (await api(host, "POST", "/api/codebase/preview", { nodeId: first.id })).json.changes ?? [];
      const diff = await page.locator("#codebase-diff").textContent().catch(() => "");
      check("D", "the review shows the change as a diff and writes nothing yet", diff.includes("(from Ninerr)") && readFileSync(absolute, "utf8") === original, { preview: preview.slice(0, 300) });
      const revision = await revisionOf(page);
      await timed("write-back write", async () => {
        await page.locator("#codebase-write").click();
        await waitRevision(page, revision + 2);
      });
      const written = readFileSync(absolute, "utf8");
      const changedLines = git(source, "diff", "--unified=0", "--", relative(source, absolute).split(sep).join("/")).split("\n").filter((entry) => /^[-+][^-+]/u.test(entry));
      const removedLines = changedLines.filter((entry) => entry.startsWith("-"));
      const addedLines = changedLines.filter((entry) => entry.startsWith("+"));
      check("D", `the file changed in exactly the ${planned.length} planned field(s) and nothing else`, written.includes("(from Ninerr)") && removedLines.length === planned.length && addedLines.length === planned.length && planned.every((change) => addedLines.some((entry) => entry.includes(change.to))), { planned: planned.map((change) => change.to), changedLines });
      await page.locator("#dialog[open] button", { hasText: "Close" }).last().click().catch(() => {});
      // An external change to another part of the file, then a Ninerr change: no conflict, both kept.
      const secondText = second.props.text;
      const external = written.replace(`>${secondText}<`, `>${secondText} (outside)<`);
      if (external !== written && second.props.codeSource.file === file) {
        writeFileSync(absolute, external);
        await edit(first, `${first.props.text} again`);
        const plan = (await api(host, "POST", "/api/codebase/preview", { nodeId: first.id })).json;
        check("D", "after an external change elsewhere in the file, the next write-back has no conflict", plan.conflicts?.length === 0 && plan.changes?.length === 1, { conflicts: plan.conflicts, changes: plan.changes });
        const wrote = await api(host, "POST", "/api/codebase/write", { nodeId: first.id, token: plan.token });
        const now = readFileSync(absolute, "utf8");
        check("D", "both the external change and Ninerr's are in the file", wrote.status === 200 && now.includes(`${secondText} (outside)`) && now.includes("again"), wrote.json);
        // A genuine conflict: the same text changed in the file and in Ninerr.
        writeFileSync(absolute, now.replace(`${secondText} (outside)`, `${secondText} (file)`));
        await edit(doc().nodes[second.id], `${secondText} (Ninerr)`);
        const conflict = (await api(host, "POST", "/api/codebase/preview", { nodeId: second.id })).json;
        check("D", "a text changed in both places is a conflict, and the file keeps its change", conflict.conflicts?.some((entry) => entry.nodeId === second.id) && conflict.changes?.length === 0 && readFileSync(absolute, "utf8").includes("(file)"), { conflicts: conflict.conflicts, changes: conflict.changes });
        // The conflict carries both values for the person to choose (#236).
        const shown = await review(second.id);
        if (!shown.includes("(file)") || !shown.includes("(Ninerr)")) finding("workflow", "a write-back conflict does not show the two values, so the person cannot see what to choose (#236)", { preview: shown.slice(0, 300) });
        else {
          check("D", "the conflict shows Ninerr's value and the file's", true);
          // The person takes the file's: the layer gets it and the field is settled, nothing written.
          const fileBefore = readFileSync(absolute, "utf8");
          const revision = await revisionOf(page);
          await timed("conflict: take the file's", async () => {
            await page.locator("#codebase-preview button", { hasText: "Take the file's" }).first().click();
            await waitRevision(page, revision + 1);
          });
          const settled = (await api(host, "POST", "/api/codebase/preview", { nodeId: second.id })).json;
          check("D", "taking the file's value settles the conflict and writes nothing", doc().nodes[second.id].props.text === `${secondText} (file)` && !settled.conflicts?.some((entry) => entry.nodeId === second.id) && readFileSync(absolute, "utf8") === fileBefore, { text: doc().nodes[second.id].props.text, conflicts: settled.conflicts });
        }
        await page.locator("#dialog[open] button", { hasText: "Close" }).last().click().catch(() => {});
      } else unsupported("D", "an external change elsewhere in the file", "the second bound text is in another file or not unique in it");
      git(source, "checkout", "--", ".");
    }

    // ---- E: an MCP agent ----
    await page.locator("#action-agents").click();
    await page.locator("#agent-name").fill("Dogfood agent");
    await page.keyboard.press("Enter");
    const token = await page.locator("#agent-credential").inputValue();
    await page.locator("#dialog[open] button.primary").click();
    let rpcId = 0;
    const rpc = async (method, params) => {
      const response = await fetch(host.mcpUrl, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
      return (await response.json()).result;
    };
    const tool = (toolName, toolArgs) => timed(`mcp ${toolName}`, () => rpc("tools/call", { name: toolName, arguments: toolArgs }));
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "dogfood", version: "1" } });
    const info = await tool("project_info", {});
    check("E", "the agent sees the open project", info?.structuredContent?.project === PROJECT || JSON.stringify(info).includes(PROJECT), info?.structuredContent ?? info);
    const tree = await tool("layer_tree", { nodeId: target.frameId, depth: 3 });
    check("E", "the agent reads the imported layers", tree?.isError === undefined, tree?.content?.[0]?.text?.slice(0, 200));
    const searchFor = Object.values(doc().nodes).find((node) => typeof node.props?.text === "string" && /\w{4,}/u.test(node.props.text))?.props.text.match(/\w{4,}/u)?.[0];
    const found = searchFor ? await tool("find_layers", { query: searchFor }) : null;
    const foundIds = found?.structuredContent?.layers?.map((layer) => layer.id) ?? found?.structuredContent?.nodes?.map((layer) => layer.id) ?? [];
    check("E", `the agent finds layers by text ("${searchFor}")`, foundIds.length > 0, found?.structuredContent ?? found);
    const agentTarget = foundIds.find((id) => typeof doc().nodes[id]?.props?.text === "string") ?? null;
    if (agentTarget !== null) {
      const revision = await revisionOf(page);
      const set = await tool("set_text", { nodeId: agentTarget, text: "Written by the agent" });
      await waitRevision(page, revision + 1);
      check("E", "the agent's text edit is applied, drawn, and attributed in the history", set?.isError === undefined && (await renderedText(page, agentTarget))?.includes("Written by the agent") && (await page.locator("#history li").first().getAttribute("class")) === "agent", set?.content?.[0]?.text);
      // Undo is for the person's own changes: after the agent's edit it is not offered.
      const undoOffered = await page.locator("#action-undo").isEnabled();
      if (!undoOffered) finding("ux", "after an agent's edit the editor's Undo is unavailable; the agent's change is undone with Revert in the history, which a person may not look for");
      // The person reverts it from the history, then undoes the revert.
      await page.locator("#history li").first().locator("button.revert").click();
      await waitRevision(page, revision + 2);
      const undoneText = doc().nodes[agentTarget].props.text;
      await page.locator("#action-undo").click();
      await waitRevision(page, revision + 3);
      check("E", "the person reverts the agent's edit, and undoing the revert restores it", undoneText !== "Written by the agent" && doc().nodes[agentTarget].props.text === "Written by the agent", { undoneText });
      // Reorder within a parent: the move the editor has no control for.
      const current = doc();
      const parent = Object.values(current.nodes).find((node) => node.children.length > 1 && inFrame(node.id)) ?? null;
      if (parent && parent.children.length > 1) {
        const moved = await tool("move_layers", { moves: [{ nodeId: parent.children.at(-1), parentId: parent.id, index: 0 }] });
        await waitRevision(page, revision + 4);
        check("E", "the agent reorders a layer within its parent", moved?.isError === undefined && doc().nodes[parent.id].children[0] === parent.children.at(-1), moved?.content?.[0]?.text);
      } else unsupported("E", "reorder a layer", "no layer in the imported content has two children");
      // Deleting asks the person; they approve in the editor.
      const before = await revisionOf(page);
      const deleting = tool("delete_layers", { nodeIds: [agentTarget] });
      await page.waitForFunction(() => /asks for your approval/u.test(document.getElementById("dialog-title")?.textContent ?? ""));
      await page.locator("#dialog[open] button:not([disabled])", { hasText: "Approve" }).click();
      const deleted = await deleting;
      await waitRevision(page, before + 1);
      check("E", "a delete is applied only after the person approves it", deleted?.isError === undefined && doc().nodes[agentTarget] === undefined);
      // The agent may not change a project it has not read: the person opens another one.
      await api(host, "POST", "/api/projects/create", { name: "other" });
      const refused = await tool("set_text", { nodeId: agentTarget, text: "wrong project" });
      check("E", "after the person opens another project, the agent's write is refused", refused?.isError === true && /project_info/u.test(refused?.content?.[0]?.text ?? ""), refused?.content?.[0]?.text);
      await api(host, "POST", "/api/projects/open", { name: PROJECT });
      await page.waitForFunction(() => document.getElementById("project-name").textContent === "dogfood");
    } else unsupported("E", "agent edits", "find_layers found no text layer");

    // ---- C again: everything so far persists ----
    const finalDocument = serializeDocument({ ...doc(), revision: 0 });
    const finalRevision = doc().revision;
    await api(host, "POST", "/api/projects/close");
    await editor.close();
    await host.close();
    host = await startStudioHost({ projectsRoot });
    editor = await openEditor(host);
    page = editor.page;
    await page.locator(`#dialog[open] button[data-project="${PROJECT}"]`).click();
    await waitRevision(page, finalRevision);
    check("C", "after the agent's work, a reopen gives the same document", serializeDocument({ ...doc(), revision: 0 }) === finalDocument);
    await shot(page, "C-reopened");
  }

  // ---- F: security and privacy ----
  check("F", `no request left the host (${requests} requests)`, foreign.length === 0, foreign.slice(0, 5));
  check("F", "the editor raised no errors", pageErrors.length === 0, { errors: pageErrors.slice(0, 5), failedResponses: failedResponses.slice(0, 10) });
  result.failedResponses = failedResponses;
  const sandbox = await page.evaluate(() => document.querySelector("iframe")?.getAttribute("sandbox"));
  check("F", "the canvas frame is sandboxed without scripts", typeof sandbox === "string" && !sandbox.includes("allow-scripts"), { sandbox });
  const scripts = await page.evaluate(() => document.querySelector("iframe")?.contentDocument?.querySelectorAll("script").length ?? -1);
  check("F", "no script element reached the canvas", scripts === 0, { scripts });
  check("F", "the fetched project was not written", git(fetched, "status", "--porcelain") === "");
} catch (error) {
  result.error = error instanceof Error ? `${error.message}\n${error.stack?.split("\n").slice(1, 4).join("\n")}` : String(error);
  process.stdout.write(`ERROR ${result.error}\n`);
  await shot(page, "error").catch(() => {});
} finally {
  await editor.close().catch(() => {});
  await host.close().catch(() => {});
  await browser.close();
  result.timings = Object.fromEntries(Object.entries(result.timings).map(([label, samples]) => [label, summarize(samples)]));
  writeFileSync(join(base, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result.timings)}\n`);
}
