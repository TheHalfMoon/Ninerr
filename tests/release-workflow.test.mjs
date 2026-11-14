import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// P07d (#187): the release workflow's trust boundaries. Repository and dependency code runs
// only in jobs that cannot sign or write; the jobs that sign and publish run on pushed tags
// only, run no repository code, publish only a draft, and create no tag.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const release = read(".github/workflows/release.yml");

/** The workflow's jobs, each as its own block of text (two-space indented keys under `jobs:`). */
function jobs(text) {
  const body = text.slice(text.indexOf("\njobs:\n") + "\njobs:\n".length);
  const result = {};
  for (const block of body.split(/^(?=  [a-z][a-z-]*:$)/m)) {
    const name = /^  ([a-z][a-z-]*):$/m.exec(block)?.[1];
    if (name) result[name] = block;
  }
  return result;
}

const TAG_ONLY = "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')";
const all = jobs(release);

test("the release workflow has its five jobs, in their order of trust", () => {
  assert.deepEqual(Object.keys(all), ["build", "desktop", "collect", "attest", "publish"]);
  assert.match(all.desktop, /^    uses: \.\/\.github\/workflows\/desktop\.yml$/m, "the release reuses the Desktop workflow");
  assert.match(read(".github/workflows/desktop.yml"), /^  workflow_call:$/m);
  assert.match(all.collect, /^    needs: \[build, desktop\]$/m);
  // The build runs the full gate, so it sets up the desktop shell's tests exactly as CI does.
  const ci = read(".github/workflows/ci.yml");
  for (const step of ["run: node scripts/fetch-electron.mjs", "run: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0", "npm run check 2>&1 | tee check.log"]) {
    assert.ok(ci.includes(step) && all.build.includes(step), `build runs "${step}" as CI does`);
  }
  assert.match(all.attest, /^    needs: collect$/m);
  assert.match(all.publish, /^    needs: attest$/m);
  assert.match(release, /^permissions:\n  contents: read\n/m, "every job reads only, unless it says otherwise");
});

test("only tag pushes sign or publish, and those jobs run no repository code", () => {
  for (const name of ["attest", "publish"]) {
    assert.ok(all[name].includes(TAG_ONLY), `${name} runs for pushed tags only`);
    assert.doesNotMatch(all[name], /actions\/checkout|actions\/setup-node|\bnpm\b|\bnode\b/, `${name} runs no repository or dependency code`);
  }
  assert.doesNotMatch(all.collect, /actions\/checkout|actions\/setup-node|\bnpm\b|\bnode\b/, "collect runs no repository or dependency code");
  // A job-level condition would skip the job on some trigger; a step's own condition (the tag check) does not.
  for (const name of ["build", "desktop", "collect"]) assert.doesNotMatch(all[name], /^    if:/m, `${name} runs on every trigger`);
  // The tag check is the one step gated on the trigger, and it refuses a tag that is not the product's version.
  assert.match(all.build, /- name: Verify tag matches product and lockfile\n {8}if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/v'\)\n(?: {8}.*\n)* {8}run: node scripts\/check-release-tag\.mjs "\$RELEASE_TAG"\n/);
});

test("signing and writing are each granted to one job", () => {
  const granted = (permission) => Object.keys(all).filter((name) => new RegExp(`^      ${permission}$`, "m").test(all[name]));
  assert.deepEqual(granted("id-token: write"), ["attest"]);
  assert.deepEqual(granted("attestations: write"), ["attest"]);
  assert.deepEqual(granted("contents: write"), ["publish"]);
  assert.doesNotMatch(release.replace(/^ *#.*$/gm, ""), /write-all|permissions: write/);
});

test("the release is a draft for an existing tag, and every collected file is signed", () => {
  assert.match(all.publish, /gh release create "\$TAG" out\/\* --repo "\$GITHUB_REPOSITORY" --draft --verify-tag/);
  assert.doesNotMatch(release, /git tag|git push|gh release edit|--draft=false|gh api/);
  assert.match(all.attest, /subject-path: \|\n {12}dist\/release\/\*\*\n {12}dist\/out\/\*\n/);
  for (const target of ["linux-x64", "darwin-arm64", "win32-x64"]) assert.ok(all.collect.includes(target), `collect checks the ${target} archive`);
  // The release is the evidence bundle and the engine's tarball (founder, 2026-11-14): the
  // desktop archives are checked, in a folder of their own, and are not released.
  assert.match(all.collect, /if \[ "\$count" -ne 2 \]/, "collect refuses a set missing any file");
  assert.match(all.collect, /name: ninerr-engine-\$\{\{ github\.sha \}\}\n {10}path: out\n/, "the engine goes into the release");
  assert.equal((all.collect.match(/^ {10}path: desktop$/gm) ?? []).length, 3, "each desktop archive goes into desktop/, not out/");
  assert.doesNotMatch(all.collect, /"out\/Ninerr-|out\/\$archive/, "no desktop archive is read from the release folder");
  assert.match(all.collect, /engine="out\/ninerr-\$version\.tgz"/);
  assert.match(all.collect, /if \[ "\$\(ls out \| wc -l\)" -ne 1 \] \|\| \[ ! -f "\$engine" \]; then [^\n]*exit 1; fi/, "only the engine's tarball is in its artifact");
  assert.match(all.collect, /if \[ "\$\(tar -xzOf "\$engine" package\/package\.json \| jq -r '\.name \+ "@" \+ \.version'\)" != "ninerr@\$version" \]; then [^\n]*exit 1; fi/, "it is ninerr at the bundle's version");
  // One commit and one version across the set: the bundle's, which must be this run's commit and, on a tag, the tag's version.
  assert.match(all.collect, /commit=\$\(jq -r '\.sourceCommit' evidence\/MANIFEST\.json\)/);
  assert.match(all.collect, /if \[ "\$commit" != "\$GITHUB_SHA" \]; then [^\n]*exit 1; fi/);
  assert.match(all.collect, /case "\$version" in ""\|null\) [^\n]*exit 1 ;; esac/);
  assert.match(all.collect, /if \[ "\$GITHUB_REF_TYPE" = tag \] && \[ "\$GITHUB_REF_NAME" != "v\$version" \]; then [^\n]*exit 1; fi/);
  assert.match(all.collect, /if \[ "\$\(jq -r '\.commit' "\$manifest"\)" != "\$commit" \]; then [^\n]*exit 1; fi/);
  assert.match(all.collect, /if \[ "\$\(jq -r '\.version' "\$manifest"\)" != "\$version" \]; then [^\n]*exit 1; fi/);
  // collect downloads each archive by the exact name the Desktop workflow uploads it under.
  const upload = /name: (ninerr-desktop-\$\{\{ matrix\.target \}\}-\$\{\{ [^}]+\}\})\n/.exec(read(".github/workflows/desktop.yml"))?.[1];
  assert.ok(upload, "desktop.yml uploads each package under one name");
  for (const target of ["linux-x64", "darwin-arm64", "win32-x64"]) {
    assert.ok(all.collect.includes(`name: ${upload.replace("${{ matrix.target }}", target)}\n`), `collect downloads ${target} by its upload name`);
  }
  assert.doesNotMatch(all.collect, /pattern:|merge-multiple/);
});

test("what is signed is uploaded as built, before any later step runs", () => {
  /** A job's steps, each as its own block of text, named or not. */
  const steps = (text) => text.split(/^      - /m).slice(1);
  // The bundle: the install, then build, verify and upload, before any other step runs.
  const build = steps(all.build);
  const install = build.findIndex((step) => step.startsWith("run: npm ci --ignore-scripts"));
  assert.ok(install >= 0, "the build installs with npm ci --ignore-scripts");
  const [made, verified, uploaded, engineBuilt, engineUploaded] = build.slice(install + 1, install + 6);
  // Then the engine's tarball, built and uploaded as built, still before any test code runs.
  assert.match(engineBuilt ?? "", /^name: Build the engine package\n {8}run: node scripts\/build-engine\.mjs --out dist\/engine --pack\n/);
  assert.match(engineUploaded ?? "", /^uses: actions\/upload-artifact@[0-9a-f]{40} # v4\.6\.2\n {8}with:\n {10}name: ninerr-engine-\$\{\{ github\.sha \}\}\n {10}path: dist\/ninerr-\*\.tgz\n/);
  assert.ok(made?.startsWith("name: Build the release bundle\n"), "the bundle is built straight after the install");
  assert.ok(verified?.startsWith("name: Verify the bundle against its manifest\n"), "then verified");
  assert.match(uploaded ?? "", /^uses: actions\/upload-artifact@[0-9a-f]{40} # v4\.6\.2\n {8}with:\n {10}name: ninerr-release-evidence-\$\{\{ github\.sha \}\}\n/, "then uploaded");
  // Each archive: uploaded straight after packaging, before the smoke, journey or egress runs.
  const desktop = steps(read(".github/workflows/desktop.yml"));
  const packaged = desktop.findIndex((step) => step.startsWith("name: Package\n"));
  assert.ok(packaged >= 0, "desktop.yml has its Package step");
  const upload = desktop[packaged + 1] ?? "";
  assert.ok(upload.startsWith("name: Upload the package\n"), "the archive is uploaded straight after it is packaged");
  assert.doesNotMatch(upload, /^ {8}if:/m, "the upload has no condition of its own");
  // A failed attempt leaves its artifact behind; a re-run must be able to replace it.
  for (const step of [uploaded, upload]) assert.match(step ?? "", /^ {10}overwrite: true$/m, "a re-run replaces the earlier attempt's upload");
});

test("a pull request that changes the release path runs the unsigned pipeline", () => {
  const on = release.slice(release.indexOf("\non:\n"), release.indexOf("\npermissions:"));
  assert.match(on, /^  pull_request:\n    paths:\n/m);
  for (const path of [".github/workflows/release.yml", ".github/workflows/desktop.yml", "scripts/release-bundle.mjs", "scripts/package-desktop.mjs", "scripts/fetch-electron.mjs"]) {
    assert.ok(on.includes(`      - ${path}\n`), `a change to ${path} runs the release workflow`);
  }
});
