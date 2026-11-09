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
// A token value is one CSS value: no rule, block, markup or escape may hide in it.
const VALUE_REFUSED = /[;{}<>\\]|\/\*|@import|url\s*\(|expression\s*\(|javascript:/iu;

export const isV2Type = (type) => V2_TYPE_SET.has(type);

/** The schema version a document's nodes need: 2 when any node is a v2 node, else 1. */
export function schemaVersionFor(nodes) {
  for (const id in nodes) {
    if (Object.hasOwn(nodes, id) && V2_TYPE_SET.has(nodes[id]?.type)) return 2;
  }
  return 1;
}

/**
 * The token names a CSS value binds, in order: every `var(--name)` anywhere in it, inside
 * calc() or with a fallback. The host and the renderer read bindings with this one function.
 */
export function tokenReferences(value) {
  if (typeof value !== "string") return [];
  const names = [];
  const pattern = /var\(\s*(--[A-Za-z0-9_-]{1,127})\s*[,)]/gu;
  for (const match of value.matchAll(pattern)) names.push(match[1]);
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
    if (!isRecord(collection) || typeof collection.id !== "string" || !ID.test(collection.id)) return "a collection needs an id of letters, digits and . _ : -";
    if (collections.has(collection.id)) return `collection ${shown(collection.id)} is listed twice`;
    if (!text(collection.name, 200)) return `collection ${shown(collection.id)} needs a name`;
    if (!Array.isArray(collection.modes) || collection.modes.length === 0 || collection.modes.length > SCHEMA_V2_LIMITS.modesPerCollection) {
      return `collection ${shown(collection.id)} needs 1 to ${SCHEMA_V2_LIMITS.modesPerCollection} modes`;
    }
    const modes = new Set();
    for (const mode of collection.modes) {
      if (!isRecord(mode) || typeof mode.id !== "string" || !ID.test(mode.id)) return `a mode of ${shown(collection.id)} needs an id of letters, digits and . _ : -`;
      if (modes.has(mode.id)) return `mode ${shown(mode.id)} is listed twice in ${shown(collection.id)}`;
      if (!text(mode.name, 200)) return `mode ${shown(mode.id)} needs a name`;
      modes.add(mode.id);
    }
    if (!modes.has(collection.defaultMode)) return `collection ${shown(collection.id)}'s default mode is not one of its modes`;
    collections.set(collection.id, modes);
  }
  if (!Array.isArray(props.tokens) || props.tokens.length > SCHEMA_V2_LIMITS.tokens) return `it may hold at most ${SCHEMA_V2_LIMITS.tokens} tokens`;
  const tokens = new Map();
  for (const token of props.tokens) {
    if (!isRecord(token) || typeof token.name !== "string" || !TOKEN_NAME.test(token.name)) return "a token needs a CSS custom property name such as --brand-500";
    if (tokens.has(token.name)) return `token ${token.name} is defined twice`;
    if (!TOKEN_TYPE_SET.has(token.type)) return `token ${token.name} has an unknown type`;
    const modes = collections.get(token.collection);
    if (modes === undefined) return `token ${token.name} names a collection that does not exist`;
    if (!isRecord(token.values) || Object.keys(token.values).length === 0) return `token ${token.name} has no values`;
    for (const [mode, value] of Object.entries(token.values)) {
      if (!modes.has(mode)) return `token ${token.name} has a value for ${shown(mode)}, which is not a mode of its collection`;
      if (typeof value !== "string" || value.trim() === "" || value.length > SCHEMA_V2_LIMITS.valueLength || VALUE_REFUSED.test(value)) {
        return `token ${token.name} has a value that is not one CSS value`;
      }
    }
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
    const problem = v2NodeProblem(node) ?? referenceProblem(nodes, node);
    if (problem) return `node ${shown(id)}: ${problem}`;
  }
  if (designSystems > 1) return "a document has at most one design system";
  if (definitions > SCHEMA_V2_LIMITS.definitions) return `a document has at most ${SCHEMA_V2_LIMITS.definitions} components`;
  if (instances > SCHEMA_V2_LIMITS.instances) return `a document has at most ${SCHEMA_V2_LIMITS.instances} instances`;
  return componentCycle(nodes);
}

/** An instance's component exists and is a component-definition. */
function referenceProblem(nodes, node) {
  if (node.type !== "component-instance") return null;
  const component = Object.hasOwn(nodes, node.props.componentId) ? nodes[node.props.componentId] : undefined;
  if (component === undefined) return `its component ${shown(node.props.componentId)} does not exist`;
  if (component.type !== "component-definition") return `its component ${shown(node.props.componentId)} is not a component`;
  return null;
}

/**
 * The v2 problems of the records `ids` in a document whose structure did not change (setting
 * props): their own props and references, and component cycles when a component or an instance
 * changed. Nothing else in the document can have become invalid.
 */
export function v2NodesProblem(document, ids) {
  let components = false;
  for (const id of ids) {
    const node = document.nodes[id];
    if (!node || !V2_TYPE_SET.has(node.type)) continue;
    const problem = v2NodeProblem(node) ?? referenceProblem(document.nodes, node);
    if (problem) return `node ${shown(id)}: ${problem}`;
    if (node.type !== "design-system") components = true;
  }
  return components ? componentCycle(document.nodes) : null;
}
