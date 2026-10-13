import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentRegistry, CodebaseLinks, discoverMcpUrl, startStudioHost } from "../packages/studio-host/src/index.ts";
import { readTrustedFile, UntrustedFileError, windowsTrustProblem, writeTrustedFile } from "../packages/studio-host/src/trusted-file.ts";
import { currentUserSid, formatSid, longPath, privateSddl, readWithSecurity } from "../packages/studio-host/src/windows-security.ts";

// #268, the founder's decision of 2026-10-13: Ninerr trusts the files in its projects folder
// that steer an agent's credential (the relay's discovery file), list the agents, or link
// codebases only when this user owns them and no one else can change them. On Windows that is
// proven from the owner and the access list, read through a small native boundary, on the very
// handle the content is read from; whatever cannot be proven is refused. Ninerr writes these
// files private to this user from the moment they exist.

const WINDOWS = process.platform === "win32";
const onWindows = { skip: !WINDOWS && "Windows access lists: the POSIX owner and mode are tested below and in codebase.test.mjs" };
const onPosix = { skip: WINDOWS && "POSIX owner and mode: Windows is tested above" };
const USER = "S-1-5-21-1-2-3-1001";
const allow = (sid, mask, flags = 0x10) => ({ type: 0, flags, mask, sid });
const MODIFY = 0x1301bf;
const READ = 0x1200a9;
const FULL = 0x1f01ff;

async function withFolder(callback) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-file-trust-")));
  try {
    return await callback(root);
  } finally {
    rmSync(longPath(root), { recursive: true, force: true });
  }
}

/** A folder like the root of a second drive: Authenticated Users may change what it holds. */
async function sharedFolder(root) {
  const { setAccessList } = await import("./support/windows-acl.mjs");
  const shared = join(root, "shared");
  mkdirSync(shared);
  setAccessList(shared, `D:P(A;OICI;FA;;;${currentUserSid()})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1301bf;;;AU)`);
  return shared;
}

test("the judgement trusts only this user, SYSTEM and Administrators, and refuses what it cannot read", () => {
  const owned = (aces, owner = USER) => windowsTrustProblem({ owner, aces }, USER);
  // The home folder's inheritance: this user, SYSTEM and Administrators.
  assert.equal(owned([allow("S-1-5-18", FULL), allow("S-1-5-32-544", FULL), allow(USER, FULL)]), null);
  // Others may read it; OWNER RIGHTS applies to the owner, checked below.
  assert.equal(owned([allow(USER, FULL), allow("S-1-5-32-545", READ), allow("S-1-3-4", FULL)]), null);
  // A second drive's root: Authenticated Users may modify.
  assert.match(owned([allow(USER, FULL), allow("S-1-5-11", MODIFY)]), /another account \(S-1-5-11\) may change it/u);
  // Everyone with write, delete, write-owner or write-access-list only.
  for (const mask of [0x2, 0x4, 0x10000, 0x40000, 0x80000, 0x40000000, 0x10000000]) {
    assert.match(owned([allow(USER, FULL), allow("S-1-1-0", mask)]), /another account \(S-1-1-0\)/u, `mask ${mask.toString(16)}`);
  }
  // Inherit-only entries do not apply to the file; denying entries never widen access.
  assert.equal(owned([allow(USER, FULL), allow("S-1-1-0", FULL, 0x8 | 0x2)]), null);
  assert.equal(owned([allow(USER, FULL), { type: 1, flags: 0, mask: FULL, sid: "S-1-1-0" }]), null);
  // An allowing entry Ninerr cannot read (callback, conditional, object) is refused.
  assert.match(owned([allow(USER, FULL), { type: 9, flags: 0, mask: MODIFY, sid: null }]), /cannot read \(type 9\)/u);
  // Another owner; no owner (FAT, exFAT); no access list at all.
  assert.match(owned([allow(USER, FULL)], "S-1-5-21-9-9-9-1002"), /owned by S-1-5-21-9-9-9-1002/u);
  assert.equal(owned([allow(USER, FULL)], "S-1-5-32-544"), null, "an elevated process's files are owned by Administrators");
  assert.match(owned([allow(USER, FULL)], null), /keeps no owner or access list/u);
  assert.match(owned(null), /no access list/u);
});

test("SIDs, long paths and the private access list are formed exactly", () => {
  // S-1-5-21-1-2-3-1001: revision 1, five sub-authorities, authority 5.
  const sid = Buffer.from([1, 5, 0, 0, 0, 0, 0, 5, 21, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0xe9, 0x03, 0, 0]);
  assert.equal(formatSid(sid), "S-1-5-21-1-2-3-1001");
  assert.throws(() => formatSid(sid.subarray(0, 20)), /shorter than it says/u);
  if (WINDOWS) {
    assert.equal(longPath("C:/Users/a/file.json"), "\\\\?\\C:\\Users\\a\\file.json");
    assert.equal(longPath("\\\\server\\share\\file.json"), "\\\\?\\UNC\\server\\share\\file.json");
    assert.equal(longPath("\\\\?\\C:\\x"), "\\\\?\\C:\\x");
  }
  assert.equal(privateSddl(USER), `D:P(A;;FA;;;${USER})(A;;FA;;;SY)(A;;FA;;;BA)`);
  assert.throws(() => privateSddl("Everyone"), /not a SID/u);
});

test("the native boundary binds only advapi32.dll and kernel32.dll, and starts no process", () => {
  const source = readFileSync(new URL("../packages/studio-host/src/windows-security.ts", import.meta.url), "utf8");
  assert.deepEqual([...source.matchAll(/koffi\.load\("([^"]+)"\)/gu)].map((match) => match[1]).sort(), ["advapi32.dll", "kernel32.dll"]);
  const bound = [...source.matchAll(/(?:advapi|kernel)\.func\("[^"(]*?(\w+)\(/gu)].map((match) => match[1]).sort();
  assert.deepEqual(bound, ["CloseHandle", "ConvertStringSecurityDescriptorToSecurityDescriptorW", "CreateFileW", "FlushFileBuffers", "GetAce", "GetAclInformation", "GetCurrentProcess", "GetFileInformationByHandle", "GetLastError", "GetLengthSid", "GetSecurityInfo", "GetTokenInformation", "IsValidSid", "LocalFree", "OpenProcessToken", "ReadFile", "WriteFile"]);
  for (const file of ["windows-security.ts", "trusted-file.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(`../packages/studio-host/src/${file}`, import.meta.url), "utf8"), /child_process|spawn|execFile|icacls|whoami|powershell/iu, file);
  }
  // Koffi can load any DLL, and the offline guard allows its module: so it stays in this one
  // file, which loads exactly the two DLLs above (from the review of #268).
  assert.equal([...source.matchAll(/\.load\(/gu)].length, 2);
  const packages = new URL("../packages/", import.meta.url);
  for (const name of readdirSync(packages)) {
    const src = new URL(`${name}/src/`, packages);
    if (!existsSync(src)) continue;
    for (const file of readdirSync(src, { recursive: true }).map(String)) {
      if (`${name}/${file}` === "studio-host/windows-security.ts" || !/\.(?:m?js|ts|cjs)$/u.test(file)) continue;
      assert.doesNotMatch(readFileSync(new URL(file, src), "utf8"), /koffi/iu, `packages/${name}/src/${file} must not use Koffi`);
    }
  }
});

test("a file Ninerr writes is private from the start: owned by this user, protected, nobody else listed", onWindows, () => withFolder((root) => {
  const path = join(root, ".ninerr-agents.json");
  writeTrustedFile(path, "{}\n");
  const read = readWithSecurity(path, 1024);
  assert.equal(read.security.owner, currentUserSid());
  assert.deepEqual(read.security.aces.map((ace) => ace.sid).sort(), [currentUserSid(), "S-1-5-18", "S-1-5-32-544"].sort());
  assert.ok(read.security.aces.every((ace) => (ace.flags & 0x10) === 0), "no entry is inherited from the folder");
  assert.equal(readTrustedFile(path, 1024).toString(), "{}\n");
  // Replaced the same way: still private.
  writeTrustedFile(path, "[]\n");
  assert.equal(readTrustedFile(path, 1024).toString(), "[]\n");
}));

test("in a folder others may change, a file Ninerr did not write is refused, its own is trusted", onWindows, async () => withFolder(async (root) => {
  const shared = await sharedFolder(root);
  writeFileSync(join(shared, "planted.json"), "{}");
  assert.throws(() => readTrustedFile(join(shared, "planted.json"), 1024), (error) => error instanceof UntrustedFileError && /another account \(S-1-5-11\)/u.test(error.message));
  writeTrustedFile(join(shared, "own.json"), "{}");
  assert.equal(readTrustedFile(join(shared, "own.json"), 1024).toString(), "{}");
  assert.equal(readTrustedFile(join(shared, "absent.json"), 1024), null);
}));

test("a hostile projects folder cannot redirect the relay: the agent's credential is never sent", onWindows, async () => withFolder(async (root) => {
  const shared = await sharedFolder(root);
  // Another account's server, waiting for a credential.
  const seen = [];
  const thief = createServer((request, response) => {
    seen.push(request.headers.authorization ?? null);
    response.end("{}");
  });
  await new Promise((resolve) => thief.listen(0, "127.0.0.1", resolve));
  try {
    // What the other account plants: a discovery file pointing at it, naming a live process.
    const port = thief.address().port;
    writeFileSync(join(shared, ".ninerr-studio.json"), JSON.stringify({ version: 1, url: `http://127.0.0.1:${port}`, mcpUrl: `http://127.0.0.1:${port}/mcp`, pid: process.pid, nonce: "x" }));
    assert.throws(() => discoverMcpUrl(shared), /will not use this projects folder's discovery file, so the agent's credential is not sent: another account \(S-1-5-11\) may change it/u);
    assert.deepEqual(seen, [], "nothing reached the other account's server");
    // Ninerr itself, in the same folder, writes a discovery file the relay trusts.
    rmSync(join(shared, ".ninerr-studio.json"));
    const host = await startStudioHost({ projectsRoot: shared });
    try {
      assert.equal(discoverMcpUrl(shared), `${host.url}/mcp`);
    } finally {
      await host.close();
    }
  } finally {
    await new Promise((resolve) => thief.close(resolve));
  }
}));

test("an agent registry or codebase links another account could change are not trusted", onWindows, async () => withFolder(async (root) => {
  const shared = await sharedFolder(root);
  writeFileSync(join(shared, ".ninerr-agents.json"), JSON.stringify({ version: 1, agents: [] }));
  const registry = new AgentRegistry(shared, "test");
  assert.match(registry.problem ?? "", /not trusted: another account \(S-1-5-11\) may change it/u);
  // Connecting an agent writes a fresh registry, private, which is then trusted.
  registry.create("Fresh", "2026-10-13T00:00:00.000Z");
  assert.equal(new AgentRegistry(shared, "test").list().length, 1);
  writeFileSync(join(shared, ".ninerr-codebases.json"), JSON.stringify({ version: 1, links: { site: shared } }));
  const links = new CodebaseLinks(shared);
  assert.equal(links.get("site"), null, "planted links are not followed");
  assert.match(links.problem ?? "", /codebase links were not trusted and were set aside: another account \(S-1-5-11\) may change it/u, "and not dropped without a word");
  assert.ok(readdirSync(shared).some((name) => name.startsWith(".ninerr-codebases.json.unreadable-")), "kept for inspection");
  links.set("site", shared);
  assert.equal(new CodebaseLinks(shared).get("site"), shared, "the next save is private, and trusted");
}));

test("a registry another program holds open is kept as it is, not set aside, and read again next time", onWindows, () => withFolder((root) => {
  const registry = new AgentRegistry(root, "test");
  registry.create("Kept", "2026-10-13T00:00:00.000Z");
  const held = openSync(join(root, ".ninerr-agents.json"), "r+");
  let busy;
  try {
    busy = new AgentRegistry(root, "test");
  } finally {
    closeSync(held);
  }
  assert.equal(busy.problemCode, "agents-unavailable");
  assert.match(busy.problem, /could not be read just now/u);
  assert.throws(() => busy.create("Lost", "2026-10-13T00:00:00.000Z"), /could not be read just now/u, "and is not overwritten");
  assert.equal(readdirSync(root).some((name) => name.includes(".unreadable-")), false, "not set aside");
  assert.deepEqual(new AgentRegistry(root, "test").list().map((agent) => agent.displayName), ["Kept"]);
}));

test("an access list widened after Ninerr wrote the file is noticed on the next read", onWindows, async () => withFolder(async (root) => {
  const { setAccessList } = await import("./support/windows-acl.mjs");
  const path = join(root, ".ninerr-studio.json");
  writeTrustedFile(path, "{}");
  assert.equal(readTrustedFile(path, 1024).toString(), "{}");
  setAccessList(path, `D:P(A;;FA;;;${currentUserSid()})(A;;0x1301bf;;;WD)`);
  assert.throws(() => readTrustedFile(path, 1024), /another account \(S-1-1-0\) may change it/u);
}));

test("a file held open for writing by another handle is not read: checked and read on one handle", onWindows, () => withFolder((root) => {
  const path = join(root, ".ninerr-studio.json");
  writeTrustedFile(path, "{}");
  // Node opens files sharing read, write and delete; the trusted read shares reading only, so
  // it cannot open a file someone else holds for writing, and nobody can write while it reads.
  const writer = openSync(path, "r+");
  try {
    assert.throws(() => readTrustedFile(path, 1024), (error) => error instanceof UntrustedFileError && /could not be read/u.test(error.message));
  } finally {
    closeSync(writer);
  }
  assert.equal(readTrustedFile(path, 1024).toString(), "{}");
}));

test("a link, junction or folder in the trusted file's place is refused, and long paths work", onWindows, () => withFolder((root) => {
  const target = join(root, "target");
  mkdirSync(target);
  symlinkSync(target, join(root, ".ninerr-studio.json"), "junction");
  assert.throws(() => readTrustedFile(join(root, ".ninerr-studio.json"), 1024), /not a regular file \(a folder or a link\)/u);
  mkdirSync(join(root, ".ninerr-agents.json"));
  assert.throws(() => readTrustedFile(join(root, ".ninerr-agents.json"), 1024), /not a regular file/u);
  // Past Windows's 260-character path limit.
  let deep = root;
  while (deep.length < 300) deep = join(deep, "a-long-folder-name-for-ninerr");
  mkdirSync(longPath(deep), { recursive: true });
  writeTrustedFile(join(deep, ".ninerr-studio.json"), "{\"deep\":true}");
  assert.equal(readTrustedFile(join(deep, ".ninerr-studio.json"), 1024).toString(), "{\"deep\":true}");
  // Larger than allowed.
  writeTrustedFile(join(root, "big.json"), "x".repeat(2048));
  assert.throws(() => readTrustedFile(join(root, "big.json"), 1024), /larger than 1024 bytes/u);
}));

test("on POSIX a link, a file of another owner or one others can write is refused", onPosix, () => withFolder((root) => {
  writeTrustedFile(join(root, "own.json"), "{}");
  assert.equal(readTrustedFile(join(root, "own.json"), 1024).toString(), "{}");
  symlinkSync(join(root, "own.json"), join(root, "link.json"));
  assert.throws(() => readTrustedFile(join(root, "link.json"), 1024), /it is a link/u);
  writeFileSync(join(root, "open.json"), "{}");
  chmodSync(join(root, "open.json"), 0o666);
  assert.throws(() => readTrustedFile(join(root, "open.json"), 1024), /other accounts may change it/u);
  assert.equal(readTrustedFile(join(root, "absent.json"), 1024), null);
  // A FIFO in the file's place is refused at once, not waited on (from the review of #268).
  execFileSync("mkfifo", [join(root, "fifo.json")]);
  assert.throws(() => readTrustedFile(join(root, "fifo.json"), 1024), /not a regular file/u);
}));

test("a registry this user cannot read is not trusted: it is reported, not used", onWindows, async () => withFolder(async (root) => {
  const { setAccessList } = await import("./support/windows-acl.mjs");
  const path = join(root, ".ninerr-agents.json");
  writeTrustedFile(path, JSON.stringify({ version: 1, agents: [] }));
  // Another account could leave a file this user may not read (only SYSTEM listed here).
  setAccessList(path, "D:P(A;;FA;;;SY)");
  try {
    const registry = new AgentRegistry(root, "test");
    assert.match(registry.problem ?? "", /not trusted: its owner and access list could not be read \(CreateFileW failed \(Windows error 5\)\)/u);
    assert.notEqual(registry.problemCode, "agents-unavailable", "not merely busy");
  } finally {
    setAccessList(path, `D:P(A;;FA;;;${currentUserSid()})`);
  }
}));

test("a busy legacy registry blocks saves too, so its import is never skipped", onWindows, () => withFolder((root) => {
  const legacy = join(root, ".lilac-agents.json");
  writeTrustedFile(legacy, `${JSON.stringify({ version: 1, agents: [] })}\n`);
  const held = openSync(legacy, "r+");
  let busy;
  try {
    busy = new AgentRegistry(root, "test");
  } finally {
    closeSync(held);
  }
  assert.equal(busy.problemCode, "agents-unavailable");
  assert.throws(() => busy.create("Early", "2026-10-13T00:00:00.000Z"), /could not be read just now/u);
  assert.equal(existsSync(join(root, ".ninerr-agents.json")), false, "no Ninerr registry was written past the legacy one");
}));

test("links set aside as untrusted end the legacy links' import: removed links cannot come back", async () => withFolder(async (root) => {
  // Legacy links from before the rename, and a Ninerr links file set aside earlier.
  writeTrustedFile(join(root, ".lilac-codebases.json"), JSON.stringify({ version: 1, links: { site: root } }));
  writeFileSync(join(root, ".ninerr-codebases.json.unreadable-1"), "{}");
  assert.equal(new CodebaseLinks(root).get("site"), null);
}));
