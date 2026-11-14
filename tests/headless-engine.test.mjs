import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { PROJECT_FILES } from "../packages/persistence/src/index.ts";
import { runHeadless } from "../packages/studio-host/src/index.ts";

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
