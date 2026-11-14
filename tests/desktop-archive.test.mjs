import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { writeTarGz, writeZip } from "../scripts/desktop/archive.mjs";
import { WINDOWS_TAR } from "../scripts/desktop/electron.mjs";

// A desktop package's archive is deterministic: the same files give the same bytes, whatever
// the time they were written or the order they were made in, and the platform's own tools
// unpack it to the same files, modes and links.

const posix = process.platform !== "win32";
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function withDirectory(callback) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-archive-")));
  try {
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The same package, its files written in the given order and dated `at`. */
function makePackage(root, order, at) {
  const top = join(root, "Ninerr-test");
  mkdirSync(join(top, "resources", "app"), { recursive: true });
  mkdirSync(join(top, "locales"), { recursive: true });
  const files = {
    "resources/app/package.json": '{"name":"ninerr","version":"0.1.0"}\n',
    "locales/ünïcödé.pak": "x".repeat(5000),
    "empty.txt": "",
    "ninerr": "#!/bin/sh\necho ninerr\n",
    "LICENSE": "Apache-2.0\n".repeat(200),
  };
  const names = Object.keys(files);
  for (const name of order === "reverse" ? names.reverse() : names) writeFileSync(join(top, name), files[name]);
  if (posix) {
    chmodSync(join(top, "ninerr"), 0o755);
    symlinkSync("resources/app/package.json", join(top, "current"));
    // A link to a folder, as in a macOS framework (Versions/Current -> A).
    symlinkSync("resources", join(top, "current-folder"));
  }
  const date = new Date(at);
  const touch = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory()) touch(join(path, entry.name));
      if (!entry.isSymbolicLink()) utimesSync(join(path, entry.name), date, date);
    }
  };
  touch(top);
  return files;
}

/** Unpack with the platform's own tool, as drive.mjs and a person would. */
function unpack(archive, into) {
  mkdirSync(into, { recursive: true });
  const [command, args] = archive.endsWith(".tar.gz")
    ? ["tar", ["-xzf", archive, "-C", into]]
    : process.platform === "darwin" ? ["ditto", ["-x", "-k", archive, into]]
    : process.platform === "win32" ? [WINDOWS_TAR, ["-xf", archive, "-C", into]]
    : ["unzip", ["-q", archive, "-d", into]];
  const result = spawnSync(command, args, { encoding: "utf8" });
  assert.equal(result.status, 0, `${command} ${result.stderr}`);
  return join(into, "Ninerr-test");
}

function checkUnpacked(top, files) {
  for (const [name, content] of Object.entries(files)) assert.equal(readFileSync(join(top, name), "utf8"), content, name);
  if (posix) {
    assert.equal(lstatSync(join(top, "ninerr")).mode & 0o777, 0o755, "an executable stays executable");
    assert.equal(lstatSync(join(top, "LICENSE")).mode & 0o777, 0o644);
    assert.equal(readlinkSync(join(top, "current")), "resources/app/package.json", "a link stays a link");
    assert.equal(readlinkSync(join(top, "current-folder")), "resources", "a link to a folder stays a link");
    assert.equal(readFileSync(join(top, "current-folder", "app", "package.json"), "utf8"), files["resources/app/package.json"], "and leads where it did");
  }
}

for (const [kind, write, extension] of [["zip", writeZip, "zip"], ...(process.platform === "linux" ? [["tar.gz", writeTarGz, "tar.gz"]] : [])]) {
  test(`a ${kind} of the same files is the same bytes, whenever and in whatever order they were written`, () => withDirectory((root) => {
    const first = join(root, "one");
    const second = join(root, "two");
    const files = makePackage(first, "forward", "2026-01-02T03:04:05Z");
    makePackage(second, "reverse", "2030-06-07T08:09:10Z");
    write(first, "Ninerr-test", join(root, `a.${extension}`));
    write(second, "Ninerr-test", join(root, `b.${extension}`));
    assert.equal(sha256(join(root, `a.${extension}`)), sha256(join(root, `b.${extension}`)));
    checkUnpacked(unpack(join(root, `a.${extension}`), join(root, "unpacked")), files);
  }));

  test(`a ${kind} changes when a file does`, () => withDirectory((root) => {
    makePackage(join(root, "one"), "forward", "2026-01-02T03:04:05Z");
    makePackage(join(root, "two"), "forward", "2026-01-02T03:04:05Z");
    writeFileSync(join(root, "two", "Ninerr-test", "empty.txt"), "changed");
    write(join(root, "one"), "Ninerr-test", join(root, `a.${extension}`));
    write(join(root, "two"), "Ninerr-test", join(root, `b.${extension}`));
    assert.notEqual(sha256(join(root, `a.${extension}`)), sha256(join(root, `b.${extension}`)));
  }));
}

test("a zip records no time and no host: every entry is dated 1980-01-01 and made on Unix", () => withDirectory((root) => {
  makePackage(root, "forward", "2026-01-02T03:04:05Z");
  writeZip(root, "Ninerr-test", join(root, "a.zip"));
  const zip = readFileSync(join(root, "a.zip"));
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const names = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50);
    assert.equal(zip.readUInt16LE(at + 4) >> 8, 3, "made on Unix");
    assert.equal(zip.readUInt16LE(at + 12), 0, "time 00:00");
    assert.equal(zip.readUInt16LE(at + 14), (1 << 5) | 1, "date 1980-01-01");
    assert.equal(zip.readUInt16LE(at + 30), 0, "no extra field");
    const nameLength = zip.readUInt16LE(at + 28);
    names.push(zip.subarray(at + 46, at + 46 + nameLength).toString("utf8"));
    at += 46 + nameLength;
  }
  assert.deepEqual(names, [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), "entries are in path order");
  assert.equal(names[0], "Ninerr-test/");
}));
