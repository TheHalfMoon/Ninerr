import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import {
  ImportSecurityError,
  ImportValidationError,
} from "../packages/import-stack/src/errors.ts";
import {
  REFERENCE_PACK_LIMITS,
  referencePackDigest,
} from "../packages/import-stack/src/reference-packs.mjs";
import { readReferencePackFile } from "../packages/import-stack/src/reference-pack-file.ts";

const AT = "2026-11-06T00:00:00.000Z";
const source = () => ({
  id: "urn:ninerr:source:local-file",
  uri: "https://example.com/local-file",
  observedAt: AT,
  rights: { status: "verified", license: "Apache-2.0", redistributable: true },
});
const object = (index, overrides = {}) => ({
  id: `urn:ninerr:object:ref-${String(index).padStart(4, "0")}`,
  kind: "pattern",
  title: `Pattern ${index} dashboard`,
  tags: ["dashboard", "responsive"],
  sourceId: "urn:ninerr:source:local-file",
  assetSha256: null,
  confidence: "observed",
  visibility: "public",
  rights: { status: "verified", license: "Apache-2.0", redistributable: true },
  ...overrides,
});
const fixture = (count = 2) => ({
  schemaVersion: 1,
  packId: "urn:ninerr:pack:file-reader",
  ownerScope: null,
  createdAt: AT,
  sources: [source()],
  assets: [],
  objects: Array.from({ length: count }, (_, index) => object(index)),
});

async function withTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), "ninerr-reference-pack-file-"));
  try { return await fn(dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

async function withPack(fn, count = 2) {
  return withTemp(async (dir) => {
    const root = join(dir, "root");
    await mkdir(root);
    const file = join(root, "pack.json");
    const raw = fixture(count);
    await writeFile(file, JSON.stringify(raw));
    return fn({ dir, root, file, raw });
  });
}

async function withEmptyRoot(fn) {
  return withTemp(async (dir) => {
    const root = join(dir, "root");
    await mkdir(root);
    return fn({ dir, root });
  });
}

const UNSUPPORTED_LINKS = new Set(["EPERM", "EACCES", "ENOSYS", "ENOTSUP", "EINVAL", "EXDEV", "UNKNOWN"]);

async function skipIfUnsupported(t, error, kind) {
  if (UNSUPPORTED_LINKS.has(error?.code)) {
    t.skip(`${kind} not supported here (${error.code})`);
    return true;
  }
  return false;
}

test("reads one pack from a trusted directory without leaking its absolute path", async () => {
  await withPack(async ({ dir, root, raw }) => {
    const result = await readReferencePackFile({ directory: root, fileName: "pack.json" });
    assert.equal(result.fileName, "pack.json");
    assert.equal(result.pack.objects.length, 2);
    assert.equal(result.pack.packId, raw.packId);
    assert.equal(result.byteLength, Buffer.byteLength(JSON.stringify(raw), "utf8"));
    assert.equal(result.packDigest, referencePackDigest(raw));
    assert.equal(JSON.stringify(result).includes(dir), false);
    assert.equal(Object.isFrozen(result) && Object.isFrozen(result.pack.objects[0]), true);
  });
});

test("only the named file in the supplied root is read", async () => {
  await withTemp(async (dir) => {
    const left = join(dir, "left");
    const right = join(dir, "right");
    await mkdir(left);
    await mkdir(right);
    const leftRaw = fixture(1);
    leftRaw.objects[0].title = "Left pack";
    const rightRaw = fixture(1);
    rightRaw.objects[0].title = "Right pack";
    await writeFile(join(left, "pack.json"), JSON.stringify(leftRaw));
    await writeFile(join(right, "pack.json"), JSON.stringify(rightRaw));

    const result = await readReferencePackFile({ directory: left, fileName: "pack.json" });
    assert.equal(result.pack.objects[0].title, "Left pack");
    assert.notEqual(result.packDigest, referencePackDigest(rightRaw));
  });
});

test("digest is deterministic across reads and independent of stored object order", async () => {
  await withTemp(async (dir) => {
    const root = join(dir, "root");
    await mkdir(root);
    const raw = fixture(50);
    const reversed = { ...raw, objects: [...raw.objects].reverse() };
    await writeFile(join(root, "forward.json"), JSON.stringify(raw));
    await writeFile(join(root, "reverse.json"), JSON.stringify(reversed));

    const first = await readReferencePackFile({ directory: root, fileName: "forward.json" });
    const second = await readReferencePackFile({ directory: root, fileName: "forward.json" });
    const other = await readReferencePackFile({ directory: root, fileName: "reverse.json" });
    assert.equal(first.packDigest, second.packDigest);
    assert.equal(first.packDigest, other.packDigest);
    assert.equal(first.packDigest, referencePackDigest(raw));
  });
});

test("parent traversal, nested paths and absolute paths are rejected before IO", async () => {
  await withPack(async ({ dir, root }) => {
    const names = [
      "../pack.json",
      "..\\pack.json",
      "..",
      "../",
      "sub/pack.json",
      "sub\\pack.json",
      join(root, "pack.json"),
      "/etc/passwd",
      "C:\\Windows\\win.ini",
      `${dir}${join("", "pack.json")}`,
    ];
    for (const fileName of names) {
      await assert.rejects(
        () => readReferencePackFile({ directory: root, fileName }),
        ImportSecurityError,
        `expected rejection for ${fileName}`,
      );
    }
  });
});

test("strict basename allowlist accepts only a lowercase .json name", async () => {
  await withPack(async ({ root }) => {
    const names = [
      "",
      " ",
      ".pack.json",
      ".json",
      "pack",
      "pack.txt",
      "pack.json.exe",
      "pack.JSON",
      "pack json.json",
      "pack.json ",
      "pack.json\n",
      "pack\u0000.json",
      "a".repeat(129) + ".json",
    ];
    for (const fileName of names) {
      await assert.rejects(
        () => readReferencePackFile({ directory: root, fileName }),
        ImportSecurityError,
        `expected rejection for ${JSON.stringify(fileName)}`,
      );
    }
  });
});

test("a missing file in an allowed root is reported, not guessed", async () => {
  await withEmptyRoot(async ({ root }) => {
    await assert.rejects(
      () => readReferencePackFile({ directory: root, fileName: "absent.json" }),
      (error) => {
        assert.ok(error instanceof ImportValidationError);
        assert.match(error.message, /could not be read \(ENOENT\)/u);
        assert.ok(!error.message.includes(root), "the absolute path is not echoed back");
        return true;
      },
    );
  });
});

test("a directory must be an absolute local path", async () => {
  await withPack(async ({ root }) => {
    const refused = [".", "root", "", ...(process.platform === "win32"
      ? ["\\\\localhost\\C$\\x", "\\\\127.0.0.1\\C$\\x", "\\\\?\\UNC\\localhost\\C$\\x", "\\\\?\\C:\\x", "\\\\.\\C:\\x", "//localhost/C$/x", "C:", "C:x"]
      : [])];
    for (const directory of refused) {
      await assert.rejects(() => readReferencePackFile({ directory, fileName: "pack.json" }), ImportSecurityError, directory);
    }
    assert.equal((await readReferencePackFile({ directory: root, fileName: "pack.json" })).fileName, "pack.json");
  });
});

test("a junction or link named with a trailing separator is still refused", async (t) => {
  await withPack(async ({ dir, root }) => {
    const linked = join(dir, "linked-root");
    try {
      // A junction needs no privilege on Windows, so this runs where symlinks skip.
      await symlink(root, linked, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (await skipIfUnsupported(t, error, "directory link")) return;
      throw error;
    }
    for (const directory of [linked, `${linked}${sep}`, `${linked}${sep}.`]) {
      await assert.rejects(() => readReferencePackFile({ directory, fileName: "pack.json" }), ImportSecurityError, directory);
    }
  });
});

test("an empty file is rejected", async () => {
  await withEmptyRoot(async ({ root }) => {
    await writeFile(join(root, "empty.json"), Buffer.alloc(0));
    await assert.rejects(
      () => readReferencePackFile({ directory: root, fileName: "empty.json" }),
      (error) => error instanceof ImportValidationError && /empty/u.test(error.message),
    );
  });
});

test("malformed JSON is rejected", async () => {
  await withEmptyRoot(async ({ root }) => {
    await writeFile(join(root, "broken.json"), '{"schemaVersion": 1,');
    await assert.rejects(
      () => readReferencePackFile({ directory: root, fileName: "broken.json" }),
      (error) => error instanceof ImportValidationError && /not valid JSON/u.test(error.message),
    );
  });
});

test("invalid UTF-8 is rejected", async () => {
  await withEmptyRoot(async ({ root }) => {
    await writeFile(join(root, "latin1.json"), Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]));
    await assert.rejects(
      () => readReferencePackFile({ directory: root, fileName: "latin1.json" }),
      (error) => error instanceof ImportValidationError && /not valid UTF-8/u.test(error.message),
    );
  });
});

test("oversize content is rejected before JSON parsing", async () => {
  await withEmptyRoot(async ({ root }) => {
    await writeFile(join(root, "huge.json"), Buffer.alloc(REFERENCE_PACK_LIMITS.maxManifestBytes + 1, 0x20));
    await assert.rejects(
      () => readReferencePackFile({ directory: root, fileName: "huge.json" }),
      (error) => error instanceof ImportSecurityError && /exceeds/u.test(error.message),
    );
  });
});

test("a schema-invalid pack is rejected by the canonical normalizer", async () => {
  await withEmptyRoot(async ({ root }) => {
    const raw = { ...fixture(1), unexpected: true };
    await writeFile(join(root, "invalid.json"), JSON.stringify(raw));
    await assert.rejects(
      () => readReferencePackFile({ directory: root, fileName: "invalid.json" }),
      (error) => error instanceof ImportValidationError && /unsupported field unexpected/u.test(error.message),
    );
  });
});

test("a symlinked pack file is rejected", async (t) => {
  await withPack(async ({ root, file }) => {
    const linked = join(root, "linked.json");
    try {
      await symlink(file, linked, "file");
    } catch (error) {
      if (await skipIfUnsupported(t, error, "file symlink")) return;
      throw error;
    }
    await assert.rejects(
      () => readReferencePackFile({ directory: root, fileName: "linked.json" }),
      ImportSecurityError,
    );
  });
});

test("a symlinked trusted directory is rejected", async (t) => {
  await withPack(async ({ dir, root }) => {
    const linkedRoot = join(dir, "linked-root");
    try {
      await symlink(root, linkedRoot, "dir");
    } catch (error) {
      if (await skipIfUnsupported(t, error, "directory symlink")) return;
      throw error;
    }
    await assert.rejects(
      () => readReferencePackFile({ directory: linkedRoot, fileName: "pack.json" }),
      ImportSecurityError,
    );
  });
});

test("a hard-linked pack file is rejected", async (t) => {
  await withPack(async ({ root, file }) => {
    const linked = join(root, "hard.json");
    try {
      await link(file, linked);
    } catch (error) {
      if (await skipIfUnsupported(t, error, "hard link")) return;
      throw error;
    }
    await assert.rejects(
      () => readReferencePackFile({ directory: root, fileName: "hard.json" }),
      ImportSecurityError,
    );
  });
});

test("a 1,000-object pack is read offline with a stable digest", async () => {
  await withPack(async ({ root, raw }) => {
    const first = await readReferencePackFile({ directory: root, fileName: "pack.json" });
    const second = await readReferencePackFile({ directory: root, fileName: "pack.json" });
    assert.equal(first.pack.objects.length, 1_000);
    assert.equal(first.pack.objects[999].id, "urn:ninerr:object:ref-0999");
    assert.equal(first.packDigest, second.packDigest);
    assert.equal(first.packDigest, referencePackDigest(raw));
    assert.ok(first.byteLength < REFERENCE_PACK_LIMITS.maxManifestBytes);
  }, 1_000);
});

test("the trusted root must be a real directory", async () => {
  await withPack(async ({ file }) => {
    await assert.rejects(
      () => readReferencePackFile({ directory: file, fileName: "pack.json" }),
      ImportSecurityError,
    );
    await assert.rejects(
      () => readReferencePackFile({ directory: "", fileName: "pack.json" }),
      ImportSecurityError,
    );
  });
});

test("the reader is exported from the package entry point", () => {
  const index = readFileSync(new URL("../packages/import-stack/src/index.ts", import.meta.url), "utf8");
  assert.match(index, /export \* from "\.\/reference-pack-file\.ts";/u);
});

test("the reader reuses the canonical guards and has no network or write authority", () => {
  const sourceCode = readFileSync(new URL("../packages/import-stack/src/reference-pack-file.ts", import.meta.url), "utf8");
  for (const reused of ["canonicalDirectory", "canonicalFileWithinRoots", "readSingleLinkFile", "normalizeReferencePack", "referencePackDigest"]) {
    assert.match(sourceCode, new RegExp(`\\b${reused}\\b`, "u"));
  }
  assert.doesNotMatch(sourceCode, /\bfetch\s*\(|\bhttps?\.request\s*\(|\bnet\.connect\s*\(/u);
  assert.doesNotMatch(sourceCode, /\bwriteFile\s*\(|\bappendFile\s*\(|\bunlink\s*\(|\brm\s*\(|\brename\s*\(|\bmkdir\s*\(/u);
  assert.doesNotMatch(sourceCode, /ownership is guaranteed|ACL is guaranteed/iu);
});
