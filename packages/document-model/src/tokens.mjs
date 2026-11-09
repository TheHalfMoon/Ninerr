// Design tokens (ADR-0004, accepted 2026-11-09). Tokens, collections and modes are props of the
// one design-system node; a style binds a token by holding var(--name). This module reads them and
// builds the history operations that change them, so every change is one undoable transaction:
// a rename or a delete reaches every use in the same transaction, and never leaves a dangling
// reference. It compiles the tokens to the CSS the canvas and code export draw with; that CSS is
// never stored.
import { cssValueProblem, designSystemProblem, tokenReferences } from "./schema-v2.mjs";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** The document's design-system node, or null. */
export function designSystemOf(document) {
  for (const id of document.rootIds) {
    const node = document.nodes[id];
    if (node?.type === "design-system") return node;
  }
  return null;
}

/** A design system's starting props: one collection with one mode. */
export function newDesignSystemProps(name = "Design system") {
  return { name, collections: [{ id: "base", name: "Base", modes: [{ id: "default", name: "Default" }], defaultMode: "default" }], tokens: [] };
}

/** The operation that adds a design system to a document that has none. */
export function createDesignSystem(document, { id, name } = {}) {
  if (designSystemOf(document) !== null) throw new Error("the document already has a design system");
  if (typeof id !== "string" || id === "" || Object.hasOwn(document.nodes, id)) throw new Error("a new design system needs an unused id");
  return [{ type: "insert-node", parentId: null, index: document.rootIds.length, node: { id, type: "design-system", props: newDesignSystemProps(name) } }];
}

// Style-bearing props: a node's inline style values, and its scoped stylesheet's text.
function usesIn(node, name) {
  const style = isRecord(node.props.style) ? node.props.style : {};
  const fields = [];
  for (const [property, value] of Object.entries(style)) {
    if (tokenReferences(value).includes(name)) fields.push(`style.${property}`);
  }
  if (typeof node.props.stylesheet === "string" && tokenReferences(node.props.stylesheet).includes(name)) fields.push("stylesheet");
  return fields;
}

/** Every node, and field, that binds `name`: the search for a token's uses. */
export function tokenUses(document, name) {
  const uses = [];
  for (const [id, node] of Object.entries(document.nodes)) {
    if (node.type === "design-system") continue;
    const fields = usesIn(node, name);
    if (fields.length > 0) uses.push({ nodeId: id, fields });
  }
  return uses;
}

// var(--old) and VAR( --old ) and var(--old, fallback), as whole references outside strings.
function renameIn(value, from, to) {
  if (typeof value !== "string" || !tokenReferences(value).includes(from)) return value;
  let result = "";
  let index = 0;
  const pattern = /("[^"]*"|'[^']*')|(?<![\w-])(var\(\s*)(--[A-Za-z0-9_-]{1,127})(?=\s*[,)])/giu;
  for (const match of value.matchAll(pattern)) {
    result += value.slice(index, match.index);
    result += match[1] !== undefined ? match[1] : match[3] === from ? `${match[2]}${to}` : match[0];
    index = match.index + match[0].length;
  }
  return result + value.slice(index);
}

// A value with every reference to `from` replaced by `replacement` (another var(), or a literal).
function replaceIn(value, from, replacement) {
  if (typeof value !== "string" || !tokenReferences(value).includes(from)) return value;
  // A whole var(--from) or var(--from, fallback) is replaced; the fallback goes with it.
  let result = "";
  let index = 0;
  const pattern = /("[^"]*"|'[^']*')|(?<![\w-])var\(\s*(--[A-Za-z0-9_-]{1,127})\s*(?=[,)])/giu;
  for (const match of value.matchAll(pattern)) {
    result += value.slice(index, match.index);
    if (match[1] !== undefined || match[2] !== from) {
      result += match[0];
      index = match.index + match[0].length;
      continue;
    }
    // Skip to the matching close bracket of this var( call.
    let depth = 1;
    let at = match.index + match[0].length;
    let quote = null;
    for (; at < value.length && depth > 0; at += 1) {
      const character = value[at];
      if (quote !== null) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === "(") depth += 1;
      else if (character === ")") depth -= 1;
    }
    result += replacement;
    index = at;
  }
  return result + value.slice(index);
}

/** The set-props operations that rewrite every use of `from` with `rewrite` on the nodes that bind it. */
function rewriteUses(document, from, rewrite) {
  const operations = [];
  for (const { nodeId } of tokenUses(document, from)) {
    const node = document.nodes[nodeId];
    const set = {};
    if (isRecord(node.props.style)) {
      const style = Object.fromEntries(Object.entries(node.props.style).map(([property, value]) => [property, rewrite(value)]));
      if (JSON.stringify(style) !== JSON.stringify(node.props.style)) set.style = style;
    }
    if (typeof node.props.stylesheet === "string") {
      const sheet = rewrite(node.props.stylesheet);
      if (sheet !== node.props.stylesheet) set.stylesheet = sheet;
    }
    if (Object.keys(set).length > 0) operations.push({ type: "set-props", nodeId, set });
  }
  return operations;
}

const withTokens = (system, tokens) => ({ type: "set-props", nodeId: system.id, set: { tokens } });

/** Check the props a change would give the design system, and say what is wrong in the person's terms. */
function checked(system, props) {
  const problem = designSystemProblem({ ...system.props, ...props });
  if (problem !== null) throw new Error(problem);
  return props;
}

/**
 * Add a token or change its type or values. `values` maps mode ids to CSS values; a value may be
 * another token's var(). One operation on the design system.
 */
export function setToken(document, { name, type, collection, values, description }) {
  const system = designSystemOf(document);
  if (system === null) throw new Error("the document has no design system yet");
  for (const value of Object.values(values ?? {})) {
    const problem = cssValueProblem(value);
    if (problem) throw new Error(`${name}: ${problem}`);
  }
  const existing = system.props.tokens.find((token) => token.name === name);
  const token = { ...(existing ?? {}), name, type: type ?? existing?.type, collection: collection ?? existing?.collection, values: { ...(existing?.values ?? {}), ...values } };
  if (description !== undefined) token.description = description;
  const tokens = existing ? system.props.tokens.map((entry) => (entry.name === name ? token : entry)) : [...system.props.tokens, token];
  return [withTokens(system, checked(system, { tokens }).tokens)];
}

/**
 * Rename a token, and every use of it, in one transaction: the design system (with any alias that
 * names it) and each bound style value. Its inverse restores them all.
 */
export function renameToken(document, from, to) {
  const system = designSystemOf(document);
  if (system === null) throw new Error("the document has no design system yet");
  if (!system.props.tokens.some((token) => token.name === from)) throw new Error(`${from} is not a token`);
  if (system.props.tokens.some((token) => token.name === to)) throw new Error(`${to} is already a token`);
  const tokens = system.props.tokens.map((token) => ({
    ...token,
    name: token.name === from ? to : token.name,
    values: Object.fromEntries(Object.entries(token.values).map(([mode, value]) => [mode, renameIn(value, from, to)])),
  }));
  return [withTokens(system, checked(system, { tokens }).tokens), ...rewriteUses(document, from, (value) => renameIn(value, from, to))];
}

/**
 * Delete a token. Its uses, and any alias to it, are replaced in the same transaction: with
 * another token (`{ token: "--name" }`) or with its own value in its collection's default mode
 * (`{ literal: true }`). A token in use is never deleted into a dangling reference.
 */
export function deleteToken(document, name, replacement) {
  const system = designSystemOf(document);
  if (system === null) throw new Error("the document has no design system yet");
  const token = system.props.tokens.find((entry) => entry.name === name);
  if (!token) throw new Error(`${name} is not a token`);
  let with_;
  if (replacement?.token !== undefined) {
    if (replacement.token === name || !system.props.tokens.some((entry) => entry.name === replacement.token)) throw new Error(`${replacement.token} is not another token`);
    with_ = `var(${replacement.token})`;
  } else if (replacement?.literal === true) {
    const collection = system.props.collections.find((entry) => entry.id === token.collection);
    with_ = token.values[collection.defaultMode] ?? Object.values(token.values)[0];
  } else {
    const aliased = system.props.tokens.some((entry) => entry.name !== name && Object.values(entry.values).some((value) => tokenReferences(value).includes(name)));
    if (tokenUses(document, name).length > 0 || aliased) throw new Error(`${name} is in use: choose another token or its value to put in its place`);
    with_ = null;
  }
  const rewrite = (value) => (with_ === null ? value : replaceIn(value, name, with_));
  const tokens = system.props.tokens
    .filter((entry) => entry.name !== name)
    .map((entry) => ({ ...entry, values: Object.fromEntries(Object.entries(entry.values).map(([mode, value]) => [mode, rewrite(value)])) }));
  return [withTokens(system, checked(system, { tokens }).tokens), ...(with_ === null ? [] : rewriteUses(document, name, rewrite))];
}

/** Add a mode to a collection; each token in it takes its default mode's value until changed. */
export function addMode(document, collectionId, { id, name }) {
  const system = designSystemOf(document);
  if (system === null) throw new Error("the document has no design system yet");
  const collection = system.props.collections.find((entry) => entry.id === collectionId);
  if (!collection) throw new Error(`${collectionId} is not a collection`);
  const collections = system.props.collections.map((entry) => (entry.id === collectionId ? { ...entry, modes: [...entry.modes, { id, name }] } : entry));
  const tokens = system.props.tokens.map((token) => (token.collection === collectionId && token.values[collection.defaultMode] !== undefined
    ? { ...token, values: { ...token.values, [id]: token.values[collection.defaultMode] } }
    : token));
  checked(system, { collections, tokens });
  return [{ type: "set-props", nodeId: system.id, set: { collections, tokens } }];
}

/** Add a collection with one mode. */
export function addCollection(document, { id, name, modeId = "default", modeName = "Default" }) {
  const system = designSystemOf(document);
  if (system === null) throw new Error("the document has no design system yet");
  const collections = [...system.props.collections, { id, name, modes: [{ id: modeId, name: modeName }], defaultMode: modeId }];
  checked(system, { collections });
  return [{ type: "set-props", nodeId: system.id, set: { collections } }];
}

/**
 * The CSS the tokens compile to: each token's default-mode value on :root, and each other mode's
 * values under [data-ninerr-mode~="collection:mode"], which a frame carries to take that mode.
 * Every value was checked as one balanced CSS value, and names as custom property names.
 */
export function compileTokens(document) {
  const system = designSystemOf(document);
  if (system === null || system.props.tokens.length === 0) return "";
  const rules = new Map([[":root", []]]);
  const collections = new Map(system.props.collections.map((collection) => [collection.id, collection]));
  for (const token of system.props.tokens) {
    const collection = collections.get(token.collection);
    if (!collection) continue;
    for (const [mode, value] of Object.entries(token.values)) {
      const selector = mode === collection.defaultMode ? ":root" : `[data-ninerr-mode~="${collection.id}:${mode}"]`;
      if (!rules.has(selector)) rules.set(selector, []);
      rules.get(selector).push(`  ${token.name}: ${value};`);
    }
  }
  return [...rules].filter(([, lines]) => lines.length > 0).map(([selector, lines]) => `${selector} {\n${lines.join("\n")}\n}`).join("\n");
}

/** A frame's modes as its data-ninerr-mode attribute: "collection:mode ...", from props.modes. */
export const MODE_REFERENCE = /^[A-Za-z0-9_.:-]{1,128}$/u;
export function modeAttribute(props) {
  if (!isRecord(props?.modes)) return null;
  const parts = Object.entries(props.modes).filter(([collection, mode]) => MODE_REFERENCE.test(collection) && typeof mode === "string" && MODE_REFERENCE.test(mode) && !collection.includes(":") && !mode.includes(":")).map(([collection, mode]) => `${collection}:${mode}`);
  return parts.length === 0 ? null : parts.sort().join(" ");
}
