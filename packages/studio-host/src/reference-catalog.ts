import { ReferencePackValidationError, normalizeReferencePack, readReferencePackFile, referencePackDigest, referenceReuseDecisions, searchReferencePack, ImportSecurityError, ImportValidationError } from "@ninerr/import-stack";
import { StudioError } from "./errors.ts";

// The reference catalog of the open project (M03): one local reference pack, read from a
// directory the owner chose, searched by the person and by agents through the same functions.
//
// It lives in memory and belongs to one open project: closing or switching the project revokes
// it, and a project opened again starts with none. Reading the same pack again keeps its ids.
//
// Only public objects are served. A pack's non-public objects need its ownerScope to name who is
// asking, and a project has no owner identity to compare yet. So at load the catalog keeps a view
// of the public objects alone, and every answer, digest and reuse decision comes from that view:
// nothing hidden can show, not even in the rights of a public object with the same bytes.
// A grant register (M06) must judge the whole pack, not this view.
//
// There is no network fallback: with no pack read, the answer says so.

interface Loaded {
  session: object;
  fileName: string;
  /** The digest of the public view, so it can differ from the digest of the pack's file. */
  packDigest: string;
  view: any;
  objects: Map<string, any>;
  sources: Map<string, any>;
  reuse: Map<string, any>;
}

/** What a reference may show: its metadata and rights, never a path or file bytes. */
function safeReference(loaded: Loaded, entry: any) {
  const source = loaded.sources.get(entry.sourceId);
  const reuse = loaded.reuse.get(entry.id);
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

/** A pack's public objects, with only the sources and assets they use, and no owner. */
function publicView(pack: any) {
  const objects = pack.objects.filter((entry: any) => entry.visibility === "public");
  const sources = new Set(objects.map((entry: any) => entry.sourceId));
  const assets = new Set(objects.map((entry: any) => entry.assetSha256));
  return normalizeReferencePack({
    schemaVersion: pack.schemaVersion,
    packId: pack.packId,
    ownerScope: null,
    createdAt: pack.createdAt,
    sources: pack.sources.filter((entry: any) => sources.has(entry.id)),
    objects,
    assets: pack.assets.filter((entry: any) => assets.has(entry.sha256)),
  });
}

export class ReferenceCatalog {
  #loaded: Loaded | null = null;
  #lastAsked = 0;
  #landed = 0;

  /** The loaded pack, if it was read for this very session: a later one never sees it. */
  #current(session: object): Loaded | null {
    if (this.#loaded !== null && this.#loaded.session !== session) this.#loaded = null;
    return this.#loaded;
  }

  /** Forget the pack, when its project closes. A read still under way will not land. */
  revoke(): void {
    this.#loaded = null;
    this.#landed = ++this.#lastAsked;
  }

  /**
   * Read one pack from a directory the owner chose, in place of any before. This is the owner's
   * route alone: no agent names a directory. `isOpen` asks whether the session is still the open
   * one, since the project can change during the read. Of two reads that succeed, the one asked
   * for last wins; one that is refused takes nothing from a read under way.
   */
  async load(session: object, isOpen: () => boolean, directory: unknown, fileName: unknown) {
    const thisLoad = ++this.#lastAsked;
    let read: any;
    try {
      read = await readReferencePackFile({ directory: directory as string, fileName: fileName as string });
    } catch (error) {
      if (error instanceof ImportSecurityError || error instanceof ImportValidationError) throw new StudioError(422, "reference-pack-refused", error.message.slice(0, 300));
      throw error;
    }
    if (!isOpen()) throw new StudioError(409, "project-changed", "the project changed while the pack was being read");
    if (thisLoad < this.#landed) throw new StudioError(409, "reference-load-superseded", "a later read took the place of this one");
    this.#landed = thisLoad;
    const view = publicView(read.pack);
    const packDigest = referencePackDigest(view);
    this.#loaded = {
      session,
      fileName: read.fileName,
      packDigest,
      view,
      objects: new Map(view.objects.map((entry: any) => [entry.id, entry])),
      sources: new Map(view.sources.map((entry: any) => [entry.id, entry])),
      reuse: referenceReuseDecisions(view),
    };
    return { status: "loaded", fileName: read.fileName, packId: view.packId, packDigest, createdAt: view.createdAt, objects: view.objects.length };
  }

  /** Bounded search: the query at most 200 characters, 1 to 100 results. */
  search(session: object, project: string, input: { query?: unknown; kinds?: unknown; limit?: unknown } = {}) {
    const loaded = this.#current(session);
    if (loaded === null) return { project, status: "not-loaded", results: [] };
    let found: any[];
    try {
      found = searchReferencePack(loaded.view, { query: input.query ?? "", kinds: input.kinds ?? [], limit: input.limit ?? 20 });
    } catch (error) {
      if (error instanceof ReferencePackValidationError) throw new StudioError(400, "invalid-reference-search", error.message.slice(0, 300));
      throw error;
    }
    return { project, status: "loaded", packId: loaded.view.packId, packDigest: loaded.packDigest, results: found.map((entry) => safeReference(loaded, entry)) };
  }

  /** One reference by id. An id that is absent, hidden, or from before a switch answers alike. */
  get(session: object, project: string, id: unknown) {
    const loaded = this.#current(session);
    const entry = loaded === null || typeof id !== "string" ? undefined : loaded.objects.get(id);
    if (entry === undefined) throw new StudioError(404, "reference-not-found", "no such reference in this project");
    return { project, packId: loaded!.view.packId, packDigest: loaded!.packDigest, reference: safeReference(loaded!, entry) };
  }
}
