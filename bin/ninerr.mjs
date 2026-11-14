#!/usr/bin/env node
// The ninerr command.
//
//   ninerr mcp [--projects <folder>]
//
// runs Ninerr's headless engine: an MCP server on stdio for an agent's client (Codex, Claude
// Code, OpenCode, Cursor, Gemini CLI and others) to start. It needs no editor, browser or
// desktop app, no account and no network. Projects are kept in the projects folder: --projects,
// or NINERR_PROJECTS, or "Ninerr Projects" in your home folder.
import { prepareProjectsFolder, resolveProjectsFolder, runHeadless } from "../packages/studio-host/src/index.ts";

const USAGE = "usage: ninerr mcp [--projects <folder>]";

function fail(message) {
  process.stderr.write(`ninerr: ${message}\n${USAGE}\n`);
  process.exit(2);
}

const [command, ...args] = process.argv.slice(2);
if (command !== "mcp") fail(command === undefined ? "name a command" : `unknown command ${JSON.stringify(command)}`);
let projects;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--projects" && args[index + 1] !== undefined && !args[index + 1].startsWith("--")) projects = args[++index];
  else fail(`unknown option ${JSON.stringify(args[index])}`);
}

const { path: projectsRoot, note: folderNote } = resolveProjectsFolder(projects);
try {
  const { note } = prepareProjectsFolder(projectsRoot);
  // stdout carries MCP only: notes go to stderr, which clients show in their logs.
  for (const line of [folderNote, note]) if (line !== null) process.stderr.write(`ninerr: note: ${line}\n`);
} catch (error) {
  fail(`cannot use the projects folder ${projectsRoot}: ${error instanceof Error ? error.message : String(error)}`);
}
process.stderr.write(`ninerr: headless engine on stdio, projects folder ${projectsRoot}\n`);
await runHeadless({ projectsRoot, input: process.stdin, output: process.stdout });
