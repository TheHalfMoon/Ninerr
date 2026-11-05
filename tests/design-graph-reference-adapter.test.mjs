import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { convertDesignGraphSnapshot } from "../packages/import-stack/src/design-graph-reference-adapter.mjs";
import { referencePackDigest, referenceReuseDecision, searchReferencePack, ReferencePackValidationError } from "../packages/import-stack/src/reference-packs.mjs";

const at = "2026-11-06T00:00:00.000Z";
const ID = (num) => `00000000-0000-4000-a000-${String(num).padStart(12, "0")}`;
const bytes = Buffer.from("Ninerr local asset");
const hash = createHash("sha256").update(bytes).digest("hex");
function fixture() {
  return {
    packKey: "example-owner-export",
    exportedAt: at,
    sources: [{ id: ID(1), key: "example", kind: "registry", displayName: "Example source", createdAt: at }],
    artifacts: [
      { id: ID(10), sourceId: ID(1), title: "Public dashboard", kind: "screen", visibility: "public", rightsClassification: "permitted" },
      { id: ID(11), sourceId: ID(1), title: "Private project", kind: "screen", visibility: "private", rightsClassification: "permitted" },
      { id: ID(12), sourceId: ID(1), title: "Example icon", kind: "icon", visibility: "public", contentHash: hash, rightsClassification: "restricted" },
      { id: ID(13), sourceId: ID(1), title: "Unlinked icon", kind: "icon", visibility: "public", contentHash: "0".repeat(64), rightsClassification: "permitted" },
    ],
    assets: [{ id: ID(20), sourceId: ID(1), sha256: hash, mediaType: "image/svg+xml", byteLength: bytes.byteLength, rightsClassification: "restricted" }],
    patterns: [{ id: ID(30), sourceId: ID(1), title: "Details flow" }],
    flows: [{ id: ID(40), sourceId: ID(1), title: "Checkout" }],
  };
}

test("public graph snapshot converts to offline reference pack, excluding private content by default", () => {
  const { pack, skipped } = convertDesignGraphSnapshot(fixture());
  assert.equal(pack.objects.length, 2);
  assert.equal(pack.assets.length, 1);
  assert.equal(skipped.nonPublic, 3);
  assert.equal(skipped.assetUnavailable, 1);
  assert.equal(searchReferencePack(pack, { query: "dashboard" }).length, 1);
  assert.equal(searchReferencePack(pack, { query: "private" }).length, 0);
  for (const object of pack.objects) assert.equal(referenceReuseDecision(pack, object.id).allowed, false,
    "permitted upstream classification cannot create a verified license or a source-level grant");
});

test("binary assets retain the stricter underlying storage-rights classification", () => {
  const f = fixture();
  f.artifacts[2].rightsClassification = "permitted";
  const { pack } = convertDesignGraphSnapshot(f);
  const icon = pack.objects.find((object) => object.kind === "asset");
  assert.equal(icon.rights.status, "restricted", "a permitted artifact cannot erase restricted storage rights");
  assert.equal(referenceReuseDecision(pack, icon.id).allowed, false);
});

test("private references can be imported locally only by an explicit option and remain non-redistributable", () => {
  const { pack } = convertDesignGraphSnapshot(fixture(), { includeNonPublic: true });
  assert.equal(pack.objects.length, 5);
  assert.equal(pack.objects.filter((object) => object.visibility === "private").length, 3);
  for (const object of pack.objects) assert.equal(referenceReuseDecision(pack, object.id).allowed, false);
});

test("stable IDs and digests are independent of input row order", () => {
  const f = fixture();
  const a = convertDesignGraphSnapshot(f);
  f.artifacts.reverse();
  const b = convertDesignGraphSnapshot(f);
  assert.equal(referencePackDigest(a.pack), referencePackDigest(b.pack));
  assert.deepEqual(a.pack.objects.map((row) => row.id), b.pack.objects.map((row) => row.id));
});

test("changed export timestamp receives new pack identity", () => {
  const f = fixture();
  const old = convertDesignGraphSnapshot(f).pack.packId;
  f.exportedAt = "2026-11-07T00:00:00.000Z";
  assert.notEqual(old, convertDesignGraphSnapshot(f).pack.packId);
});

test("unknown sources, duplicate hashes and impossible snapshots fail closed", () => {
  const f1 = fixture(); f1.artifacts[0].sourceId = ID(99);
  assert.throws(() => convertDesignGraphSnapshot(f1), ReferencePackValidationError);
  const f2 = fixture(); f2.assets.push(f2.assets[0]);
  assert.throws(() => convertDesignGraphSnapshot(f2), /duplicate content hash/u);
  const f3 = fixture(); f3.sources.push(f3.sources[0]);
  assert.throws(() => convertDesignGraphSnapshot(f3), /duplicate source UUID/u);
  assert.throws(() => convertDesignGraphSnapshot(fixture(), { includeNonPublic: "yes" }), ReferencePackValidationError);
});

test("conversion is model-free and produces no provider, network, or storage dependency", () => {
  const { pack } = convertDesignGraphSnapshot(fixture());
  assert.equal(pack.sources[0].uri.startsWith("urn:ninerr:source:"), true);
  assert.equal(pack.sources[0].rights.status, "unknown");
  assert.equal(pack.sources[0].rights.redistributable, false);
  assert.equal(pack.objects[0].confidence, "documented");
});
