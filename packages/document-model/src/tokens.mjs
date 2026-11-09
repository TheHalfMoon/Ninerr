// Design tokens (ADR-0004, accepted 2026-11-09). Tokens, collections and modes are props of the
// one design-system node; a style binds a token by holding var(--name). This module reads them and
// builds the history operations that change them, so every change is one undoable transaction:
// a rename or a delete reaches every use in the same transaction, and never leaves a dangling
// reference. It compiles the tokens to the CSS the canvas and code export draw with; that CSS is
// never stored.
import { cssCode, cssValueProblem, designSystemProblem, tokenReferences } from "./schema-v2.mjs";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// One edit holds at most 5,000 operations (the studio host's MAX_OPERATIONS_PER_EDIT): the design
// system's own, and one per layer it rewrites.
export const MAX_REWRITTEN_LAYERS = 4_999;

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

/**
 * Every style value a node holds, with where it is: its inline style, its scoped stylesheet, an
 * instance's overrides and a component's variant overrides (schema v2).
 */
export function styleValuesOf(node) {
  const values = [];
  const style = (record, field) => {
    if (!isRecord(record)) return;
    for (const [property, value] of Object.entries(record)) if (typeof value === "string") values.push({ field: `${field}.${property}`, value });
  };
  style(node.props.style, "style");
  if (typeof node.props.stylesheet === "string") values.push({ field: "stylesheet", value: node.props.stylesheet });
  if (Array.isArray(node.props.overrides)) node.props.overrides.forEach((override, index) => style(override?.set?.style, `overrides.${index}.style`));
  if (Array.isArray(node.props.variants)) {
    node.props.variants.forEach((variant, index) => {
      if (Array.isArray(variant?.overrides)) variant.overrides.forEach((override, at) => style(override?.set?.style, `variants.${index}.overrides.${at}.style`));
    });
  }
  return values;
}

// A stylesheet may also declare the token itself (`--brand: red` on a layer, a local value): that
// is a use too, and is renamed with it.
const declares = (value, name) => new RegExp(`(?<![\\w-])${name}(?=\\s*:)`, "u").test(cssCode(value));
const uses = (value, name) => tokenReferences(value).includes(name) || declares(value, name);

/** Every node, and field, that uses `name`: the search for a token's uses. */
export function tokenUses(document, name) {
  const found = [];
  for (const [id, node] of Object.entries(document.nodes)) {
    if (node.type === "design-system") continue;
    const fields = styleValuesOf(node).filter(({ value }) => uses(value, name)).map(({ field }) => field);
    if (fields.length > 0) found.push({ nodeId: id, fields });
  }
  return found;
}

/**
 * `value` with each reference to `from` (and, in a stylesheet, each declaration of it) rewritten
 * by `replace(start, end)`, which returns the text for the span [start, end) of `value`. Matches
 * are found in the code alone (cssCode), so strings and comments are never touched.
 */
function rewriteReferences(value, from, { onReference, onDeclaration = null }) {
  const code = cssCode(value);
  const spans = [];
  const reference = /(?<![\w-])var\(\s*(--[A-Za-z0-9_-]{1,127})\s*(?=[,)])/giu;
  for (const match of code.matchAll(reference)) {
    if (match[1] !== from) continue;
    // The whole var( ... ) call, to its matching close bracket in the code.
    let depth = 1;
    let at = match.index + match[0].length;
    for (; at < code.length && depth > 0; at += 1) {
      if (code[at] === "(") depth += 1;
      else if (code[at] === ")") depth -= 1;
    }
    const nameStart = match.index + match[0].indexOf(from);
    spans.push({ start: match.index, end: at, nameStart, nameEnd: nameStart + from.length, kind: "reference" });
  }
  if (onDeclaration !== null) {
    for (const match of code.matchAll(new RegExp(`(?<![\\w(-])${from}(?=\\s*:)`, "gu"))) spans.push({ start: match.index, end: match.index + from.length, kind: "declaration" });
  }
  spans.sort((a, b) => a.start - b.start);
  let result = "";
  let index = 0;
  for (const span of spans) {
    if (span.start < index) continue; // inside a replaced call's fallback
    result += value.slice(index, span.start);
    result += span.kind === "reference" ? onReference(value, span) : onDeclaration(value, span);
    index = span.end;
  }
  return result + value.slice(index);
}

// Rename: only the name changes; a call's spacing, case and fallback stay as written.
const renameIn = (value, from, to) => (uses(value, from)
  ? rewriteReferences(value, from, {
    onReference: (text, span) => `${text.slice(span.start, span.nameStart)}${to}${text.slice(span.nameEnd, span.end)}`,
    onDeclaration: () => to,
  })
  : value);
// Delete: the whole var(--from, fallback) call becomes `replacement`.
const replaceIn = (value, from, replacement) => (tokenReferences(value).includes(from) ? rewriteReferences(value, from, { onReference: () => replacement }) : value);

/** The set-props operations that rewrite every use of `from` with `rewrite`, on each node that has one. */
function rewriteUses(document, from, rewrite) {
  const operations = [];
  for (const { nodeId } of tokenUses(document, from)) {
    const node = document.nodes[nodeId];
    const set = {};
    const styleOf = (record) => (isRecord(record) ? Object.fromEntries(Object.entries(record).map(([property, value]) => [property, typeof value === "string" ? rewrite(value) : value])) : record);
    const changed = (before, after) => JSON.stringify(before) !== JSON.stringify(after);
    if (isRecord(node.props.style)) {
      const style = styleOf(node.props.style);
      if (changed(style, node.props.style)) set.style = style;
    }
    if (typeof node.props.stylesheet === "string") {
      const sheet = rewrite(node.props.stylesheet);
      if (sheet !== node.props.stylesheet) set.stylesheet = sheet;
    }
    const overridden = (override) => (isRecord(override?.set?.style) ? { ...override, set: { ...override.set, style: styleOf(override.set.style) } } : override);
    if (Array.isArray(node.props.overrides)) {
      const overrides = node.props.overrides.map(overridden);
      if (changed(overrides, node.props.overrides)) set.overrides = overrides;
    }
    if (Array.isArray(node.props.variants)) {
      const variants = node.props.variants.map((variant) => (Array.isArray(variant?.overrides) ? { ...variant, overrides: variant.overrides.map(overridden) } : variant));
      if (changed(variants, node.props.variants)) set.variants = variants;
    }
    if (Object.keys(set).length > 0) operations.push({ type: "set-props", nodeId, set });
  }
  if (operations.length > MAX_REWRITTEN_LAYERS) {
    throw new Error(`${from} is used by ${operations.length} layers; one change can rewrite at most ${MAX_REWRITTEN_LAYERS}. Replace some uses first.`);
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

const requireSystem = (document) => {
  const system = designSystemOf(document);
  if (system === null) throw new Error("the document has no design system yet");
  return system;
};

/** Add a token. Refused when one of that name exists: its values are changed with setToken. */
export function addToken(document, { name, type, collection, values, description }) {
  const system = requireSystem(document);
  if (system.props.tokens.some((token) => token.name === name)) throw new Error(`${name} is already a token; change its values in its row`);
  return setToken(document, { name, type, collection, values, description });
}

/**
 * Add a token or change its type or values. `values` maps mode ids to CSS values; a value may be
 * another token's var(). One operation on the design system.
 */
export function setToken(document, { name, type, collection, values, description }) {
  const system = requireSystem(document);
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
 * names it) and each value on a layer that uses it. Its inverse restores them all.
 */
export function renameToken(document, from, to) {
  const system = requireSystem(document);
  if (!system.props.tokens.some((token) => token.name === from)) throw new Error(`${from} is not a token`);
  if (system.props.tokens.some((token) => token.name === to)) throw new Error(`${to} is already a token`);
  const tokens = system.props.tokens.map((token) => ({
    ...token,
    name: token.name === from ? to : token.name,
    values: Object.fromEntries(Object.entries(token.values).map(([mode, value]) => [mode, renameIn(value, from, to)])),
  }));
  return [withTokens(system, checked(system, { tokens }).tokens), ...rewriteUses(document, from, (value) => renameIn(value, from, to))];
}

/** The tokens `name` refers to, directly or through others. */
function referencedBy(system, name, seen = new Set()) {
  const token = system.props.tokens.find((entry) => entry.name === name);
  for (const value of Object.values(token?.values ?? {})) {
    for (const next of tokenReferences(value)) {
      if (!seen.has(next)) {
        seen.add(next);
        referencedBy(system, next, seen);
      }
    }
  }
  return seen;
}

/**
 * Delete a token. Its uses, and any alias to it, are replaced in the same transaction: with
 * another token (`{ token: "--name" }`) or with its own value (`{ literal: true }`). An alias in
 * the same collection takes the deleted token's value for each of its modes; a layer takes its
 * value in the default mode, the one a layer has unless it chose another. A token in use is never
 * deleted into a dangling reference.
 */
export function deleteToken(document, name, replacement) {
  const system = requireSystem(document);
  const token = system.props.tokens.find((entry) => entry.name === name);
  if (!token) throw new Error(`${name} is not a token`);
  const collection = system.props.collections.find((entry) => entry.id === token.collection);
  const defaultValue = token.values[collection.defaultMode] ?? Object.values(token.values)[0];
  const aliased = system.props.tokens.some((entry) => entry.name !== name && Object.values(entry.values).some((value) => tokenReferences(value).includes(name)));
  let forLayers;
  let forMode;
  if (replacement?.token !== undefined) {
    if (replacement.token === name || !system.props.tokens.some((entry) => entry.name === replacement.token)) throw new Error(`${replacement.token} is not another token`);
    if (referencedBy(system, replacement.token).has(name)) throw new Error(`${replacement.token} itself refers to ${name}; choose another token, or its value`);
    forLayers = `var(${replacement.token})`;
    forMode = () => forLayers;
  } else if (replacement?.literal === true) {
    forLayers = defaultValue;
    forMode = (entry, mode) => (entry.collection === token.collection ? token.values[mode] ?? defaultValue : defaultValue);
  } else {
    if (tokenUses(document, name).length > 0 || aliased) throw new Error(`${name} is in use: choose another token or its value to put in its place`);
    forLayers = null;
  }
  const tokens = system.props.tokens
    .filter((entry) => entry.name !== name)
    .map((entry) => (forLayers === null ? entry : { ...entry, values: Object.fromEntries(Object.entries(entry.values).map(([mode, value]) => [mode, replaceIn(value, name, forMode(entry, mode))])) }));
  return [withTokens(system, checked(system, { tokens }).tokens), ...(forLayers === null ? [] : rewriteUses(document, name, (value) => replaceIn(value, name, forLayers)))];
}

/** Add a mode to a collection; each token in it takes its default mode's value until changed. */
export function addMode(document, collectionId, { id, name }) {
  const system = requireSystem(document);
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
  const system = requireSystem(document);
  const collections = [...system.props.collections, { id, name, modes: [{ id: modeId, name: modeName }], defaultMode: modeId }];
  checked(system, { collections });
  return [{ type: "set-props", nodeId: system.id, set: { collections } }];
}

/**
 * The CSS the tokens compile to: each token's default-mode value on :root, and each other mode's
 * values under [data-ninerr-mode~="collection:mode"], which a layer carries to take that mode.
 *
 * A custom property's var() is resolved where it is declared, so an alias declared only on :root
 * would keep its default value in every mode. Under each mode's selector, every token that refers
 * (directly or through others) to a token the mode changes is declared again with the value it
 * has there, so `--button: var(--brand)` follows `--brand` into Dark.
 */
export function compileTokens(document) {
  const system = designSystemOf(document);
  if (system === null || system.props.tokens.length === 0) return "";
  const collections = new Map(system.props.collections.map((collection) => [collection.id, collection]));
  const own = (values, mode) => (Object.hasOwn(values, mode) ? values[mode] : undefined);
  const defaultValue = (token) => {
    const collection = collections.get(token.collection);
    return collection ? own(token.values, collection.defaultMode) : undefined;
  };
  // Who refers to whom, by each token's default-mode value: the value it has wherever its own
  // collection is in its default mode.
  const dependents = new Map();
  for (const token of system.props.tokens) {
    const value = defaultValue(token);
    for (const name of tokenReferences(value)) {
      if (!dependents.has(name)) dependents.set(name, []);
      dependents.get(name).push(token);
    }
  }
  const lines = (entries) => entries.map(([name, value]) => `  ${name}: ${value};`).join("\n");
  const blocks = [];
  const root = system.props.tokens.map((token) => [token.name, defaultValue(token)]).filter(([, value]) => value !== undefined);
  if (root.length > 0) blocks.push(`:root {\n${lines(root)}\n}`);
  for (const collection of system.props.collections) {
    for (const mode of collection.modes) {
      if (mode.id === collection.defaultMode) continue;
      const declared = new Map();
      for (const token of system.props.tokens) {
        if (token.collection === collection.id && own(token.values, mode.id) !== undefined) declared.set(token.name, own(token.values, mode.id));
      }
      // Every alias of a token this mode declares follows it into the mode.
      const queue = [...declared.keys()];
      while (queue.length > 0) {
        for (const dependent of dependents.get(queue.shift()) ?? []) {
          if (declared.has(dependent.name)) continue;
          const value = dependent.collection === collection.id && own(dependent.values, mode.id) !== undefined ? own(dependent.values, mode.id) : defaultValue(dependent);
          if (value === undefined) continue;
          declared.set(dependent.name, value);
          queue.push(dependent.name);
        }
      }
      if (declared.size > 0) blocks.push(`[data-ninerr-mode~="${collection.id}:${mode.id}"] {\n${lines([...declared])}\n}`);
    }
  }
  return blocks.join("\n");
}

/** A layer's modes as its data-ninerr-mode attribute: "collection:mode ...", from props.modes. */
export const MODE_REFERENCE = /^[A-Za-z0-9_.-]{1,128}$/u;
export function modeAttribute(props) {
  if (!isRecord(props?.modes)) return null;
  const parts = Object.entries(props.modes).filter(([collection, mode]) => MODE_REFERENCE.test(collection) && typeof mode === "string" && MODE_REFERENCE.test(mode)).map(([collection, mode]) => `${collection}:${mode}`);
  return parts.length === 0 ? null : parts.sort().join(" ");
}
