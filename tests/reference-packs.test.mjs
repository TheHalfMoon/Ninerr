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
  visibility: from === "owned" ? "public" : "private",
  rights: { status: from === "owned" ? "verified" : "restricted", license: from === "owned" ? "Apache-2.0" : null, redistributable: from === "owned" },
  ...overrides,
});
const OWNER = "urn:ninerr:owner:test";
const fixture = () => ({
  schemaVersion: REFERENCE_PACK_SCHEMA_VERSION,
  packId: "urn:ninerr:pack:test",
  ownerScope: OWNER,
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

const GOLDEN_DIGEST = "5afadffb131b45ae555d52a3336ef459f934d28fcc4ad99a33144d124f41e3d3";

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

test("the digest format is pinned", () => {
  assert.equal(referencePackDigest({ schemaVersion: 1, packId: "urn:ninerr:pack:golden", ownerScope: null, createdAt: at, sources: [], objects: [], assets: [] }), GOLDEN_DIGEST);
});

test("search shows non-public objects only to the owner the pack names", () => {
  const search = (options) => searchReferencePack(fixture(), { query: "dashboard", ...options }).map((item) => item.id);
  assert.deepEqual(search({}), ["urn:ninerr:object:allowed"], "public only by default");
  assert.deepEqual(search({ ownerScope: "urn:ninerr:owner:other" }), ["urn:ninerr:object:allowed"]);
  assert.equal(search({ ownerScope: OWNER }).length, 3);
  const unowned = fixture(); unowned.ownerScope = null;
  rejects(unowned, /requires an ownerScope/u);
  unowned.objects = [unowned.objects[0]];
  assert.equal(normalizeReferencePack(unowned).ownerScope, null, "a pack of public objects needs no owner");
  const bad = fixture(); bad.ownerScope = "urn:ninerr:source:test";
  rejects(bad, /invalid owner identifier/u);
});

test("text an agent reads back carries no direction overrides or line separators", () => {
  for (const unsafe of ["\u202e", "\u2028", "\u200b", "\ufeff", "\u2066"]) {
    const f = fixture(); f.objects[0].title = `a${unsafe}b`;
    rejects(f, /without controls/u);
  }
  const f = fixture(); f.objects[0].title = "\u0645\u0631\u062d\u0628\u0627\u200c \u{1F468}\u200d\u{1F4BB}";
  assert.equal(normalizeReferencePack(f).objects[0].title, f.objects[0].title, "joiners stay");
  const long = fixture(); long[`x${"y".repeat(100_000)}\n`] = 1;
  assert.throws(() => normalizeReferencePack(long), (error) => error.message.length < 200);
});

test("local search is deterministic, supports kind/tag terms, and includes rights metadata", () => {
  const result = searchReferencePack(fixture(), { query: "dashboard responsive", kinds: ["pattern"], ownerScope: OWNER });
  assert.deepEqual(result.map((item) => item.id), ["urn:ninerr:object:private", "urn:ninerr:object:uncertain"]);
  assert.equal(result[0].sourceRights.status, "restricted");
  assert.equal(result[0].rights.status, "restricted");
  assert.equal(searchReferencePack(fixture(), { query: "doesnotexist" }).length, 0);
  assert.throws(() => searchReferencePack(fixture(), { limit: 1000 }), ReferencePackValidationError);
  assert.throws(() => searchReferencePack(fixture(), { kinds: ["ghost"] }), ReferencePackValidationError);
});

test("a pack cannot grant its own permission: nothing it says makes reuse allowed", () => {
  const pack = fixture();
  pack.sources[0].rights.license = pack.objects[0].rights.license = "All Rights Reserved";
  const decision = referenceReuseDecision(pack, "urn:ninerr:object:allowed");
  assert.equal(decision.allowed, false);
  assert.equal(decision.metadataPermits, true);
  assert.match(decision.reason, /no grant register/u);
});

test("metadata permits reuse only when source rights, object rights and visibility all do", () => {
  const verified = { status: "verified", license: "Apache-2.0", redistributable: true };
  const notRedistributable = { status: "verified", license: "Apache-2.0", redistributable: false };
  const restricted = { status: "restricted", license: null, redistributable: false };
  const unknown = { status: "unknown", license: null, redistributable: false };
  const all = [verified, notRedistributable, restricted, unknown];
  let cases = 0;
  for (const sourceRights of all) for (const objectRights of all) for (const visibility of ["public", "workspace", "private"]) {
    const f = fixture();
    f.sources = [{ ...source("owned"), rights: sourceRights }];
    f.objects = [object("one", "owned", { rights: objectRights, visibility })];
    f.assets = [];
    const decision = referenceReuseDecision(f, "urn:ninerr:object:one");
    assert.equal(decision.metadataPermits, sourceRights === verified && objectRights === verified && visibility === "public", JSON.stringify([sourceRights, objectRights, visibility]));
    assert.equal(decision.allowed, false);
    cases += 1;
  }
  assert.equal(cases, 48);
  assert.equal(referenceReuseDecision(fixture(), "urn:ninerr:object:absent").metadataPermits, false);
});

test("objects with the same bytes are one work: the strictest statement holds for all", () => {
  const f = fixture();
  f.objects.push(object("copy", "restricted", { kind: "asset", assetSha256: assetHash }));
  assert.equal(referenceReuseDecision(f, "urn:ninerr:object:allowed").metadataPermits, false);
  assert.equal(referenceReuseDecision(fixture(), "urn:ninerr:object:allowed").metadataPermits, true);
});

test("object-specific access never inherits a broader source grant", () => {
  const pack = fixture();
  pack.objects[0].rights = { status: "restricted", license: null, redistributable: false };
  assert.equal(referenceReuseDecision(pack, "urn:ninerr:object:allowed").metadataPermits, false);
  pack.objects[0].rights = { status: "verified", license: "Apache-2.0", redistributable: true };
  pack.objects[0].visibility = "private";
  assert.equal(referenceReuseDecision(pack, "urn:ninerr:object:allowed").metadataPermits, false);
  pack.objects[0].visibility = "public";
  assert.equal(referenceReuseDecision(pack, "urn:ninerr:object:allowed").metadataPermits, true);
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
