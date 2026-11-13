// Deterministic archives of a package folder: the same files give the same bytes, whatever the
// time, the machine, its user and umask, or the order its file system lists a folder in. Entries are in
// path order, every time is fixed, and nothing about the host is written. A zip (Windows and
// macOS) is written here; a tar.gz (Linux) is GNU tar's, told to do the same, then `gzip -n`.
// Compressed bytes are zlib's, so the same Node.js release gives the same archive.
import { closeSync, lstatSync, openSync, readdirSync, readFileSync, readlinkSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { crc32, deflateRawSync } from "node:zlib";

// 1980-01-01 00:00:00, the earliest time a zip can record.
const DOS_DATE = (1 << 5) | 1;
const DOS_TIME = 0;
const UTF8 = 1 << 11;
const MADE_BY_UNIX = 3 << 8 | 20;
const NEEDED = 20;
const MAX_ZIP = 0xffffffff;

/** Every entry under root/name, in path order: [path inside the archive, its stat, its full path]. */
function entries(root, name) {
  const found = [];
  const walk = (relative) => {
    const full = join(root, ...relative.split("/"));
    const stat = lstatSync(full);
    found.push({ path: relative, stat, full });
    if (stat.isDirectory()) {
      for (const child of readdirSync(full).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) walk(`${relative}/${child}`);
    }
  };
  walk(name);
  return found;
}

/**
 * A file's mode as the archive records it: a folder 755, a link 777, and a file 755 when anyone
 * may run it, else 644. Windows has no such bits, so there every file is 644.
 */
function modeOf(stat) {
  if (stat.isDirectory()) return 0o040755;
  if (stat.isSymbolicLink()) return 0o120777;
  if (!stat.isFile()) throw new Error("only folders, files and links can be archived");
  return process.platform !== "win32" && (stat.mode & 0o111) !== 0 ? 0o100755 : 0o100644;
}

/** Write root/name, and everything in it, to archive as a deterministic zip. */
export function writeZip(root, name, archive) {
  const fd = openSync(archive, "w");
  const central = [];
  let offset = 0;
  const write = (buffer) => {
    writeSync(fd, buffer);
    offset += buffer.length;
  };
  try {
    for (const { path, stat, full } of entries(root, name)) {
      const mode = modeOf(stat);
      const fileName = Buffer.from(stat.isDirectory() ? `${path}/` : path, "utf8");
      const data = stat.isDirectory() ? Buffer.alloc(0) : stat.isSymbolicLink() ? Buffer.from(readlinkSync(full), "utf8") : readFileSync(full);
      const deflated = stat.isFile() && data.length > 0 ? deflateRawSync(data, { level: 9 }) : null;
      const stored = deflated === null || deflated.length >= data.length;
      const body = stored ? data : deflated;
      const crc = crc32(data);
      if (data.length > MAX_ZIP || body.length > MAX_ZIP || offset > MAX_ZIP) throw new Error(`${path} is too large for a zip without ZIP64`);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(NEEDED, 4);
      local.writeUInt16LE(UTF8, 6);
      local.writeUInt16LE(stored ? 0 : 8, 8);
      local.writeUInt16LE(DOS_TIME, 10);
      local.writeUInt16LE(DOS_DATE, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(fileName.length, 26);
      local.writeUInt16LE(0, 28);
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(MADE_BY_UNIX, 4);
      header.writeUInt16LE(NEEDED, 6);
      header.writeUInt16LE(UTF8, 8);
      header.writeUInt16LE(stored ? 0 : 8, 10);
      header.writeUInt16LE(DOS_TIME, 12);
      header.writeUInt16LE(DOS_DATE, 14);
      header.writeUInt32LE(crc, 16);
      header.writeUInt32LE(body.length, 20);
      header.writeUInt32LE(data.length, 24);
      header.writeUInt16LE(fileName.length, 28);
      // Extra field, comment, disk and internal attributes stay 0.
      header.writeUInt32LE(((mode << 16) | (stat.isDirectory() ? 0x10 : 0)) >>> 0, 38);
      header.writeUInt32LE(offset, 42);
      central.push(Buffer.concat([header, fileName]));
      write(local);
      write(fileName);
      write(body);
    }
    if (central.length > 0xffff) throw new Error("too many entries for a zip without ZIP64");
    const directory = Buffer.concat(central);
    const start = offset;
    write(directory);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(start, 16);
    write(end);
  } catch (error) {
    closeSync(fd);
    rmSync(archive, { force: true });
    throw error;
  }
  closeSync(fd);
}

/** Write root/name to archive as a deterministic tar.gz, with GNU tar and gzip. */
export function writeTarGz(root, name, archive) {
  const tar = `${archive.replace(/\.gz$/u, "")}`;
  rmSync(tar, { force: true });
  const flags = ["--sort=name", "--mtime=@315532800", "--owner=0", "--group=0", "--numeric-owner", "--format=gnu", "--mode=u+rwX,go=rX"];
  const made = spawnSync("tar", [...flags, "-cf", tar, "-C", root, name], { stdio: "inherit" });
  if (made.status !== 0) {
    rmSync(tar, { force: true });
    throw new Error("tar failed: GNU tar 1.28 or later is needed for a deterministic archive");
  }
  rmSync(archive, { force: true });
  const zipped = spawnSync("gzip", ["-9", "-n", tar], { stdio: "inherit" });
  if (zipped.status !== 0) {
    rmSync(tar, { force: true });
    rmSync(archive, { force: true });
    throw new Error("gzip failed");
  }
}
