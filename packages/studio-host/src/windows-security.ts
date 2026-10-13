import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

// The native boundary to the Windows security API (#268, the founder's decision of 2026-10-13).
// Node has no API for Windows owners or access lists, and Ninerr starts no child process, so
// these few functions of advapi32.dll and kernel32.dll are called through Koffi (MIT, pinned
// in packages/studio-host/package.json). Nothing else is bound, and this module is loaded on
// Windows only. Every failure is an error: a caller that cannot prove a file is private does
// not trust it.

/** A file's security, as the trust judgement reads it. */
export interface WindowsFileSecurity {
  /** The owner's SID as text, or null when the file system keeps none (FAT, exFAT). */
  owner: string | null;
  /** Null when there is no access list at all, which grants everyone everything. */
  aces: Array<{ type: number; flags: number; mask: number; sid: string | null }> | null;
}

/** What a trusted read found, before the content is judged. */
export interface WindowsTrustedRead {
  security: WindowsFileSecurity;
  /** Whether the opened object is a regular file: not a directory and not a reparse point. */
  regularFile: boolean;
  size: number;
  bytes: Buffer | null;
}

const INVALID_HANDLE = 0xffffffffffffffffn;
const GENERIC_READ = 0x80000000;
const GENERIC_WRITE = 0x40000000;
const READ_CONTROL = 0x00020000;
const FILE_SHARE_READ = 0x1;
const OPEN_EXISTING = 3;
const CREATE_NEW = 1;
const FILE_ATTRIBUTE_NORMAL = 0x80;
const FILE_ATTRIBUTE_DIRECTORY = 0x10;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
const FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
const FILE_FLAG_WRITE_THROUGH = 0x80000000;
const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
const SE_FILE_OBJECT = 1;
const OWNER_SECURITY_INFORMATION = 0x1;
const DACL_SECURITY_INFORMATION = 0x4;
const TOKEN_QUERY = 0x0008;
const TOKEN_USER = 1;
const ACL_SIZE_INFORMATION_CLASS = 2;
const SDDL_REVISION_1 = 1;
const ERROR_FILE_NOT_FOUND = 2;
const ERROR_PATH_NOT_FOUND = 3;

/** An error the Windows API reported, with its code. */
export class WindowsSecurityError extends Error {
  readonly code: number;
  constructor(what: string, code: number) {
    super(`${what} failed (Windows error ${code})`);
    this.name = "WindowsSecurityError";
    this.code = code;
  }
}

/** A path as the wide Windows API takes it: absolute, backslashed, past the 260-character limit. */
export function longPath(path: string): string {
  const full = resolve(path).replace(/\//gu, "\\");
  if (full.startsWith("\\\\?\\")) return full;
  if (full.startsWith("\\\\")) return `\\\\?\\UNC\\${full.slice(2)}`;
  return `\\\\?\\${full}`;
}

/** A SID as text from its bytes: S-revision-authority-subauthority... */
export function formatSid(bytes: Buffer): string {
  if (bytes.length < 8 || bytes.length < 8 + bytes[1] * 4) throw new Error("a SID is shorter than it says");
  let authority = 0n;
  for (let index = 2; index < 8; index += 1) authority = (authority << 8n) | BigInt(bytes[index]);
  const parts: Array<number | bigint> = [bytes[0], authority];
  for (let index = 0; index < bytes[1]; index += 1) parts.push(bytes.readUInt32LE(8 + index * 4));
  return `S-${parts.join("-")}`;
}

interface Bindings {
  koffi: any;
  CreateFileW: any;
  CloseHandle: any;
  GetLastError: any;
  LocalFree: any;
  ReadFile: any;
  WriteFile: any;
  FlushFileBuffers: any;
  GetFileInformationByHandle: any;
  GetSecurityInfo: any;
  GetLengthSid: any;
  IsValidSid: any;
  GetAclInformation: any;
  GetAce: any;
  GetCurrentProcess: any;
  OpenProcessToken: any;
  GetTokenInformation: any;
  ConvertStringSecurityDescriptorToSecurityDescriptorW: any;
  ACE_HEADER: any;
  BY_HANDLE_FILE_INFORMATION: any;
}

let bindings: Bindings | null = null;

/** Koffi and the bound functions, loaded once, on Windows only. */
function bind(): Bindings {
  if (bindings !== null) return bindings;
  if (process.platform !== "win32") throw new Error("the Windows security API is available on Windows only");
  const koffi = createRequire(import.meta.url)("koffi");
  const advapi = koffi.load("advapi32.dll");
  const kernel = koffi.load("kernel32.dll");
  koffi.pointer("NINERR_HANDLE", koffi.opaque());
  const ACE_HEADER = koffi.struct("NINERR_ACE_HEADER", { AceType: "uint8", AceFlags: "uint8", AceSize: "uint16" });
  koffi.struct("NINERR_ACL_SIZE_INFORMATION", { AceCount: "uint32", AclBytesInUse: "uint32", AclBytesFree: "uint32" });
  const FILETIME = koffi.struct("NINERR_FILETIME", { low: "uint32", high: "uint32" });
  const BY_HANDLE_FILE_INFORMATION = koffi.struct("NINERR_BY_HANDLE_FILE_INFORMATION", {
    attributes: "uint32", created: FILETIME, accessed: FILETIME, written: FILETIME,
    volumeSerial: "uint32", sizeHigh: "uint32", sizeLow: "uint32", links: "uint32", indexHigh: "uint32", indexLow: "uint32",
  });
  koffi.struct("NINERR_SECURITY_ATTRIBUTES", { nLength: "uint32", lpSecurityDescriptor: "void *", bInheritHandle: "int" });
  bindings = {
    koffi,
    ACE_HEADER,
    BY_HANDLE_FILE_INFORMATION,
    CreateFileW: kernel.func("NINERR_HANDLE __stdcall CreateFileW(str16 name, uint32 access, uint32 share, NINERR_SECURITY_ATTRIBUTES *attributes, uint32 disposition, uint32 flags, NINERR_HANDLE template)"),
    CloseHandle: kernel.func("bool __stdcall CloseHandle(NINERR_HANDLE h)"),
    GetLastError: kernel.func("uint32 __stdcall GetLastError()"),
    LocalFree: kernel.func("void * __stdcall LocalFree(void *p)"),
    ReadFile: kernel.func("bool __stdcall ReadFile(NINERR_HANDLE h, _Out_ uint8_t *buffer, uint32 size, _Out_ uint32 *read, void *overlapped)"),
    WriteFile: kernel.func("bool __stdcall WriteFile(NINERR_HANDLE h, const uint8_t *buffer, uint32 size, _Out_ uint32 *written, void *overlapped)"),
    FlushFileBuffers: kernel.func("bool __stdcall FlushFileBuffers(NINERR_HANDLE h)"),
    GetFileInformationByHandle: kernel.func("bool __stdcall GetFileInformationByHandle(NINERR_HANDLE h, _Out_ NINERR_BY_HANDLE_FILE_INFORMATION *info)"),
    GetSecurityInfo: advapi.func("uint32 __stdcall GetSecurityInfo(NINERR_HANDLE h, int type, uint32 info, _Out_ void **owner, _Out_ void **group, _Out_ void **dacl, _Out_ void **sacl, _Out_ void **descriptor)"),
    GetLengthSid: advapi.func("uint32 __stdcall GetLengthSid(void *sid)"),
    IsValidSid: advapi.func("bool __stdcall IsValidSid(void *sid)"),
    GetAclInformation: advapi.func("bool __stdcall GetAclInformation(void *acl, _Out_ NINERR_ACL_SIZE_INFORMATION *info, uint32 size, int cls)"),
    GetAce: advapi.func("bool __stdcall GetAce(void *acl, uint32 index, _Out_ void **ace)"),
    GetCurrentProcess: kernel.func("NINERR_HANDLE __stdcall GetCurrentProcess()"),
    OpenProcessToken: advapi.func("bool __stdcall OpenProcessToken(NINERR_HANDLE process, uint32 access, _Out_ NINERR_HANDLE *token)"),
    GetTokenInformation: advapi.func("bool __stdcall GetTokenInformation(NINERR_HANDLE token, int cls, _Out_ uint8_t *buffer, uint32 size, _Out_ uint32 *returned)"),
    ConvertStringSecurityDescriptorToSecurityDescriptorW: advapi.func("bool __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(str16 sddl, uint32 revision, _Out_ void **descriptor, _Out_ uint32 *size)"),
  };
  return bindings;
}

const isInvalid = (api: Bindings, handle: unknown) => handle === null || api.koffi.address(handle) === INVALID_HANDLE;

function sidAt(api: Bindings, sid: unknown): string {
  if (!api.IsValidSid(sid)) throw new Error("the Windows API returned an invalid SID");
  return formatSid(Buffer.from(api.koffi.decode(sid, api.koffi.array("uint8", api.GetLengthSid(sid)))));
}

/** The SID of the user this process runs as. */
export function currentUserSid(): string {
  const api = bind();
  const token = [null];
  if (!api.OpenProcessToken(api.GetCurrentProcess(), TOKEN_QUERY, token)) throw new WindowsSecurityError("OpenProcessToken", api.GetLastError());
  try {
    const buffer = Buffer.alloc(512);
    const returned = [0];
    if (!api.GetTokenInformation(token[0], TOKEN_USER, buffer, buffer.length, returned)) throw new WindowsSecurityError("GetTokenInformation", api.GetLastError());
    // TOKEN_USER begins with the user's SID pointer.
    return sidAt(api, api.koffi.decode(buffer, "void *"));
  } finally {
    api.CloseHandle(token[0]);
  }
}

function securityOf(api: Bindings, handle: unknown): WindowsFileSecurity {
  const owner = [null];
  const dacl = [null];
  const descriptor = [null];
  const status = api.GetSecurityInfo(handle, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, owner, [null], dacl, [null], descriptor);
  if (status !== 0) throw new WindowsSecurityError("GetSecurityInfo", status);
  try {
    const ownerSid = owner[0] === null ? null : sidAt(api, owner[0]);
    if (dacl[0] === null) return { owner: ownerSid, aces: null };
    const info: { AceCount?: number } = {};
    if (!api.GetAclInformation(dacl[0], info, 12, ACL_SIZE_INFORMATION_CLASS)) throw new WindowsSecurityError("GetAclInformation", api.GetLastError());
    const aces: WindowsFileSecurity["aces"] = [];
    for (let index = 0; index < (info.AceCount ?? 0); index += 1) {
      const ace = [null];
      if (!api.GetAce(dacl[0], index, ace)) throw new WindowsSecurityError("GetAce", api.GetLastError());
      const header = api.koffi.decode(ace[0], api.ACE_HEADER);
      const bytes = Buffer.from(api.koffi.decode(ace[0], api.koffi.array("uint8", header.AceSize)));
      // Access-allowed (0) and access-denied (1) entries: header, mask, then the SID. Other
      // types (object, callback, conditional) are kept without a SID; the judgement refuses an
      // allowing one it cannot read.
      const simple = header.AceType === 0 || header.AceType === 1;
      aces.push({ type: header.AceType, flags: header.AceFlags, mask: bytes.readUInt32LE(4), sid: simple ? formatSid(bytes.subarray(8)) : null });
    }
    return { owner: ownerSid, aces };
  } finally {
    api.LocalFree(descriptor[0]);
  }
}

/**
 * Open `path` once, without following a link, with writers shut out while it is open, and from
 * that one handle read its security and, when it is a small regular file, its content. Null
 * when there is nothing at `path`.
 */
export function readWithSecurity(path: string, maxBytes: number): WindowsTrustedRead | null {
  const api = bind();
  // Backup semantics lets a folder in the file's place be opened, and so refused by its kind.
  const handle = api.CreateFileW(longPath(path), GENERIC_READ | READ_CONTROL, FILE_SHARE_READ, null, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, null);
  if (isInvalid(api, handle)) {
    const code = api.GetLastError();
    if (code === ERROR_FILE_NOT_FOUND || code === ERROR_PATH_NOT_FOUND) return null;
    throw new WindowsSecurityError("CreateFileW", code);
  }
  try {
    const info: { attributes?: number; sizeHigh?: number; sizeLow?: number } = {};
    if (!api.GetFileInformationByHandle(handle, info)) throw new WindowsSecurityError("GetFileInformationByHandle", api.GetLastError());
    const attributes = info.attributes ?? 0;
    const regularFile = (attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) === 0;
    const size = (info.sizeHigh ?? 0) * 2 ** 32 + (info.sizeLow ?? 0);
    const security = securityOf(api, handle);
    if (!regularFile || size > maxBytes) return { security, regularFile, size, bytes: null };
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const chunk = Buffer.alloc(size - offset);
      const read = [0];
      if (!api.ReadFile(handle, chunk, chunk.length, read, null)) throw new WindowsSecurityError("ReadFile", api.GetLastError());
      if (read[0] === 0) break;
      chunk.copy(bytes, offset, 0, read[0]);
      offset += read[0];
    }
    return { security, regularFile, size, bytes: bytes.subarray(0, offset) };
  } finally {
    api.CloseHandle(handle);
  }
}

/**
 * The access list Ninerr gives the files it trusts: full control for this user, SYSTEM and
 * the Administrators group only, protected from what the folder would pass down.
 */
export function privateSddl(userSid: string): string {
  if (!/^S-1-\d+(-\d+)+$/u.test(userSid)) throw new Error("not a SID");
  return `D:P(A;;FA;;;${userSid})(A;;FA;;;SY)(A;;FA;;;BA)`;
}

/**
 * Create `path`'s replacement with the private access list from the start, write `bytes`
 * through to disk, and return the temporary path for the caller to rename into place. No
 * handle to the new file is ever open to anyone else: it is created private.
 */
export function createPrivateFile(path: string, bytes: Buffer): string {
  const api = bind();
  const descriptor = [null];
  const size = [0];
  if (!api.ConvertStringSecurityDescriptorToSecurityDescriptorW(privateSddl(currentUserSid()), SDDL_REVISION_1, descriptor, size)) {
    throw new WindowsSecurityError("ConvertStringSecurityDescriptorToSecurityDescriptorW", api.GetLastError());
  }
  try {
    const temporary = `${resolve(path)}.${randomBytes(8).toString("hex")}.tmp`;
    const attributes = { nLength: 24, lpSecurityDescriptor: descriptor[0], bInheritHandle: 0 };
    const handle = api.CreateFileW(longPath(temporary), GENERIC_WRITE, 0, attributes, CREATE_NEW, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, null);
    if (isInvalid(api, handle)) throw new WindowsSecurityError("CreateFileW", api.GetLastError());
    try {
      const written = [0];
      if (bytes.length > 0 && (!api.WriteFile(handle, bytes, bytes.length, written, null) || written[0] !== bytes.length)) throw new WindowsSecurityError("WriteFile", api.GetLastError());
      if (!api.FlushFileBuffers(handle)) throw new WindowsSecurityError("FlushFileBuffers", api.GetLastError());
    } finally {
      api.CloseHandle(handle);
    }
    return temporary;
  } finally {
    api.LocalFree(descriptor[0]);
  }
}
