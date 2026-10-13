// Windows only, for tests of #268: give a file or folder an access list from SDDL, as another
// local account or an administrator could, so a test can build the hostile or shared folders
// Ninerr must refuse. Not used by Ninerr itself, which only reads access lists and creates
// private files (packages/studio-host/src/windows-security.ts).
import { createRequire } from "node:module";

let api = null;

function bind() {
  if (api !== null) return api;
  const koffi = createRequire(import.meta.url)("koffi");
  const advapi = koffi.load("advapi32.dll");
  const kernel = koffi.load("kernel32.dll");
  api = {
    convert: advapi.func("bool __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(str16 sddl, uint32 revision, _Out_ void **descriptor, _Out_ uint32 *size)"),
    dacl: advapi.func("bool __stdcall GetSecurityDescriptorDacl(void *descriptor, _Out_ bool *present, _Out_ void **dacl, _Out_ bool *defaulted)"),
    set: advapi.func("uint32 __stdcall SetNamedSecurityInfoW(str16 name, int type, uint32 info, void *owner, void *group, void *dacl, void *sacl)"),
    free: kernel.func("void * __stdcall LocalFree(void *p)"),
    lastError: kernel.func("uint32 __stdcall GetLastError()"),
  };
  return api;
}

/**
 * Set `path`'s access list to the one `sddl` describes ("D:..." or "D:P..."); `P` protects it
 * from what its folder passes down, and without it the folder's inherited entries apply too.
 */
export function setAccessList(path, sddl) {
  const { convert, dacl, set, free, lastError } = bind();
  const descriptor = [null];
  if (!convert(sddl, 1, descriptor, [0])) throw new Error(`SDDL ${sddl}: Windows error ${lastError()}`);
  try {
    const present = [false];
    const list = [null];
    if (!dacl(descriptor[0], present, list, [false])) throw new Error(`GetSecurityDescriptorDacl: Windows error ${lastError()}`);
    // DACL_SECURITY_INFORMATION, plus PROTECTED_ or UNPROTECTED_DACL_SECURITY_INFORMATION.
    const protection = /^D:P/u.test(sddl) ? 0x80000000 : 0x20000000;
    const status = set(path, 1, 0x4 | protection, null, null, list[0], null);
    if (status !== 0) throw new Error(`SetNamedSecurityInfoW ${path}: Windows error ${status}`);
  } finally {
    free(descriptor[0]);
  }
}
