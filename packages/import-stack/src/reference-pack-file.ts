import { basename, join } from "node:path";
import { ImportSecurityError, ImportValidationError } from "./errors.ts";
import { canonicalDirectory, canonicalFileWithinRoots, readSingleLinkFile } from "./filesystem.ts";
import {
  REFERENCE_PACK_LIMITS,
  ReferencePackValidationError,
  normalizeReferencePack,
  referencePackDigest,
} from "./reference-packs.mjs";

/**
 * Read-only reader for one portable reference pack stored as a JSON file.
 *
 * The caller must supply a directory it already trusts (for example a path the user
 * selected in a native dialog). This module never accepts arbitrary paths from an
 * untrusted MCP request: `fileName` is a single basename on a strict allowlist, and the
 * file must resolve inside `directory`.
 *
 * The reused filesystem helpers enforce path containment, a regular non-symlink file,
 * no hard links and a byte limit. They do NOT verify file ownership, ACLs, Windows
 * integrity levels, or who else can read the directory; those remain caller
 * responsibilities for the trusted root. No network, AI provider or cloud service is
 * contacted, and nothing is written or modified.
 */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,122}\.json$/u;

export interface LocalReferencePackFile {
  /** Basename only; the absolute directory is deliberately not echoed back. */
  fileName: string;
  byteLength: number;
  /** Deterministic digest of the normalized manifest, not of the raw file bytes. */
  packDigest: string;
  pack: ReturnType<typeof normalizeReferencePack>;
}

export interface ReadReferencePackFileInput {
  /** Trusted, user-selected directory that contains the pack. */
  directory: string;
  /** A single `.json` basename. Never a path, glob, URL or MCP-supplied string. */
  fileName: string;
}

export async function readReferencePackFile(input: ReadReferencePackFileInput): Promise<LocalReferencePackFile> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ImportValidationError("reference pack input must be an object");
  }
  const { directory, fileName } = input;

  if (typeof fileName !== "string" || basename(fileName) !== fileName
    || /[\u0000-\u001f\u007f]/u.test(fileName) || !FILE_NAME.test(fileName)) {
    throw new ImportSecurityError("reference pack fileName must be a single basename ending .json");
  }

  const root = await canonicalDirectory(directory, "reference pack directory");
  const file = await canonicalFileWithinRoots(join(root, fileName), [root], "reference pack file");
  const bytes = await readSingleLinkFile(file, "reference pack file", REFERENCE_PACK_LIMITS.maxManifestBytes);
  if (bytes.byteLength === 0) throw new ImportValidationError("reference pack file is empty");

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ImportValidationError("reference pack file is not valid UTF-8");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ImportValidationError("reference pack file is not valid JSON");
  }

  let pack: ReturnType<typeof normalizeReferencePack>;
  try {
    pack = normalizeReferencePack(parsed);
  } catch (error) {
    if (error instanceof ReferencePackValidationError) {
      throw new ImportValidationError(`reference pack is invalid: ${error.message}`);
    }
    throw error;
  }

  return Object.freeze({
    fileName,
    byteLength: bytes.byteLength,
    packDigest: referencePackDigest(pack),
    pack,
  });
}
