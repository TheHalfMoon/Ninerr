import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildEngine, workspaceImportsIn } from "../scripts/build-engine.mjs";

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
  for (const excluded of ["@ninerr/studio-web", "@ninerr/agent-supervisor", "@ninerr/visual-git", "@ninerr/decision-router", "@ninerr/architecture", "@ninerr/delivery-governance"]) {
    assert.ok(!engine.bundleDependencies.includes(excluded), `${excluded} is not bundled in the headless engine`);
  }
  for (const name of ["@ninerr/studio-host", "@ninerr/persistence", "@ninerr/mcp-protocol", "@ninerr/document-model"]) assert.ok(engine.bundleDependencies.includes(name), name);
  for (const [name, version] of Object.entries(engine.dependencies)) {
    if (name.startsWith("@ninerr/")) continue;
    assert.equal(version, lock.packages[`node_modules/${name}`].version, `${name} is the locked version, exactly`);
  }
  const files = filesUnder(out);
  assert.deepEqual(files.filter((file) => file.endsWith(".ts")), [], "no TypeScript");
  for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md", "SECURITY.md", "README.md"]) assert.ok(existsSync(join(out, file)), file);
  // Every relative import AND every @ninerr/* workspace import in every built module resolves.
  // Import and export statements, and dynamic imports: not text in data that only looks like one.
  const IMPORT = /^\s*(?:import|export)\b[^;\n]*?\bfrom\s*["'](\.{1,2}\/[^"'\n]+)["']|^\s*import\s*["'](\.{1,2}\/[^"'\n]+)["']|\bimport\(\s*["'](\.{1,2}\/[^"'\n]+)["']\s*\)/gmu;
  for (const file of files.filter((path) => /\.(m?js|cjs)$/u.test(path))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      assert.ok(existsSync(join(dirname(file), specifier)), `${file.slice(out.length)} imports ${specifier}`);
    }
    for (const pkg of workspaceImportsIn(text)) {
      assert.ok(existsSync(join(out, "node_modules", "@ninerr", pkg, "package.json")), `${file.slice(out.length)} imports @ninerr/${pkg}`);
    }
  }
  assert.deepEqual(
    workspaceImportsIn([
      'const quoteRe = /["\']/u;',
      'const html = `<!doctype html>${css === "" ? "" : `<style>${css}</style>`}</head>`;',
      'const tick = `${x.replace("`", "\'")} ${(await import("@ninerr/epsilon")).x}`;',
      'function f(x) { const a = 1\nreturn /["\']/u.test(x); }',
      'import/*c*/"@ninerr/zeta";',
      'import { a } from "@ninerr/alpha";',
      'export { b } from "@ninerr/beta/subpath";',
      'const c = await import("@ninerr/gamma/deep/mod.mjs");',
      'const d = require("@ninerr/delta");',
      '// moved from "@ninerr/ignored-line-comment"',
      '/* copied from "@ninerr/ignored-block-comment" */',
      'const doc = \'example: import x from "@ninerr/ignored-string"\';',
    ].join("\n")),
    ["alpha", "beta", "delta", "epsilon", "gamma", "zeta"],
  );
  const codeTs = readFileSync(join(ROOT, "packages", "studio-host", "src", "code.ts"), "utf8");
  assert.ok(workspaceImportsIn(`${codeTs}\nimport { __s } from "@ninerr/sentinel-check";\n`).includes("sentinel-check"));
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
    // Programmatic local SDK entrypoint (`sdk.mjs`) loads via @ninerr/studio-host/sdk exports from both global and local installs.
    const sdkProbe = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `import * as sdk from ${JSON.stringify(pathToFileURL(join(home, "sdk.mjs")).href)}; const p = sdk.planDesignDirections({ domain: "enterprise-saas", productName: "Probe" }); const pat = sdk.extractPatternsFromSource({ html: "<main><h1>Hi</h1></main>", css: ":root { --a: #111; }" }); console.log(JSON.stringify({ dirs: p.directions.length, policy: pat.rightsPolicy, vue: typeof sdk.exportVue, inv: typeof sdk.verifyFunctionalInvariance }));`],
      { encoding: "utf8" },
    );
    assert.equal(sdkProbe.status, 0, sdkProbe.stdout + sdkProbe.stderr);
    assert.deepEqual(JSON.parse(sdkProbe.stdout), { dirs: 3, policy: "observed-inspiration-only", vue: "function", inv: "function" });

    // Local `npm install <tarball>` supports bare-specifier `import("ninerr")` and `import("ninerr/sdk")`.
    const consumer = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-sdk-consumer-")));
    try {
      const localInstall = npm(["install", "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund", tarball], consumer);
      assert.equal(localInstall.status, 0, localInstall.stderr);
      const bareProbe = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", 'import * as a from "ninerr"; import * as b from "ninerr/sdk"; console.log(JSON.stringify({ same: a.planDesignDirections === b.planDesignDirections, dirs: a.planDesignDirections({ domain: "fintech", productName: "Desk" }).directions.length, vue: typeof b.exportVue }));'],
        { cwd: consumer, encoding: "utf8" },
      );
      assert.equal(bareProbe.status, 0, bareProbe.stdout + bareProbe.stderr);
      assert.deepEqual(JSON.parse(bareProbe.stdout), { same: true, dirs: 3, vue: "function" });
    } finally {
      rmSync(consumer, { recursive: true, force: true, maxRetries: 5 });
    }
  } finally {
    for (const folder of [packs, prefix, projects]) rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
  }
}));
