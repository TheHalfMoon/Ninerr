import { ReferencePackValidationError, readReferencePackFile, referenceReuseDecision, searchReferencePack, ImportSecurityError, ImportValidationError } from "@ninerr/import-stack";
import { StudioError } from "./errors.ts";

// The reference catalog of the open project (M03): one local reference pack, read from a
// directory the owner chose, searched by the person and by agents through the same functions.
//
// It lives in memory and belongs to one open project: closing or switching the project revokes
// it, and a project opened again starts with none. Reading the same pack again keeps its ids.
//
// Only public objects are shown. A pack's non-public objects need its ownerScope to name who is
// asking, and a project has no owner identity to compare yet, so they stay hidden. Anything
// hidden answers exactly as an id that does not exist.
//
// There is no network fallback: with no pack read, the answer says so.

interface Loaded {
  session: object;
  fileName: string;
  packDigest: string;
  pack: any;
}

/** What a reference may show: its metadata and rights, never a path or file bytes. */
function safeReference(pack: any, entry: any) {
  const source = pack.sources.find((item: any) => item.id === entry.sourceId);
  const reuse = referenceReuseDecision(pack, entry.id);
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    tags: entry.tags,
    confidence: entry.confidence,
    visibility: entry.visibility,
    assetSha256: entry.assetSha256,
    rights: entry.rights,
    source: { id: source.id, uri: source.uri, observedAt: source.observedAt, rights: source.rights },
    reuse: { allowed: reuse.allowed, metadataPermits: reuse.metadataPermits, reason: reuse.reason },
  };
}

export class ReferenceCatalog {
  #loaded: Loaded | null = null;

  /** The loaded pack, if it was read for this very session: a later one never sees it. */
  #current(session: object): Loaded | null {
    if (this.#loaded !== null && this.#loaded.session !== session) this.#loaded = null;
    return this.#loaded;
  }

  /**
   * Read one pack from a directory the owner chose, in place of any before. This is the owner's
   * route alone: no agent names a directory. `isOpen` asks whether the session is still the open
   * one, since the project can change during the read.
   */
  async load(session: object, isOpen: () => boolean, directory: unknown, fileName: unknown) {
    let read: any;
    try {
      read = await readReferencePackFile({ directory: directory as string, fileName: fileName as string });
    } catch (error) {
      if (error instanceof ImportSecurityError || error instanceof ImportValidationError) throw new StudioError(422, "reference-pack-refused", error.message.slice(0, 300));
      throw error;
    }
    if (!isOpen()) throw new StudioError(409, "project-changed", "the project changed while the pack was being read");
    this.#loaded = { session, fileName: read.fileName, packDigest: read.packDigest, pack: read.pack };
    return { status: "loaded", fileName: read.fileName, packId: read.pack.packId, packDigest: read.packDigest, createdAt: read.pack.createdAt, objects: read.pack.objects.filter((entry: any) => entry.visibility === "public").length };
  }

  /** Bounded search: the query at most 200 characters, 1 to 100 results. */
  search(session: object, project: string, input: { query?: unknown; kinds?: unknown; limit?: unknown } = {}) {
    const loaded = this.#current(session);
    if (loaded === null) return { project, status: "not-loaded", results: [] };
    let found: any[];
    try {
      found = searchReferencePack(loaded.pack, { query: input.query ?? "", kinds: input.kinds ?? [], limit: input.limit ?? 20 });
    } catch (error) {
      if (error instanceof ReferencePackValidationError) throw new StudioError(400, "invalid-reference-search", error.message.slice(0, 300));
      throw error;
    }
    return { project, status: "loaded", packId: loaded.pack.packId, packDigest: loaded.packDigest, results: found.map((entry) => safeReference(loaded.pack, entry)) };
  }

  /** One reference by id. An id that is absent, hidden, or from before a switch answers alike. */
  get(session: object, project: string, id: unknown) {
    const loaded = this.#current(session);
    const entry = loaded === null || typeof id !== "string" ? undefined : loaded.pack.objects.find((item: any) => item.id === id && item.visibility === "public");
    if (entry === undefined) throw new StudioError(404, "reference-not-found", "no such reference in this project");
    return { project, packId: loaded!.pack.packId, packDigest: loaded!.packDigest, reference: safeReference(loaded!.pack, entry) };
  }
}
