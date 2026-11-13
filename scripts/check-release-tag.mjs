#!/usr/bin/env node
// Refuse a release tag that disagrees with the product and lockfile versions.
// Invoked before dependency installation by Release Evidence on tagged pushes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function verifyReleaseTag(tag, product, lockfile) {
  if (typeof product?.version !== "string" ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(product.version)) {
    throw new Error("product version must be a canonical stable semver");
  }
  const version = product.version;
  if (lockfile?.version !== version || lockfile?.packages?.[""]?.version !== version) {
    throw new Error("package-lock.json root version disagrees with package.json");
  }
  if (tag !== `v${version}`) {
    throw new Error(`release tag ${JSON.stringify(tag)} does not match package version v${version}`);
  }
  return version;
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invoked) {
  try {
    const product = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const lockfile = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
    const version = verifyReleaseTag(process.argv[2], product, lockfile);
    process.stdout.write(`release tag and package metadata match: v${version}\n`);
  } catch (error) {
    process.stderr.write(`check-release-tag: ${error.message}\n`);
    process.exitCode = 2;
  }
}
