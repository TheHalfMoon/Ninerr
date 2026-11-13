import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyReleaseTag } from "../scripts/check-release-tag.mjs";

const product = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lockfile = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

test("the founder-selected first release is 0.1.0 and npm metadata agrees", () => {
  assert.equal(product.version, "0.1.0");
  assert.equal(lockfile.version, product.version);
  assert.equal(lockfile.packages[""].version, product.version);
  assert.equal(verifyReleaseTag("v0.1.0", product, lockfile), "0.1.0");
});

test("tag preflight rejects mismatched versions and malformed tags", () => {
  for (const tag of [undefined, "v1.0.0", "v0.1.1", "0.1.0", "v0.1.0-beta.1", "v0.1.0\n"]) {
    assert.throws(() => verifyReleaseTag(tag, product, lockfile));
  }
});

test("tag preflight rejects npm lockfile drift", () => {
  assert.throws(() => verifyReleaseTag("v0.1.0", product, { ...lockfile, version: "0.0.0" }));
  assert.throws(() => verifyReleaseTag("v0.1.0", product, {
    ...lockfile,
    packages: { ...lockfile.packages, "": { ...lockfile.packages[""], version: "0.0.0" } },
  }));
});

test("tag preflight rejects invalid product semver", () => {
  assert.throws(() => verifyReleaseTag("v01.0.0", { ...product, version: "01.0.0" }, lockfile));
});
