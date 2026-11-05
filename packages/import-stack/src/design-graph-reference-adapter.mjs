import { createHash } from "node:crypto";
import { normalizeReferencePack, REFERENCE_PACK_SCHEMA_VERSION, REFERENCE_PACK_LIMITS, ReferencePackValidationError } from "./reference-packs.mjs";

/**
 * Offline, content-only adapter for a previously authorized design-graph snapshot.
 * No database connections, network requests, file operations or account inference.
 * Rights remain non-redistributable until separately verified outside this adapter.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HASH = /^[a-f0-9]{64}$/u;
const GRANT = Object.freeze({ status: "unknown", license: null, redistributable: false });
const DENIED = Object.freeze({ status: "restricted", license: null, redistributable: false });
const KINDS = new Map([
  ["screen", "screen"], ["page", "screen"], ["section", "screen"], ["design", "screen"],
  ["component", "component"], ["icon", "asset"], ["logo", "asset"], ["font", "asset"],
  ["illustration", "asset"], ["resource", "asset"],
]);

function fail(field, message) { throw new ReferencePackValidationError(`${field}: ${message}`); }
function rows(value, field, limit) {
  if (!Array.isArray(value) || value.length > limit) fail(field, `expected array of at most ${limit}`);
  return value;
}
function uuid(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) fail(field, "expected canonical UUID");
  return value.toLowerCase();
}
function scopedId(kind, original) {
  return `urn:ninerr:${kind}:${createHash("sha256").update(`${kind}:${original}`).digest("hex").slice(0, 32)}`;
}
function classification(value) {
  return value === "restricted" || value === "metadata_only" ? DENIED : GRANT;
}
function record(value, at) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(at, "expected record");
  return value;
}
function title(value, fallback) {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return value.trim().slice(0, 200).replace(/[\u0000-\u001f\u007f]/gu, " ").trim() || fallback;
}
function iso(value, field) {
  if (typeof value !== "string") fail(field, "expected timestamp");
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail(field, "invalid timestamp");
  return new Date(ms).toISOString();
}

/**
 * Input is an **already access-filtered** export from the source system, not raw DB access.
 * Only public artifacts are copied by default. Private rows require an explicit local-only
 * flag and always remain non-redistributable; patterns/flows without visibility are private.
 */
export function convertDesignGraphSnapshot(input, { includeNonPublic = false } = {}) {
  record(input, "snapshot");
  if (typeof includeNonPublic !== "boolean") fail("includeNonPublic", "expected boolean");
  const sources = rows(input.sources, "sources", REFERENCE_PACK_LIMITS.maxSources);
  const artifacts = rows(input.artifacts, "artifacts", REFERENCE_PACK_LIMITS.maxObjects);
  const assets = rows(input.assets, "assets", REFERENCE_PACK_LIMITS.maxAssets);
  const patterns = rows(input.patterns, "patterns", REFERENCE_PACK_LIMITS.maxObjects);
  const flows = rows(input.flows, "flows", REFERENCE_PACK_LIMITS.maxObjects);
  const sourceMap = new Map();
  const outputSources = sources.map((raw, i) => {
    const src = record(raw, `sources[${i}]`);
    const srcId = uuid(src.id, `sources[${i}].id`);
    if (sourceMap.has(srcId)) fail(`sources[${i}]`, "duplicate source UUID");
    const id = scopedId("source", srcId);
    sourceMap.set(srcId, id);
    return { id, uri: id, observedAt: iso(src.createdAt, `sources[${i}].createdAt`), rights: GRANT };
  });
  const byHash = new Map();
  for (const [i, value] of assets.entries()) {
    const a = record(value, `assets[${i}]`);
    const sourceId = uuid(a.sourceId, `assets[${i}].sourceId`);
    if (!sourceMap.has(sourceId)) fail(`assets[${i}]`, "unknown source UUID");
    if (typeof a.sha256 !== "string" || !HASH.test(a.sha256)) fail(`assets[${i}]`, "invalid sha256");
    if (!Number.isSafeInteger(a.byteLength) || a.byteLength < 0 || a.byteLength > REFERENCE_PACK_LIMITS.maxAssetBytes) fail(`assets[${i}]`, "invalid asset size");
    if (byHash.has(a.sha256)) fail(`assets[${i}]`, "duplicate content hash");
    byHash.set(a.sha256, a);
  }
  const objects = [];
  const usedAssets = new Set();
  const skipped = { nonPublic: 0, unsupported: 0, assetUnavailable: 0 };
  const push = (entry) => { objects.push(entry); if (objects.length > REFERENCE_PACK_LIMITS.maxObjects) fail("objects", "too many converted objects"); };
  for (const [i, value] of artifacts.entries()) {
    const a = record(value, `artifacts[${i}]`);
    const visibility = a.visibility === undefined ? "private" : a.visibility;
    if (!(["public", "workspace", "private"].includes(visibility))) fail(`artifacts[${i}]`, "invalid visibility");
    if (!includeNonPublic && visibility !== "public") { skipped.nonPublic++; continue; }
    const orig = uuid(a.id, `artifacts[${i}].id`);
    const from = uuid(a.sourceId, `artifacts[${i}].sourceId`);
    const kind = KINDS.get(a.kind);
    if (!kind) { skipped.unsupported++; continue; }
    const sourceId = sourceMap.get(from);
    if (!sourceId) fail(`artifacts[${i}]`, "unknown source UUID");
    let assetSha256 = null;
    if (kind === "asset") {
      const contentHash = a.contentHash;
      const matching = byHash.get(contentHash);
      if (!matching || uuid(matching.sourceId, `artifacts[${i}].assetSourceId`) !== from) {
        skipped.assetUnavailable++; continue;
      }
      usedAssets.add(contentHash);
      assetSha256 = contentHash;
    }
    push({ id: scopedId("object", `artifact:${orig}`), kind,
      title: title(a.title, kind), tags: [String(a.kind)], sourceId, assetSha256,
      confidence: "documented", visibility, rights: classification(a.rightsClassification) });
  }
  for (const [name, rowsInput, kind] of [["patterns", patterns, "pattern"], ["flows", flows, "flow"]]) {
    for (const [i, value] of rowsInput.entries()) {
      if (!includeNonPublic) { skipped.nonPublic++; continue; }
      const row = record(value, `${name}[${i}]`);
      const orig = uuid(row.id, `${name}[${i}].id`);
      const sourceId = sourceMap.get(uuid(row.sourceId, `${name}[${i}].sourceId`));
      if (!sourceId) fail(`${name}[${i}]`, "unknown source UUID");
      push({ id: scopedId("object", `${kind}:${orig}`), kind, title: title(row.title, kind),
        tags: [kind], sourceId, assetSha256: null, confidence: "documented",
        visibility: "private", rights: GRANT });
    }
  }
  const outputAssets = [...usedAssets].map((hash) => {
    const row = byHash.get(hash);
    return { sha256: hash, mediaType: row.mediaType, byteLength: row.byteLength };
  });
  const packId = scopedId("pack", String(input.packKey ?? "local-snapshot") + ":" + input.exportedAt);
  const createdAt = iso(input.exportedAt, "exportedAt");
  const pack = normalizeReferencePack({ schemaVersion: REFERENCE_PACK_SCHEMA_VERSION, packId, createdAt,
    sources: outputSources, objects, assets: outputAssets });
  return Object.freeze({ pack, skipped: Object.freeze(skipped) });
}
