import { createHash, randomUUID } from "node:crypto";
import { IMPORT_SCHEMA_VERSION, defaultImportPolicy, frameStylesheet, importHtmlSnapshot, sanitizeImportedStylesheet, validateImportProposal, type ImportProposal } from "@ninerr/import-stack";
import { inferSemantics, reviewImport } from "@ninerr/intake";
import { isImportant, isLonghandOf, shorthandsFirst, withoutOverriddenLonghands } from "@ninerr/renderer";
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
  const overridden = Object.values(proposal.nodes as Record<string, any>).filter((node) => Object.keys(importedStyle(node.style)).length < Object.keys(styleProperties(node.style)).length).length;
  const outOfOrder = Object.values(proposal.nodes as Record<string, any>).filter((node) => styleOutOfWrittenOrder(node.style)).length;
  if (outOfOrder > 0) notes.push(`${outOfOrder} layer${outOfOrder === 1 ? " has" : "s have"} overlapping style properties that the canvas applies in its own order, so ${outOfOrder === 1 ? "it" : "they"} may draw differently from the source.`);
  if (overridden > 0) notes.push(`${overridden} layer${overridden === 1 ? " has" : "s have"} style properties left out that a later shorthand in the same style overrides; the layer looks the same.`);
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

const CLOSES: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
// The name url, whole: not the end of a longer name such as my-url.
const UNQUOTED_URL_NAME = /(?:^|[^-\w\\\u0080-\uffff])url$/iu;

/** Whether, past CSS's own whitespace, the text at `from` opens a string. */
function opensQuoted(text: string, from: number): boolean {
  let at = from;
  while (text[at] === " " || text[at] === "\t" || text[at] === "\n") at += 1;
  return text[at] === "\"" || text[at] === "'";
}

/**
 * A style's declarations, read as CSS reads them (differentially tested against a browser in
 * tests/style-order.test.mjs). A semicolon ends one only outside strings, brackets and comments.
 * A comment can sit anywhere but inside an unquoted url(), one left open runs to the end, a line
 * break in a string or a stray closing bracket makes its declaration invalid, and a backslash
 * takes the next character with it. An escaped name such as u\\72l( is not read as url(. Linear in
 * the text.
 */
function declarationsOf(input: string): string[] {
  const text = input.replace(/\r\n?|\f/gu, "\n");
  const declarations: string[] = [];
  const open: string[] = [];
  let current = "";
  let invalid = false;
  const end = () => {
    if (!invalid) declarations.push(current);
    current = "";
    invalid = false;
  };
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    if (char === "\\") {
      current += text.slice(at, at + 2);
      at += 2;
    } else if (char === "/" && text[at + 1] === "*") {
      const close = text.indexOf("*/", at + 2);
      if (close < 0) break;
      current += " ";
      at = close + 2;
    } else if (char === "\"" || char === "'") {
      let scan = at + 1;
      while (scan < text.length && text[scan] !== char && text[scan] !== "\n") scan += text[scan] === "\\" ? 2 : 1;
      if (text[scan] === char) scan += 1;
      else if (scan < text.length) invalid = true;
      current += text.slice(at, scan);
      at = scan;
    } else if (char === "(" && UNQUOTED_URL_NAME.test(text.slice(Math.max(0, at - 4), at)) && !opensQuoted(text, at + 1)) {
      // An unquoted url(): quotes and comments mean nothing in it, only its closing bracket.
      let scan = at + 1;
      while (scan < text.length && text[scan] !== ")") scan += text[scan] === "\\" ? 2 : 1;
      current += text.slice(at, scan + 1);
      at = scan + 1;
    } else if (char === ";" && open.length === 0) {
      end();
      at += 1;
    } else {
      if (Object.hasOwn(CLOSES, char)) open.push(CLOSES[char]);
      else if (char === open.at(-1)) open.pop();
      else if (open.length === 0 && (char === ")" || char === "]" || char === "}")) invalid = true;
      current += char;
      at += 1;
    }
  }
  end();
  return declarations;
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
    // A name written again takes the later value and the later place, since order decides what
    // wins; but a plain one never beats an important one, as in CSS.
    for (const declaration of declarationsOf(value)) {
      const at = declaration.indexOf(":");
      if (at <= 0) continue;
      const property = declaration.slice(0, at).trim().toLowerCase();
      const text = declaration.slice(at + 1).trim();
      // Custom properties (--brand) keep their case; other names are lowercased.
      const name = declaration.slice(0, at).trim().startsWith("--") ? declaration.slice(0, at).trim() : property;
      if ((/^-?[a-z][a-z0-9-]{0,63}$/u.test(name) || /^--[A-Za-z0-9_-]{1,64}$/u.test(name)) && text !== "" && text.length <= 2000) {
        if (Object.hasOwn(out, name) && isImportant(out[name]) && !isImportant(text)) continue;
        delete out[name];
        out[name] = text;
      }
    }
  }
  return out;
}

// Shorthands and what they set, beyond their own name followed by "-" (margin-top).
const SHORTHANDS = new Set(["margin", "padding", "inset", "border", "border-top", "border-right", "border-bottom", "border-left", "border-block", "border-inline", "border-block-start", "border-block-end", "border-inline-start", "border-inline-end", "border-width", "border-style", "border-color", "border-radius", "border-image", "outline", "background", "font", "flex", "flex-flow", "grid", "grid-template", "grid-area", "grid-row", "grid-column", "gap", "grid-gap", "place-items", "place-content", "place-self", "text-decoration", "list-style", "overflow", "transition", "animation", "mask", "columns", "scroll-margin", "scroll-padding", "inset-block", "inset-inline", "margin-block", "margin-inline", "padding-block", "padding-inline", "all"]);
const SETS: Record<string, string[]> = {
  inset: ["top", "right", "bottom", "left"],
  gap: ["row-gap", "column-gap", "grid-gap", "grid-row-gap", "grid-column-gap"],
  "grid-gap": ["row-gap", "column-gap", "gap", "grid-row-gap", "grid-column-gap"],
  font: ["line-height"],
  "flex-flow": ["flex-direction", "flex-wrap"],
  "place-items": ["align-items", "justify-items"],
  "place-content": ["align-content", "justify-content"],
  "place-self": ["align-self", "justify-self"],
  "border-width": ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"],
  "border-style": ["border-top-style", "border-right-style", "border-bottom-style", "border-left-style"],
  "border-color": ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"],
  "border-radius": ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"],
  columns: ["column-count", "column-width"],
  "inset-block": ["top", "bottom"],
  "inset-inline": ["left", "right"],
  "margin-inline": ["margin-left", "margin-right"],
  "margin-block": ["margin-top", "margin-bottom"],
  "padding-inline": ["padding-left", "padding-right"],
  "padding-block": ["padding-top", "padding-bottom"],
};
const sets = (shorthand: string, name: string): boolean => SHORTHANDS.has(shorthand) && (shorthand === "all" || name.startsWith(`${shorthand}-`) || (SETS[shorthand]?.includes(name) ?? false));
// A border's side and a border's part (border-top and border-color) each set some of the other.
const BORDER_SIDE = /^border-(?:top|right|bottom|left|block|inline)(?:-start|-end)?$/u;
const BORDER_PART = /^border-(?:color|style|width)$/u;
export const overlap = (x: string, y: string): boolean => sets(x, y) || sets(y, x) || (SHORTHANDS.has(x) && SHORTHANDS.has(y) && ((BORDER_SIDE.test(x) && BORDER_PART.test(y)) || (BORDER_PART.test(x) && BORDER_SIDE.test(y))));

/**
 * Whether a style can draw differently from its source (decided in P09, #369): two properties
 * that overlap, in an order the canvas does not keep. The store sorts a style's names and the
 * canvas applies shorthands first, so of two overlapping shorthands the last written need not
 * win. Within the overlap table: other pairs (margin-left and margin-inline-start) are not seen.
 * A longhand left beside its shorthand needs no report: importedStyle has already dropped one the
 * shorthand resets, and the canvas applies the rest in order. Importance on one side settles a
 * pair whatever the order. Linear in the names, for the few shorthands there can be.
 */
export function styleOutOfWrittenOrder(style: unknown): boolean {
  const written = importedStyle(style);
  const names = Object.keys(written);
  const applied = new Map(Object.keys(shorthandsFirst(Object.fromEntries([...names].sort().map((name) => [name, ""])))).map((name, index) => [name, index]));
  return names.some((shorthand, at) => SHORTHANDS.has(shorthand) && names.some((other, otherAt) => {
    if (other === shorthand || !overlap(shorthand, other) || isLonghandOf(shorthand, other) || isLonghandOf(other, shorthand)) return false;
    if (isImportant(written[shorthand]) !== isImportant(written[other])) return false;
    return (at < otherAt) !== (applied.get(shorthand)! < applied.get(other)!);
  }));
}

/** What an imported style says: its properties, without those a later shorthand overrides (#360). */
export function importedStyle(style: unknown): Record<string, string> {
  return withoutOverriddenLonghands(styleProperties(style));
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
      props: { ...node.props, style: importedStyle(node.props.style), ...(semantics.has(node.id) ? { semantics: semantics.get(node.id) } : {}) },
    };
  })];
  return {
    operation: { type: "restore-subtree" as const, rootId: frameId, parentId: null, nodes },
    // What import-stack's commit records about the import.
    provenance: { requestId: proposal.requestId, proposalId: proposal.proposalId, inputSha256: proposal.inputSha256, sourceKind: proposal.source.kind, requestedAt: proposal.requestedAt },
  };
}
