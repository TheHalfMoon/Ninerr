import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  REFERENCE_PACK_SCHEMA_VERSION,
  REFERENCE_PACK_LIMITS,
  ReferencePackValidationError,
  normalizeReferencePack,
  referencePackDigest,
  searchReferencePack,
  referenceReuseDecision,
  verifyReferenceAssetBytes,
} from "../packages/import-stack/src/reference-packs.mjs";

const bytes = Buffer.from("Ninerr native local reference");
const assetHash = createHash("sha256").update(bytes).digest("hex");
const secondHash = "0".repeat(64);
const at = "2026-11-06T00:00:00.000Z";
const source = (id, status = "verified", redistributable = true) => ({
  id: `urn:ninerr:source:${id}`,
  uri: `https://example.com/${id}`,
  observedAt: at,
  rights: { status, license: status === "verified" ? "Apache-2.0" : null, redistributable },
});
const object = (id, from = "owned", overrides = {}) => ({
  id: `urn:ninerr:object:${id}`,
  kind: "pattern",
  title: "Accessible dashboard cards",
  tags: ["dashboard", "responsive"],
  sourceId: `urn:ninerr:source:${from}`,
  assetSha256: null,
  confidence: "observed",
  ...overrides,
});
const fixture = () => ({
  schemaVersion: REFERENCE_PACK_SCHEMA_VERSION,
  packId: "urn:ninerr:pack:test",
  createdAt: at,
  sources: [source("owned"), source("restricted", "restricted", false), source("unknown", "unknown", false)],
  assets: [{ sha256: assetHash, byteLength: bytes.byteLength, mediaType: "image/png" }],
  objects: [
    object("allowed", "owned", { kind: "asset", assetSha256: assetHash }),
    object("private", "restricted"),
    object("uncertain", "unknown"),
  ],
});
const rejects = (value, pattern) => assert.throws(() => normalizeReferencePack(value), (error) => {
  assert.ok(error instanceof ReferencePackValidationError, `${error}`);
  if (pattern) assert.match(error.message, pattern);
  return true;
});

test("local reference pack normalizes deterministically and freezes nested metadata", () => {
  const input = fixture();
  const output = normalizeReferencePack(input);
  assert.equal(output.schemaVersion, 1);
  assert.ok(Object.isFrozen(output) && Object.isFrozen(output.objects[0]) && Object.isFrozen(output.sources[0].rights));
  input.sources.reverse();
  input.objects.reverse();
  assert.equal(referencePackDigest(input), referencePackDigest(fixture()));
  assert.deepEqual(output.objects.map((o) => o.id), ["urn:ninerr:object:allowed", "urn:ninerr:object:private", "urn:ninerr:object:uncertain"]);
});

test("local search is deterministic, supports kind/tag terms, and includes rights metadata", () => {
  const result = searchReferencePack(fixture(), { query: "dashboard responsive", kinds: ["pattern"] });
  assert.deepEqual(result.map((item) => item.id), ["urn:ninerr:object:private", "urn:ninerr:object:uncertain"]);
  assert.equal(result[0].rights.status, "restricted");
  assert.equal(searchReferencePack(fixture(), { query: "doesnotexist" }).length, 0);
  assert.throws(() => searchReferencePack(fixture(), { limit: 1000 }), ReferencePackValidationError);
  assert.throws(() => searchReferencePack(fixture(), { kinds: ["ghost"] }), ReferencePackValidationError);
});

test("unknown and restricted source metadata NEVER enables export", () => {
  const pack = fixture();
  assert.equal(referenceReuseDecision(pack, "urn:ninerr:object:allowed").allowed, true);
  assert.equal(referenceReuseDecision(pack, "urn:ninerr:object:private").allowed, false);
  assert.equal(referenceReuseDecision(pack, "urn:ninerr:object:uncertain").allowed, false);
  assert.equal(referenceReuseDecision(pack, "urn:ninerr:object:absent").allowed, false);
});

test("asset bytes are checked against manifest size AND SHA-256", () => {
  const pack = fixture();
  assert.equal(verifyReferenceAssetBytes(pack, assetHash, bytes), true);
  assert.throws(() => verifyReferenceAssetBytes(pack, assetHash, Buffer.from("modified bytes")), /content digest or length mismatch/u);
  assert.throws(() => verifyReferenceAssetBytes(pack, secondHash, bytes), /undeclared/u);
  assert.throws(() => verifyReferenceAssetBytes(pack, assetHash, "not binary"), /bounded byte array/u);
});

test("unknown fields and prototype-pollution structures fail closed", () => {
  rejects({ ...fixture(), status: "ok" }, /unsupported field/u);
  const f = fixture(); f.objects[0].__proto__ = { unsafe: true };
  rejects(f, /plain object/u);
  const parsed = JSON.parse('{"schemaVersion":1,"packId":"urn:ninerr:pack:x","createdAt":"2026-11-06T00:00:00.000Z","sources":[],"objects":[],"assets":[],"__proto__":{"admin":true}}');
  rejects(parsed, /unsupported field __proto__/u);
});

test("references must have real source identities and declared assets", () => {
  const f1 = fixture(); f1.objects[0].sourceId = "urn:ninerr:source:missing";
  rejects(f1, /unknown sourceId/u);
  const f2 = fixture(); f2.objects[0].assetSha256 = secondHash;
  rejects(f2, /missing asset manifest entry/u);
  const f3 = fixture(); f3.objects[0].assetSha256 = null;
  rejects(f3, /asset kind requires content hash/u);
});

test("duplicate identifiers, hashes and tags are rejected", () => {
  const f1 = fixture(); f1.sources.push(source("owned"));
  rejects(f1, /duplicate id/u);
  const f2 = fixture(); f2.assets.push(f2.assets[0]);
  rejects(f2, /duplicate sha256/u);
  const f3 = fixture(); f3.objects[0].tags.push("dashboard");
  rejects(f3, /duplicate tag/u);
});

test("rights must be verified with a grant before redistribution", () => {
  for (const status of ["unknown", "restricted"]) {
    const f = fixture(); f.sources[0].rights.status = status;
    rejects(f, /redistribution requires verified rights/u);
  }
  const f = fixture(); f.sources[0].rights.license = null;
  rejects(f, /redistribution requires verified rights/u);
  const f2 = fixture(); f2.sources[0].rights.status = "not-a-real-state";
  rejects(f2, /invalid rights status/u);
});

test("all source URIs exclude secrets and executable URL schemes", () => {
  for (const uri of ["javascript:alert(1)", "file:///tmp/x", "https://a:b@example.com/path", "https://example.com/?key=abc", "https://example.com/#token", "http://example.com/"]) {
    const f = fixture(); f.sources[0].uri = uri;
    rejects(f, /HTTPS URL/u);
  }
});

test("pack-size and resource bounds reject oversized records", () => {
  const f = fixture(); f.assets[0].byteLength = REFERENCE_PACK_LIMITS.maxAssetBytes + 1;
  rejects(f, /invalid asset size/u);
  const f2 = fixture(); f2.objects[0].title = "x".repeat(201);
  rejects(f2, /at most 200/u);
  const f3 = fixture(); f3.objects[0].tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
  rejects(f3, /at most 20/u);
  const f4 = fixture(); f4.sources = Array.from({ length: 2049 }, (_, i) => source(`item-${i}`));
  rejects(f4, /at most 2048/u);
});

test("1,000-object fixture is indexed offline without a model or network", () => {
  const f = fixture();
  f.objects = Array.from({ length: 1_000 }, (_, i) => object(`ref-${String(i).padStart(4, "0")}`, "owned", { title: `Pattern ${i} dashboard` }));
  const manifest = normalizeReferencePack(f);
  assert.equal(manifest.objects.length, 1_000);
  assert.equal(searchReferencePack(manifest, { query: "pattern 999" }).length, 1);
  assert.equal(searchReferencePack(manifest, { query: "dashboard", limit: 100 }).length, 100);
});

test("reference pack implementation contains no network or filesystem authority", () => {
  const sourceCode = readFileSync(new URL("../packages/import-stack/src/reference-packs.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(sourceCode, /\bfetch\s*\(|\bhttps?\.request\s*\(|\bnet\.connect\s*\(/u);
  assert.doesNotMatch(sourceCode, /\breadFile\s*\(|\bwriteFile\s*\(|\bopenSync\s*\(/u);
});
