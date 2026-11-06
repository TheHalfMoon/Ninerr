# Local Reference Pack Foundation — Implementation Grain
Date: 2026-11-06
Status: implemented and tested in an isolated grain; exact PR-head CI and native packaged integration still gate qualification
Scope: `@ninerr/import-stack` read-only offline reference intelligence, not the final user-facing Research/Lens UI.

## Why this exists
Ninerr's desktop product cannot depend on a hosted design catalog, remote database, GPU inference, login or workspace service. It can nevertheless import design evidence from an owner-authorized export, preserve stable reference IDs, search locally and refuse asset redistribution absent independently verified rights.

## Present code
- `packages/import-stack/src/reference-packs.mjs`: versioned bounded manifest, canonical ordering/digest, local keyword search, source **and per-object** rights/visibility checks, SHA-256 asset validation.
- `packages/import-stack/src/design-graph-reference-adapter.mjs`: deterministic transformation from an already access-filtered graph snapshot into a portable local reference pack. It does not execute database queries or connect to a source system.
- `packages/import-stack/src/index.ts`: exports both modules through the existing import-stack package.
- `tests/reference-packs.test.mjs` and `tests/design-graph-reference-adapter.test.mjs`: direct tests on the authored modules. Full repo CI and native packaged qualification are separate.

## Required input: authorized graph snapshot
A caller provides the source system's **already-authorized** `sources`, `artifacts`, `assets`, `patterns`, and `flows` arrays, `exportedAt` and `packKey`. The converter never attempts to bypass source-system authorization and must not be fed a raw cross-tenant database dump.

Each source record supplies `id` and `createdAt`. Each artifact supplies `id`, `sourceId`, `kind`, `title`, `visibility`, `rightsClassification` and for linked media `contentHash`. Each matched asset supplies `sourceId`, `sha256`, `byteLength`, `mediaType`. Patterns/flows without visibility are considered **private** and excluded by default. Unsupported artifact kinds or binary artifacts missing their content-addressed bytes are excluded with counts.

Example:

```js
import {
  convertDesignGraphSnapshot,
  searchReferencePack,
  referenceReuseDecision,
} from "@ninerr/import-stack";

const { pack, skipped } = convertDesignGraphSnapshot(authorizedSnapshot);
const matches = searchReferencePack(pack, {
  query: "responsive dashboard",
  kinds: ["screen", "component", "pattern"],
  limit: 20,
});

for (const result of matches) {
  const decision = referenceReuseDecision(pack, result.id);
  // decision.allowed is false until a grant register outside the pack confirms reuse.
  // decision.metadataPermits says whether the pack's own statements would permit it.
  console.log(result.id, decision.allowed, decision.metadataPermits, decision.reason);
}
```

## Rights and identity: fail closed
- **A pack cannot grant its own permission.** Whatever its rights fields say, `referenceReuseDecision` returns `allowed: false` until a grant register outside the pack exists and confirms reuse (board task M06). `metadataPermits` reports only what the pack itself states.
- Upstream `permitted` is **not automatically** a verified redistribution grant: the adapter maps it to `unknown` with `redistributable:false`. Every other classification, including unrecognized spellings, maps to restricted. An artifact with none is restricted; a source, pattern or flow row with none is unknown.
- Per-artifact visibility and rights are independent of source rights. Objects sharing one content hash are one work: the strictest statement about any of them holds for all.
- **Owner scope.** A pack with non-public objects must name an `ownerScope` (`urn:ninerr:owner:*`). Search returns only public objects unless the caller names that owner, so a copied pack does not show one owner's objects to another. `ownerScope` is a statement the catalog must enforce against its own project identity, not authentication.
- Titles and other text refuse controls, line separators, direction overrides, zero-width spaces and byte-order marks, since agents read them back. Joiners stay, which Arabic and emoji need.
- A content hash is a **media integrity identifier**, not permission. `verifyReferenceAssetBytes` validates declared length and SHA256; it does not override rights.
- Source/object URNs derive deterministically from the original UUID via SHA256. The pack does **not** include raw source account tokens, storage keys, secrets or end-user identity fields.
- Repeated imports with a matching export key and instant have the same pack ID; a different snapshot timestamp has a new pack ID. The exact source->local ID mapping must be independently preserved by the caller if trace-back to original source UUIDs is required.
- No network, filesystem, remote model or external process is invoked by these pure functions; the trust boundary for reading actual disk bytes remains a future separate module.

## Explicitly not claimed
- No actual private/source records have been read, migrated or redistributed.
- No user-facing Research/Assets UI or MCP tool has been added.
- No URL capture/Lens worker, local SQLite/FTS index or semantic vector search is implemented.
- No source-system auth/tenant filters are replaced by this module.
- No project data has been written, exported or uploaded.
- No live Desktop application E2E or full product release has passed by adding these primitives.

## Next release grains
1. Qualify this exact PR head with existing identity gate, full tests, native desktop checks, rights audits, Graft and independent review.
2. Design a read-only **local storage adapter** using trusted paths and same-file owner/ACL checks on Windows and POSIX; no arbitrary file paths from agents.
3. Implement a minimal Research UI and local MCP search/read tools against one imported pack, with access scopes and safe error handling. Ensure UI and MCP return the same stable IDs.
4. Add preview-and-apply to canonical Ninerr document operations through the single history/undo gateway, never mutating host state from data imports alone.
5. Test offline 1,000+ refs, restricted/private assets, rollback, malicious manifests, memory bounds, two-agent reads, and cross-platform native packaging.
6. Bring in additional source objects only after versioned schema and rights validation of each source entity.

## Verification and migration governance
Use the founder strategy PR #363, the migration inventory issue in the source graph repository, and Ninerr's canonical P09/P10 master plan. This grain cannot replace P09/P10 release gates; both remain separately required.
