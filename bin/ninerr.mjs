#!/usr/bin/env node
// The ninerr command.
//
//   ninerr mcp [--projects <folder>]     the headless engine: an MCP server on stdio
//   ninerr doctor [--projects <folder>]  check this computer's setup, and print client configuration
//   ninerr --version | help
//
// `ninerr mcp` is for an agent's client (Codex, Claude Code, OpenCode, Cursor, Gemini CLI and
// others) to start. It needs no editor, browser or desktop app, no account and no network.
// Projects are kept in the projects folder: --projects, or NINERR_PROJECTS, or "Ninerr Projects"
// in your home folder.
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { prepareProjectsFolder, resolveProjectsFolder, runHeadless } from "../packages/studio-host/src/index.ts";

const USAGE = "usage: ninerr mcp [--projects <folder>] | ninerr doctor [--projects <folder>] | ninerr --version";
const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

function fail(message) {
  process.stderr.write(`ninerr: ${message}\n${USAGE}\n`);
  process.exit(2);
}

const [command, ...args] = process.argv.slice(2);
if (command === "--version" || command === "version") {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}
if (command === "help" || command === "--help" || command === "-h") {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}
if (command !== "mcp" && command !== "doctor") fail(command === undefined ? "name a command" : `unknown command ${JSON.stringify(command)}`);
let projects;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--projects" && args[index + 1] !== undefined && !args[index + 1].startsWith("--")) projects = args[++index];
  else fail(`unknown option ${JSON.stringify(args[index])}`);
}
const { path: projectsRoot, note: folderNote } = resolveProjectsFolder(projects);

if (command === "doctor") {
  process.exitCode = await doctor();
} else {
  try {
    const { note } = prepareProjectsFolder(projectsRoot);
    // stdout carries MCP only: notes go to stderr, which clients show in their logs.
    for (const line of [folderNote, note]) if (line !== null) process.stderr.write(`ninerr: note: ${line}\n`);
  } catch (error) {
    fail(`cannot use the projects folder ${projectsRoot}: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.stderr.write(`ninerr: headless engine on stdio, projects folder ${projectsRoot}\n`);
  // A client that goes away closes stdin, which ends the engine and closes the open project.
  // A stopped client (a signal) or a closed stdout ends it the same way.
  const stop = () => process.stdin.destroy();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.stdout.on("error", stop);
  await runHeadless({ projectsRoot, input: process.stdin, output: process.stdout });
}

/** Check the setup, each check with what to do when it fails; 0 when all pass. */
async function doctor() {
  let failed = 0;
  const say = (ok, what, fix) => {
    process.stdout.write(`${ok ? "ok  " : "FAIL"} ${what}${ok || fix === undefined ? "" : `\n     ${fix}`}\n`);
    if (!ok) failed += 1;
  };
  process.stdout.write(`Ninerr ${VERSION}\n`);
  const [major, minor] = process.versions.node.split(".").map(Number);
  say((major === 22 && minor >= 18) || (major === 24 && minor >= 11) || major > 24, `Node.js ${process.versions.node}`, "Install Node.js 22.18 or a later 22.x, or 24.11 or later, from https://nodejs.org.");
  try {
    const { note } = prepareProjectsFolder(projectsRoot);
    say(true, `projects folder ${projectsRoot}${note === null ? "" : ` (${note})`}`);
  } catch (error) {
    say(false, `projects folder ${projectsRoot}`, `${error instanceof Error ? error.message : String(error)}. Choose another with --projects <folder>, or set NINERR_PROJECTS.`);
  }
  // The engine itself, end to end, in a scratch folder: create a project, design in it, read it back.
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-doctor-")));
  try {
    const input = new PassThrough();
    const output = new PassThrough();
    const answers = new Map();
    createInterface({ input: output }).on("line", (line) => {
      const message = JSON.parse(line);
      answers.get(message.id)?.(message);
    });
    const running = runHeadless({ projectsRoot: scratch, input, output });
    const rpc = (id, method, params) => new Promise((resolve) => {
      answers.set(id, resolve);
      input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
    await rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ninerr doctor", version: VERSION } });
    const created = await rpc(2, "tools/call", { name: "create_project", arguments: { name: "doctor" } });
    const frame = await rpc(3, "tools/call", { name: "create_frame", arguments: { name: "Check", width: 100, height: 100 } });
    const preview = await rpc(4, "tools/call", { name: "export_design", arguments: { nodeId: frame.result?.structuredContent?.nodeId ?? "", format: "html" } });
    input.end();
    await running;
    const ok = created.result?.isError === undefined && frame.result?.isError === undefined && preview.result?.isError === undefined;
    say(ok, "the engine creates a project, designs in it and writes a preview", ok ? undefined : `The engine answered: ${JSON.stringify([created, frame, preview].map((answer) => answer.result?.content?.[0]?.text ?? answer.error)).slice(0, 400)}`);
  } catch (error) {
    say(false, "the engine creates a project, designs in it and writes a preview", error instanceof Error ? error.message : String(error));
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
  }
  // How an MCP client starts the engine: this Node.js and this command, by absolute paths.
  const server = { command: process.execPath, args: [realpathSync(process.argv[1]), "mcp", "--projects", projectsRoot] };
  process.stdout.write(`\nTo connect an agent, give its client this MCP server (docs/ENGINE.md shows each client's file):\n  command: ${JSON.stringify(server.command)}\n  args:    ${JSON.stringify(server.args)}\n`);
  process.stdout.write(`\n${failed === 0 ? "Everything Ninerr needs is in place." : `${failed} check${failed === 1 ? "" : "s"} failed.`}\n`);
  return failed === 0 ? 0 : 1;
}
