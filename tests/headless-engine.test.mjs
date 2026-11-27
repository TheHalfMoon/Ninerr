import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { PROJECT_FILES, createProject } from "../packages/persistence/src/index.ts";
import { createDocument } from "@ninerr/document-model";
import { runHeadless } from "../packages/studio-host/src/index.ts";
import { exportDtcgTokens, parseDtcgTokens } from "../packages/studio-host/src/tokens-dtcg.ts";

// The headless engine (docs/HEADLESS.md): the real `ninerr mcp` process on stdio, driven as an
// agent's client drives it. No editor, browser or desktop app runs.

const BIN = new URL("../bin/ninerr.mjs", import.meta.url);
// Every engine a test starts, stopped when the test ends however it ends.
const running = new Set();

/** Start `ninerr mcp` on a projects folder; `onAsk` answers the engine's elicitation requests. */
function engine(projects, { elicitation = false, onAsk } = {}) {
  const child = spawn(process.execPath, [BIN.pathname.replace(/^\/([A-Za-z]:)/u, "$1"), "mcp", "--projects", projects], { stdio: ["pipe", "pipe", "pipe"] });
  running.add(child);
  child.on("exit", () => running.delete(child));
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const waiting = new Map();
  const asked = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.method === "elicitation/create") {
      asked.push(message.params);
      const answer = onAsk === undefined ? { action: "decline" } : onAsk(message.params);
      if (answer === null) return;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: answer })}\n`);
      return;
    }
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  });
  let next = 1;
  const rpc = (method, params) => new Promise((resolve) => {
    const id = next++;
    waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  const call = async (name, args = {}) => (await rpc("tools/call", { name, arguments: args })).result;
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  return {
    asked,
    rpc,
    call,
    stderr: () => stderr,
    initialize: (name = "Test Agent") => rpc("initialize", { protocolVersion: "2025-06-18", capabilities: elicitation ? { elicitation: {} } : {}, clientInfo: { name, version: "1" } }),
    async stop() {
      child.stdin.end();
      return exited;
    },
  };
}

const text = (result) => result.content[0].text;

function withProjects(callback) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-headless-")));
  return Promise.resolve()
    .then(() => callback(root))
    .finally(async () => {
      await Promise.all([...running].map((child) => new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill();
      })));
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    });
}

test("an agent creates, designs, saves, closes, reopens and edits a project with no editor", () => withProjects(async (projects) => {
  const first = engine(projects);
  const init = await first.initialize();
  assert.equal(init.result.serverInfo.name, "ninerr");
  assert.match(init.result.instructions, /list_projects/u);
  const tools = (await first.rpc("tools/list", {})).result.tools.map((tool) => tool.name);
  for (const name of ["list_projects", "create_project", "open_project", "save_project", "close_project", "create_frame", "set_styles", "delete_layers", "layer_code"]) assert.ok(tools.includes(name), name);
  assert.deepEqual((await first.call("list_projects")).structuredContent.projects, []);
  assert.match(text(await first.call("create_frame", { width: 10, height: 10 })), /No project is open/u, "a document tool before a project is open says what to do");

  const created = (await first.call("create_project", { name: "launch", title: "Launch page" })).structuredContent;
  assert.deepEqual([created.project, created.created], ["launch", true]);
  const frame = (await first.call("create_frame", { name: "Hero", width: 1200, height: 600 })).structuredContent.nodeId;
  await first.call("set_styles", { updates: [{ nodeId: frame, styles: { background: "#123456" } }] });
  await first.call("set_token", { name: "--brand", type: "color", values: { default: "#2255ff" } });
  const code = (await first.call("layer_code", { nodeId: frame })).structuredContent;
  assert.match(JSON.stringify(code), /#123456/u);
  const saved = (await first.call("save_project")).structuredContent;
  assert.equal(saved.project, "launch");
  assert.equal((await first.call("close_project")).structuredContent.closed, "launch");
  assert.equal(await first.stop(), 0);
  assert.ok(!existsSync(join(projects, "launch", PROJECT_FILES.directory, "lock")), "the project is released");

  // A new process, as a later conversation: the design is all there, attributed, and editable.
  const second = engine(projects);
  await second.initialize();
  assert.deepEqual((await second.call("list_projects")).structuredContent.projects, ["launch"]);
  const opened = (await second.call("open_project", { name: "launch" })).structuredContent;
  assert.equal(opened.revision, 3, "the frame, its style and the token");
  const details = (await second.call("layer_details", { nodeId: frame })).structuredContent;
  assert.match(JSON.stringify(details), /Hero/u);
  const edit = (await second.call("rename_layers", { renames: [{ nodeId: frame, name: "Hero section" }] })).structuredContent;
  assert.equal(edit.revision, 4);
  assert.equal(await second.stop(), 0, "ending the conversation ends the engine and releases the project");
  assert.ok(!existsSync(join(projects, "launch", PROJECT_FILES.directory, "lock")));
}));

test("project names stay inside the projects folder, and a project open elsewhere is refused", () => withProjects(async (projects) => {
  const one = engine(projects);
  await one.initialize();
  for (const name of ["../outside", "a/b", "..", "C:\\temp", "", ".hidden"]) {
    const result = await one.call("create_project", { name });
    assert.equal(result.isError, true, JSON.stringify(name));
  }
  assert.deepEqual(readdirSync(projects).filter((entry) => !entry.startsWith(".")), [], "nothing was made");
  assert.match(text(await one.call("create_project", { name: "p", path: "/tmp/x" })), /takes no argument "path"/u);
  assert.match(text(await one.call("open_project", { name: "missing" })), /no project named missing/u);
  await one.call("create_project", { name: "p" });
  assert.equal((await one.call("create_project", { name: "P" })).isError, true, "a name that differs only by case is taken");

  // A second agent's engine cannot open the project the first holds.
  const two = engine(projects);
  await two.initialize();
  const refused = await two.call("open_project", { name: "p" });
  assert.equal(refused.isError, true);
  assert.match(text(refused), /open|lock|use/iu);
  await one.stop();
  assert.equal((await two.call("open_project", { name: "p" })).isError, undefined, "once released, it opens");
  await two.stop();
}));

test("a delete is never approved without the person: refused when the client cannot ask", () => withProjects(async (projects) => {
  const agent = engine(projects);
  await agent.initialize();
  await agent.call("create_project", { name: "p" });
  const frame = (await agent.call("create_frame", { name: "Keep", width: 10, height: 10 })).structuredContent.nodeId;
  const refused = await agent.call("delete_layers", { nodeIds: [frame] });
  assert.equal(refused.isError, true);
  assert.match(text(refused), /cannot ask them/u);
  assert.equal(agent.asked.length, 0, "nothing was asked");
  assert.equal((await agent.call("layer_details", { nodeId: frame })).isError, undefined, "the layer is still there");
  // A dry run is not a change, and needs no approval.
  assert.equal((await agent.call("delete_layers", { nodeIds: [frame], dryRun: true })).structuredContent.dryRun, true);
  await agent.stop();
}));

test("a delete is put to the person through the client, bound to the exact call", () => withProjects(async (projects) => {
  let approve = false;
  const agent = engine(projects, { elicitation: true, onAsk: () => ({ action: "accept", content: { approve } }) });
  await agent.initialize();
  await agent.call("create_project", { name: "p" });
  const frame = (await agent.call("create_frame", { name: "Old banner", width: 10, height: 10 })).structuredContent.nodeId;

  const declined = await agent.call("delete_layers", { nodeIds: [frame] });
  assert.match(text(declined), /declined/u);
  assert.equal(agent.asked.length, 1);
  assert.match(agent.asked[0].message, /Test Agent \(local agent\) asks/u);
  assert.match(agent.asked[0].message, /Delete 1 layer: Old banner/u);
  assert.equal((await agent.call("layer_details", { nodeId: frame })).isError, undefined, "declined: still there");

  // Cancelling the question, or answering without approving, is not an approval either.
  const cancelling = engine(projects, { elicitation: true, onAsk: () => ({ action: "cancel" }) });
  await agent.call("close_project");
  await cancelling.initialize();
  await cancelling.call("open_project", { name: "p" });
  assert.match(text(await cancelling.call("delete_layers", { nodeIds: [frame] })), /declined/u);
  await cancelling.stop();

  await agent.call("open_project", { name: "p" });
  approve = true;
  const approved = await agent.call("delete_layers", { nodeIds: [frame] });
  assert.equal(approved.isError, undefined, text(approved));
  assert.match(text(await agent.call("layer_details", { nodeId: frame })), /no node/u, "approved: deleted");
  await agent.stop();
}));

test("stale revisions are refused, and a damaged project is refused rather than half-opened", () => withProjects(async (projects) => {
  const agent = engine(projects);
  await agent.initialize();
  await agent.call("create_project", { name: "p" });
  await agent.call("create_frame", { name: "A", width: 10, height: 10 });
  const stale = await agent.call("create_frame", { name: "B", width: 10, height: 10, baseRevision: 0 });
  assert.match(text(stale), /based on revision 0/u);
  await agent.call("close_project");
  // Damage the journal's history: the store refuses to open it.
  const journal = join(projects, "p", PROJECT_FILES.directory, PROJECT_FILES.journal);
  writeFileSync(journal, Buffer.concat([readFileSync(journal), Buffer.from('{"not":"a journal record"}\n')]));
  const damaged = await agent.call("open_project", { name: "p" });
  assert.equal(damaged.isError, true);
  assert.equal((await agent.call("list_projects")).structuredContent.open, null, "nothing is open");
  await agent.stop();
}));

test("an agent reads history, undoes and redoes its own change, and exports code and a preview into the project", () => withProjects(async (projects) => {
  const agent = engine(projects);
  await agent.initialize();
  await agent.call("create_project", { name: "site" });
  const frame = (await agent.call("create_frame", { name: "Pricing", width: 800, height: 400 })).structuredContent.nodeId;
  await agent.call("set_styles", { updates: [{ nodeId: frame, styles: { background: "#fde68a", padding: "24px" } }] });
  await agent.call("rename_layers", { renames: [{ nodeId: frame, name: "Pricing table" }] });

  const history = (await agent.call("project_history")).structuredContent;
  assert.equal(history.revision, 3);
  assert.deepEqual(history.changes.map((change) => change.tool), ["create_frame", "set_styles", "rename_layers"]);
  assert.ok(history.changes.every((change) => change.actor === "agent-local-test-agent" && change.actorKind === "agent"), "every change is the agent's");

  const undone = (await agent.call("undo_change")).structuredContent;
  assert.equal(undone.revision, 4);
  assert.match(text(await agent.call("layer_details", { nodeId: frame })), /"name": "Pricing"/u, "the rename is undone");
  await agent.call("redo_change");
  assert.match(text(await agent.call("layer_details", { nodeId: frame })), /"name": "Pricing table"/u, "and redone");
  assert.equal((await agent.call("project_history", { limit: 2 })).structuredContent.changes.length, 2);

  const preview = (await agent.call("export_design", { nodeId: frame, format: "html", name: "pricing" })).structuredContent;
  assert.equal(preview.path, join(projects, "site", "exports", "pricing.html"));
  const page = readFileSync(preview.path, "utf8");
  assert.match(page, /^<!doctype html>/u);
  assert.match(page, /Content-Security-Policy/u, "the preview carries the canvas's content policy");
  assert.doesNotMatch(page, /<script/iu, "and no script");
  assert.match(page, /fde68a/u);
  const jsx = (await agent.call("export_design", { nodeId: frame, format: "jsx" })).structuredContent;
  assert.match(readFileSync(jsx.path, "utf8"), /export function/u);
  assert.ok(jsx.path.startsWith(join(projects, "site", "exports")));
  const tailwind = (await agent.call("export_design", { nodeId: frame, format: "tailwind", name: "pricing-tw" })).structuredContent;
  assert.match(readFileSync(tailwind.path, "utf8"), /className=/u);

  for (const name of ["../escape", "a/b", "..", "with space", ".hidden", "x".repeat(65)]) {
    assert.equal((await agent.call("export_design", { nodeId: frame, format: "html", name })).isError, true, name);
  }
  assert.equal((await agent.call("export_design", { nodeId: frame, format: "pdf" })).isError, true);
  assert.equal((await agent.call("export_design", { nodeId: "missing", format: "html" })).isError, true);
  assert.deepEqual(readdirSync(join(projects, "site", "exports")).sort(), [`${jsx.componentName}.jsx`, "pricing-tw.jsx", "pricing.html"].sort(), "only the asked-for files, inside exports");
  assert.equal((await agent.call("project_history")).structuredContent.revision, 5, "exporting changes nothing in the design");
  await agent.stop();
}));

test("a client that goes away while a delete waits for the person leaves nothing deleted and the project released", () => withProjects(async (projects) => {
  const agent = engine(projects, { elicitation: true, onAsk: () => null });
  await agent.initialize();
  await agent.call("create_project", { name: "p" });
  const frame = (await agent.call("create_frame", { name: "Keep", width: 10, height: 10 })).structuredContent.nodeId;
  void agent.call("delete_layers", { nodeIds: [frame] });
  for (let tries = 0; tries < 200 && agent.asked.length === 0; tries += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(agent.asked.length, 1, "the person is being asked");
  assert.equal(await agent.stop(), 0, "the engine ends cleanly");
  assert.ok(!existsSync(join(projects, "p", PROJECT_FILES.directory, "lock")), "the project's lock is released");
  const next = engine(projects);
  await next.initialize();
  await next.call("open_project", { name: "p" });
  assert.equal((await next.call("layer_details", { nodeId: frame })).isError, undefined, "nothing was deleted");
  await next.stop();
}));

test("reopening the open project works, and a second initialize cannot change who the agent is", () => withProjects(async (projects) => {
  const agent = engine(projects);
  await agent.initialize("First Client");
  await agent.call("create_project", { name: "p" });
  assert.equal((await agent.call("open_project", { name: "p" })).isError, undefined, "the open project reopens");
  await agent.initialize("Other Client");
  const made = await agent.call("create_frame", { name: "A", width: 10, height: 10 });
  assert.equal(made.isError, undefined, "still the first identity, still granted");
  await agent.stop();
}));

test("a question the person never answers is no approval, and asking again asks again", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-headless-")));
  const input = new PassThrough();
  const output = new PassThrough();
  const asked = [];
  const answers = new Map();
  createInterface({ input: output }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.method === "elicitation/create") asked.push(message);
    else answers.get(message.id)?.(message);
  });
  let next = 1;
  const call = (name, args = {}) => new Promise((resolve) => {
    const id = next++;
    answers.set(id, (message) => resolve(message.result));
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })}\n`);
  });
  const running = runHeadless({ projectsRoot: root, input, output, confirmationWaitMs: 1500 });
  try {
    await new Promise((resolve) => {
      answers.set(0, resolve);
      input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { elicitation: {} }, clientInfo: { name: "Silent", version: "1" } } })}\n`);
    });
    await call("create_project", { name: "p" });
    const frame = (await call("create_frame", { name: "Keep", width: 10, height: 10 })).structuredContent.nodeId;
    const first = await call("delete_layers", { nodeIds: [frame] });
    assert.equal(first.isError, true);
    assert.match(first.content[0].text, /declined/u, "no answer is no approval");
    const second = await call("delete_layers", { nodeIds: [frame] });
    assert.equal(second.isError, true);
    assert.equal(asked.length, 2, "a retry asks the person again");
    assert.equal((await call("layer_details", { nodeId: frame })).isError, undefined, "still there");
  } finally {
    input.end();
    await running;
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("a project left open with no call is closed after the idle time, releasing it", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-headless-")));
  const input = new PassThrough();
  const output = new PassThrough();
  const answers = new Map();
  createInterface({ input: output }).on("line", (line) => {
    const message = JSON.parse(line);
    answers.get(message.id)?.(message);
  });
  let next = 1;
  const call = (name, args = {}) => new Promise((resolve) => {
    const id = next++;
    answers.set(id, (message) => resolve(message.result));
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })}\n`);
  });
  const running = runHeadless({ projectsRoot: root, input, output, idleCloseMs: 400 });
  try {
    await call("create_project", { name: "p" });
    const lock = join(root, "p", PROJECT_FILES.directory, "lock");
    assert.ok(existsSync(lock), "open and locked");
    await call("list_projects");
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.ok(existsSync(lock), "a call keeps it open");
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.ok(!existsSync(lock), "idle: closed and released");
    assert.match((await call("create_frame", { name: "A", width: 10, height: 10 })).content[0].text, /No project is open/u, "the next call is told to open it");
    assert.equal((await call("open_project", { name: "p" })).isError, undefined, "and it opens again");
  } finally {
    input.end();
    await running;
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("a dry run of undo, redo or export changes nothing; an export never replaces a file unasked, nor goes through a link", () => withProjects(async (projects) => {
  const agent = engine(projects);
  await agent.initialize();
  await agent.call("create_project", { name: "p" });
  const frame = (await agent.call("create_frame", { name: "Hero", width: 10, height: 10 })).structuredContent.nodeId;
  const dryUndo = (await agent.call("undo_change", { dryRun: true })).structuredContent;
  assert.equal(dryUndo.dryRun, true);
  assert.equal((await agent.call("project_history")).structuredContent.revision, 1, "a dry undo undoes nothing");
  assert.equal((await agent.call("redo_change", { dryRun: true })).isError, true, "nothing to redo");
  const exports = join(projects, "p", "exports");
  const dryExport = (await agent.call("export_design", { nodeId: frame, format: "html", name: "hero", dryRun: true })).structuredContent;
  assert.equal(dryExport.wouldWrite, join(exports, "hero.html"));
  assert.ok(!existsSync(exports), "a dry export writes nothing");

  assert.equal((await agent.call("export_design", { nodeId: frame, format: "html", name: "hero" })).isError, undefined);
  writeFileSync(join(exports, "hero.html"), "edited by the person");
  const again = await agent.call("export_design", { nodeId: frame, format: "html", name: "HERO" });
  assert.match(text(again), /already has HERO\.html; pass replace: true/u, "the same name, in any case, is refused");
  assert.equal(readFileSync(join(exports, "hero.html"), "utf8"), "edited by the person", "and the person's file is untouched");
  assert.equal((await agent.call("export_design", { nodeId: frame, format: "html", name: "hero", replace: true })).structuredContent.replaced, true);
  assert.match(readFileSync(join(exports, "hero.html"), "utf8"), /^<!doctype html>/u);

  // A project whose exports folder is a link (from a clone, an archive or a shared drive): nothing is written through it.
  const outside = mkdtempSync(join(tmpdir(), "ninerr-outside-"));
  try {
    rmSync(exports, { recursive: true, force: true });
    symlinkSync(outside, exports, process.platform === "win32" ? "junction" : "dir");
    const linked = await agent.call("export_design", { nodeId: frame, format: "jsx", name: "escaped" });
    assert.match(text(linked), /link to somewhere else/u);
    assert.deepEqual(readdirSync(outside), [], "nothing was written outside the project");
  } finally {
    rmSync(exports, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
  await agent.stop();
}));

test("an idle project waiting on the person stays open until the question ends, then is closed", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-headless-")));
  const input = new PassThrough();
  const output = new PassThrough();
  const answers = new Map();
  createInterface({ input: output }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.method === undefined) answers.get(message.id)?.(message);
  });
  let next = 1;
  const rpc = (method, params) => new Promise((resolve) => {
    const id = next++;
    answers.set(id, (message) => resolve(message.result));
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  const running = runHeadless({ projectsRoot: root, input, output, idleCloseMs: 300, confirmationWaitMs: 2500 });
  try {
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: { elicitation: {} }, clientInfo: { name: "Slow", version: "1" } });
    await rpc("tools/call", { name: "create_project", arguments: { name: "p" } });
    const frame = (await rpc("tools/call", { name: "create_frame", arguments: { name: "A", width: 10, height: 10 } })).structuredContent.nodeId;
    const lock = join(root, "p", PROJECT_FILES.directory, "lock");
    const asked = rpc("tools/call", { name: "delete_layers", arguments: { nodeIds: [frame] } });
    await new Promise((resolve) => setTimeout(resolve, 900));
    assert.ok(existsSync(lock), "still open while the person is asked");
    assert.match((await asked).content[0].text, /declined/u, "unanswered: declined");
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.ok(!existsSync(lock), "then idle: closed and released");
  } finally {
    input.end();
    await running;
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});


test("an agent authors a multi-section semantic page with create_layers, imports HTML/JSX/tokens, exports TSX and tokens, and recovers stale locks", () => withProjects(async (projects) => {
  const agent = engine(projects);
  await agent.initialize("Builder");
  await agent.call("create_project", { name: "authoring" });

  // 1. Atomic nested tree creation with tempId references in one transaction.
  const dry = await agent.call("create_layers", {
    dryRun: true,
    nodes: [
      { tempId: "page", type: "frame", tag: "main", name: "Pricing", style: { display: "flex", "flex-direction": "column", gap: "24px", padding: "32px" } },
      { tempId: "title", parentId: "page", type: "element", tag: "h1", name: "Heading", text: "Simple pricing", style: { "font-size": "36px", color: "#111827" } },
      { parentId: "page", type: "element", tag: "button", name: "Primary CTA", text: "Start free", attributes: { type: "button", "aria-label": "Start free trial" }, style: { background: "#111827", color: "#ffffff", padding: "12px 20px" } },
    ],
  });
  assert.equal(dry.isError, undefined, text(dry));
  assert.equal(dry.structuredContent.dryRun, true);
  assert.equal((await agent.call("project_info")).structuredContent.revision, 0, "dryRun commits nothing");

  const built = await agent.call("create_layers", {
    nodes: [
      { tempId: "page", type: "frame", tag: "main", name: "Pricing", style: { display: "flex", "flex-direction": "column", gap: "24px", padding: "32px" } },
      { tempId: "title", parentId: "page", type: "element", tag: "h1", name: "Heading", text: "Simple pricing", style: { "font-size": "36px", color: "#111827" } },
      { parentId: "page", type: "element", tag: "button", name: "Primary CTA", text: "Start free", attributes: { type: "button", "aria-label": "Start free trial" }, style: { background: "#111827", color: "#ffffff", padding: "12px 20px" } },
    ],
  });
  assert.equal(built.isError, undefined, text(built));
  assert.equal(built.structuredContent.revision, 1, "entire nested tree is one atomic transaction");
  assert.equal(built.structuredContent.created.length, 3);
  const pageId = built.structuredContent.created[0].nodeId;
  const tree = (await agent.call("layer_tree", { nodeId: pageId, depth: 3 })).structuredContent.tree;
  assert.equal(tree[0].tag, "main");
  assert.deepEqual(tree[0].children.map((c) => c.tag), ["h1", "button"]);

  // Security & validation refusals on create_layers.
  assert.equal((await agent.call("create_layers", { nodes: [{ tag: "script", text: "alert(1)" }] })).isError, true, "script tag refused");
  assert.equal((await agent.call("create_layers", { nodes: [{ tag: "div", style: { background: "url(https://evil.example/x.png)" } }] })).isError, true, "url() style refused");
  assert.equal((await agent.call("create_layers", { nodes: [{ tag: "div", style: { color: "a".repeat(2001) } }] })).isError, true, "oversized style value refused");
  assert.equal((await agent.call("create_layers", { nodes: [{ tag: "div", name: "bad\u202ename" }] })).isError, true, "bidi smuggling in nodes[].name refused");
  assert.equal((await agent.call("create_layers", { nodes: [{ tag: "button", attributes: { onclick: "alert(1)" } }] })).isError, true, "event handler attribute refused");
  assert.equal((await agent.call("create_layers", { nodes: [{ tag: "a", attributes: { href: "javascript:alert(1)" } }] })).isError, true, "javascript: href refused");
  assert.equal((await agent.call("create_layers", { nodes: [{ tag: "div", attributes: { dir: "sideways" } }] })).isError, true, "invalid dir attribute refused");
  assert.equal((await agent.call("create_layers", { nodes: [{ tag: "div", attributes: { ["__proto__"]: "pollute" } }] })).isError, true, "__proto__ attribute name refused");
  assert.equal((await agent.call("create_layers", { nodes: [{ type: null, tag: "div" }] })).isError, true, "null type refused");

  // 2. import_source: HTML (strips script, preserves semantics & linked CSS), JSX, CSS tokens, and W3C DTCG JSON.
  const htmlImport = await agent.call("import_source", {
    format: "html",
    name: "Imported Hero",
    source: '<html><head><link rel="stylesheet" href="hero.css"></head><body><section><script>alert(1)</script><h2>Hello HTML</h2><p>Clean copy</p></section></body></html>',
    stylesheets: [{ name: "hero.css", css: "h2 { color: #0f172a; }" }],
  });
  assert.equal(htmlImport.isError, undefined, text(htmlImport));
  assert.equal(htmlImport.structuredContent.format, "html");
  assert.ok(htmlImport.structuredContent.layers >= 3);

  const jsxImport = await agent.call("import_source", {
    format: "jsx",
    name: "MetricCard",
    source: 'export function MetricCard() { return <article style={{ padding: "16px" }}><h3>Revenue</h3><p>$42k</p></article>; }',
  });
  assert.equal(jsxImport.isError, undefined, text(jsxImport));
  assert.equal(jsxImport.structuredContent.componentName, "MetricCard");

  const cssTokens = await agent.call("import_source", {
    format: "tokens-css",
    name: "theme.css",
    source: ":root { --surface-bg: #ffffff; --brand-accent: #2563eb; } .dark { --surface-bg: #0b1020; }",
  });
  assert.equal(cssTokens.isError, undefined, text(cssTokens));
  assert.equal(cssTokens.structuredContent.adds, 2);

  const dtcgTokens = await agent.call("import_source", {
    format: "tokens-json",
    name: "tokens.json",
    source: JSON.stringify({
      color: {
        $type: "color",
        primary: { $value: "{brand.accent}", $description: "Primary brand action", $extensions: { modes: { dark: "#60a5fa" } } },
        muted: { $value: "#64748b" },
      },
      layout: {
        gutter: { $type: "dimension", $value: { value: 16, unit: "px" } },
      },
      elevation: {
        sm: { $type: "shadow", $value: { offsetX: "0px", offsetY: "2px", blur: "8px", color: "rgba(15, 23, 42, 0.12)" } },
      },
    }),
  });
  assert.equal(dtcgTokens.isError, undefined, text(dtcgTokens));
  assert.equal(dtcgTokens.structuredContent.adds, 4);

  // Verify explicit DTCG $type and $description were preserved instead of guessed as "color".
  const listed = (await agent.call("design_tokens")).structuredContent.tokens;
  assert.equal(listed.find((t) => t.name === "--layout-gutter")?.type, "spacing");
  assert.equal(listed.find((t) => t.name === "--elevation-sm")?.type, "shadow");
  assert.equal(listed.find((t) => t.name === "--color-primary")?.description, "Primary brand action");

  // Verify DTCG security edge cases: empty-slug alias {---} and nested shadow objects are skipped, not committed as var(--) or stack-overflowed.
  const badDtcg = await agent.call("import_source", {
    format: "tokens-json",
    name: "bad.json",
    source: JSON.stringify({
      badAlias: { $type: "color", $value: "{---}" },
      nestedShadow: { $type: "shadow", $value: { offsetX: { offsetX: "0px", offsetY: "0px", color: "#000" }, offsetY: "2px", color: "#000" } },
      badDark: { $type: "color", $value: "#ffffff", $extensions: { modes: { dark: "url(https://evil.example/a)" } } },
    }),
  });
  assert.equal(badDtcg.isError, undefined, text(badDtcg));
  assert.equal(badDtcg.structuredContent.adds, 0);
  assert.equal(badDtcg.structuredContent.skipped, 3);

  // Verify #64 label sanitization: BiDi-smuggled DTCG $description is refused.
  const smuggledDesc = await agent.call("import_source", {
    format: "tokens-json",
    name: "smuggled.json",
    source: JSON.stringify({
      brand: { $type: "color", $value: "#111111", $description: "Safe\u202egnp.exe" },
    }),
  });
  assert.equal(smuggledDesc.isError, true, "BiDi-smuggled DTCG $description refused");

  // 3. export_design: tsx, tokens-css, tokens-json (no nodeId required for tokens) + lossless round-trip + __proto__ safety.
  const tsxOut = (await agent.call("export_design", { nodeId: pageId, format: "tsx", name: "PricingView" })).structuredContent;
  assert.ok(tsxOut.path.endsWith("PricingView.tsx"));
  const tsxSource = readFileSync(tsxOut.path, "utf8");
  assert.match(tsxSource, /^import type React from "react";/u);
  assert.match(tsxSource, /React\.JSX\.Element/u);

  const cssOut = (await agent.call("export_design", { format: "tokens-css", name: "design-tokens" })).structuredContent;
  assert.ok(cssOut.path.endsWith("design-tokens.css"));
  assert.match(readFileSync(cssOut.path, "utf8"), /--brand-accent: #2563eb/u);

  const jsonOut = (await agent.call("export_design", { format: "tokens-json", name: "design-tokens" })).structuredContent;
  assert.ok(jsonOut.path.endsWith("design-tokens.json"));
  const exportedDtcgText = readFileSync(jsonOut.path, "utf8");
  const exportedDtcg = JSON.parse(exportedDtcgText);
  assert.equal(exportedDtcg["brand-accent"].$value, "#2563eb");
  assert.equal(exportedDtcg["color-primary"].$value, "{brand-accent}");
  // Round-trip re-import of exported DTCG JSON adds 0 duplicate tokens.
  const reimported = await agent.call("import_source", { format: "tokens-json", name: "roundtrip.json", source: exportedDtcgText });
  assert.equal(reimported.isError, undefined, text(reimported));
  assert.equal(reimported.structuredContent.adds, 0, "exported DTCG round-trips without duplicating prefixes");

  // Token named --__proto__ exports safely without prototype mutation.
  const protoTok = await agent.call("set_token", { name: "--__proto__", type: "color", collection: "base", values: { default: "#123456" } });
  assert.equal(protoTok.isError, undefined, text(protoTok));
  const protoExport = (await agent.call("export_design", { format: "tokens-json", name: "proto-tokens" })).structuredContent;
  assert.match(readFileSync(protoExport.path, "utf8"), /"__proto__":\s*\{/u, "--__proto__ serializes as an own key");

  // Multi-collection cross-collection alias resolves target collection accurately in DTCG export.
  await agent.call("set_token", { name: "--sem-accent", type: "color", collection: "base", values: { default: "var(--brand-accent)" } });
  const multiExport = (await agent.call("export_design", { format: "tokens-json", name: "alias-tokens" })).structuredContent;
  assert.equal(JSON.parse(readFileSync(multiExport.path, "utf8"))["sem-accent"].$value, "{brand-accent}");

  // 4. Live-lock refusal vs stale-lock recovery via open_project({ breakStaleLock: true }).
  const rival = engine(projects);
  await rival.initialize("Rival");
  const liveRefused = await rival.call("open_project", { name: "authoring", breakStaleLock: true });
  assert.equal(liveRefused.isError, true, "breakStaleLock refuses a lock held by a live process");
  await rival.stop();

  await agent.call("close_project");
  await agent.stop();

  const lockPath = join(projects, "authoring", PROJECT_FILES.directory, "lock");
  writeFileSync(lockPath, JSON.stringify({ holderId: "crashed", pid: 999_999, acquiredAt: "2026-01-01T00:00:00.000Z" }));
  const recover = engine(projects);
  await recover.initialize("Recovery");
  assert.equal((await recover.call("open_project", { name: "authoring" })).isError, true, "stale lock refused without breakStaleLock");
  const recovered = await recover.call("open_project", { name: "authoring", breakStaleLock: true });
  assert.equal(recovered.isError, undefined, text(recovered));
  assert.equal(recovered.structuredContent.project, "authoring");
  await recover.stop();
}));


test("DTCG export resolves cross-collection aliases, ignores var() in quoted strings, and round-trips cleanly", () => {
  const doc = {
    rootIds: ["ds-1"],
    nodes: {
      "ds-1": {
        id: "ds-1",
        type: "design-system",
        props: {
          name: "Multi",
          collections: [
            { id: "primitives", name: "Primitives", modes: [{ id: "default", name: "Default" }], defaultMode: "default" },
            { id: "semantic", name: "Semantic", modes: [{ id: "light", name: "Light" }, { id: "dark", name: "Dark" }], defaultMode: "light" },
          ],
          tokens: [
            { name: "--teal-500", type: "color", collection: "primitives", values: { default: "#0f766e" } },
            { name: "--brand-action", type: "color", collection: "semantic", values: { light: "var(--teal-500)", dark: "#2dd4bf" }, description: "Primary CTA" },
            { name: "--font-note", type: "fontFamily", collection: "primitives", values: { default: "'var(--teal-500)', sans-serif" } },
          ],
        },
      },
    },
  };
  const json = exportDtcgTokens(doc);
  const parsedObj = JSON.parse(json);
  assert.equal(parsedObj.semantic["brand-action"].$value, "{primitives.teal-500}", "cross-collection alias points at primitives");
  assert.equal(parsedObj.primitives["font-note"].$value, "'var(--teal-500)', sans-serif", "var() inside CSS string stays untouched");
  const re = parseDtcgTokens(json);
  assert.equal(re.theme["teal-500"], "#0f766e");
  assert.equal(re.light["brand-action"], "var(--teal-500)", "grouped DTCG re-import strips collection wrapper cleanly");
  assert.equal(re.dark["brand-action"], "#2dd4bf");
  assert.equal(re.types["font-note"], "fontFamily");
  assert.equal(re.descriptions["brand-action"], "Primary CTA");
});


test("an agent plans aesthetic directions, sets a product brief with seeded tokens, evaluates taste, applies reduced-motion presets, and reads skills via MCP", () => withProjects(async (projects) => {
  const agent = engine(projects);
  await agent.initialize("DesignAgent");
  await agent.call("create_project", { name: "intel" });

  // 1. Read archetypes, plan 3 distinct directions, and read skills.
  const archs = (await agent.call("design_intelligence", { action: "archetypes" })).structuredContent;
  assert.equal(archs.archetypes.length, 9);

  const plan = (await agent.call("design_intelligence", { action: "plan", productName: "PulseOps", domain: "developer-tools", density: "compact" })).structuredContent;
  assert.equal(plan.directions.length, 3);
  const chosenId = plan.recommendedDirectionId;

  const skills = (await agent.call("design_intelligence", { action: "skills" })).structuredContent;
  assert.equal(skills.skills.length, 19);
  const motionSkill = (await agent.call("design_intelligence", { action: "skill", skillId: "motion" })).structuredContent;
  assert.match(motionSkill.markdown, /^---\nname: ninerr-motion\n/u);

  // 2. Store brief + seed direction tokens in one atomic undoable transaction; BiDi refused.
  assert.equal((await agent.call("set_design_brief", { productName: "Bad\u202eName", domain: "fintech" })).isError, true, "BiDi brief rejected");
  const seeded = await agent.call("set_design_brief", {
    productName: "PulseOps",
    domain: "developer-tools",
    density: "compact",
    themePreference: "dark",
    applyDirectionId: chosenId,
  });
  assert.equal(seeded.isError, undefined, text(seeded));
  assert.ok(seeded.structuredContent.seededTokens >= 30);

  const briefRead = (await agent.call("design_intelligence", { action: "brief" })).structuredContent;
  assert.equal(briefRead.brief.productName, "PulseOps");

  // 3. Create a frame with a low-contrast child, run taste critique, and apply reduced-motion presets.
  const built = (await agent.call("create_layers", {
    nodes: [
      { tempId: "root", type: "frame", tag: "main", name: "Console", style: { padding: "48px", background: "linear-gradient(90deg, #6366f1, #ec4899)" } },
      { parentId: "root", type: "element", tag: "p", name: "Faint", text: "Low contrast", style: { color: "#aaaaaa", "background-color": "#bbbbbb" } },
    ],
  })).structuredContent;
  const rootId = built.created[0].nodeId;

  const taste = (await agent.call("design_intelligence", { action: "taste", nodeId: rootId })).structuredContent;
  assert.ok(taste.summary.deterministicDefects >= 1);
  assert.ok(taste.findings.some((f) => f.ruleId === "taste:color-low-contrast"));
  assert.ok(taste.findings.some((f) => f.ruleId === "taste:anti-slop-gratuitous-gradient"));

  const applied = await agent.call("apply_motion", { nodeId: rootId, presetIds: ["hover", "focus", "enter"] });
  assert.equal(applied.isError, undefined, text(applied));
  assert.equal(applied.structuredContent.nodeId, rootId);
  assert.equal(applied.structuredContent.selector, ":scope", "default apply_motion selector is :scope so exports match");

  // Consecutive apply_motion preserves prior motion presets and rejects invalid selectors or reducedMotion: "none".
  assert.equal((await agent.call("apply_motion", { nodeId: rootId, presetIds: ["press"], selector: 'bad[attr="unclosed' })).isError, true, "unbalanced selector refused");
  assert.equal((await agent.call("apply_motion", { nodeId: rootId, presetIds: ["press"], reducedMotion: "none" })).isError, true, "reducedMotion: none refused over MCP");
  const appliedPress = await agent.call("apply_motion", { nodeId: rootId, presetIds: ["press"], reducedMotion: "minimal" });
  assert.equal(appliedPress.isError, undefined, text(appliedPress));
  const motionAfter = (await agent.call("design_intelligence", { action: "brief" })).structuredContent.motion;
  assert.ok(motionAfter.presets.some((p) => p.id === "enter") && motionAfter.presets.some((p) => p.id === "press"), "consecutive apply_motion merges presets non-destructively");
  // Re-apply enter so exported HTML contains keyframes for the check below.
  await agent.call("apply_motion", { nodeId: rootId, presetIds: ["hover", "focus", "enter"] });

  // Verify motion stylesheet compiles cleanly into exported HTML with prefers-reduced-motion, while tokens CSS stays :root/mode only.
  const htmlOut = (await agent.call("export_design", { nodeId: rootId, format: "html", name: "console" })).structuredContent;
  const htmlText = readFileSync(htmlOut.path, "utf8");
  assert.match(htmlText, /@keyframes ninerr-enter/u);
  assert.match(htmlText, /prefers-reduced-motion: reduce/u);
  assert.doesNotMatch(htmlText, /scroll-behavior/iu);

  const tokCssOut = (await agent.call("export_design", { format: "tokens-css", name: "tokens" })).structuredContent;
  const tokCssText = readFileSync(tokCssOut.path, "utf8");
  assert.match(tokCssText, /--ease-out:/u);
  assert.doesNotMatch(tokCssText, /@keyframes|@media/iu);

  const lintClean = (await agent.call("design_intelligence", { action: "motion_lint", nodeId: rootId })).structuredContent;
  assert.deepEqual(lintClean.findings, [], "applied Ninerr motion stylesheet has 0 lint findings");
  assert.equal((await agent.call("design_intelligence", { action: "motion_frequency", trigger: "click", presetId: "unknown-preset" })).isError, true, "unknown motion_frequency preset returns ToolError");

  await agent.call("close_project");

  // 4. Token missing defaultMode & dark-as-default set_design_brief({ applyDirectionId }) preserves light and dark modes safely.
  await agent.call("create_project", { name: "dark-default" });
  const initTok = await agent.call("set_token", { name: "--bg-surface", type: "spacing", collection: "base", values: { default: "16px" } });
  assert.equal(initTok.isError, undefined, text(initTok));
  const addAlt = await agent.call("add_token_mode", { collection: "base", id: "alt", name: "Alt" });
  assert.equal(addAlt.isError, undefined, text(addAlt));
  const onlyAltSet = await agent.call("set_token", { name: "--only-alt", type: "color", collection: "base", values: { alt: "#123456" } });
  assert.equal(onlyAltSet.isError, undefined, text(onlyAltSet));
  const fintechPlan = (await agent.call("design_intelligence", { action: "plan", productName: "Vault", domain: "fintech" })).structuredContent;
  const darkSeeded = await agent.call("set_design_brief", {
    productName: "Vault",
    domain: "fintech",
    applyDirectionId: fintechPlan.recommendedDirectionId,
  });
  assert.equal(darkSeeded.isError, undefined, text(darkSeeded));
  const tokensAfter = (await agent.call("design_tokens")).structuredContent.tokens;
  const onlyAlt = tokensAfter.find((t) => t.name === "--only-alt");
  assert.deepEqual(onlyAlt.values, { alt: "#123456" }, "token missing defaultMode is never backfilled with undefined");
  const bgSurface = tokensAfter.find((t) => t.name === "--bg-surface");
  assert.equal(bgSurface.type, "color", "existing token type reconciled to planned token type");
  assert.notEqual(bgSurface.values.default, bgSurface.values.dark, "light and dark values stay distinct");
  await agent.call("close_project");

  // 5. True dark-as-default collection (defaultMode: "dark", only dark mode) creates a distinct light mode without dropping light values.
  const darkDoc = createDocument({ id: "doc-dark-only", name: "Dark First" });
  darkDoc.schemaVersion = 2;
  darkDoc.rootIds.push("ds-dark");
  darkDoc.nodes["ds-dark"] = {
    id: "ds-dark",
    type: "design-system",
    parentId: null,
    children: [],
    metadata: {},
    props: {
      name: "Dark DS",
      collections: [{ id: "base", name: "Base", modes: [{ id: "dark", name: "Dark" }], defaultMode: "dark" }],
      tokens: [{ name: "--existing-dark", type: "color", collection: "base", values: { dark: "#090d16" } }],
    },
  };
  const darkProjectDir = join(projects, "dark-only");
  mkdirSync(darkProjectDir, { recursive: true });
  createProject(darkProjectDir, { projectId: "dark-only", document: darkDoc, createdAt: "2026-11-27T00:00:00.000Z" });
  const openDark = await agent.call("open_project", { name: "dark-only" });
  assert.equal(openDark.isError, undefined, text(openDark));
  const darkOnlySeed = await agent.call("set_design_brief", {
    productName: "Nocturne",
    domain: "developer-tools",
    applyDirectionId: chosenId,
  });
  assert.equal(darkOnlySeed.isError, undefined, text(darkOnlySeed));
  const darkOnlyTokens = (await agent.call("design_tokens")).structuredContent;
  assert.ok(darkOnlyTokens.collections[0].modes.some((m) => m.id === "light"), "light mode created for dark-as-default collection");
  const darkOnlyBg = darkOnlyTokens.tokens.find((t) => t.name === "--bg-surface");
  assert.ok(typeof darkOnlyBg.values.light === "string" && typeof darkOnlyBg.values.dark === "string");
  assert.notEqual(darkOnlyBg.values.light, darkOnlyBg.values.dark, "dark-as-default preserves distinct light and dark token values");

  await agent.call("close_project");
  await agent.stop();
}));
