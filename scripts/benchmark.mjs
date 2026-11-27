#!/usr/bin/env node
// Run Ninerr's reproducible 14-category design and engineering benchmark locally (zero egress).
//   node scripts/benchmark.mjs [--category <id>] [--vision] [--out <file>] [--json]

import { readFileSync } from "node:fs";
import { runCliCommand } from "../packages/studio-host/src/index.ts";

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const argv = process.argv.slice(2);
const subArgs = argv[0] === "run" || argv[0] === "list" || argv[0] === "help" ? argv : ["run", ...argv];
process.exitCode = await runCliCommand("benchmark", subArgs, { version });
