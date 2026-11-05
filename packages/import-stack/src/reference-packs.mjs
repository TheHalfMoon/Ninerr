import { createHash } from "node:crypto";

/**
 * A bounded, offline-only, rights-aware portable reference format. This module NEVER
 * opens a URL or a file, and does not import a hosted runtime.
 *
 * Research adapters may emit these objects after verifying their own input
 * rights and provenance. The pack is a catalogue, not proof of permission.
 */
export const REFERENCE_PACK_SCHEMA_VERSION = 1;
export const REFERENCE_PACK_LIMITS = Object.freeze({
  maxManifestBytes: 4 * 1024 * 1024,
  maxSources: 2_048,
  maxObjects: 10_000,
  maxAssets: 2_048,
  maxAssetBytes: 32 * 1024 * 1024,
  maxTotalAssetBytes: 128 * 1024 * 1024,
});

const ID = /^urn:ninerr:(?:pack|source|object):[a-z0-9][a-z0-9._:-]{0,127}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const TAG = /^[a-z0-9][a-z0-9._/-]{0,31}$/u;
const OBJECT_KINDS = new Set(["screen", "flow", "pattern", "asset", "token", "component"]);
const CONFIDENCES = new Set(["observed", "documented", "inferred", "unknown"]);
const RIGHTS = new Set(["verified", "restricted", "unknown"]);

export class ReferencePackValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReferencePackValidationError";
  }
}

const fail = (at, message) => { throw new ReferencePackValidationError(\`\${at}: \${message}\`); };

function record(value, at, allowed, required = allowed) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    fail(at, "expected a plain object");
  }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(at, \`unsupported field \${key}\`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(at, \`missing field \${key}\`);
  return value;
}

function string(value, at, maximum = 256) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum
    || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(at, \`expected a nonempty trimmed string of at most \${maximum} characters without controls\`);
  }
  return value;
}

function id(value, at, kind) {
  string(value, at, 144);
  if (!ID.test(value) || !value.startsWith(\`urn:ninerr:\${kind}:\`)) fail(at, \`invalid \${kind} identifier\`);
  return value;
}

function digest(value, at) {
  if (typeof value !== "string" || !HASH.test(value)) fail(at, "expected lowercase SHA-256 hex");
  return value;
}

function timestamp(value, at) {
  string(value, at, 30);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail(at, "expected exact UTC RFC3339 timestamp with milliseconds");
  }
  return value;
}

function sourceUri(value, at) {
  string(value, at, 2048);
  if (value.startsWith("urn:ninerr:source:")) return id(value, at, "source");
  let url;
  try { url = new URL(value); } catch { fail(at, "expected HTTPS URL or local source URN"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash
    || url.search || url.href !== value) {
    fail(at, "only absolute HTTPS URLs without credentials, query, or fragment are allowed");
  }
  return value;
}

function array(value, at, max) {
  if (!Array.isArray(value) || value.length > max) fail(at, \`expected an array of at most \${max} elements\`);
  return value;
}

function unique(items, field, at) {
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item[field])) fail(at, \`duplicate \${field} \${item[field]}\`);
    ids.add(item[field]);
  }
  return items.sort((a, b) => a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0);
}

function rights(value, at) {
  record(value, at, ["status", "license", "redistributable"]);
  if (!RIGHTS.has(value.status)) fail(at, "invalid rights status");
  if (value.license !== null) string(value.license, \`\${at}.license\`, 128);
  if (typeof value.redistributable !== "boolean") fail(at, "redistributable must be boolean");
  if (value.redistributable && (value.status !== "verified" || value.license === null)) {
    fail(at, "redistribution requires verified rights and an identified license/grant");
  }
  return Object.freeze({ status: value.status, license: value.license, redistributable: value.redistributable });
}

function source(value, index) {
  const at = \`sources[\${index}]\`;
  record(value, at, ["id", "uri", "observedAt", "rights"]);
  return Object.freeze({
    id: id(value.id, \`\${at}.id\`, "source"),
    uri: sourceUri(value.uri, \`\${at}.uri\`),
    observedAt: timestamp(value.observedAt, \`\${at}.observedAt\`),
    rights: rights(value.rights, \`\${at}.rights\`),
  });
}

function asset(value, index) {
  const at = \`assets[\${index}]\`;
  record(value, at, ["sha256", "byteLength", "mediaType"]);
  const sha256 = digest(value.sha256, \`\${at}.sha256\`);
  if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 0 || value.byteLength > REFERENCE_PACK_LIMITS.maxAssetBytes) {
    fail(\`\${at}.byteLength\`, "invalid asset size");
  }
  const mediaType = string(value.mediaType, \`\${at}.mediaType\`, 100);
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(mediaType)) fail(\`\${at}.mediaType\`, "invalid media type");
  return Object.freeze({ sha256, byteLength: value.byteLength, mediaType });
}

function object(value, index) {
  const at = \`objects[\${index}]\`;
  record(value, at, ["id", "kind", "title", "tags", "sourceId", "assetSha256", "confidence"]);
  if (!OBJECT_KINDS.has(value.kind)) fail(\`\${at}.kind\`, "invalid object kind");
  if (!CONFIDENCES.has(value.confidence)) fail(\`\${at}.confidence\`, "invalid evidence confidence");
  const tags = array(value.tags, \`\${at}.tags\`, 20).map((tag, i) => {
    string(tag, \`\${at}.tags[\${i}]\`, 32);
    if (!TAG.test(tag)) fail(\`\${at}.tags[\${i}]\`, "invalid tag");
    return tag;
  });
  if (new Set(tags).size !== tags.length) fail(\`\${at}.tags\`, "duplicate tag");
  const assetSha256 = value.assetSha256 === null ? null : digest(value.assetSha256, \`\${at}.assetSha256\`);
  if (value.kind === "asset" && assetSha256 === null) fail(\`\${at}.assetSha256\`, "asset kind requires content hash");
  return Object.freeze({
    id: id(value.id, \`\${at}.id\`, "object"), kind: value.kind,
    title: string(value.title, \`\${at}.title\`, 200),
    tags: Object.freeze(tags.sort()),
    sourceId: id(value.sourceId, \`\${at}.sourceId\`, "source"),
    assetSha256, confidence: value.confidence,
  });
}

/** Validate untrusted JSON input; return a canonical, frozen manifest. No IO or network. */
export function normalizeReferencePack(value) {
  try {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > REFERENCE_PACK_LIMITS.maxManifestBytes) {
      fail("manifest", "exceeds size limit");
    }
  } catch (error) {
    if (error instanceof ReferencePackValidationError) throw error;
    fail("manifest", "not JSON serializable");
  }
  record(value, "manifest", ["schemaVersion", "packId", "createdAt", "sources", "objects", "assets"]);
  if (value.schemaVersion !== REFERENCE_PACK_SCHEMA_VERSION) fail("schemaVersion", "unsupported schema");
  const packId = id(value.packId, "packId", "pack");
  const createdAt = timestamp(value.createdAt, "createdAt");
  const sources = unique(array(value.sources, "sources", REFERENCE_PACK_LIMITS.maxSources).map(source), "id", "sources");
  const assets = unique(array(value.assets, "assets", REFERENCE_PACK_LIMITS.maxAssets).map(asset), "sha256", "assets");
  const objects = unique(array(value.objects, "objects", REFERENCE_PACK_LIMITS.maxObjects).map(object), "id", "objects");
  if (assets.reduce((count, entry) => count + entry.byteLength, 0) > REFERENCE_PACK_LIMITS.maxTotalAssetBytes) {
    fail("assets", "aggregate size exceeds limit");
  }
  const sourceIds = new Set(sources.map((entry) => entry.id));
  const assetIds = new Set(assets.map((entry) => entry.sha256));
  for (const entry of objects) {
    if (!sourceIds.has(entry.sourceId)) fail(entry.id, "unknown sourceId");
    if (entry.assetSha256 !== null && !assetIds.has(entry.assetSha256)) fail(entry.id, "missing asset manifest entry");
  }
  return Object.freeze({ schemaVersion: REFERENCE_PACK_SCHEMA_VERSION, packId, createdAt,
    sources: Object.freeze(sources), objects: Object.freeze(objects), assets: Object.freeze(assets) });
}

export function referencePackDigest(value) {
  return createHash("sha256").update(JSON.stringify(normalizeReferencePack(value)), "utf8").digest("hex");
}

/** Deterministic local keyword search; even restricted references can be discovered but not exported. */
export function searchReferencePack(value, { query = "", kinds = [], limit = 20 } = {}) {
  const manifest = normalizeReferencePack(value);
  if (typeof query !== "string" || query.length > 200 || /[\u0000-\u001f\u007f]/u.test(query)) fail("query", "invalid search text");
  if (!Array.isArray(kinds) || kinds.some((kind) => !OBJECT_KINDS.has(kind))) fail("kinds", "invalid filter");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("limit", "expected 1..100");
  const terms = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
  const sourceMap = new Map(manifest.sources.map((entry) => [entry.id, entry]));
  return manifest.objects.filter((entry) => {
    if (kinds.length > 0 && !kinds.includes(entry.kind)) return false;
    const searchable = \`\${entry.title} \${entry.tags.join(" ")} \${entry.kind} \${entry.id}\`.toLowerCase();
    return terms.every((term) => searchable.includes(term));
  }).slice(0, limit).map((entry) => Object.freeze({
    ...entry, rights: sourceMap.get(entry.sourceId).rights,
  }));
}

/** Rights gate only. A grant does not prove that separately supplied bytes are unmodified. */
export function referenceReuseDecision(value, objectId) {
  const manifest = normalizeReferencePack(value);
  const entry = manifest.objects.find((object) => object.id === objectId);
  if (!entry) return Object.freeze({ allowed: false, reason: "unknown object" });
  const source = manifest.sources.find((item) => item.id === entry.sourceId);
  if (source.rights.status !== "verified" || !source.rights.redistributable) {
    return Object.freeze({ allowed: false, reason: "source rights do not permit redistribution" });
  }
  return Object.freeze({ allowed: true, reason: "verified metadata allows reuse; verify asset bytes before export" });
}

/** Checks local bytes against declared size and SHA; deliberately has no file access. */
export function verifyReferenceAssetBytes(value, sha256, bytes) {
  const manifest = normalizeReferencePack(value);
  digest(sha256, "assetSha256");
  const meta = manifest.assets.find((entry) => entry.sha256 === sha256);
  if (!meta) fail("asset", "undeclared content hash");
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > REFERENCE_PACK_LIMITS.maxAssetBytes) {
    fail("asset", "expected bounded byte array");
  }
  if (bytes.byteLength !== meta.byteLength || createHash("sha256").update(bytes).digest("hex") !== sha256) {
    fail("asset", "content digest or length mismatch");
  }
  return true;
}
