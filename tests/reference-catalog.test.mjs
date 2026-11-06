import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ReferenceCatalog } from "../packages/studio-host/src/reference-catalog.ts";
import { hostPool, ok } from "./support/host-api.mjs";

// M03: the open project's reference catalog. One local pack, read from a directory the owner
// chose, gone when the project closes, and with no network fallback.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 6, 12, 0, 0) + clock++ * 1000).toISOString();
const at = "2026-11-06T00:00:00.000Z";
const verified = { status: "verified", license: "Apache-2.0", redistributable: true };
const restricted = { status: "restricted", license: null, redistributable: false };
const object = (id, overrides = {}) => ({
  id: `urn:ninerr:object:${id}`, kind: "pattern", title: `Pattern ${id} dashboard`, tags: ["dashboard"],
  sourceId: "urn:ninerr:source:one", assetSha256: null, confidence: "observed", visibility: "public", rights: verified, ...overrides,
});
const pack = (objects, ownerScope = null) => ({
  schemaVersion: 1, packId: "urn:ninerr:pack:catalog", ownerScope, createdAt: at,
  sources: [{ id: "urn:ninerr:source:one", uri: "https://example.com/one", observedAt: at, rights: verified }],
  assets: [], objects,
});

async function hosted(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-reference-catalog-")));
  const pool = hostPool(now);
  t.after(async () => {
    await pool.closeAll();
    rmSync(root, { recursive: true, force: true });
  });
  const projects = join(root, "projects");
  const packs = join(root, "packs");
  mkdirSync(projects);
  mkdirSync(packs);
  const running = await pool.open(projects);
  await ok(running.call("POST", "/api/projects/create", { name: "site" }), "create");
  return { running, packs, root };
}
const query = (params) => `/api/references?${new URLSearchParams(params)}`;
const refused = async (pending, status, code) => {
  const answer = await pending;
  assert.equal(answer.status, status, JSON.stringify(answer));
  assert.equal(answer.json.error?.code ?? answer.json.error ?? answer.json.code, code, JSON.stringify(answer.json));
  return answer;
};

test("with no pack read, search says so and fetches nothing", async (t) => {
  const { running } = await hosted(t);
  const answer = await ok(running.call("GET", "/api/references"), "search");
  assert.deepEqual(answer, { project: "site", status: "not-loaded", results: [] });
  await refused(running.call("GET", "/api/references/urn:ninerr:object:a"), 404, "reference-not-found");
});

test("a pack read from the owner's directory is searched and read back with its rights", async (t) => {
  const { running, packs } = await hosted(t);
  writeFileSync(join(packs, "pack.json"), JSON.stringify(pack([object("a"), object("b", { title: "Other card", tags: ["card"], rights: restricted })])));
  const loaded = await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "pack.json" }), "load");
  assert.equal(loaded.status, "loaded");
  assert.equal(loaded.objects, 2);
  const found = await ok(running.call("GET", query({ query: "dashboard" })), "search");
  assert.equal(found.status, "loaded");
  assert.equal(found.packDigest, loaded.packDigest);
  assert.deepEqual(found.results.map((item) => item.id), ["urn:ninerr:object:a"]);
  const { reference } = await ok(running.call("GET", "/api/references/urn:ninerr:object:b"), "read");
  assert.equal(reference.title, "Other card");
  assert.equal(reference.rights.status, "restricted");
  assert.equal(reference.source.uri, "https://example.com/one");
  assert.deepEqual(reference.reuse.allowed, false, "a pack cannot allow reuse");
  assert.deepEqual(reference.reuse.metadataPermits, false);
  assert.equal((await ok(running.call("GET", "/api/references/urn:ninerr:object:a"), "read")).reference.reuse.metadataPermits, true);
  assert.ok(!JSON.stringify([found, reference]).includes(packs), "no path comes back");
});

test("search is bounded, and an invalid search is refused", async (t) => {
  const { running, packs } = await hosted(t);
  writeFileSync(join(packs, "pack.json"), JSON.stringify(pack(Array.from({ length: 150 }, (_, index) => object(`n${String(index).padStart(3, "0")}`)))));
  await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "pack.json" }), "load");
  assert.equal((await ok(running.call("GET", "/api/references"), "default")).results.length, 20);
  assert.equal((await ok(running.call("GET", query({ limit: "100" })), "most")).results.length, 100);
  assert.equal((await ok(running.call("GET", query({ limit: "1", kinds: "pattern,screen" })), "kinds")).results.length, 1);
  for (const params of [{ limit: "0" }, { limit: "101" }, { limit: "1.5" }, { limit: "ten" }, { limit: "1e1" }, { query: "x".repeat(201) }, { kinds: "ghost" }, { kinds: Array(7).fill("screen").join(",") }]) {
    await refused(running.call("GET", query(params)), 400, "invalid-reference-search");
  }
  assert.equal((await ok(running.call("GET", query({ query: "x".repeat(200) })), "longest")).results.length, 0);
});

test("switching or closing the project revokes the catalog; the same pack read again keeps its ids", async (t) => {
  const { running, packs } = await hosted(t);
  writeFileSync(join(packs, "pack.json"), JSON.stringify(pack([object("a")])));
  const first = await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "pack.json" }), "load");
  const before = await ok(running.call("GET", "/api/references"), "search");
  await ok(running.call("POST", "/api/projects/create", { name: "other" }), "switch");
  assert.equal((await ok(running.call("GET", "/api/references"), "search")).status, "not-loaded");
  await refused(running.call("GET", "/api/references/urn:ninerr:object:a"), 404, "reference-not-found");
  await ok(running.call("POST", "/api/projects/open", { name: "site" }), "back");
  assert.equal((await ok(running.call("GET", "/api/references"), "search")).status, "not-loaded", "reopening does not bring it back");
  const again = await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "pack.json" }), "load again");
  assert.equal(again.packDigest, first.packDigest);
  assert.deepEqual((await ok(running.call("GET", "/api/references"), "search")).results, before.results);
});

test("a read that outlives its project does not land in the next one", async () => {
  const catalog = new ReferenceCatalog();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-reference-race-")));
  try {
    writeFileSync(join(root, "pack.json"), JSON.stringify(pack([object("a")])));
    const session = {};
    await assert.rejects(catalog.load(session, () => false, root, "pack.json"), (error) => error.code === "project-changed");
    assert.equal(catalog.search(session, "site").status, "not-loaded");
    await catalog.load(session, () => true, root, "pack.json");
    assert.equal(catalog.search(session, "site").status, "loaded");
    assert.equal(catalog.search({}, "other").status, "not-loaded", "another session sees none");
    assert.equal(catalog.search(session, "site").status, "not-loaded", "and the catalog is gone for good");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("non-public objects answer exactly as ids that do not exist", async (t) => {
  const { running, packs } = await hosted(t);
  writeFileSync(join(packs, "pack.json"), JSON.stringify(pack([object("a"), object("secret", { visibility: "private", rights: restricted }), object("team", { visibility: "workspace", rights: restricted })], "urn:ninerr:owner:someone")));
  const loaded = await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "pack.json" }), "load");
  assert.equal(loaded.objects, 1, "the count shows only what can be seen");
  assert.deepEqual((await ok(running.call("GET", "/api/references"), "search")).results.map((item) => item.id), ["urn:ninerr:object:a"]);
  const hidden = await refused(running.call("GET", "/api/references/urn:ninerr:object:secret"), 404, "reference-not-found");
  const absent = await refused(running.call("GET", "/api/references/urn:ninerr:object:absent"), 404, "reference-not-found");
  assert.deepEqual(hidden.json, absent.json);
  const everything = JSON.stringify(await ok(running.call("GET", "/api/references"), "search"));
  assert.ok(!everything.includes("someone") && !everything.includes("ownerScope"), "no owner in an answer");
});

test("a hidden object shows nowhere: not in a public object's rights, nor in the digest", async (t) => {
  const { running, packs } = await hosted(t);
  const hash = "a".repeat(64);
  const shared = { assets: [{ sha256: hash, byteLength: 1, mediaType: "image/png" }] };
  const open = object("open", { kind: "asset", assetSha256: hash });
  const answers = {};
  for (const [name, objects, ownerScope] of [
    ["alone", [open], null],
    ["sibling", [open, object("copy", { kind: "asset", assetSha256: hash, visibility: "private", rights: restricted })], "urn:ninerr:owner:someone"],
    ["other", [open, object("copy", { kind: "asset", assetSha256: hash, visibility: "private", title: "Changed", rights: verified })], "urn:ninerr:owner:else"],
  ]) {
    writeFileSync(join(packs, `${name}.json`), JSON.stringify({ ...pack(objects, ownerScope), ...shared }));
    const loaded = await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: `${name}.json` }), name);
    answers[name] = { digest: loaded.packDigest, read: await ok(running.call("GET", "/api/references/urn:ninerr:object:open"), name) };
  }
  assert.deepEqual(answers.sibling, answers.alone, "a hidden copy changes nothing that can be read");
  assert.deepEqual(answers.other, answers.alone, "nor does its title, or the pack's owner");
  assert.equal(answers.alone.read.reference.reuse.metadataPermits, true);
  assert.ok(!JSON.stringify(answers).includes("someone"));
});

test("a pack of shared bytes cannot stall the host", async (t) => {
  const { running, packs } = await hosted(t);
  const hash = "b".repeat(64);
  const sources = Array.from({ length: 2_048 }, (_, index) => ({ id: `urn:ninerr:source:s${index}`, uri: `urn:ninerr:source:s${index}`, observedAt: at, rights: verified }));
  const objects = Array.from({ length: 10_000 }, (_, index) => ({ id: `urn:ninerr:object:${index}`, kind: "asset", title: "x", tags: [], sourceId: "urn:ninerr:source:s2047", assetSha256: hash, confidence: "observed", visibility: "public", rights: verified }));
  writeFileSync(join(packs, "wide.json"), JSON.stringify({ schemaVersion: 1, packId: "urn:ninerr:pack:wide", ownerScope: null, createdAt: at, sources, objects, assets: [{ sha256: hash, byteLength: 1, mediaType: "image/png" }] }));
  await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "wide.json" }), "load");
  const started = performance.now();
  assert.equal((await ok(running.call("GET", query({ limit: "100" })), "search")).results.length, 100);
  await ok(running.call("GET", "/api/references/urn:ninerr:object:9999"), "read");
  assert.ok(performance.now() - started < 2_000, `took ${performance.now() - started} ms; 136 s before the view was built at load`);
});

test("of two reads, the one asked for last wins, and closing ends a read under way", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-reference-order-")));
  try {
    writeFileSync(join(root, "one.json"), JSON.stringify(pack([object("first")])));
    writeFileSync(join(root, "two.json"), JSON.stringify(pack([object("second")])));
    const catalog = new ReferenceCatalog();
    const session = {};
    const first = catalog.load(session, () => true, root, "one.json");
    await catalog.load(session, () => true, root, "two.json");
    await assert.rejects(first, (error) => error.code === "reference-load-superseded");
    assert.deepEqual(catalog.search(session, "site").results.map((item) => item.id), ["urn:ninerr:object:second"]);
    const late = catalog.load(session, () => true, root, "one.json");
    catalog.revoke();
    await assert.rejects(late, (error) => error.code === "reference-load-superseded");
    assert.equal(catalog.search(session, "site").status, "not-loaded");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the routes need the owner's token, and a project made for another tab is refused", async (t) => {
  const { running, packs } = await hosted(t);
  const { host } = running;
  const { token } = await ok(running.call("POST", "/api/agents/create", { name: "Agent" }), "agent");
  const routes = [["GET", "/api/references"], ["GET", "/api/references/urn:ninerr:object:a"], ["POST", "/api/references/load"]];
  for (const [method, path] of routes) {
    for (const headers of [{}, { authorization: `Bearer ${token}` }]) {
      const answer = await fetch(`${host.url}${path}`, { method, headers: { ...headers, ...(method === "POST" ? { "content-type": "application/json" } : {}) }, ...(method === "POST" ? { body: JSON.stringify({ directory: packs, fileName: "pack.json" }) } : {}) });
      assert.equal(answer.status, 401, `${method} ${path}`);
    }
  }
  writeFileSync(join(packs, "pack.json"), JSON.stringify(pack([object("a")])));
  const stale = await fetch(`${host.url}/api/references/load`, { method: "POST", headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json", "x-ninerr-project": "elsewhere" }, body: JSON.stringify({ directory: packs, fileName: "pack.json" }) });
  assert.equal(stale.status, 409);
});

test("closing and reopening the same project starts with none", async (t) => {
  const { running, packs } = await hosted(t);
  writeFileSync(join(packs, "pack.json"), JSON.stringify(pack([object("a")])));
  await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "pack.json" }), "load");
  await ok(running.call("POST", "/api/projects/close", {}), "close");
  await ok(running.call("POST", "/api/projects/open", { name: "site" }), "reopen");
  assert.equal((await ok(running.call("GET", "/api/references"), "search")).status, "not-loaded");
});

test("a bad pack, path or name is refused, and leaves the catalog as it was", async (t) => {
  const { running, packs, root } = await hosted(t);
  writeFileSync(join(packs, "pack.json"), JSON.stringify(pack([object("a")])));
  await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "pack.json" }), "load");
  writeFileSync(join(packs, "broken.json"), "{ not json");
  writeFileSync(join(packs, "poison.json"), JSON.stringify({ ...pack([]), extra: true }));
  for (const body of [
    { directory: packs, fileName: "broken.json" },
    { directory: packs, fileName: "poison.json" },
    { directory: packs, fileName: "absent.json" },
    { directory: packs, fileName: "../pack.json" },
    { directory: "relative", fileName: "pack.json" },
    { directory: join(root, "absent"), fileName: "pack.json" },
    { fileName: "pack.json" },
    { directory: packs },
  ]) {
    const answer = await refused(running.call("POST", "/api/references/load", body), 422, "reference-pack-refused");
    assert.ok(!JSON.stringify(answer.json).includes(root), "no absolute path in the refusal");
  }
  assert.equal((await ok(running.call("GET", "/api/references"), "search")).results.length, 1);
});

test("1,000 references: a stable digest, and quick searches", async (t) => {
  const { running, packs } = await hosted(t);
  const objects = Array.from({ length: 1_000 }, (_, index) => object(`n${String(index).padStart(4, "0")}`));
  writeFileSync(join(packs, "forward.json"), JSON.stringify(pack(objects)));
  writeFileSync(join(packs, "reverse.json"), JSON.stringify(pack([...objects].reverse())));
  const first = await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "forward.json" }), "load");
  const second = await ok(running.call("POST", "/api/references/load", { directory: packs, fileName: "reverse.json" }), "load");
  assert.equal(first.objects, 1_000);
  assert.equal(first.packDigest, second.packDigest);
  const started = performance.now();
  for (let index = 0; index < 20; index += 1) {
    assert.equal((await ok(running.call("GET", query({ query: "dashboard", limit: "100" })), "search")).results.length, 100);
  }
  assert.ok((performance.now() - started) / 20 < 250, "a search does not re-read the whole pack each time");
});
