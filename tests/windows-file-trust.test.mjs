import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

import { formatSid, longPath, privateSddl } from "../packages/studio-host/src/windows-security.ts";

// #268, the founder's decision of 2026-10-13: Ninerr reads the owner and access list of the
// files that steer an agent's credential through a small native boundary. Its use, the trust
// judgement, follows in the next change; these tests pin the boundary itself.

const WINDOWS = process.platform === "win32";
const USER = "S-1-5-21-1-2-3-1001";

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
  assert.deepEqual(bound, ["CloseHandle", "ConvertStringSecurityDescriptorToSecurityDescriptorW", "CreateFileW", "FlushFileBuffers", "GetAce", "GetAclInformation", "GetCurrentProcess", "GetFileInformationByHandle", "GetFileType", "GetLastError", "GetLengthSid", "GetSecurityInfo", "GetTokenInformation", "IsValidSid", "LocalFree", "OpenProcessToken", "ReadFile", "WriteFile"]);
  for (const file of ["windows-security.ts"]) {
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
