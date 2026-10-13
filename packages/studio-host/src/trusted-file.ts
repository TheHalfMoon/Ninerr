import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, openSync, readSync, renameSync, rmSync, writeSync } from "node:fs";
import { createPrivateFile, currentUserSid, readWithSecurity, type WindowsFileSecurity } from "./windows-security.ts";

// The files in the projects folder that Ninerr trusts: the relay discovery file, which tells an
// MCP relay where to send an agent's credential; the agent registry; and the codebase links. A
// file is trusted only when this user owns it and no one else can change it, proven on the same
// open file that is then read, so it cannot be swapped between the check and the read (#268).
// On POSIX that is the owner and the mode; on Windows, the owner and the access list, read
// through a small native boundary (windows-security.ts). Whatever cannot be proven is refused.

/** A file that is there but not trusted, with the reason. */
export class UntrustedFileError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UntrustedFileError";
  }
}

/**
 * A file that could not be read just now (another program holds it, or the system refused
 * the read), so nothing about it is proven: not trusted, but not shown to be untrusted either.
 * A caller keeps such a file rather than setting it aside.
 */
export class TrustedFileUnavailableError extends UntrustedFileError {
  constructor(reason: string) {
    super(reason);
    this.name = "TrustedFileUnavailableError";
  }
}

// Rights that let an account change, replace or re-permission a file: write and append data,
// write extended attributes and attributes, delete, change the access list or the owner, and
// the generic and maximum-allowed forms that include them.
const WRITE_RIGHTS = 0x2 | 0x4 | 0x10 | 0x100 | 0x10000 | 0x40000 | 0x80000 | 0x2000000 | 0x10000000 | 0x40000000;
// Who may hold those rights besides this user: SYSTEM, the Administrators group, and OWNER
// RIGHTS, which applies to the owner, itself checked to be one of these.
const SYSTEM = "S-1-5-18";
const ADMINISTRATORS = "S-1-5-32-544";
const OWNER_RIGHTS = "S-1-3-4";
// An entry that only passes down to children does not apply to the file itself.
const INHERIT_ONLY = 0x8;
// Entries that deny never widen access: access-denied, its object and callback forms.
const DENYING = new Set([0x1, 0x6, 0xa, 0xc]);

/** Why a Windows file with `security` is not private to `userSid`, or null when it is. */
export function windowsTrustProblem(security: WindowsFileSecurity, userSid: string): string | null {
  const trusted = new Set([userSid, SYSTEM, ADMINISTRATORS]);
  if (security.owner === null) return "its file system keeps no owner or access list (for example FAT or exFAT)";
  if (!trusted.has(security.owner)) return `it is owned by ${security.owner}, not by this user`;
  if (security.aces === null) return "it has no access list, so every account may change it";
  for (const ace of security.aces) {
    if (DENYING.has(ace.type) || (ace.flags & INHERIT_ONLY) !== 0 || (ace.mask & WRITE_RIGHTS) === 0) continue;
    if (ace.sid === null) return `an access entry Ninerr cannot read (type ${ace.type}) may let another account change it`;
    if (!trusted.has(ace.sid) && ace.sid !== OWNER_RIGHTS) return `another account (${ace.sid}) may change it`;
  }
  return null;
}

/**
 * The content of the trusted file at `path`, at most `maxBytes`; null when nothing is there.
 * Throws UntrustedFileError for a file that is there but cannot be proven private.
 */
export function readTrustedFile(path: string, maxBytes: number): Buffer | null {
  if (process.platform === "win32") return readTrustedWindows(path, maxBytes);
  let fd: number;
  try {
    // Never through a link: the check and the read are of this one file. Without blocking, so
    // a FIFO in its place is refused below rather than waited on.
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    if (code === "ELOOP") throw new UntrustedFileError("it is a link");
    throw new TrustedFileUnavailableError(`it could not be opened (${code ?? "unknown error"})`);
  }
  try {
    const entry = fstatSync(fd);
    if (!entry.isFile()) throw new UntrustedFileError("it is not a regular file");
    if (entry.size > maxBytes) throw new UntrustedFileError(`it is larger than ${maxBytes} bytes`);
    if (typeof process.getuid === "function" && entry.uid !== process.getuid()) throw new UntrustedFileError("it is not owned by this user");
    if ((entry.mode & 0o022) !== 0) throw new UntrustedFileError("other accounts may change it");
    const bytes = Buffer.alloc(entry.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    return bytes.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

function readTrustedWindows(path: string, maxBytes: number): Buffer | null {
  let read;
  let userSid;
  try {
    read = readWithSecurity(path, maxBytes);
    userSid = currentUserSid();
  } catch (error) {
    throw new TrustedFileUnavailableError(`its owner and access list could not be read (${error instanceof Error ? error.message : String(error)})`);
  }
  if (read === null) return null;
  if (!read.regularFile) throw new UntrustedFileError("it is not a regular file (a folder or a link)");
  if (read.size > maxBytes || read.bytes === null) throw new UntrustedFileError(`it is larger than ${maxBytes} bytes`);
  const problem = windowsTrustProblem(read.security, userSid);
  if (problem !== null) throw new UntrustedFileError(problem);
  return read.bytes;
}

/**
 * Replace the trusted file at `path` with `text`, private to this user from the moment it
 * exists: written to a new file beside it and renamed into place, durable before the rename.
 */
export function writeTrustedFile(path: string, text: string): void {
  const bytes = Buffer.from(text, "utf8");
  let temporary: string | null = null;
  try {
    if (process.platform === "win32") {
      temporary = createPrivateFile(path, bytes);
    } else {
      temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
      const fd = openSync(temporary, "wx", 0o600);
      try {
        writeSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      // The creation mode is narrowed by the umask, never widened; make it exactly owner-only.
      chmodSync(temporary, 0o600);
    }
    renameSync(temporary, path);
    temporary = null;
  } finally {
    if (temporary !== null) rmSync(temporary, { force: true });
  }
}
