// Document schema v2 (ADR-0003, accepted 2026-11-09): design tokens live on one `design-system`
// node (ADR-0004), and a `component-instance` stores only its component, property values and
// overrides, expanded when drawn (ADR-0005). A document is v2 exactly when it holds a v2 node, so
// a project stays v1, and older builds keep opening it, until its first v2 node, and goes back to
// v1 if that node is undone.

export const V2_NODE_TYPES = Object.freeze(["design-system", "component-definition", "component-instance"]);
const V2_TYPE_SET = new Set(V2_NODE_TYPES);

export const TOKEN_TYPES = Object.freeze([
  "color", "spacing", "radius", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "opacity", "shadow", "breakpoint",
]);
const TOKEN_TYPE_SET = new Set(TOKEN_TYPES);
export const PROPERTY_KINDS = Object.freeze(["boolean", "text", "variant", "instance-swap", "slot"]);
const PROPERTY_KIND_SET = new Set(PROPERTY_KINDS);
export const PROPERTY_FIELDS = Object.freeze(["visible", "text", "attributes.class", "style", "children"]);
const PROPERTY_FIELD_SET = new Set(PROPERTY_FIELDS);

// Proposed in ARCHITECTURE.md §2.2 and held here; the scale suite measures them.
export const SCHEMA_V2_LIMITS = Object.freeze({
  tokens: 5_000,
  collections: 64,
  modesPerCollection: 32,
  definitions: 2_000,
  instances: 10_000,
  overridesPerInstance: 500,
  propertiesPerDefinition: 200,
  variantsPerDefinition: 500,
  textLength: 2_000,
  valueLength: 1_024,
});

export const TOKEN_NAME = /^--[A-Za-z0-9_-]{1,127}$/u;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/u;
// A collection's or mode's id is half of a "collection:mode" pair in a layer's data-ninerr-mode and
// the compiled sheet's selectors, so it holds no colon.
export const MODE_ID = /^[A-Za-z0-9_.-]{1,128}$/u;
// The compiled token sheet must stay well under the renderer's 2 MiB stylesheet limit, aliases
// re-emitted per mode included.
const MAX_TOKEN_TEXT = 512 * 1024;

/**
 * `text` with every comment and string character, and every escaped character, replaced by a
 * space (a string keeps its quotes), so the result has the same length and only code is left
 * readable: references, brackets and declarations are found where the browser would find them.
 */
export function cssCode(text) {
  const out = [];
  let index = 0;
  while (index < text.length) {
    if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (; index < stop; index += 1) out.push(" ");
      continue;
    }
    const character = text[index];
    if (character === '"' || character === "'") {
      out.push(character);
      index += 1;
      while (index < text.length && text[index] !== character && text[index] !== "\n") {
        const width = text[index] === "\\" ? 2 : 1;
        for (let step = 0; step < width && index < text.length; step += 1, index += 1) out.push(" ");
      }
      if (index < text.length && text[index] === character) {
        out.push(character);
        index += 1;
      }
      continue;
    }
    if (character === "\\") {
      out.push(" ");
      index += 1;
      if (index < text.length) {
        out.push(" ");
        index += 1;
      }
      continue;
    }
    out.push(character);
    index += 1;
  }
  return out.join("");
}

/** Whether a node of this type takes part in schema v2's checks (design systems and components). */
export const isV2Type = (type) => V2_TYPE_SET.has(type);

// `component-definition` was already a schema 1 type, with props of any shape: one needs schema 2
// only once it has schema 2's properties or variants, so a schema 1 project holding one opens as
// it did.
const hasV2Props = (props) => props !== null && typeof props === "object" && (Object.hasOwn(props, "properties") || Object.hasOwn(props, "variants"));

/** Whether this node needs schema 2. */
export function requiresSchemaV2(node) {
  if (node?.type === "design-system" || node?.type === "component-instance") return true;
  return node?.type === "component-definition" && hasV2Props(node.props);
}

/** The schema version a document's nodes need: 2 when any node needs it, else 1. */
export function schemaVersionFor(nodes) {
  for (const id in nodes) {
    if (Object.hasOwn(nodes, id) && requiresSchemaV2(nodes[id])) return 2;
  }
  return 1;
}

// Functions that load or read something from outside the value: never in a token.
const LOADING_FUNCTION = /(?:^|[^\w-])(?:url|src|image-set|-webkit-image-set|image|cross-fade|element|paint|expression|attr|env)\s*\(/iu;

/**
 * Why a value cannot be a token's, or null. A token value becomes one declaration in a compiled
 * `:root` sheet, so it must be one balanced CSS value: no character that ends or opens a
 * declaration, block, comment or rule, no escape, no function that loads or reads anything, and
 * brackets and quotes that close, or the rest of the sheet would be swallowed.
 */
export function cssValueProblem(value) {
  if (typeof value !== "string" || value.trim() === "" || value.length > SCHEMA_V2_LIMITS.valueLength) return "it is not one CSS value";
  if (/[\u0000-\u001f\u007f\\;{}<>@!]/u.test(value)) return "it holds a character a CSS value cannot";
  if (value.includes("/*") || value.includes("*/")) return "it holds a comment";
  if (LOADING_FUNCTION.test(value)) return "it loads or reads something from outside the value";
  // Whatever the renderer's stylesheet check refuses, so one value never blanks the whole sheet.
  if (/javascript:|vbscript:|behavior\s*:|-moz-binding/iu.test(value)) return "it holds a scheme or binding a stylesheet never may";
  let depth = 0;
  let quote = null;
  for (const character of value) {
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth < 0) return "its brackets do not balance";
    }
  }
  if (quote !== null) return "it has a string that does not close";
  if (depth !== 0) return "its brackets do not balance";
  return null;
}

/**
 * The token names a CSS value binds, in order: every `var(--name)` anywhere in it, inside
 * calc() or with a fallback. The host and the renderer read bindings with this one function.
 */
export function tokenReferences(value) {
  if (typeof value !== "string") return [];
  const names = [];
  // Only code is read: a string's or a comment's text is not a reference (a font named
  // 'var(--x)', a comment with an apostrophe); var is matched in any case, as CSS matches it,
  // and only as a whole word (not myvar()).
  const pattern = /(?<![\w-])var\(\s*(--[A-Za-z0-9_-]{1,127})\s*[,)]/giu;
  for (const match of cssCode(value).matchAll(pattern)) names.push(match[1]);
  return names;
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max = SCHEMA_V2_LIMITS.textLength) => typeof value === "string" && value.length > 0 && value.length <= max;
const shown = (value) => {
  const string = String(value);
  return string.length > 60 ? `${string.slice(0, 57)}...` : string;
};

/** Why a design-system node's props are invalid, or null. Alias cycles are named. */
export function designSystemProblem(props) {
  if (!isRecord(props)) return "its props are not an object";
  if (!text(props.name, 200)) return "it needs a name";
  if (!Array.isArray(props.collections) || props.collections.length === 0 || props.collections.length > SCHEMA_V2_LIMITS.collections) {
    return `it needs 1 to ${SCHEMA_V2_LIMITS.collections} collections`;
  }
  const collections = new Map();
  for (const collection of props.collections) {
    if (!isRecord(collection) || typeof collection.id !== "string" || !MODE_ID.test(collection.id)) return "a collection needs an id of letters, digits and . _ -";
    if (collection.id in Object.prototype) return `${shown(collection.id)} is a name a collection cannot have`;
    if (collections.has(collection.id)) return `collection ${shown(collection.id)} is listed twice`;
    if (!text(collection.name, 200)) return `collection ${shown(collection.id)} needs a name`;
    if (!Array.isArray(collection.modes) || collection.modes.length === 0 || collection.modes.length > SCHEMA_V2_LIMITS.modesPerCollection) {
      return `collection ${shown(collection.id)} needs 1 to ${SCHEMA_V2_LIMITS.modesPerCollection} modes`;
    }
    const modes = new Set();
    for (const mode of collection.modes) {
      if (!isRecord(mode) || typeof mode.id !== "string" || !MODE_ID.test(mode.id)) return `a mode of ${shown(collection.id)} needs an id of letters, digits and . _ -`;
      if (mode.id in Object.prototype) return `${shown(mode.id)} is a name a mode cannot have`;
      if (modes.has(mode.id)) return `mode ${shown(mode.id)} is listed twice in ${shown(collection.id)}`;
      if (!text(mode.name, 200)) return `mode ${shown(mode.id)} needs a name`;
      modes.add(mode.id);
    }
    if (!modes.has(collection.defaultMode)) return `collection ${shown(collection.id)}'s default mode is not one of its modes`;
    collections.set(collection.id, modes);
  }
  if (!Array.isArray(props.tokens) || props.tokens.length > SCHEMA_V2_LIMITS.tokens) return `it may hold at most ${SCHEMA_V2_LIMITS.tokens} tokens`;
  const tokens = new Map();
  let textSize = 0;
  for (const token of props.tokens) {
    if (!isRecord(token) || typeof token.name !== "string" || !TOKEN_NAME.test(token.name)) return "a token needs a CSS custom property name such as --brand-500";
    if (tokens.has(token.name)) return `token ${token.name} is defined twice`;
    if (!TOKEN_TYPE_SET.has(token.type)) return `token ${token.name} has an unknown type`;
    const modes = collections.get(token.collection);
    if (modes === undefined) return `token ${token.name} names a collection that does not exist`;
    if (!isRecord(token.values) || Object.keys(token.values).length === 0) return `token ${token.name} has no values`;
    for (const [mode, value] of Object.entries(token.values)) {
      if (!modes.has(mode)) return `token ${token.name} has a value for ${shown(mode)}, which is not a mode of its collection`;
      const problem = cssValueProblem(value);
      if (problem) return `token ${token.name} has a value that is not one CSS value: ${problem}`;
      textSize += token.name.length + value.length + 8;
    }
    if (textSize > MAX_TOKEN_TEXT) return `the tokens would compile to more than ${MAX_TOKEN_TEXT / 1024} KiB of CSS`;
    if (token.description !== undefined && (typeof token.description !== "string" || token.description.length > SCHEMA_V2_LIMITS.textLength)) {
      return `token ${token.name}'s description is too long`;
    }
    tokens.set(token.name, token);
  }
  // Every alias resolves, and none loops back to itself.
  for (const token of tokens.values()) {
    for (const value of Object.values(token.values)) {
      for (const name of tokenReferences(value)) {
        if (!tokens.has(name)) return `token ${token.name} refers to ${name}, which is not a token`;
      }
    }
  }
  const state = new Map();
  const visit = (name, trail) => {
    state.set(name, "visiting");
    trail.push(name);
    for (const value of Object.values(tokens.get(name).values)) {
      for (const next of tokenReferences(value)) {
        if (state.get(next) === "visiting") return `the tokens ${[...trail.slice(trail.indexOf(next)), next].join(" -> ")} refer to each other in a cycle`;
        if (state.get(next) !== "done") {
          const problem = visit(next, trail);
          if (problem) return problem;
        }
      }
    }
    trail.pop();
    state.set(name, "done");
    return null;
  };
  for (const name of tokens.keys()) {
    if (state.get(name) === undefined) {
      const problem = visit(name, []);
      if (problem) return problem;
    }
  }
  return null;
}

function overrideProblem(override) {
  if (!isRecord(override)) return "an override is not an object";
  if (!Array.isArray(override.path) || override.path.length > 64 || override.path.some((id) => typeof id !== "string" || id.length === 0 || id.length > 512)) {
    return "an override's path must be a list of instance ids";
  }
  if (typeof override.nodeId !== "string" || override.nodeId.length === 0 || override.nodeId.length > 512) return "an override needs a node id";
  if (!isRecord(override.set)) return "an override needs what it sets";
  for (const key of Object.keys(override.set)) {
    if (!["text", "style", "attributes", "visible"].includes(key)) return `an override cannot set ${shown(key)}`;
  }
  if (override.set.text !== undefined && typeof override.set.text !== "string") return "an override's text must be text";
  if (override.set.visible !== undefined && typeof override.set.visible !== "boolean") return "an override's visibility must be true or false";
  for (const key of ["style", "attributes"]) {
    const record = override.set[key];
    if (record === undefined) continue;
    if (!isRecord(record) || Object.values(record).some((value) => typeof value !== "string")) return `an override's ${key} must map names to text`;
  }
  return null;
}

/** Why a component-definition node's props are invalid, or null. */
export function definitionProblem(props) {
  if (!isRecord(props)) return "its props are not an object";
  // A schema 1 component-definition, with no schema 2 properties or variants, is kept as it was.
  if (!hasV2Props(props)) return null;
  if (!text(props.name, 200)) return "it needs a name";
  const properties = props.properties ?? [];
  if (!Array.isArray(properties) || properties.length > SCHEMA_V2_LIMITS.propertiesPerDefinition) return `it may have at most ${SCHEMA_V2_LIMITS.propertiesPerDefinition} properties`;
  const ids = new Set();
  const names = new Set();
  for (const property of properties) {
    if (!isRecord(property) || typeof property.id !== "string" || !ID.test(property.id)) return "a property needs an id of letters, digits and . _ : -";
    if (ids.has(property.id)) return `property ${shown(property.id)} is listed twice`;
    if (!text(property.name, 200)) return `property ${shown(property.id)} needs a name`;
    if (names.has(property.name)) return `two properties are named ${shown(property.name)}`;
    if (!PROPERTY_KIND_SET.has(property.kind)) return `property ${shown(property.id)} has an unknown kind`;
    if (property.kind === "boolean" ? typeof property.default !== "boolean" : typeof property.default !== "string") return `property ${shown(property.id)}'s default does not match its kind`;
    if (property.kind === "variant") {
      if (!Array.isArray(property.options) || property.options.length === 0 || property.options.length > 64 || property.options.some((option) => !text(option, 200))) return `variant property ${shown(property.id)} needs its options`;
      if (new Set(property.options).size !== property.options.length) return `variant property ${shown(property.id)} lists an option twice`;
      if (!property.options.includes(property.default)) return `variant property ${shown(property.id)}'s default is not one of its options`;
    } else if (property.options !== undefined) return `only a variant property has options`;
    if (!isRecord(property.target) || typeof property.target.nodeId !== "string" || property.target.nodeId.length === 0 || !PROPERTY_FIELD_SET.has(property.target.field)) {
      return `property ${shown(property.id)} needs a target node and field`;
    }
    // An instance swap chooses the component a nested instance draws; a slot, a component drawn in
    // a layer in place of its own children. Both set what their target draws: its children.
    if ((property.kind === "instance-swap" || property.kind === "slot") && property.target.field !== "children") return `${property.kind} property ${shown(property.id)} sets its target's children`;
    ids.add(property.id);
    names.add(property.name);
  }
  if (props.variants !== undefined) {
    if (!Array.isArray(props.variants) || props.variants.length > SCHEMA_V2_LIMITS.variantsPerDefinition) return `it may have at most ${SCHEMA_V2_LIMITS.variantsPerDefinition} variants`;
    for (const variant of props.variants) {
      if (!isRecord(variant) || !isRecord(variant.values) || !Array.isArray(variant.overrides)) return "a variant needs its values and overrides";
      for (const [id, value] of Object.entries(variant.values)) {
        const property = properties.find((candidate) => candidate.id === id);
        if (!property || property.kind !== "variant" || !property.options.includes(value)) return `a variant sets ${shown(id)} to a value it does not offer`;
      }
      for (const override of variant.overrides) {
        const problem = overrideProblem(override);
        if (problem) return problem;
      }
    }
  }
  return null;
}

/** Why a component-instance node's own props are invalid, or null (references are checked apart). */
export function instanceProblem(props) {
  if (!isRecord(props)) return "its props are not an object";
  if (typeof props.componentId !== "string" || props.componentId.length === 0 || props.componentId.length > 512) return "it needs the id of its component";
  if (props.propertyValues !== undefined && (!isRecord(props.propertyValues) || Object.values(props.propertyValues).some((value) => typeof value !== "string" && typeof value !== "boolean"))) {
    return "its property values must be text or true or false";
  }
  const overrides = props.overrides ?? [];
  if (!Array.isArray(overrides) || overrides.length > SCHEMA_V2_LIMITS.overridesPerInstance) return `it may have at most ${SCHEMA_V2_LIMITS.overridesPerInstance} overrides`;
  for (const override of overrides) {
    const problem = overrideProblem(override);
    if (problem) return problem;
  }
  if (props.style !== undefined && (!isRecord(props.style) || Object.values(props.style).some((value) => typeof value !== "string"))) return "its style must map properties to text";
  return null;
}

/** The node's own v2 problem: its props, and its place (a design system is a root with no children; an instance has none). */
export function v2NodeProblem(node) {
  switch (node.type) {
    case "design-system":
      if (node.parentId !== null) return "a design system is a root node";
      if (node.children.length > 0) return "a design system has no children";
      return designSystemProblem(node.props);
    case "component-definition":
      return definitionProblem(node.props);
    case "component-instance":
      if (node.children.length > 0) return "an instance stores no children; its component's are drawn";
      return instanceProblem(node.props);
    default:
      return null;
  }
}

/**
 * Whether any component contains an instance of itself, directly or through other components;
 * the cycle is named. `nodes` is the document's node record.
 */
export function componentCycle(nodes) {
  const own = (id) => (typeof id === "string" && Object.hasOwn(nodes, id) ? nodes[id] : undefined);
  // For each definition, the definitions its subtree instances.
  const uses = new Map();
  const usesOf = (definitionId) => {
    if (uses.has(definitionId)) return uses.get(definitionId);
    const found = new Set();
    const stack = [...(own(definitionId)?.children ?? [])];
    while (stack.length > 0) {
      const node = own(stack.pop());
      if (!node) continue;
      if (node.type === "component-instance") found.add(node.props.componentId);
      stack.push(...node.children);
    }
    uses.set(definitionId, found);
    return found;
  };
  const state = new Map();
  const visit = (id, trail) => {
    state.set(id, "visiting");
    trail.push(id);
    for (const next of usesOf(id)) {
      if (state.get(next) === "visiting") return `component ${[...trail.slice(trail.indexOf(next)), next].map(shown).join(" -> ")} contains an instance of itself`;
      if (state.get(next) === undefined && own(next)?.type === "component-definition") {
        const problem = visit(next, trail);
        if (problem) return problem;
      }
    }
    trail.pop();
    state.set(id, "done");
    return null;
  };
  for (const id in nodes) {
    if (Object.hasOwn(nodes, id) && nodes[id].type === "component-definition" && state.get(id) === undefined) {
      const problem = visit(id, []);
      if (problem) return problem;
    }
  }
  return null;
}

/** The v2 problems of a whole document, or null: version, counts, every v2 node and reference. */
export function v2DocumentProblem(document) {
  const nodes = document.nodes;
  const needed = schemaVersionFor(nodes);
  if (document.schemaVersion !== needed) {
    return needed === 2 ? "holds schema v2 nodes but says it is schema 1" : "says it is schema 2 but holds no schema v2 node";
  }
  if (needed === 1) return null;
  let designSystems = 0;
  let definitions = 0;
  let instances = 0;
  for (const id in nodes) {
    if (!Object.hasOwn(nodes, id)) continue;
    const node = nodes[id];
    if (!V2_TYPE_SET.has(node.type)) continue;
    if (node.type === "design-system") designSystems += 1;
    if (node.type === "component-definition") definitions += 1;
    if (node.type === "component-instance") instances += 1;
    const problem = v2NodeProblem(node) ?? referenceProblem(nodes, node) ?? targetProblem(nodes, node);
    if (problem) return `node ${shown(id)}: ${problem}`;
  }
  if (designSystems > 1) return "a document has at most one design system";
  if (definitions > SCHEMA_V2_LIMITS.definitions) return `a document has at most ${SCHEMA_V2_LIMITS.definitions} components`;
  if (instances > SCHEMA_V2_LIMITS.instances) return `a document has at most ${SCHEMA_V2_LIMITS.instances} instances`;
  return componentCycle(nodes);
}

/** Whether `id` is `ancestorId` or lies inside it. */
function within(nodes, id, ancestorId) {
  let current = Object.hasOwn(nodes, id) ? nodes[id] : undefined;
  for (let steps = 0; current !== undefined && steps <= 1_100; steps += 1) {
    if (current.id === ancestorId) return true;
    current = current.parentId === null ? undefined : nodes[current.parentId];
  }
  return false;
}

/**
 * A definition's properties and variant overrides name its own nodes. A target that no longer
 * exists is stale, kept and reported elsewhere; one that exists outside the definition (a copy
 * that still names the original's children) is refused.
 */
function targetProblem(nodes, node) {
  if (node.type !== "component-definition" || !hasV2Props(node.props)) return null;
  const inside = (id) => !Object.hasOwn(nodes, id) || within(nodes, id, node.id);
  for (const property of node.props.properties ?? []) {
    if (!inside(property.target.nodeId)) return `property ${shown(property.id)} targets ${shown(property.target.nodeId)}, which is not in this component`;
    const target = Object.hasOwn(nodes, property.target.nodeId) ? nodes[property.target.nodeId] : null;
    if (property.kind === "instance-swap" && target !== null && target.type !== "component-instance") return `instance-swap property ${shown(property.id)} targets ${shown(target.id)}, which is not an instance`;
    if (property.kind === "slot" && target !== null && target.type === "component-instance") return `slot property ${shown(property.id)} targets an instance; a slot is a layer that holds what is put in it`;
    if ((property.kind === "instance-swap" || property.kind === "slot") && property.default !== "") {
      const chosen = Object.hasOwn(nodes, property.default) ? nodes[property.default] : null;
      if (chosen === null || chosen.type !== "component-definition") return `${property.kind} property ${shown(property.id)} of ${shown(node.props.name ?? node.id)} has a default that is not a component (it is gone, or is another kind of layer); choose another default or ""`;
      if (chosen.id === node.id) return `${property.kind} property ${shown(property.id)}'s default is its own component, which cannot be drawn inside itself`;
    }
  }
  for (const variant of node.props.variants ?? []) {
    for (const override of variant.overrides) {
      if (override.path.length === 0 && !inside(override.nodeId)) return `a variant overrides ${shown(override.nodeId)}, which is not in this component`;
    }
  }
  return null;
}

/**
 * A property's id is minted once and never renamed (ADR-0005; Figma renames keys when it combines
 * variants, E-FG-13): a property that keeps its name keeps its id. Removing one is allowed; the
 * instances' values for it become stale.
 */
export function propertyRenameProblem(before, after) {
  if (!hasV2Props(before) || !hasV2Props(after)) return null;
  const afterIds = new Set((after.properties ?? []).map((property) => property.id));
  const beforeIds = new Set((before.properties ?? []).map((property) => property.id));
  for (const old of before.properties ?? []) {
    if (afterIds.has(old.id)) continue;
    const renamed = (after.properties ?? []).find((property) => property.name === old.name && !beforeIds.has(property.id));
    if (renamed) return `property ${shown(old.name)}'s id cannot change (it was ${shown(old.id)}, now ${shown(renamed.id)})`;
  }
  return null;
}

/** An instance's component exists and is a component-definition. */
function referenceProblem(nodes, node) {
  if (node.type !== "component-instance") return null;
  const component = Object.hasOwn(nodes, node.props.componentId) ? nodes[node.props.componentId] : undefined;
  if (component === undefined) return `an instance${typeof node.props.name === "string" ? ` (${shown(node.props.name)})` : ""} still uses its component ${shown(node.props.componentId)}, which does not exist: detach or delete its instances before deleting a component`;
  if (component.type !== "component-definition") return `its component ${shown(node.props.componentId)} is not a component`;
  return null;
}

/**
 * The v2 problems of the records `ids` in a document whose structure did not change (setting
 * props), against `before`, the document they were set on: their own props and references, ids
 * that must not change, and component cycles, which only an instance's new component can make.
 */
export function v2NodesProblem(document, ids, before = null) {
  let cycles = before === null;
  for (const id of ids) {
    const node = document.nodes[id];
    if (!node || !V2_TYPE_SET.has(node.type)) continue;
    const old = before !== null && Object.hasOwn(before.nodes, id) ? before.nodes[id] : null;
    const problem = v2NodeProblem(node) ?? referenceProblem(document.nodes, node) ?? targetProblem(document.nodes, node) ?? (node.type === "component-definition" && old ? propertyRenameProblem(old.props, node.props) : null);
    if (problem) return `node ${shown(id)}: ${problem}`;
    if (node.type === "component-instance" && old?.props?.componentId !== node.props.componentId) cycles = true;
  }
  return cycles ? componentCycle(document.nodes) : null;
}
