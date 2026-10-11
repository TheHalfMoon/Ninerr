import { createHash, randomUUID } from "node:crypto";
import { IMPORT_SCHEMA_VERSION, defaultImportPolicy, frameStylesheet, importHtmlSnapshot, sanitizeImportedStylesheet, validateImportProposal, type ImportProposal } from "@ninerr/import-stack";
import { inferSemantics, reviewImport } from "@ninerr/intake";
import { StudioError } from "./errors.ts";

// Importing HTML into the open project (PC6, gate 10). The import stack parses and
// sanitizes the markup offline (no network: the policy is "offline", so nothing referenced
// is fetched); intake reviews the proposal; the person sees the review in the editor and
// decides. Committing turns the proposal into one history transaction, made by the
// session like any other edit (attributed, undoable, persisted): one restore-subtree of a
// new page frame holding the imported layers, with inline styles as style properties,
// intake's observed semantics in their props, and the import's provenance in the
// transaction. The change is built and measured when the import is reviewed, so a review
// that says "ready" commits.

const OFFLINE_POLICY = defaultImportPolicy("offline");
/** The import stack's own limits for an offline HTML import. */
export const MAX_IMPORT_HTML_BYTES = OFFLINE_POLICY.maxHtmlBytes;
export const MAX_IMPORT_NODES = OFFLINE_POLICY.maxDomNodes;
// Persistence keeps each change as one journal entry of at most 4 MiB; leave room for the
// transaction's own fields.
const MAX_IMPORT_CHANGE_BYTES = 3.5 * 1024 * 1024;
const MAX_PENDING_IMPORTS = 4;
const PENDING_TTL_MS = 10 * 60 * 1000;

export interface ImportReviewSummary {
  proposalId: string;
  name: string;
  commitReady: boolean;
  blockingReasons: string[];
  counts: { roots: number; nodes: number; byKind: Record<string, number>; stylesheets: number; resources: number };
  security: Record<string, number>;
  diagnostics: Array<{ severity: string; code: string; message: string }>;
  accessibilityFindings: number;
  notes: string[];
}

interface Pending {
  name: string;
  review: ReturnType<typeof reviewImport>;
  blocking: string[];
  /** The page frame holding the import; the frame's index is set when committed. */
  operation: { type: "restore-subtree"; rootId: string; parentId: null; index?: number; nodes: Array<{ id: string }> };
  provenance: Record<string, unknown>;
  expires: number;
}

const NAME = /^[^\u0000-\u001f<>]{1,120}$/u;

export class ImportDesk {
  #pending = new Map<string, Pending>();

  /** Parse and review `html`; the proposal waits for the person's decision. */
  prepare(input: { html: unknown; name: unknown; stylesheets?: unknown }, actorId: string, at: string): ImportReviewSummary {
    const files = chosenStylesheets(input?.stylesheets);
    if (typeof input?.html !== "string" || input.html.trim() === "") throw new StudioError(400, "invalid-import", "html must be a non-empty string");
    if (Buffer.byteLength(input.html) > MAX_IMPORT_HTML_BYTES) throw new StudioError(413, "import-too-large", `an HTML import is limited to ${MAX_IMPORT_HTML_BYTES / 1024 / 1024} MiB`);
    const name = typeof input.name === "string" && NAME.test(input.name.trim()) ? input.name.trim() : "Imported page";
    this.#prune();
    if (this.#pending.size >= MAX_PENDING_IMPORTS) throw new StudioError(409, "too-many-imports", "finish or discard the imports already waiting for review");
    let proposal: ImportProposal;
    try {
      proposal = importHtmlSnapshot({
        schemaVersion: IMPORT_SCHEMA_VERSION,
        requestId: `import-${randomUUID()}`,
        actorId,
        intent: `Import ${name}`,
        at,
        source: { kind: "html-snapshot" },
        policy: OFFLINE_POLICY,
      }, input.html);
    } catch (error) {
      // The import stack's refusals (limits, unparseable input) are fixed descriptions.
      const message = error instanceof Error ? error.message.slice(0, 300) : "the HTML could not be imported";
      throw new StudioError(422, "import-refused", message);
    }
    const linked = linkStylesheets(proposal, files);
    const review = reviewImport(proposal);
    const { operation, provenance } = importOperation(proposal, name);
    const blocking = [...review.blockingReasons];
    const bytes = Buffer.byteLength(JSON.stringify(operation));
    if (bytes > MAX_IMPORT_CHANGE_BYTES) blocking.push(`the imported page is too large to add as one change (${(bytes / 1024 / 1024).toFixed(1)} MiB of layers; at most ${MAX_IMPORT_CHANGE_BYTES / 1024 / 1024} MiB)`);
    this.#pending.set(proposal.proposalId, { name, review, blocking, operation, provenance, expires: Date.now() + PENDING_TTL_MS });
    return summarize(proposal.proposalId, name, proposal, review, blocking, linked);
  }

  /**
   * The change that adds the reviewed import to `document`. The review stays until
   * `consume`, so a commit that fails (the project needs reopening) can be retried.
   */
  change(proposalId: unknown, document: any): { operations: unknown[]; intent: string; frameId: string; provenance: Record<string, unknown> } {
    this.#prune();
    const pending = typeof proposalId === "string" ? this.#pending.get(proposalId) : undefined;
    if (pending === undefined) throw new StudioError(404, "import-not-found", "that import is no longer waiting; import the file again");
    if (pending.blocking.length > 0) throw new StudioError(409, "import-not-ready", `this import cannot be committed: ${pending.blocking.join("; ").slice(0, 300)}`);
    // Import ids are derived from a fresh request id, so they are new; check anyway.
    if (pending.operation.nodes.some((node) => Object.hasOwn(document.nodes, node.id))) throw new StudioError(409, "import-conflict", "this import is already in the project");
    return { operations: [{ ...pending.operation, index: document.rootIds.length }], intent: `Import ${pending.name}`.slice(0, 500), frameId: pending.operation.rootId, provenance: pending.provenance };
  }

  /** The review was committed. */
  consume(proposalId: string): void {
    this.#pending.delete(proposalId);
  }

  discard(proposalId: unknown): void {
    if (typeof proposalId !== "string" || !this.#pending.delete(proposalId)) throw new StudioError(404, "import-not-found", "that import is no longer waiting");
  }

  clear(): void {
    this.#pending.clear();
  }

  #prune(): void {
    for (const [id, pending] of this.#pending) if (pending.expires < Date.now()) this.#pending.delete(id);
  }
}

/** The most stylesheet files an import takes with its page. */
const MAX_CHOSEN_STYLESHEETS = 64;

interface ChosenStylesheet {
  name: string;
  css: string;
}

/** The stylesheet files chosen with the page ({ name, css }), checked and bounded. */
function chosenStylesheets(value: unknown): ChosenStylesheet[] {
  if (value === undefined) return [];
  const valid = (entry: any) => entry !== null && typeof entry === "object" && typeof entry.name === "string" && entry.name.length > 0 && entry.name.length <= 255 && typeof entry.css === "string";
  if (!Array.isArray(value) || value.length > MAX_CHOSEN_STYLESHEETS || !value.every(valid)) {
    throw new StudioError(400, "invalid-import", `stylesheets must be a list of at most ${MAX_CHOSEN_STYLESHEETS} { name, css } files`);
  }
  // Files are matched by name, case aside: two that differ only in case would be ambiguous.
  if (new Set(value.map((entry) => entry.name.toLowerCase())).size !== value.length) {
    throw new StudioError(400, "invalid-import", "two stylesheet files have the same name");
  }
  return value as ChosenStylesheet[];
}

interface LinkedStylesheets {
  /** How many links were read from a chosen file. */
  readLinks: number;
  read: string[];
  missing: string[];
  overLimit: string[];
  /** "file for address", for each link to another site a chosen file answered. */
  inPlaceOf: string[];
  /** How many links each chosen file answered. */
  uses: Map<string, number>;
}

/** A linked stylesheet's file name: the last part of its address's path, decoded. */
function fileName(uri: string): string {
  let path: string;
  try {
    path = new URL(uri, "file:///").pathname;
  } catch {
    path = uri;
  }
  const last = path.split("/").filter((part) => part !== "").at(-1) ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * The page's linked stylesheets, read from the files chosen with it (#283): each
 * <link rel="stylesheet"> whose file name matches a chosen file (case aside, as on Windows and
 * macOS) takes that file, sanitized rule by rule like an inline one. Nothing is fetched. The
 * linked sheets come before the inline ones, as a page's head usually orders them, within the
 * import's CSS budget.
 */
function linkStylesheets(proposal: ImportProposal, files: ChosenStylesheet[]): LinkedStylesheets {
  const linked: LinkedStylesheets = { readLinks: 0, read: [], missing: [], overLimit: [], inPlaceOf: [], uses: new Map() };
  const byName = new Map(files.map((file) => [file.name.toLowerCase(), file]));
  let cssBytes = proposal.stylesheets.reduce((total, sheet) => total + Buffer.byteLength(sheet.cssText, "utf8"), 0);
  const sheets: ImportProposal["stylesheets"] = [];
  for (const resource of proposal.resources) {
    if (resource.kind !== "stylesheet") continue;
    const name = fileName(resource.uri);
    const file = byName.get(name.toLowerCase());
    if (file === undefined) {
      linked.missing.push(resource.uri.slice(0, 200));
      continue;
    }
    let sanitized;
    try {
      sanitized = sanitizeImportedStylesheet(file.css, OFFLINE_POLICY.maxCssBytes);
    } catch {
      linked.overLimit.push(name);
      continue;
    }
    if (sanitized.cssText === null) continue;
    const bytes = Buffer.byteLength(sanitized.cssText, "utf8");
    if (cssBytes + bytes > OFFLINE_POLICY.maxCssBytes || proposal.stylesheets.length + sheets.length >= OFFLINE_POLICY.maxAssets) {
      linked.overLimit.push(name);
      continue;
    }
    cssBytes += bytes;
    linked.readLinks += 1;
    if (!linked.read.includes(file.name)) linked.read.push(file.name);
    // Matched by file name only: a link to another site is answered by the chosen file, and
    // the review says so, as it says a file that answers more than one link (#299).
    // Counted by the chosen file, which links name in any case. (A link without a scheme
    // that starts with // never gets here: the import refuses it without a base address.)
    const address = resource.uri.length > 200 ? `${resource.uri.slice(0, 200)}…` : resource.uri;
    if (/^[a-z][a-z0-9+.-]*:/iu.test(resource.uri.trim())) linked.inPlaceOf.push(`${file.name} for ${address}`);
    linked.uses.set(file.name, (linked.uses.get(file.name) ?? 0) + 1);
    if (sanitized.unsafe) proposal.security.unsafeStylesRemoved += 1;
    sheets.push({ id: `import-style:linked-${createHash("sha256").update(`${proposal.proposalId}:${resource.uri}:${sheets.length}`).digest("hex").slice(0, 32)}`, cssText: sanitized.cssText, sourceBinding: { sourceUri: resource.uri, domPath: "linked-stylesheet" } });
  }
  proposal.stylesheets = [...sheets, ...proposal.stylesheets];
  return linked;
}

function summarize(proposalId: string, name: string, proposal: ImportProposal, review: ReturnType<typeof reviewImport>, blocking: string[], linked: LinkedStylesheets): ImportReviewSummary {
  const notes: string[] = [];
  if (linked.read.length > 0) notes.push(`Linked stylesheet${linked.read.length === 1 ? "" : "s"} read from the files chosen with the page: ${linked.read.join(", ")}.`);
  if (linked.inPlaceOf.length > 0) notes.push(`Read in place of a stylesheet at a web address, which is never fetched: ${linked.inPlaceOf.join(", ")}.`);
  const shared = [...linked.uses].filter(([, count]) => count > 1).map(([file, count]) => `${file} (${count} links)`);
  if (shared.length > 0) notes.push(`Chosen file${shared.length === 1 ? "" : "s"} read for more than one link: ${shared.join(", ")}.`);
  if (linked.missing.length > 0) notes.push(`Linked stylesheet${linked.missing.length === 1 ? "" : "s"} not chosen with the page, so not read: ${linked.missing.join(", ")}.`);
  if (linked.overLimit.length > 0) notes.push(`Linked stylesheet${linked.overLimit.length === 1 ? "" : "s"} left out, past the import's ${OFFLINE_POLICY.maxCssBytes / 1024 / 1024} MiB of CSS: ${linked.overLimit.join(", ")}.`);
  if (proposal.stylesheets.length > 0) notes.push(`${proposal.stylesheets.length} stylesheet${proposal.stylesheets.length === 1 ? " is" : "s are"} carried into the page frame, applied to it alone.`);
  // The linked stylesheets read from chosen files are not among the resources left behind.
  const unread = proposal.resources.length - linked.readLinks;
  if (unread > 0) notes.push(`${unread} linked resource${unread === 1 ? " is" : "s are"} not fetched: imports work offline.`);
  return {
    proposalId,
    name,
    commitReady: blocking.length === 0,
    blockingReasons: blocking,
    counts: { roots: review.counts.roots, nodes: review.counts.nodes, byKind: { ...review.counts.byKind }, stylesheets: review.counts.stylesheets, resources: review.counts.resources },
    security: { ...(proposal.security as unknown as Record<string, number>) },
    diagnostics: proposal.diagnostics.slice(0, 20).map((diagnostic: any) => ({ severity: String(diagnostic.severity), code: String(diagnostic.code), message: String(diagnostic.message).slice(0, 300) })),
    accessibilityFindings: Array.isArray((review as any).accessibility?.findings) ? (review as any).accessibility.findings.length : 0,
    notes,
  };
}

/** `cssText` (an imported inline style) as style properties; the renderer re-checks every value. */
export function styleProperties(style: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (style === null || typeof style !== "object") return out;
  for (const [key, value] of Object.entries(style as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    if (key !== "cssText") {
      out[key] = value;
      continue;
    }
    for (const declaration of value.split(";")) {
      const at = declaration.indexOf(":");
      if (at <= 0) continue;
      const property = declaration.slice(0, at).trim().toLowerCase();
      const text = declaration.slice(at + 1).trim();
      // Custom properties (--brand) keep their case; other names are lowercased.
      const name = declaration.slice(0, at).trim().startsWith("--") ? declaration.slice(0, at).trim() : property;
      if ((/^-?[a-z][a-z0-9-]{0,63}$/u.test(name) || /^--[A-Za-z0-9_-]{1,64}$/u.test(name)) && text !== "" && text.length <= 2000) out[name] = text;
    }
  }
  return out;
}

// The document node import-stack's commitImportProposal makes for an imported node.
function documentNode(node: any) {
  return {
    id: node.id,
    type: node.kind, // element, text, image, vector or media: the same names in the document model
    parentId: node.parentId,
    children: [...node.children],
    props: {
      ...(node.tag === undefined ? {} : { tag: node.tag }),
      ...(node.text === undefined ? {} : { text: node.text }),
      attributes: structuredClone(node.attributes),
      style: structuredClone(node.style),
    },
    metadata: node.sourceBinding === undefined ? {} : { sourceBinding: structuredClone(node.sourceBinding) },
  };
}

function importOperation(proposalInput: ImportProposal, name: string) {
  // The same nodes import-stack's own commit makes (one restore-subtree per root), built
  // here as one subtree under a new page frame: one operation whatever the page's shape,
  // which history validates once when it is committed.
  const proposal = validateImportProposal(proposalInput);
  const semantics = new Map(inferSemantics(proposal).records.map(({ nodeId, ...props }: any) => [nodeId, props]));
  const frameId = `page-import-${randomUUID().slice(0, 12)}`;
  const frame = {
    id: frameId,
    type: "frame",
    parentId: null,
    children: [...proposal.rootIds],
    props: {
      tag: "div",
      name: name.slice(0, 200),
      style: { position: "relative", width: "1024px", "min-height": "640px", background: "#ffffff" },
      // The page's own stylesheets, sanitized, applied to this frame alone (#283).
      ...(proposal.stylesheets.length === 0 ? {} : { stylesheet: frameStylesheet(proposal.stylesheets.map((sheet) => sheet.cssText)) }),
    },
    metadata: {},
  };
  // Depth-first from each root, as collectProposalSubtree does, but validating once rather
  // than once per root (a page can have thousands of top-level elements).
  const ordered: any[] = [];
  const walk = (id: string) => {
    const node = (proposal.nodes as any)[id];
    ordered.push(node);
    for (const child of node.children) walk(child);
  };
  for (const rootId of proposal.rootIds) walk(rootId);
  const nodes = [frame, ...ordered.map((imported) => {
    const node = documentNode(imported);
    return {
      ...node,
      parentId: node.parentId === null ? frameId : node.parentId,
      props: { ...node.props, style: styleProperties(node.props.style), ...(semantics.has(node.id) ? { semantics: semantics.get(node.id) } : {}) },
    };
  })];
  return {
    operation: { type: "restore-subtree" as const, rootId: frameId, parentId: null, nodes },
    // What import-stack's commit records about the import.
    provenance: { requestId: proposal.requestId, proposalId: proposal.proposalId, inputSha256: proposal.inputSha256, sourceKind: proposal.source.kind, requestedAt: proposal.requestedAt },
  };
}
