export const DOCUMENT_SCHEMA_VERSION = 1;

// Hard limits; documents beyond them are refused rather than processed slowly.
// maxDocumentBytes matches persistence's object size limit.
export const DOCUMENT_LIMITS = Object.freeze({
  maxNodes: 100_000,
  maxTreeDepth: 1_024,
  maxDocumentBytes: 64 * 1024 * 1024,
});

export const NODE_TYPES = Object.freeze([
  "page",
  "frame",
  "group",
  "element",
  "text",
  "vector",
  "image",
  "media",
  "code-component",
  "component-definition",
  "token-reference",
  "interaction",
  "asset-reference",
  "source-binding",
]);

const NODE_TYPE_SET = new Set(NODE_TYPES);

export class DocumentInvariantError extends Error {
  constructor(message) {
    super(message);
    this.name = "DocumentInvariantError";
  }
}

function cloneData(value) {
  return structuredClone(value);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DocumentInvariantError(`${label} must be a non-empty string`);
  }
}

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
  if (!isPlainRecord(value)) {
    throw new DocumentInvariantError(`${label} must be a plain object`);
  }
}

// Document schema 1 has exactly these fields on a document and on a node record.
export const DOCUMENT_FIELDS = Object.freeze(["schemaVersion", "id", "name", "revision", "rootIds", "nodes", "metadata"]);
export const NODE_FIELDS = Object.freeze(["id", "type", "parentId", "children", "props", "metadata"]);
const DOCUMENT_FIELD_SET = new Set(DOCUMENT_FIELDS);
const NODE_FIELD_SET = new Set(NODE_FIELDS);

function unknownField(record, allowed) {
  for (const key of Object.keys(record)) if (!allowed.has(key)) return key;
  return undefined;
}

function assertKnownFields(record, allowed, label) {
  const field = unknownField(record, allowed);
  if (field !== undefined) {
    throw new DocumentInvariantError(`${label} has field ${JSON.stringify(field).slice(0, 80)}, which document schema 1 does not have`);
  }
}

/**
 * The first reason `value` is not JSON data, or null. JSON data is null, booleans, strings,
 * finite numbers, dense arrays, and objects with a plain or null prototype, nested at most
 * MAX_SERIALIZE_DEPTH levels. A Map, Date, typed array, function, or undefined would pass a
 * typeof check and then fail or change meaning in serialization, so it is refused where it
 * enters. Values are read the way the serializer reads them (own enumerable string keys);
 * this is a data check for in-process callers, not a defense against hostile getters.
 */
export function jsonDataProblem(value, depth = 0) {
  if (depth > MAX_SERIALIZE_DEPTH) return `is nested deeper than ${MAX_SERIALIZE_DEPTH} levels`;
  if (value === null || typeof value === "boolean" || typeof value === "string") return null;
  if (typeof value === "number") return Number.isFinite(value) ? null : "holds a non-finite number";
  if (typeof value !== "object") return `holds ${typeof value === "undefined" ? "an" : "a"} ${typeof value} value`;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return "holds a non-plain array";
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return "holds a sparse array";
      const problem = jsonDataProblem(value[index], depth + 1);
      if (problem !== null) return problem;
    }
    return null;
  }
  if (!isPlainRecord(value)) return "holds a non-plain object";
  for (const key of Object.keys(value)) {
    const problem = jsonDataProblem(value[key], depth + 1);
    if (problem !== null) return problem;
  }
  return null;
}

function assertJsonData(value, label) {
  assertPlainObject(value, label);
  const problem = jsonDataProblem(value);
  if (problem !== null) throw new DocumentInvariantError(`${label} ${problem}`);
}

function assertUniqueStrings(values, label) {
  if (!Array.isArray(values)) {
    throw new DocumentInvariantError(`${label} must be an array`);
  }
  const seen = new Set();
  for (const value of values) {
    assertNonEmptyString(value, `${label} entry`);
    if (seen.has(value)) {
      const shownValue = value.length > 80 ? `${value.slice(0, 77)}...` : value;
      throw new DocumentInvariantError(`${label} contains duplicate id ${shownValue}`);
    }
    seen.add(value);
  }
}

// Code-unit order: unlike localeCompare, it does not depend on the process locale.
function compareCodeUnits(left, right) {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

// In-memory key order is a convenience: JS always enumerates integer-like keys
// first. The canonical order is the one serializeDocument writes.
function sortNodeRecord(nodes) {
  return Object.fromEntries(
    Object.entries(nodes).sort(([left], [right]) => compareCodeUnits(left, right)),
  );
}

/**
 * withSortedNodes for a document whose nodes are in canonical order except for the keys in
 * `added` (appended, or anywhere): those are merged into place in one pass, where sorting
 * every key costs n log n (#252). Any key of `added` may already be in place; one no longer in
 * the document is ignored. The result is the order sortNodeRecord gives.
 */
// A key JS orders as an array index: enumerated before every other key, in numeric order.
const INTEGER_KEY = /^(?:0|[1-9]\d{0,9})$/u;
const isIndexKey = (key) => INTEGER_KEY.test(key) && Number(key) <= 4294967294;

export function withAddedNodesSorted(document, added) {
  const nodes = document.nodes;
  const fresh = [...new Set(added)].filter((key) => typeof key === "string" && Object.hasOwn(nodes, key)).sort(compareCodeUnits);
  const freshSet = new Set(fresh);
  const entries = [];
  let next = 0;
  for (const key of Object.keys(nodes)) {
    if (freshSet.has(key)) continue;
    // Integer-like keys come first in any object, whatever their order: they are passed over
    // in the merge, and fromEntries puts them in place (review of #252).
    if (isIndexKey(key)) {
      entries.push([key, nodes[key]]);
      continue;
    }
    while (next < fresh.length && compareCodeUnits(fresh[next], key) < 0) {
      entries.push([fresh[next], nodes[fresh[next]]]);
      next += 1;
    }
    entries.push([key, nodes[key]]);
  }
  for (; next < fresh.length; next += 1) entries.push([fresh[next], nodes[fresh[next]]]);
  return { ...document, nodes: Object.fromEntries(entries) };
}

const MAX_SERIALIZE_DEPTH = 256;

function canonicalValue(value, depth) {
  if (depth > MAX_SERIALIZE_DEPTH) {
    throw new DocumentInvariantError(`cannot serialize values nested deeper than ${MAX_SERIALIZE_DEPTH}`);
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DocumentInvariantError("cannot serialize a non-finite number");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    const parts = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new DocumentInvariantError("cannot serialize a sparse array");
      parts.push(canonicalValue(value[index], depth + 1));
    }
    return `[${parts.join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new DocumentInvariantError("cannot serialize a non-plain object");
    }
    const body = Object.keys(value)
      .sort(compareCodeUnits)
      .map((key) => {
        if (value[key] === undefined) {
          throw new DocumentInvariantError(`cannot serialize undefined at key ${JSON.stringify(key).slice(0, 80)}`);
        }
        return `${JSON.stringify(key)}:${canonicalValue(value[key], depth + 1)}`;
      })
      .join(",");
    return `{${body}}`;
  }
  throw new DocumentInvariantError(`cannot serialize a ${typeof value} value`);
}

/**
 * Canonical JSON for a valid document: keys in code-unit order at every depth,
 * no whitespace, -0 written as 0. Values JSON cannot represent faithfully are refused.
 */
export function serializeDocument(document) {
  validateDocument(document);
  const text = canonicalValue(document, 0);
  if (exceedsByteLimit(text)) {
    throw new DocumentInvariantError(`serialized document exceeds ${DOCUMENT_LIMITS.maxDocumentBytes} bytes`);
  }
  return text;
}

function exceedsByteLimit(text) {
  // UTF-16 length bounds UTF-8 bytes from below (x1) and above (x3); count exactly only near the limit.
  if (text.length > DOCUMENT_LIMITS.maxDocumentBytes) return true;
  return text.length * 3 > DOCUMENT_LIMITS.maxDocumentBytes && utf8Length(text) > DOCUMENT_LIMITS.maxDocumentBytes;
}

// Bracket nesting of JSON text outside strings. Canonical output nests at most
// MAX_SERIALIZE_DEPTH + 1 levels (the document object is level 1), so deeper text
// is refused before JSON.parse spends time on it.
function exceedsNesting(text) {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (inString) {
      if (unit === 0x5c) index += 1;
      else if (unit === 0x22) inString = false;
    } else if (unit === 0x22) {
      inString = true;
    } else if (unit === 0x5b || unit === 0x7b) {
      depth += 1;
      if (depth > MAX_SERIALIZE_DEPTH + 1) return true;
    } else if (unit === 0x5d || unit === 0x7d) {
      depth -= 1;
    }
  }
  return false;
}

// UTF-8 byte length without Buffer, so the model stays environment-neutral.
function utf8Length(text) {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length
      && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Parse canonical document text. Only the exact canonical form is accepted, so one
 * document has exactly one byte representation.
 */
export function parseDocument(text) {
  if (typeof text !== "string") throw new DocumentInvariantError("document text must be a string");
  if (exceedsByteLimit(text)) {
    throw new DocumentInvariantError(`document text exceeds ${DOCUMENT_LIMITS.maxDocumentBytes} bytes`);
  }
  if (exceedsNesting(text)) {
    throw new DocumentInvariantError(`document text nests deeper than ${MAX_SERIALIZE_DEPTH + 1} levels`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new DocumentInvariantError("document text is not valid JSON");
  }
  if (serializeDocument(value) !== text) {
    throw new DocumentInvariantError("document text is not in canonical form");
  }
  return normalizeDocument(value);
}

export function createNode({
  id,
  type,
  parentId = null,
  children = [],
  props = {},
  metadata = {},
}) {
  assertNonEmptyString(id, "node.id");
  if (!NODE_TYPE_SET.has(type)) {
    throw new DocumentInvariantError(`Unsupported node type ${String(type)}`);
  }
  if (parentId !== null) {
    assertNonEmptyString(parentId, "node.parentId");
  }
  assertUniqueStrings(children, "node.children");
  assertJsonData(props, "node.props");
  assertJsonData(metadata, "node.metadata");

  return {
    id,
    type,
    parentId,
    children: [...children],
    props: cloneData(props),
    metadata: cloneData(metadata),
  };
}

export function createDocument({
  id,
  name = "Untitled",
  nodes = [],
  rootIds = null,
  metadata = {},
  revision = 0,
} = {}) {
  assertNonEmptyString(id, "document.id");
  assertNonEmptyString(name, "document.name");
  assertJsonData(metadata, "document.metadata");
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new DocumentInvariantError("document.revision must be a non-negative safe integer");
  }

  const record = {};
  const sourceNodes = Array.isArray(nodes) ? nodes : Object.values(nodes);
  for (const input of sourceNodes) {
    const node = createNode(input);
    // Own-key check and data definition: a node id such as "__proto__" or
    // "constructor" is an ordinary key, not an inherited member.
    if (Object.hasOwn(record, node.id)) {
      throw new DocumentInvariantError(`Duplicate node id ${node.id}`);
    }
    Object.defineProperty(record, node.id, { value: node, writable: true, enumerable: true, configurable: true });
  }

  const resolvedRoots = rootIds === null
    ? Object.values(record).filter((node) => node.parentId === null).map((node) => node.id)
    : [...rootIds];

  const document = {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    id,
    name,
    revision,
    rootIds: resolvedRoots,
    nodes: sortNodeRecord(record),
    metadata: cloneData(metadata),
  };

  validateDocument(document);
  return document;
}

/**
 * A copy of data that validation accepted: plain objects, arrays and JSON values only (see
 * jsonDataProblem). For tree-shaped data it equals structuredClone's copy (own enumerable
 * string keys in their order, "__proto__" kept as an own key, every object a plain one) at a
 * quarter of its cost, which matters because every edit copies the whole document (#252).
 * Unlike structuredClone, an object reachable twice becomes two copies, and an array's
 * non-index properties and a proxy's being a proxy are not kept; none of these survives
 * serialization either. It is not for anything unvalidated: it would turn a Map or a Date
 * into {}, where structuredClone keeps it for validation to refuse.
 */
export function cloneValidated(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const copy = new Array(value.length);
    for (let index = 0; index < value.length; index += 1) copy[index] = cloneValidated(value[index]);
    return copy;
  }
  const copy = {};
  for (const key of Object.keys(value)) {
    // Assigning "__proto__" would set the copy's prototype instead of an own key.
    if (key === "__proto__") Object.defineProperty(copy, key, { value: cloneValidated(value[key]), enumerable: true, writable: true, configurable: true });
    else copy[key] = cloneValidated(value[key]);
  }
  return copy;
}

export function cloneDocument(document) {
  validateDocument(document);
  return cloneValidated(document);
}

export function normalizeDocument(document) {
  const copy = cloneDocument(document);
  copy.nodes = sortNodeRecord(copy.nodes);
  return copy;
}

/**
 * Canonical node order for a document the caller already owns (for example a
 * private working copy): no validation and no clone, so it is cheap on large
 * documents. Returns a new top-level object; node objects are shared.
 */
export function withSortedNodes(document) {
  return { ...document, nodes: sortNodeRecord(document.nodes) };
}

export function getNode(document, nodeId) {
  // Same key coercion as a property lookup (so getNode(doc, 5) still finds
  // node "5"), but own keys only: inherited names such as toString are not nodes.
  const key = typeof nodeId === "symbol" ? undefined : String(nodeId);
  const node = key !== undefined && Object.hasOwn(document.nodes, key) ? document.nodes[key] : undefined;
  if (!node) {
    let shown = "(symbol)";
    if (key !== undefined) shown = key.length > 80 ? `${key.slice(0, 77)}...` : key;
    throw new DocumentInvariantError(`Unknown node id ${shown}`);
  }
  return node;
}

export function getSubtreeNodeIds(document, nodeId) {
  getNode(document, nodeId);
  const result = [];
  const visit = (id) => {
    result.push(id);
    for (const childId of document.nodes[id].children) {
      visit(childId);
    }
  };
  visit(nodeId);
  return result;
}

export function getNodeIndex(document, nodeId) {
  const node = getNode(document, nodeId);
  const siblings = node.parentId === null
    ? document.rootIds
    : getNode(document, node.parentId).children;
  const index = siblings.indexOf(nodeId);
  if (index < 0) {
    throw new DocumentInvariantError(`Node ${nodeId} is detached from its declared parent`);
  }
  return index;
}

export function isDescendant(document, ancestorId, candidateId) {
  getNode(document, ancestorId);
  getNode(document, candidateId);
  let cursor = document.nodes[candidateId];
  // A transaction can leave parents naming each other part-way (a restored snapshot is
  // checked whole only at its end), so the walk refuses a cycle rather than loop for ever.
  const seen = new Set();
  while (cursor.parentId !== null) {
    if (cursor.parentId === ancestorId) return true;
    if (seen.has(cursor.id)) throw new DocumentInvariantError(`Cycle detected at node ${shownId(cursor.id)}`);
    seen.add(cursor.id);
    cursor = getNode(document, cursor.parentId);
  }
  return false;
}

const shownId = (id) => {
  const text = String(id);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};

/** One node record's own checks, as validateDocument makes them for every node. */
function assertNodeRecord(nodes, id, node) {
  const lookup = (key) => (typeof key === "string" && Object.hasOwn(nodes, key) ? nodes[key] : undefined);
  assertNonEmptyString(id, "document node key");
  assertPlainObject(node, `node ${shownId(id)}`);
  assertKnownFields(node, NODE_FIELD_SET, `node ${shownId(id)}`);
  if (node.id !== id) {
    throw new DocumentInvariantError(`Node record key ${shownId(id)} does not match node.id ${shownId(node.id)}`);
  }
  if (!NODE_TYPE_SET.has(node.type)) {
    throw new DocumentInvariantError(`Node ${shownId(id)} has unsupported type ${shownId(node.type)}`);
  }
  if (node.parentId !== null && !lookup(node.parentId)) {
    throw new DocumentInvariantError(`Node ${shownId(id)} references missing parent ${shownId(node.parentId)}`);
  }
  assertUniqueStrings(node.children, `node ${shownId(id)}.children`);
  assertPlainObject(node.props, `node ${shownId(id)}.props`);
  assertPlainObject(node.metadata, `node ${shownId(id)}.metadata`);
}

/**
 * Validate only the records of `ids` in `document`, and its revision: for a document whose
 * every other part is unchanged from one that was fully validated, and whose change left its
 * structure as it was (its node keys, parents, children and roots), as setting props does
 * (#252). Anything else must go through validateDocument.
 */
export function validateNodes(document, ids) {
  if (!Number.isSafeInteger(document.revision) || document.revision < 0) {
    throw new DocumentInvariantError("document.revision must be a non-negative safe integer");
  }
  for (const id of ids) {
    if (!Object.hasOwn(document.nodes, id)) throw new DocumentInvariantError(`Unknown node id ${shownId(id)}`);
    const node = document.nodes[id];
    assertNodeRecord(document.nodes, id, node);
    // A node lies two levels into the document (document.nodes[id]): its depth counts from
    // there, as validateDocument's one walk counts it, with the same message.
    const problem = jsonDataProblem(node, 2);
    if (problem !== null) throw new DocumentInvariantError(`document ${problem}`);
  }
}

/**
 * Whether `document` is certainly valid, checking only the records of `ids` and what links to
 * them, for a document changed from a fully validated one only at those records (and records
 * removed whole). `moved` names nodes whose subtrees changed place. It answers only "certainly
 * valid" (true) or "not sure" (false); `added` says whether it added nodes: a caller that gets false must validate the document
 * whole, which then decides, with its own message (#252). Ids are own string keys.
 */
export function changedPartIsValid(document, ids, moved = [], { added = true } = {}) {
  if (!Number.isSafeInteger(document.revision) || document.revision < 0) return false;
  const nodes = document.nodes;
  const own = (id) => (typeof id === "string" && Object.hasOwn(nodes, id) ? nodes[id] : undefined);
  // Only adding nodes can pass the node limit.
  if (added && Object.keys(nodes).length > DOCUMENT_LIMITS.maxNodes) return false;
  try {
    assertUniqueStrings(document.rootIds, "document.rootIds");
  } catch {
    return false;
  }
  for (const rootId of document.rootIds) {
    const root = own(rootId);
    if (!root || root.parentId !== null) return false;
  }
  const rootSet = new Set(document.rootIds);
  // Each parent's children as a set, built once: a parent with thousands of children is asked
  // about many of them.
  const childSets = new Map();
  const lists = (parent, childId) => {
    let set = childSets.get(parent);
    if (set === undefined) {
      set = new Set(parent.children);
      childSets.set(parent, set);
    }
    return set.has(childId);
  };
  // The depth below which a walk need not count exactly: near the limit, the whole check decides.
  const safeDepth = DOCUMENT_LIMITS.maxTreeDepth - 2;
  // Its depth, walking up to a root through parents that list it; infinite if it does not get
  // there within safeDepth (a cycle, a broken link, or too deep to call without the whole check).
  // Depths found, so a restored subtree's nodes do not each walk up the whole way (review of
  // #252: undo of a large, deep removal).
  const depths = new Map();
  const depthOf = (id) => {
    const path = [];
    let node = own(id);
    if (node === undefined) return Number.POSITIVE_INFINITY;
    let base = 0;
    for (;;) {
      if (depths.has(node.id)) {
        base = depths.get(node.id);
        break;
      }
      path.push(node.id);
      if (node.parentId === null) {
        if (!rootSet.has(node.id)) return Number.POSITIVE_INFINITY;
        base = -1;
        break;
      }
      const parent = own(node.parentId);
      if (!parent || !lists(parent, node.id) || path.length > safeDepth) return Number.POSITIVE_INFINITY;
      node = parent;
    }
    if (base === Number.POSITIVE_INFINITY) return base;
    // path[0] is `id`, path.at(-1) the highest node found; each is one deeper than the next.
    for (let index = path.length - 1; index >= 0; index -= 1) {
      base += 1;
      if (base > safeDepth) return Number.POSITIVE_INFINITY;
      depths.set(path[index], base);
    }
    return depths.get(id);
  };
  for (const id of ids) {
    const node = own(id);
    if (node === undefined) {
      if (typeof id !== "string") return false;
      continue; // removed whole
    }
    try {
      assertNodeRecord(nodes, id, node);
    } catch {
      return false;
    }
    if (jsonDataProblem(node, 2) !== null) return false;
    for (const childId of node.children) {
      const child = own(childId);
      if (!child || child.parentId !== id) return false;
    }
    if (node.parentId === null) {
      if (!rootSet.has(id)) return false;
    } else {
      const parent = own(node.parentId);
      if (!parent || !lists(parent, id) || rootSet.has(id)) return false;
    }
    if (depthOf(id) === Number.POSITIVE_INFINITY) return false;
  }
  // A moved subtree's nodes keep their records but not their depth.
  for (const id of moved) {
    if (own(id) === undefined) continue; // moved, then removed
    const start = depthOf(id);
    if (start === Number.POSITIVE_INFINITY) return false;
    const stack = [[id, start]];
    while (stack.length > 0) {
      const [current, depth] = stack.pop();
      if (depth > safeDepth) return false;
      for (const childId of own(current)?.children ?? []) stack.push([childId, depth + 1]);
    }
  }
  return true;
}

export function validateDocument(document) {
  assertPlainObject(document, "document");
  assertKnownFields(document, DOCUMENT_FIELD_SET, "document");
  // One walk checks the whole record is JSON data as the serializer reads it (no Maps, typed
  // arrays, undefined, non-finite numbers...), so the field checks below read plain values.
  const dataProblem = jsonDataProblem(document);
  if (dataProblem !== null) throw new DocumentInvariantError(`document ${dataProblem}`);
  if (document.schemaVersion !== DOCUMENT_SCHEMA_VERSION) {
    throw new DocumentInvariantError(
      `Unsupported document schema version ${String(document.schemaVersion)}`,
    );
  }
  assertNonEmptyString(document.id, "document.id");
  assertNonEmptyString(document.name, "document.name");
  if (!Number.isSafeInteger(document.revision) || document.revision < 0) {
    throw new DocumentInvariantError("document.revision must be a non-negative safe integer");
  }
  assertUniqueStrings(document.rootIds, "document.rootIds");
  assertPlainObject(document.nodes, "document.nodes");
  assertPlainObject(document.metadata, "document.metadata");

  // Own-key lookups only: an id such as "toString" or "__proto__" must not
  // resolve through Object.prototype. Ids are shortened in messages so an
  // oversized id cannot produce an oversized error.
  const nodes = document.nodes;
  const lookup = (id) => (typeof id === "string" && Object.hasOwn(nodes, id) ? nodes[id] : undefined);
  const shown = (id) => {
    const text = String(id);
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  };

  const nodeTotal = Object.keys(nodes).length;
  if (nodeTotal > DOCUMENT_LIMITS.maxNodes) {
    throw new DocumentInvariantError(`document has ${nodeTotal} nodes; the limit is ${DOCUMENT_LIMITS.maxNodes}`);
  }

  const rootSet = new Set(document.rootIds);
  const referenced = new Set();
  for (const [id, node] of Object.entries(nodes)) {
    assertNodeRecord(nodes, id, node);

    if (node.parentId === null && !rootSet.has(id)) {
      throw new DocumentInvariantError(`Root node ${shown(id)} is missing from document.rootIds`);
    }
    if (node.parentId !== null && rootSet.has(id)) {
      throw new DocumentInvariantError(`Non-root node ${shown(id)} appears in document.rootIds`);
    }

    for (const childId of node.children) {
      const child = lookup(childId);
      if (!child) {
        throw new DocumentInvariantError(`Node ${shown(id)} references missing child ${shown(childId)}`);
      }
      if (child.parentId !== id) {
        throw new DocumentInvariantError(
          `Child ${shown(childId)} declares parent ${shown(child.parentId)} instead of ${shown(id)}`,
        );
      }
      // Children are unique per parent and each child names one parent, so a
      // child is referenced at most once overall.
      referenced.add(childId);
    }
  }

  for (const rootId of document.rootIds) {
    const root = lookup(rootId);
    if (!root) {
      throw new DocumentInvariantError(`document.rootIds references missing node ${shown(rootId)}`);
    }
    if (root.parentId !== null) {
      throw new DocumentInvariantError(`Root node ${shown(rootId)} must have parentId null`);
    }
  }

  for (const [id, node] of Object.entries(nodes)) {
    if (node.parentId !== null && !referenced.has(id)) {
      throw new DocumentInvariantError(
        `Parent ${shown(node.parentId)} must reference child ${shown(id)} exactly once`,
      );
    }
  }

  // Iterative depth-first walk, so a long parent chain cannot overflow the stack.
  const visited = new Set();
  const onPath = new Set();
  for (const rootId of document.rootIds) {
    if (visited.has(rootId)) continue;
    const stack = [[rootId, 0]];
    onPath.add(rootId);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const children = nodes[frame[0]].children;
      if (frame[1] < children.length) {
        const childId = children[frame[1]];
        frame[1] += 1;
        if (onPath.has(childId)) throw new DocumentInvariantError(`Cycle detected at node ${shown(childId)}`);
        if (visited.has(childId)) continue;
        if (stack.length >= DOCUMENT_LIMITS.maxTreeDepth) {
          throw new DocumentInvariantError(`document tree is deeper than ${DOCUMENT_LIMITS.maxTreeDepth} levels`);
        }
        onPath.add(childId);
        stack.push([childId, 0]);
      } else {
        stack.pop();
        onPath.delete(frame[0]);
        visited.add(frame[0]);
      }
    }
  }

  if (visited.size !== nodeTotal) {
    const unreachable = Object.keys(nodes).filter((id) => !visited.has(id));
    const listed = unreachable.slice(0, 10).map(shown).join(", ");
    const more = unreachable.length > 10 ? ` (and ${unreachable.length - 10} more)` : "";
    throw new DocumentInvariantError(`Unreachable nodes: ${listed}${more}`);
  }

  return true;
}
