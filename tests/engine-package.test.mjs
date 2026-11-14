import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildEngine } from "../scripts/build-engine.mjs";

// The Ninerr Engine package (docs/HEADLESS.md, increment 4): built with no TypeScript left in it,
// installed the way a person installs it, and checked by its own `ninerr doctor`.

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const product = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));

function filesUnder(folder) {
  const found = [];
  const walk = (path) => {
    for (const name of readdirSync(path)) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) walk(full);
      else found.push(full);
    }
  };
  walk(folder);
  return found;
}

/** Build into a folder under dist/, where the repository's own third-party packages resolve. */
function withBuild(callback) {
  const out = join(ROOT, "dist", `test-engine-${process.pid}-${Date.now()}`);
  try {
    return callback(out, buildEngine(out));
  } finally {
    rmSync(out, { recursive: true, force: true, maxRetries: 5 });
  }
}

test("the engine package carries no TypeScript, every import in it resolves, and it names exact versions", () => withBuild((out, engine) => {
  assert.equal(engine.name, "ninerr");
  assert.equal(engine.version, product.version);
  assert.deepEqual(engine.bin, { ninerr: "bin/ninerr.mjs" });
  assert.ok(!engine.bundleDependencies.includes("@ninerr/desktop"), "the frozen desktop app is not in the engine");
  for (const name of ["@ninerr/studio-host", "@ninerr/persistence", "@ninerr/mcp-protocol", "@ninerr/document-model"]) assert.ok(engine.bundleDependencies.includes(name), name);
  for (const [name, version] of Object.entries(engine.dependencies)) {
    if (name.startsWith("@ninerr/")) continue;
    assert.equal(version, lock.packages[`node_modules/${name}`].version, `${name} is the locked version, exactly`);
  }
  const files = filesUnder(out);
  assert.deepEqual(files.filter((file) => file.endsWith(".ts")), [], "no TypeScript");
  for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md", "SECURITY.md", "README.md"]) assert.ok(existsSync(join(out, file)), file);
  // Every relative import in every module names a file that is there.
  // Import and export statements, and dynamic imports: not text in data that only looks like one.
  const IMPORT = /^\s*(?:import|export)\b[^;\n]*?\bfrom\s*["'](\.{1,2}\/[^"'\n]+)["']|^\s*import\s*["'](\.{1,2}\/[^"'\n]+)["']|\bimport\(\s*["'](\.{1,2}\/[^"'\n]+)["']\s*\)/gmu;
  for (const file of files.filter((path) => /\.(m?js)$/u.test(path))) {
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      assert.ok(existsSync(join(dirname(file), specifier)), `${file.slice(out.length)} imports ${specifier}`);
    }
  }
  for (const manifest of files.filter((path) => path.endsWith(`${"package.json"}`) && path !== join(out, "package.json"))) {
    const bundled = JSON.parse(readFileSync(manifest, "utf8"));
    assert.equal(bundled.dependencies, undefined, `${bundled.name} declares no dependencies of its own`);
  }
  const version = spawnSync(process.execPath, [join(out, "bin", "ninerr.mjs"), "--version"], { encoding: "utf8" });
  assert.equal(version.stdout.trim(), product.version);
}));

test("installed with npm, the engine checks out with `ninerr doctor`, and its tarball is reproducible", { timeout: 300_000 }, () => withBuild((out) => {
  const npm = (args, cwd) => (process.platform === "win32"
    ? spawnSync(`npm ${args.map((arg) => `"${arg}"`).join(" ")}`, { cwd, encoding: "utf8", shell: true })
    : spawnSync("npm", args, { cwd, encoding: "utf8" }));
  const packs = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-pack-")));
  const prefix = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-prefix-")));
  const projects = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-projects-")));
  try {
    const first = npm(["pack", "--json", "--pack-destination", packs], out);
    assert.equal(first.status, 0, first.stderr);
    const tarball = join(packs, JSON.parse(first.stdout)[0].filename);
    const digest = createHash("sha256").update(readFileSync(tarball)).digest("hex");
    // Built and packed again: the same bytes.
    buildEngine(out);
    const again = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-pack-")));
    try {
      assert.equal(npm(["pack", "--pack-destination", again], out).status, 0);
      assert.equal(createHash("sha256").update(readFileSync(join(again, readdirSync(again)[0]))).digest("hex"), digest, "the same tarball");
    } finally {
      rmSync(again, { recursive: true, force: true });
    }
    // Installed as docs/MCP_CLIENTS.md says: no install scripts run.
    const installed = npm(["install", "-g", "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund", "--prefix", prefix, tarball], ROOT);
    assert.equal(installed.status, 0, installed.stderr);
    const home = process.platform === "win32" ? join(prefix, "node_modules", "ninerr") : join(prefix, "lib", "node_modules", "ninerr");
    assert.ok(existsSync(process.platform === "win32" ? join(prefix, "ninerr.cmd") : join(prefix, "bin", "ninerr")), "the ninerr command is installed");
    const doctor = spawnSync(process.execPath, [join(home, "bin", "ninerr.mjs"), "doctor", "--projects", projects], { encoding: "utf8" });
    assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
    assert.match(doctor.stdout, /ok {3}the engine creates a project, designs in it and writes a preview/u);
    assert.match(doctor.stdout, /Everything Ninerr needs is in place\./u);
  } finally {
    for (const folder of [packs, prefix, projects]) rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
  }
}));
