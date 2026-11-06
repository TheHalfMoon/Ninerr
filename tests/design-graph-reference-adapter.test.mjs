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
  assert.equal(pack.ownerScope, null);
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

test("an asset row's own classification holds: only permitted leaves it unknown", () => {
  for (const change of [(row) => { delete row.rightsClassification; }, (row) => { row.rightsClassification = "prohibited"; }, (row) => { row.rightsClassification = "Permitted"; }]) {
    const f = fixture();
    f.artifacts[2].rightsClassification = "permitted";
    change(f.assets[0]);
    const icon = convertDesignGraphSnapshot(f).pack.objects.find((object) => object.kind === "asset");
    assert.equal(icon.rights.status, "restricted");
  }
  const f = fixture();
  f.artifacts[2].rightsClassification = "permitted";
  f.assets[0].rightsClassification = "permitted";
  assert.equal(convertDesignGraphSnapshot(f).pack.objects.find((object) => object.kind === "asset").rights.status, "unknown");
});

test("a title with text a pack refuses is cleaned, so one row does not abort the snapshot", () => {
  const titled = (title) => {
    const f = fixture();
    f.artifacts = [{ ...f.artifacts[0], title }];
    return convertDesignGraphSnapshot(f).pack.objects[0].title;
  };
  assert.equal(titled("Hello\u200bWorld"), "Hello World");
  assert.equal(titled("a\u2028b\u202ec\u{E0041}d"), "a b c d");
  assert.equal(titled("\u200b"), "screen", "nothing left: the fallback");
  assert.equal(titled(`${"x".repeat(199)}\u{1F600}`).length, 199, "a cut emoji leaves no lone surrogate");
});

test("a timestamp must name its zone, and a pack key must be a string", () => {
  for (const exportedAt of ["2026-11-06T00:00:00", "0", "Nov 6 2026"]) {
    const f = fixture(); f.exportedAt = exportedAt;
    assert.throws(() => convertDesignGraphSnapshot(f), /timestamp with a zone/u, exportedAt);
  }
  const offset = fixture(); offset.exportedAt = "2026-11-06T03:00:00+03:00";
  assert.equal(convertDesignGraphSnapshot(offset).pack.createdAt, at);
  const key = fixture(); key.packKey = { a: 1 };
  assert.throws(() => convertDesignGraphSnapshot(key), /packKey/u);
});

test("private references are copied only for a named owner, and remain non-redistributable", () => {
  const owner = "urn:ninerr:owner:me";
  const { pack } = convertDesignGraphSnapshot(fixture(), { ownerScope: owner });
  assert.equal(pack.objects.length, 5);
  assert.equal(pack.ownerScope, owner);
  assert.equal(pack.objects.filter((object) => object.visibility === "private").length, 3);
  for (const object of pack.objects) assert.equal(referenceReuseDecision(pack, object.id).metadataPermits, false);
  assert.equal(searchReferencePack(pack, { query: "private" }).length, 0, "not shown without the owner");
  assert.equal(searchReferencePack(pack, { query: "private", ownerScope: owner }).length, 1);
});

test("only \"permitted\" leaves rights unknown: any other classification is a restriction", () => {
  const owner = "urn:ninerr:owner:me";
  const rightsOf = (change) => {
    const f = fixture();
    f.artifacts = [f.artifacts[0]];
    f.assets = [];
    change(f);
    return convertDesignGraphSnapshot(f, { ownerScope: owner }).pack;
  };
  const screenOf = (change) => rightsOf(change).objects.find((entry) => entry.kind === "screen");
  for (const value of ["RESTRICTED", "metadata-only", "metadata_only", "prohibited", "restricted", null, 7]) {
    assert.equal(screenOf((f) => { f.artifacts[0].rightsClassification = value; }).rights.status, "restricted", `artifact ${value}`);
    assert.equal(rightsOf((f) => { f.sources[0].rightsClassification = value; }).sources[0].rights.status, "restricted", `source ${value}`);
    const pattern = rightsOf((f) => { f.patterns[0].rightsClassification = value; }).objects.find((entry) => entry.kind === "pattern");
    assert.equal(pattern.rights.status, "restricted", `pattern ${value}`);
    const flow = rightsOf((f) => { f.flows[0].rightsClassification = value; }).objects.find((entry) => entry.kind === "flow");
    assert.equal(flow.rights.status, "restricted", `flow ${value}`);
  }
  assert.equal(screenOf((f) => { delete f.artifacts[0].rightsClassification; }).rights.status, "restricted", "an artifact with none");
  assert.equal(screenOf(() => {}).rights.status, "unknown");
  // A row ignoring its asset's source is not an asset of that source.
  const f = fixture();
  f.sources.push({ ...f.sources[0], id: ID(2) });
  f.artifacts[2].sourceId = ID(2);
  assert.equal(convertDesignGraphSnapshot(f).skipped.assetUnavailable, 2);
});

test("a source only private objects use does not appear in a public pack", () => {
  const f = fixture();
  f.sources.push({ ...f.sources[0], id: ID(2), createdAt: "2020-01-01T00:00:00.000Z" });
  f.artifacts[1].sourceId = ID(2);
  const { pack } = convertDesignGraphSnapshot(f);
  assert.equal(pack.sources.length, 1);
  assert.equal(pack.sources[0].observedAt, at);
});

test("one instant, written two ways, is one pack", () => {
  const f = fixture();
  const first = convertDesignGraphSnapshot(f).pack.packId;
  f.exportedAt = "2026-11-06T00:00:00Z";
  assert.equal(convertDesignGraphSnapshot(f).pack.packId, first);
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
  assert.throws(() => convertDesignGraphSnapshot(fixture(), { ownerScope: "yes" }), ReferencePackValidationError);
});

test("conversion is model-free and produces no provider, network, or storage dependency", () => {
  const { pack } = convertDesignGraphSnapshot(fixture());
  assert.equal(pack.sources[0].uri.startsWith("urn:ninerr:source:"), true);
  assert.equal(pack.sources[0].rights.status, "unknown");
  assert.equal(pack.sources[0].rights.redistributable, false);
  assert.equal(pack.objects[0].confidence, "documented");
});
