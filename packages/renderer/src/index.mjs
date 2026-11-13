// @ninerr/renderer: turns a Ninerr document into web semantics inside a sandboxed frame.
//
// Rendering contract (docs/ARCHITECTURE.md): web semantics out, a stable node -> DOM identity
// (`data-ninerr-id`), no renderer-only document state, and an explicit sandbox for imported
// markup. This module has no imports and no Node built-ins, so the browser loads it as is.
//
// Web-semantic props convention (PC2, frozen): a node's props may hold
//   tag         HTML or SVG element name (allowlisted; defaults by node type)
//   text        text content, rendered before the node's children
//   attributes  { name: string } (allowlisted names, sanitized values)
//   style       { css-property: string } (sanitized values)
//   stylesheet  CSS applied to this layer and its descendants alone (#283); the host refuses
//               one that loads or executes anything, and so does the renderer
//   name        layer name for the editor; never rendered
// Anything else in props is ignored by the renderer. Imported nodes (@ninerr/import-stack)
// already use { tag, text, attributes, style }.

export const RENDERER_SCHEMA_VERSION = 1;

const HTML_TAGS = new Set([
  "a", "abbr", "address", "article", "aside", "b", "blockquote", "br", "button", "caption", "cite", "code", "col",
  "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "fieldset", "figcaption", "figure", "footer",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "input", "ins", "kbd", "label", "legend", "li",
  "main", "mark", "nav", "ol", "optgroup", "option", "p", "picture", "pre", "q", "s", "samp", "section", "select",
  "small", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "textarea", "tfoot", "th", "thead",
  "time", "tr", "u", "ul", "var",
]);
const SVG_TAGS = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "title", "desc"]);
const SVG_NS = "http://www.w3.org/2000/svg";

const DEFAULT_TAG = Object.freeze({ page: "div", frame: "div", group: "div", element: "div", text: "span", image: "img", vector: "svg", media: "div" });

const GLOBAL_ATTRIBUTES = new Set(["class", "title", "lang", "dir", "role", "hidden"]);
const ELEMENT_ATTRIBUTES = Object.freeze({
  a: ["href", "rel", "target", "hreflang"],
  img: ["src", "alt", "width", "height", "loading", "decoding"],
  td: ["colspan", "rowspan", "headers"],
  th: ["colspan", "rowspan", "headers", "scope", "abbr"],
  col: ["span"],
  colgroup: ["span"],
  ol: ["start", "reversed", "type"],
  li: ["value"],
  time: ["datetime"],
  q: ["cite"],
  blockquote: ["cite"],
  del: ["cite", "datetime"],
  ins: ["cite", "datetime"],
  label: ["for"],
  input: ["type", "value", "placeholder", "checked", "disabled", "readonly", "name", "min", "max", "step", "size", "maxlength"],
  textarea: ["placeholder", "disabled", "readonly", "name", "rows", "cols", "maxlength"],
  select: ["disabled", "name", "multiple", "size"],
  option: ["value", "selected", "disabled", "label"],
  optgroup: ["label", "disabled"],
  button: ["type", "disabled", "name", "value"],
  details: ["open"],
  fieldset: ["disabled", "name"],
});
// SVG attributes, keyed by lowercase name, with the case the SVG DOM requires.
const SVG_ATTRIBUTES = new Map([
  "viewBox", "width", "height", "d", "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "stroke-opacity", "opacity", "transform", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "points", "text-anchor", "font-size", "preserveAspectRatio",
].map((name) => [name.toLowerCase(), name]));
const INPUT_TYPES = new Set(["text", "email", "number", "password", "search", "tel", "url", "checkbox", "radio", "range", "date", "time", "color", "button", "submit", "reset"]);
const SAFE_LINK = /^(https?:|mailto:|tel:|#)/iu;
const SAFE_IMAGE = /^data:image\/(png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/iu;
const MAX_TEXT = 1_000_000;
const MAX_VALUE = 2_000;
const STYLE_NAME = /^(--[A-Za-z0-9_-]{1,64}|-?[a-z][a-z-]{0,63})$/u;
// Anything that could fetch, execute, or escape a declaration is refused outright.
// image( and src( as in UNSAFE_STYLESHEET: a browser refuses both in a value, so this is defence
// in depth (#383).
const UNSAFE_STYLE = /url\s*\(|image-set|image\s*\(|(?:^|[^-\w])src\s*\(|expression\s*\(|javascript:|vbscript:|@import|behavior\s*:|-moz-binding|[\\;{}<>]/iu;

/**
 * Whether every quote, ( and [ in a style value is closed, in order (#382). An open one is not a
 * value a browser draws, and written next to other declarations it swallows those after it:
 * `calc(1px; top: 1px` is one declaration. Backslashes are refused before this is asked.
 */
function balancedStyleValue(value) {
  const open = [];
  let quote = null;
  for (const char of value) {
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === "\"" || char === "'") quote = char;
    else if (char === "(" || char === "[") open.push(char === "(" ? ")" : "]");
    else if ((char === ")" || char === "]") && open.pop() !== char) return false;
  }
  return quote === null && open.length === 0;
}

/** Why the renderer would not draw this style declaration, or null: the rule planElement applies. */
export function styleDeclarationProblem(name, value) {
  if (typeof name !== "string" || !STYLE_NAME.test(name)) return `${String(name).slice(0, 40)} is not a style property the canvas draws`;
  if (typeof value !== "string" || value.trim() === "") return `${name} has no value`;
  if (UNSAFE_STYLE.test(value)) return `${name}'s value could fetch or run something, or hide a declaration, and is never drawn`;
  if (!balancedStyleValue(value)) return `${name}'s value leaves a quote or bracket open, and is never drawn`;
  return null;
}
// A stylesheet that could fetch or execute is not drawn at all. It is judged with its escapes
// decoded: a comment can hide a url( from a browser but never create one, so this raw view
// holds every function and at-rule the browser would see. The frame's policy loads nothing but
// data: URLs in any case.
// The host takes a stylesheet of up to 2 MiB in UTF-8, which is at most this many characters.
const MAX_STYLESHEET = 2 * 1024 * 1024;
const UNSAFE_STYLESHEET = /url\s*\(|image-set\s*\(|image\s*\(|(?:^|[^-\w])src\(|expression\s*\(|javascript:|vbscript:|@import|behavior\s*:|-moz-binding|<\/style/u;
const RENDERER_ATTRIBUTES = new Set(["data-ninerr-id", "data-ninerr-mode", "data-ninerr-instance", "data-ninerr-stale", "data-ninerr-component"]);

// A layer's modes, from props.modes ({ collection: mode }), as "collection:mode ..." or null.
const MODE_PART = /^[A-Za-z0-9_.-]{1,128}$/u;
function modeAttributeOf(props) {
  const modes = props?.modes;
  if (modes === null || typeof modes !== "object" || Array.isArray(modes)) return null;
  const parts = Object.entries(modes).filter(([collection, mode]) => MODE_PART.test(collection) && typeof mode === "string" && MODE_PART.test(mode)).map(([collection, mode]) => `${collection}:${mode}`);
  return parts.length === 0 ? null : parts.sort().join(" ");
}

function safeStylesheet(css) {
  if (typeof css !== "string" || css.length > MAX_STYLESHEET) return false;
  const decoded = css
    .replace(/\r\n|[\r\f]/gu, "\n")
    .replace(/\\([0-9a-fA-F]{1,6})\s?/gu, (_match, hex) => {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/\\([^\n0-9a-fA-F])/gu, "$1")
    .toLowerCase();
  return !UNSAFE_STYLESHEET.test(decoded);
}

/**
 * The viewport a design is drawn for (#283, found dogfooding sb-admin-2). In the canvas frame a
 * viewport length would be the frame's, and the canvas sizes its frame to the content: a
 * `min-height: 100vh` then grew with every resize and the page always outgrew its frame, out
 * of reach. So the renderer draws viewport lengths (vh, vw, vb, vi, vmin, vmax, and their d, s
 * and l forms) as pixels of this viewport, in a layer's style and in its stylesheet's
 * declarations. The document keeps what was written, so code export and the inspector show it.
 * Media queries are left as they are, and container units (cq*) too.
 */
export const DESIGN_VIEWPORT = Object.freeze({ width: 1024, height: 768 });
const VIEWPORT_LENGTH = /(?<![\w-])([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)[dsl]?v(h|w|b|i|min|max)\b/giu;
const VIEWPORT_SIZE = Object.freeze({
  h: DESIGN_VIEWPORT.height,
  b: DESIGN_VIEWPORT.height,
  w: DESIGN_VIEWPORT.width,
  i: DESIGN_VIEWPORT.width,
  min: Math.min(DESIGN_VIEWPORT.width, DESIGN_VIEWPORT.height),
  max: Math.max(DESIGN_VIEWPORT.width, DESIGN_VIEWPORT.height),
});
export const DRAWN_ID = "data-ninerr-html-id";
// How deep a page's nested @scope is rebuilt with its ids drawn: the import sanitizer's own
// nesting limit. Deeper ones are kept with their ids undrawn.
const MAX_SCOPE_DEPTH = 8;
const ESCAPE = /\\(?:[0-9a-f]{1,6}[ \t\n]?|[^\n0-9a-f]|$)/iuy;
const ID_ATTRIBUTE = /\[\s*(?:\*?\|)?id\s*(?=\]|[~|^$*]?=)/iuy;

/**
 * A selector as the canvas draws it (#297): `#x` matches the drawn id as
 * `[data-ninerr-html-id="x"]:not(#_)`, and `[id…]` names the drawn attribute. `:not(#_)`
 * matches everything on the canvas, which draws no ids, and keeps the id column of the
 * selector's specificity: each id adds the same (0,1,0) besides, so the page's rules keep
 * their order in the cascade. (`:is([…],#x)` kept it exactly, but made style recalculation
 * of a large page one to two orders of magnitude slower: the review of #297 measured it.)
 * `selector` is the browser's serialization, with strings in double quotes.
 */
export function drawnSelector(selector) {
  if (!/[#[]/u.test(selector)) return selector;
  let drawn = "";
  let index = 0;
  const escapeAt = (at) => {
    ESCAPE.lastIndex = at;
    return ESCAPE.exec(selector)?.[0].length ?? 0;
  };
  while (index < selector.length) {
    const char = selector[index];
    if (char === "\"" || char === "'") {
      let end = index + 1;
      while (end < selector.length && selector[end] !== char) end += selector[end] === "\\" ? 2 : 1;
      drawn += selector.slice(index, end + 1);
      index = end + 1;
    } else if (char === "\\") {
      const length = Math.max(escapeAt(index), 1);
      drawn += selector.slice(index, index + length);
      index += length;
    } else if (char === "#") {
      let end = index + 1;
      while (end < selector.length) {
        if (selector[end] === "\\") end += Math.max(escapeAt(end), 1);
        else if (/[-\w\u0080-\uffff]/u.test(selector[end])) end += 1;
        else break;
      }
      const name = selector.slice(index + 1, end);
      drawn += name === "" ? "#" : `[${DRAWN_ID}="${name}"]:not(#_)`;
      index = end;
    } else {
      ID_ATTRIBUTE.lastIndex = index;
      const attribute = char === "[" ? ID_ATTRIBUTE.exec(selector) : null;
      drawn += attribute === null ? char : `[${DRAWN_ID}`;
      index += attribute === null ? 1 : attribute[0].length;
    }
  }
  return drawn;
}

const ANIMATION_DECLARATION = /(^|;\s*)((?:-webkit-)?animation(?:-name)?\s*:\s*)([^;"']*)(?=;|$)/giu;

/** `value` split at its top-level commas (not those inside steps(…) or cubic-bezier(…)). */
function topLevelItems(value) {
  const items = [];
  let depth = 0;
  let from = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") depth -= 1;
    else if (value[index] === "," && depth === 0) {
      items.push(value.slice(from, index));
      from = index + 1;
    }
  }
  items.push(value.slice(from));
  return items;
}

/**
 * Declarations (a rule's cssText as the browser writes it) with the animation names in
 * `renamed` (keyed and valued as written in CSS, escaped) written as their frame's names, in
 * animation and animation-name only. In the shorthand only the name is renamed, which the
 * browser writes last in each item, never a keyword (ease, running) a keyframes name may share.
 * A quoted name, or one given through var(), is left as written.
 */
export function renamedAnimations(cssText, renamed) {
  if (renamed.size === 0 || !/animation/iu.test(cssText)) return cssText;
  return cssText.replace(ANIMATION_DECLARATION, (whole, start, property, value) => {
    if (/var\(/iu.test(value)) return whole;
    const [, list, important] = /^([\s\S]*?)(\s*!\s*important\s*)?$/iu.exec(value);
    const shorthand = !/-name\s*:/iu.test(property);
    const items = topLevelItems(list).map((item) => {
      // A written name may hold an escape's space (\31 abc for "1abc").
      const name = shorthand ? (/((?:\\[0-9a-fA-F]{1,6} |\S)+)\s*$/u.exec(item)?.[1] ?? "") : item.trim();
      // Unquoted, none is the keyword for no animation, never a keyframes name.
      if (!renamed.has(name) || name.toLowerCase() === "none") return item;
      const at = shorthand ? item.lastIndexOf(name) : item.indexOf(name);
      return `${item.slice(0, at)}${renamed.get(name)}${item.slice(at + name.length)}`;
    });
    return `${start}${property}${items.join(",")}${important ?? ""}`;
  });
}

/** A CSS value with its viewport lengths as pixels of DESIGN_VIEWPORT; strings are left as written. */
export function designViewportLengths(value) {
  if (!/v(?:h|w|b|i|min|max)\b/iu.test(value)) return value;
  return value.split(/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/u).map((part, index) => (index % 2 === 1
    ? part
    : part.replace(VIEWPORT_LENGTH, (_match, amount, unit) => `${Math.round(Number(amount) * VIEWPORT_SIZE[unit.toLowerCase()] * 100) / 10_000}px`))).join("");
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (record, key) => (isRecord(record) && Object.hasOwn(record, key) ? record[key] : undefined);

/**
 * What the renderer will create for `node`, decided without a DOM: a tag (or null when the
 * node is not rendered), its namespace, the attributes and styles that survive the
 * allowlists, its text, and how many values were dropped. Pure, so it can be tested in Node.
 */
/** The roots the canvas draws: a design system holds tokens, and is never drawn (ADR-0004). */
export function drawnRoots(document) {
  return document.rootIds.filter((id) => document.nodes[id]?.type !== "design-system");
}

// ---------- component instances (ADR-0005) ----------

/** The id of what a slot draws in a layer: the layer's id and a unit separator, which ids made by the editor never hold. */
export const slotIdOf = (layerId) => `${layerId}\u001fslot`;

/**
 * The component ids an instance's swap and slot values name: only values of its component's
 * instance-swap and slot properties, whether or not that component still exists.
 */
export function chosenComponents(document, instance) {
  const definition = Object.hasOwn(document.nodes, instance.props.componentId) ? document.nodes[instance.props.componentId] : undefined;
  const values = isPlainRecord(instance.props.propertyValues) ? instance.props.propertyValues : {};
  if (definition?.type !== "component-definition" || !Array.isArray(definition.props.properties)) return [];
  return definition.props.properties
    .filter((property) => (property.kind === "instance-swap" || property.kind === "slot") && Object.hasOwn(values, property.id) && typeof values[property.id] === "string" && values[property.id] !== "")
    .map((property) => values[property.id]);
}

// An instance is expanded when it is drawn, and nothing expanded is ever stored: one change to
// its component redraws every instance. Its drawn layers keep their component node's id as
// data-ninerr-id (so scoped stylesheets match inside instances) and carry the instance chain as
// data-ninerr-instance; they are not layers of their own.
export const MAX_INSTANCE_DEPTH = 16;
// The most layers one instance draws, nested instances included: a document whose instances nest
// wide (8 levels of 10) would otherwise expand to millions of layers. Past it, the instance is
// drawn as stale, and code export refuses it.
export const MAX_EXPANDED_LAYERS = 5_000;

const isPlainRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// One override's set onto a copy of a view's props and visibility: text, style, attributes, and
// shown or hidden (the last word on visibility wins, so an instance's own override can show what a
// variant hid).
function overridden(view, set) {
  if (!isPlainRecord(set)) return view;
  const props = { ...view.props };
  if (typeof set.text === "string") props.text = set.text;
  if (isPlainRecord(set.style)) props.style = { ...(isPlainRecord(props.style) ? props.style : {}), ...set.style };
  if (isPlainRecord(set.attributes)) props.attributes = { ...(isPlainRecord(props.attributes) ? props.attributes : {}), ...set.attributes };
  return { props, hidden: typeof set.visible === "boolean" ? !set.visible : view.hidden };
}

// A hidden layer is hidden whatever display its own style gives it.
function withVisibility(props, hidden) {
  const attributes = { ...(isPlainRecord(props.attributes) ? props.attributes : {}) };
  const style = { ...(isPlainRecord(props.style) ? props.style : {}) };
  if (hidden === true) {
    attributes.hidden = "";
    style.display = "none !important";
  } else if (hidden === false) delete attributes.hidden;
  return { ...props, attributes, style };
}

// A component's own props (its name, properties and variants) are not drawn.
const drawnProps = (props) => {
  const { properties: _properties, variants: _variants, ...rest } = props;
  return rest;
};

class ExpansionTooLarge extends Error {}

/**
 * What an instance draws, as a tree of views { id, type, props, chain, children }: its component's
 * subtree with, in order, the variant overrides its values select, its property values, and its
 * own overrides (an outer instance's overrides on a nested one, or on its layers, win over the
 * nested one's own). The root view is the instance itself, drawn as its component's root with the
 * instance's own placement and modes. Null for a component that is missing or not a component,
 * past the depth limit, or past MAX_EXPANDED_LAYERS layers.
 */
export function expandInstance(document, instanceId, chain = [], outer = [], depth = 0, budget = { left: MAX_EXPANDED_LAYERS }) {
  try {
    const instance = Object.hasOwn(document.nodes, instanceId) ? document.nodes[instanceId] : undefined;
    return instance === undefined ? null : expand(document, instance, chain, outer, depth, budget, new Set());
  } catch (error) {
    if (error instanceof ExpansionTooLarge) return null;
    throw error;
  }
}

// `instance` is an instance node, or one a slot makes ({ id, props: { componentId } }); `seen`
// holds the components already being drawn above it, so a swap or slot value that would draw a
// component inside itself draws nothing there (stale) instead of looping.
function expand(document, instance, chain, outer, depth, budget, seen) {
  const nodes = document.nodes;
  const instanceId = instance.id;
  const definition = Object.hasOwn(nodes, instance.props.componentId) ? nodes[instance.props.componentId] : undefined;
  if (!definition || definition.type !== "component-definition" || depth >= MAX_INSTANCE_DEPTH || seen.has(definition.id)) return null;
  const inside = new Set(seen).add(definition.id);
  const here = [...chain, instanceId];
  const properties = Array.isArray(definition.props.properties) ? definition.props.properties : [];
  const values = Object.fromEntries(properties.map((property) => [property.id, property.default]));
  if (isPlainRecord(instance.props.propertyValues)) Object.assign(values, instance.props.propertyValues);
  const variants = (Array.isArray(definition.props.variants) ? definition.props.variants : [])
    .filter((variant) => isPlainRecord(variant?.values) && Object.entries(variant.values).every(([id, value]) => values[id] === value));
  // Its own overrides, then an outer instance's on it, so the outer ones win.
  const own = [...(Array.isArray(instance.props.overrides) ? instance.props.overrides : []), ...outer];
  const variantOverrides = variants.flatMap((variant) => (Array.isArray(variant.overrides) ? variant.overrides : []));
  const view = (node) => {
    budget.left -= 1;
    if (budget.left < 0) throw new ExpansionTooLarge();
    let current = { props: { ...node.props }, hidden: null };
    for (const override of variantOverrides) if (override.path?.length === 0 && override.nodeId === node.id) current = overridden(current, override.set);
    for (const property of properties) {
      if (property.target?.nodeId !== node.id) continue;
      const value = values[property.id];
      if (property.target.field === "text") current = overridden(current, { text: String(value) });
      else if (property.target.field === "visible" && typeof value === "boolean") current = overridden(current, { visible: value });
      else if (property.target.field === "attributes.class" && typeof value === "string" && value !== "") {
        // A variant's value joins the layer's own classes; it does not replace them.
        const classes = typeof current.props.attributes?.class === "string" ? current.props.attributes.class : "";
        current = overridden(current, { attributes: { class: [classes, value].filter(Boolean).join(" ") } });
      }
    }
    for (const override of own) if (Array.isArray(override?.path) && override.path.length === 0 && override.nodeId === node.id) current = overridden(current, override.set);
    if (node.type === "component-instance") {
      const passed = [...variantOverrides, ...own].filter((override) => override.path?.[0] === node.id).map((override) => ({ ...override, path: override.path.slice(1) }));
      // An instance-swap property chooses another component for this nested instance.
      const swap = properties.find((property) => property.kind === "instance-swap" && property.target?.nodeId === node.id && typeof values[property.id] === "string" && values[property.id] !== "");
      const nested = expand(document, swap ? { id: node.id, props: { ...node.props, componentId: values[swap.id] } } : node, here, passed, depth + 1, budget, inside);
      if (nested === null) return { id: node.id, type: node.type, props: withVisibility({}, current.hidden), chain: here, children: [], stale: true };
      // What was set on the nested instance itself (its style, attributes, text, visibility) is
      // drawn on its root, over what its component gives it.
      const merged = overridden({ props: nested.props, hidden: null }, { text: current.props.text !== node.props.text ? current.props.text : undefined, style: current.props.style, attributes: current.props.attributes });
      return { ...nested, props: withVisibility(merged.props, current.hidden), chain: here };
    }
    // A slot property with a component draws that component here, in place of the layer's own
    // children and text: an instance the slot makes, whose id is slotIdOf(the layer).
    const slot = properties.find((property) => property.kind === "slot" && property.target?.nodeId === node.id && typeof values[property.id] === "string" && values[property.id] !== "");
    if (slot) {
      const slotId = slotIdOf(node.id);
      const passed = [...variantOverrides, ...own].filter((override) => override.path?.[0] === slotId).map((override) => ({ ...override, path: override.path.slice(1) }));
      const filled = expand(document, { id: slotId, props: { componentId: values[slot.id] } }, here, passed, depth + 1, budget, inside);
      // What is set on the slot's content itself (path [], node slotIdOf(the layer)) is drawn on its
      // root, as on a nested instance's.
      let root = filled === null ? null : { props: filled.props, hidden: null };
      if (root !== null) for (const override of [...variantOverrides, ...own]) if (Array.isArray(override?.path) && override.path.length === 0 && override.nodeId === slotId) root = overridden(root, override.set);
      const children = filled === null ? [] : [{ ...filled, props: withVisibility(root.props, root.hidden), chain: here }];
      // What the slot draws takes the place of the layer's own children and text.
      const { text: _text, ...props } = drawnProps(current.props);
      return { id: node.id, type: node.type, props: withVisibility(props, current.hidden), chain: here, children, ...(filled === null ? { stale: true } : {}) };
    }
    return { id: node.id, type: node.type, props: withVisibility(drawnProps(current.props), current.hidden), chain: here, children: node.children.filter((id) => Object.hasOwn(nodes, id)).map((id) => view(nodes[id])) };
  };
  const root = view(definition);
  // The instance is drawn as its component's root, placed by its own style, in its own modes.
  const style = { ...(isPlainRecord(root.props.style) ? root.props.style : {}), ...(isPlainRecord(instance.props.style) ? instance.props.style : {}) };
  const props = { ...root.props, style };
  if (isPlainRecord(instance.props.modes)) props.modes = instance.props.modes;
  return { id: instanceId, type: "component-instance", componentId: definition.id, props, chain, children: root.children, ...(root.stale ? { stale: true } : {}) };
}

/**
 * A copy of `document` in which every instance under `rootId` is replaced by the layers it draws,
 * as ordinary nodes, so code export writes what the canvas shows. The instance keeps its id; the
 * layers it draws get ids made from their instance chain, which no stored node has. Throws when
 * the instances under it would draw more than MAX_EXPANDED_LAYERS layers in all.
 */
export function withInstancesExpanded(document, rootId) {
  const nodes = { ...document.nodes };
  const synthetic = (view) => `${view.chain.join("\u001f")}\u001f${view.id}`;
  const add = (view, parentId, id) => {
    const children = view.children.map((child) => add(child, id, synthetic(child)));
    nodes[id] = { id, type: view.type === "component-instance" ? "element" : view.type, parentId, children, props: view.props, metadata: {} };
    return id;
  };
  const budget = { left: MAX_EXPANDED_LAYERS };
  const stack = [rootId];
  while (stack.length > 0) {
    const node = nodes[stack.pop()];
    if (!node) continue;
    if (node.type === "component-instance") {
      const view = expandInstance(document, node.id, [], [], 0, budget);
      if (view === null && budget.left < 0) throw new Error(`the instances here draw more than ${MAX_EXPANDED_LAYERS} layers`);
      if (view !== null) add(view, node.parentId, node.id);
      continue;
    }
    stack.push(...node.children);
  }
  return { ...document, nodes };
}

/** The ids of the instances that draw any of `definitionIds`, directly or through other components. */
export function instancesDrawing(document, definitionIds) {
  const touched = new Set(definitionIds);
  if (touched.size === 0) return [];
  const nodes = document.nodes;
  // One pass: each instance, and the component it lies in, if any.
  const instances = [];
  for (const id in nodes) {
    const node = nodes[id];
    if (node.type !== "component-instance") continue;
    let inside = null;
    for (let parent = node.parentId === null ? undefined : nodes[node.parentId], steps = 0; parent && steps <= 1_100; parent = parent.parentId === null ? undefined : nodes[parent.parentId], steps += 1) {
      if (parent.type === "component-definition") {
        inside = parent.id;
        break;
      }
    }
    // The components it can draw: its own, and those its swap and slot values choose.
    // (A value naming a component that was just deleted still counts, so its instance is redrawn.)
    instances.push({ id, componentId: node.props.componentId, draws: [node.props.componentId, ...chosenComponents(document, node)], inside });
  }
  // A component whose swap or slot defaults draw a touched one is touched too.
  const defaults = [];
  for (const id in nodes) {
    const node = nodes[id];
    if (node.type !== "component-definition" || !Array.isArray(node.props.properties)) continue;
    for (const property of node.props.properties) if ((property.kind === "instance-swap" || property.kind === "slot") && typeof property.default === "string" && property.default !== "") defaults.push({ definition: id, draws: property.default });
  }
  // A component that holds an instance drawing a touched one is touched too.
  for (let grew = true; grew;) {
    grew = false;
    for (const entry of instances) {
      if (entry.draws.some((componentId) => touched.has(componentId)) && entry.inside !== null && !touched.has(entry.inside)) {
        touched.add(entry.inside);
        grew = true;
      }
    }
    for (const entry of defaults) {
      if (touched.has(entry.draws) && !touched.has(entry.definition)) {
        touched.add(entry.definition);
        grew = true;
      }
    }
  }
  return instances.filter((entry) => entry.draws.some((componentId) => touched.has(componentId))).map((entry) => entry.id);
}

/** The component-definition at or above each of `ids`. */
export function definitionsAbove(document, ids) {
  const found = new Set();
  for (const id of ids) {
    for (let node = document.nodes[id], steps = 0; node && steps <= 1_100; node = node.parentId === null ? undefined : document.nodes[node.parentId], steps += 1) {
      if (node.type === "component-definition") found.add(node.id);
    }
  }
  return [...found];
}

export function planElement(node) {
  const props = isRecord(node?.props) ? node.props : {};
  const requested = own(props, "tag");
  const fallback = DEFAULT_TAG[node?.type] ?? "div";
  let tag = typeof requested === "string" ? requested.toLowerCase() : fallback;
  let namespace = "html";
  let dropped = 0;
  if (SVG_TAGS.has(tag) && (tag === "svg" || node?.type === "vector" || requested !== undefined)) {
    namespace = "svg";
  } else if (!HTML_TAGS.has(tag)) {
    dropped += 1;
    tag = fallback === "svg" ? "div" : fallback;
  }
  const attributes = {};
  const rawAttributes = own(props, "attributes");
  if (isRecord(rawAttributes)) {
    for (const [rawName, rawValue] of Object.entries(rawAttributes)) {
      const lower = rawName.toLowerCase();
      const value = sanitizeAttribute(tag, namespace, lower, rawValue);
      if (value === null) dropped += 1;
      // Links are rendered inert: the canvas is an editing surface, never a browser.
      else if (lower === "href") attributes["data-ninerr-href"] = value;
      // An element's id is drawn under a name of ours (see drawnSelector): a real id would give
      // the frame's document named access and clash across frames (#297).
      else if (lower === "id") attributes[DRAWN_ID] = value;
      else attributes[namespace === "svg" ? SVG_ATTRIBUTES.get(lower) ?? lower : lower] = value;
    }
  }
  const style = {};
  const rawStyle = own(props, "style");
  if (isRecord(rawStyle)) {
    for (const [name, rawValue] of Object.entries(rawStyle)) {
      const value = typeof rawValue === "number" ? String(rawValue) : rawValue;
      if (typeof value !== "string" || !STYLE_NAME.test(name) || value.length > MAX_VALUE || UNSAFE_STYLE.test(value) || !balancedStyleValue(value)) dropped += 1;
      else style[name] = value.trim();
    }
  }
  const rawText = own(props, "text");
  const text = typeof rawText === "string" ? rawText.slice(0, MAX_TEXT) : null;
  const rawStylesheet = own(props, "stylesheet");
  let stylesheet = null;
  if (rawStylesheet !== undefined) {
    if (safeStylesheet(rawStylesheet)) stylesheet = rawStylesheet;
    else dropped += 1;
  }
  return { tag, namespace, attributes, style: shorthandsFirst(style), text, stylesheet, dropped };
}

// #294 (decided in P09): a style's shorthand applies before its own longhands, so a longhand
// always refines its shorthand, whatever order the entries are stored in. Nothing else moves.
const LONGHANDS = Object.freeze({
  inset: /^(?:top|right|bottom|left)$/u,
  gap: /^(?:row|column)-gap$/u,
  "grid-gap": /^grid-(?:row|column)-gap$/u,
  "grid-area": /^grid-(?:row|column)(?:-start|-end)?$/u,
  "place-items": /^(?:align|justify)-items$/u,
  "place-content": /^(?:align|justify)-content$/u,
  "place-self": /^(?:align|justify)-self$/u,
  "flex-flow": /^flex-(?:direction|wrap)$/u,
  columns: /^column-(?:width|count)$/u,
  font: /^line-height$/u,
  "border-color": /^border-(?:top|right|bottom|left|block|inline)(?:-start|-end)?-color$/u,
  "border-style": /^border-(?:top|right|bottom|left|block|inline)(?:-start|-end)?-style$/u,
  "border-width": /^border-(?:top|right|bottom|left|block|inline)(?:-start|-end)?-width$/u,
  "border-radius": /^border-(?:top|bottom|start|end)-(?:left|right|start|end)-radius$/u,
  "border-block-color": /^border-block-(?:start|end)-color$/u,
  "border-block-style": /^border-block-(?:start|end)-style$/u,
  "border-block-width": /^border-block-(?:start|end)-width$/u,
  "border-inline-color": /^border-inline-(?:start|end)-color$/u,
  "border-inline-style": /^border-inline-(?:start|end)-style$/u,
  "border-inline-width": /^border-inline-(?:start|end)-width$/u,
});
// A logical side and a physical side (inset-block and top, margin-inline and margin-left) are
// not paired: which physical side a logical one is depends on the writing mode. A physical
// shorthand is refined by its logical parts (margin-inline after margin), since each sets a
// subset of what the shorthand sets.

/** Whether `name` is one of `shorthand`'s longhands (margin-left of margin, top of inset). */
export function isLonghandOf(name, shorthand) {
  if (name === shorthand || name.startsWith("--") || shorthand.startsWith("--")) return false;
  return name.startsWith(`${shorthand}-`) || LONGHANDS[shorthand]?.test(name) === true;
}

/** Whether one of `name`'s shorthands is in `present`: the same test as isLonghandOf, by lookup. */
function hasShorthandIn(name, present) {
  if (name.startsWith("--")) return false;
  for (let at = name.indexOf("-", 1); at > 0; at = name.indexOf("-", at + 1)) if (present.has(name.slice(0, at))) return true;
  for (const [shorthand, pattern] of Object.entries(LONGHANDS)) if (present.has(shorthand) && pattern.test(name)) return true;
  return false;
}

/**
 * `style` with each longhand moved to just after its last shorthand. Shorthands keep their
 * order among themselves (so of two overlapping ones the later still wins what they share),
 * and every other entry keeps its place.
 */
export function shorthandsFirst(style) {
  const names = Object.keys(style);
  // Most styles have no shorthand with its own longhand: they are returned as they are.
  const present = new Map(names.map((name, index) => [name, index]));
  if (!names.some((name) => hasShorthandIn(name, present))) return style;
  // Linear in the entries (a style can hold thousands): each longhand waits for its shorthands,
  // and goes out where it stands if they have gone, or just after the last of them.
  const waiting = names.map((name) => shorthandsIn(name, present));
  const released = names.map(() => []);
  waiting.forEach((shorthands, index) => shorthands.forEach((shorthand) => released[shorthand].push(index)));
  const left = waiting.map((shorthands) => shorthands.length);
  const ordered = [];
  const done = names.map(() => false);
  let walked = 0;
  const emit = (index) => {
    done[index] = true;
    ordered.push(names[index]);
    for (const next of released[index]) {
      left[next] -= 1;
      if (left[next] === 0 && next < walked && !done[next]) emit(next);
    }
  };
  for (; walked < names.length; walked += 1) if (left[walked] === 0 && !done[walked]) emit(walked);
  return Object.fromEntries(ordered.map((name) => [name, style[name]]));
}

/** The positions of `name`'s shorthands in `present` (name → position), the same test as isLonghandOf. */
function shorthandsIn(name, present) {
  if (name.startsWith("--")) return [];
  const found = new Set();
  for (let at = name.indexOf("-", 1); at > 0; at = name.indexOf("-", at + 1)) if (present.has(name.slice(0, at))) found.add(present.get(name.slice(0, at)));
  for (const [shorthand, pattern] of Object.entries(LONGHANDS)) if (present.has(shorthand) && pattern.test(name)) found.add(present.get(shorthand));
  found.delete(present.get(name));
  return [...found];
}

// What each shorthand resets, per the CSS specifications. A name it merely starts with is not
// among them (flex-direction under flex, border-collapse under border, overflow-wrap under
// overflow), and a pair not listed here keeps both: an entry is left out only when it is certain.
const SIDE = "(?:top|right|bottom|left|block|inline)(?:-start|-end)?";
const RESETS = Object.freeze({
  ...Object.fromEntries(["margin", "padding", "scroll-margin", "scroll-padding"].map((name) => [name, new RegExp(`^${name}-${SIDE}$`, "u")])),
  ...Object.fromEntries(["margin", "padding", "scroll-margin", "scroll-padding", "inset"].flatMap((name) => ["block", "inline"].map((axis) => [`${name}-${axis}`, new RegExp(`^${name}-${axis}-(?:start|end)$`, "u")]))),
  inset: /^(?:top|right|bottom|left|inset-(?:block|inline)(?:-start|-end)?)$/u,
  border: new RegExp(`^border-(?:${SIDE}(?:-(?:color|style|width))?|color|style|width|image(?:-(?:source|slice|width|outset|repeat))?)$`, "u"),
  ...Object.fromEntries(["top", "right", "bottom", "left", "block-start", "block-end", "inline-start", "inline-end"].map((side) => [`border-${side}`, new RegExp(`^border-${side}-(?:color|style|width)$`, "u")])),
  "border-block": /^border-block-(?:(?:start|end)(?:-(?:color|style|width))?|color|style|width)$/u,
  "border-inline": /^border-inline-(?:(?:start|end)(?:-(?:color|style|width))?|color|style|width)$/u,
  ...Object.fromEntries(["color", "style", "width"].flatMap((part) => [`border-${part}`, `border-block-${part}`, `border-inline-${part}`].map((name) => [name, LONGHANDS[name]]))),
  "border-radius": LONGHANDS["border-radius"],
  "border-image": /^border-image-(?:source|slice|width|outset|repeat)$/u,
  outline: /^outline-(?:color|style|width)$/u,
  background: /^background-(?:color|image|position(?:-x|-y)?|size|repeat(?:-x|-y)?|attachment|origin|clip)$/u,
  "background-position": /^background-position-[xy]$/u,
  font: /^(?:font-(?:style|variant|variant-[a-z-]+|weight|stretch|size|family|size-adjust|kerning|feature-settings|language-override|variation-settings|optical-sizing)|line-height)$/u,
  "font-variant": /^font-variant-[a-z-]+$/u,
  "font-synthesis": /^font-synthesis-(?:small-caps|style|weight)$/u,
  flex: /^flex-(?:grow|shrink|basis)$/u,
  "flex-flow": LONGHANDS["flex-flow"],
  grid: /^grid-(?:template(?:-(?:rows|columns|areas))?|auto-(?:rows|columns|flow))$/u,
  "grid-template": /^grid-template-(?:rows|columns|areas)$/u,
  "grid-area": LONGHANDS["grid-area"],
  "grid-row": /^grid-row-(?:start|end)$/u,
  "grid-column": /^grid-column-(?:start|end)$/u,
  gap: LONGHANDS.gap,
  "grid-gap": LONGHANDS["grid-gap"],
  "place-items": LONGHANDS["place-items"],
  "place-content": LONGHANDS["place-content"],
  "place-self": LONGHANDS["place-self"],
  columns: LONGHANDS.columns,
  "column-rule": /^column-rule-(?:color|style|width)$/u,
  container: /^container-(?:name|type)$/u,
  marker: /^marker-(?:start|mid|end)$/u,
  offset: /^offset-(?:anchor|distance|path|position|rotate)$/u,
  "overscroll-behavior": /^overscroll-behavior-[xy]$/u,
  "position-try": /^position-try-(?:fallbacks|order)$/u,
  "scroll-timeline": /^scroll-timeline-(?:axis|name)$/u,
  "view-timeline": /^view-timeline-(?:axis|inset|name)$/u,
  "text-box": /^text-box-(?:edge|trim)$/u,
  "text-emphasis": /^text-emphasis-(?:color|style)$/u,
  "text-wrap": /^text-wrap-(?:mode|style)$/u,
  "white-space": /^white-space-collapse$/u,
  "text-decoration": /^text-decoration-(?:line|style|color|thickness)$/u,
  "list-style": /^list-style-(?:type|position|image)$/u,
  overflow: /^overflow-[xy]$/u,
  transition: /^transition-(?:property|duration|timing-function|delay|behavior)$/u,
  animation: /^animation-(?:name|duration|timing-function|delay|iteration-count|direction|fill-mode|play-state|timeline|range(?:-start|-end)?)$/u,
  "animation-range": /^animation-range-(?:start|end)$/u,
  mask: /^mask-(?:image|mode|repeat|position|clip|origin|size|composite)$/u,
  "-webkit-mask-box-image": /^-webkit-mask-box-image-(?:outset|repeat|slice|source|width)$/u,
});

/**
 * A style as written in one declaration, without the longhands a later shorthand of theirs
 * overrides (#360): since shorthands apply first here, keeping one would bring it back. An
 * !important longhand is not overridden by a later shorthand unless that is important too.
 */
export function withoutOverriddenLonghands(style) {
  const names = Object.keys(style);
  const later = new Map(); // shorthand met so far, walking back → whether it is important
  const kept = [];
  for (let at = names.length - 1; at >= 0; at -= 1) {
    const name = names[at];
    const strong = isImportant(style[name]);
    let overridden = false;
    for (const [shorthand, shorthandStrong] of later) {
      if ((shorthandStrong || !strong) && RESETS[shorthand].test(name)) overridden = true;
    }
    if (!overridden) kept.unshift(name);
    if (Object.hasOwn(RESETS, name)) later.set(name, strong);
  }
  return kept.length === names.length ? style : Object.fromEntries(kept.map((name) => [name, style[name]]));
}

/** Whether a declaration's value is !important, whatever comments follow it. */
export function isImportant(value) {
  // A comment's body cannot run past its own end, so this takes linear time per candidate.
  return /!\s*important\s*(?:\/\*(?:[^*]|\*(?!\/))*\*\/\s*)*$/iu.test(value);
}

function sanitizeAttribute(tag, namespace, name, rawValue) {
  const value = typeof rawValue === "number" || typeof rawValue === "boolean" ? String(rawValue) : rawValue;
  if (typeof value !== "string" || value.length > MAX_VALUE) return null;
  // Event handlers, inline styles (they go through `style`), and our own identity never pass.
  if (name.startsWith("on") || name === "style" || name.startsWith("data-ninerr") || name.startsWith("data-lilac")) return null;
  if (name === "id") return value;
  if (name.startsWith("aria-") && /^aria-[a-z]{1,32}$/u.test(name)) return value;
  if (/^data-[a-z0-9-]{1,64}$/u.test(name)) return value;
  if (namespace === "svg") return SVG_ATTRIBUTES.has(name) && !/javascript:|url\s*\(/iu.test(value) ? value : null;
  if (!(GLOBAL_ATTRIBUTES.has(name) || (ELEMENT_ATTRIBUTES[tag] ?? []).includes(name))) return null;
  if (name === "href" || name === "cite") return SAFE_LINK.test(value.trim()) ? value.trim() : null;
  if (name === "src") return SAFE_IMAGE.test(value.trim()) ? value.trim() : null;
  if (name === "target") return value === "_blank" ? "_blank" : null;
  if (name === "type" && tag === "input") return INPUT_TYPES.has(value.toLowerCase()) ? value.toLowerCase() : null;
  return value;
}

// The frame's document: no scripts (the sandbox has no allow-scripts), no forms, no
// navigation, no network (CSP default-src 'none'; images only as data: URLs).
export const FRAME_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";
export const FRAME_SANDBOX = "allow-same-origin";

// The canvas's own defaults (a base font, how a link looks) are in a cascade layer declared first,
// so a page's own styles win over them, layered or not, as they would in a browser; an unlayered
// default would beat every rule a page keeps in @layer (Astryx keeps all of its rules so).
// When the system asks for reduced motion, the canvas runs no animation or transition: each ends
// at once, as its end state. Its !important there wins over a page's own, important or not, since
// important declarations in the first layer win; export is unchanged, so the design keeps them.
export function frameSrcdoc() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><style>@layer ninerr-canvas{body{font-family:system-ui,sans-serif}a[data-ninerr-href]{color:LinkText;text-decoration:underline}@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}}}html,body{margin:0;padding:0}[data-ninerr-root]{position:relative;min-height:100vh}</style></head><body><div data-ninerr-root inert></div></body></html>`;
}

/**
 * Create the sandboxed frame inside `container` and resolve with a renderer bound to it.
 * The parent drives the frame's DOM directly (same origin, scripts disabled inside).
 */
export function mountSandboxedRenderer(container) {
  const owner = container.ownerDocument;
  const frame = owner.createElement("iframe");
  frame.setAttribute("sandbox", FRAME_SANDBOX);
  frame.setAttribute("title", "Canvas");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.srcdoc = frameSrcdoc();
  return new Promise((resolve) => {
    frame.addEventListener("load", () => {
      const frameDocument = frame.contentDocument;
      // Defense in depth: nothing in the frame may navigate it or submit anything.
      for (const type of ["click", "auxclick", "submit", "keydown"]) {
        frameDocument.addEventListener(type, (event) => {
          if (type !== "keydown" || event.key === "Enter") {
            if (type === "keydown" && !event.target?.closest?.("a, button, input, summary")) return;
            event.preventDefault();
          }
        }, true);
      }
      resolve({ frame, renderer: createRenderer(frameDocument.querySelector("[data-ninerr-root]")) });
    }, { once: true });
    container.appendChild(frame);
  });
}

/**
 * A renderer over `root` (an element). It keeps only the node -> element map, which is
 * derived and rebuilt from the document; the document stays the sole source of truth.
 */
export function createRenderer(root) {
  const doc = root.ownerDocument;
  const elements = new Map();
  // Each layer's stylesheet, as a <style> in the frame's head scoped to that layer (#283).
  const sheets = new Map();
  // Each frame's number in this renderer, for names that must be the frame's own (#299).
  const frameNumbers = new Map();
  const stats = { created: 0, updated: 0, removed: 0, dropped: 0 };

  function applySheet(nodeId, css) {
    const current = sheets.get(nodeId);
    if (css === null) {
      current?.remove();
      sheets.delete(nodeId);
      return;
    }
    const escaped = nodeId.replace(/["\\\n\r\f]/gu, (char) => `\\${char.codePointAt(0).toString(16)} `);
    const text = `@scope ([data-ninerr-id="${escaped}"]) {\n${css}\n}`;
    // Unchanged: already checked, pruned and drawn (#301 review: the walk below is not cheap).
    if (current !== undefined && current.textContent === text) return;
    const element = current ?? doc.createElement("style");
    element.textContent = text;
    if (!current) {
      element.setAttribute("data-ninerr-sheet", nodeId);
      doc.head.append(element);
      sheets.set(nodeId, element);
    }
    // The browser's parser is the final judge: the sheet must be exactly the one @scope rule,
    // or something in it ended the scope and would style other frames (#298 review).
    const rules = element.sheet?.cssRules;
    const view = doc.defaultView;
    const ScopeRule = view?.CSSScopeRule;
    if (rules === undefined || rules.length !== 1 || ScopeRule === undefined || !(rules[0] instanceof ScopeRule)) {
      element.remove();
      sheets.delete(nodeId);
      stats.dropped += 1;
      return;
    }
    // Rules that are global even inside @scope (@property, @font-face, @layer order, @page,
    // …) would act on every frame: they are removed, the rest is kept. @keyframes are global
    // too, but named: each is kept under a name of this frame's (grow becomes grow--n<number>,
    // the frame's own number in this renderer), and the sheet's animations name it so, so
    // frames' animations never meet (#299).
    const kept = [view.CSSStyleRule, view.CSSMediaRule, view.CSSSupportsRule, view.CSSContainerRule, ScopeRule, view.CSSLayerBlockRule, view.CSSStartingStyleRule, view.CSSNestedDeclarations].filter((type) => type !== undefined);
    if (!frameNumbers.has(nodeId)) frameNumbers.set(nodeId, frameNumbers.size + 1);
    const suffix = `--n${frameNumbers.get(nodeId)}`;
    // Keyed and valued as the names are written in CSS (escaped), as declarations hold them.
    const animations = new Map();
    const prune = (group) => {
      for (let index = group.cssRules.length - 1; index >= 0; index -= 1) {
        const rule = group.cssRules[index];
        if (view.CSSKeyframesRule !== undefined && rule instanceof view.CSSKeyframesRule) {
          // Renamed once: a rule put back by a rebuild below is pruned again.
          if (!rule.name.endsWith(suffix)) {
            const renamed = `${rule.name}${suffix}`;
            animations.set(view.CSS.escape(rule.name), view.CSS.escape(renamed));
            rule.name = renamed;
          }
        } else if (!kept.some((type) => rule instanceof type)) {
          group.deleteRule(index);
          stats.dropped += 1;
        } else if (rule.cssRules !== undefined) prune(rule);
      }
    };
    prune(rules[0]);
    // Viewport lengths in its declarations, as in a layer's style (DESIGN_VIEWPORT), and ids
    // in its selectors as the canvas draws them (drawnSelector).
    const lengths = (group, depth) => {
      for (let index = 0; index < group.cssRules.length; index += 1) {
        let rule = group.cssRules[index];
        // A nested @scope's start and limit are selectors too, but read-only: the rule is put
        // back in its place with them drawn (#310). insertRule adds one rule to this group, so
        // nothing reaches past the frame's own @scope; a rule the browser refuses stays as it was,
        // and the rule put back is pruned again. Each rebuild parses what the rule holds again, so
        // only scopes nested at most MAX_SCOPE_DEPTH deep are rebuilt: deeper, their ids stay
        // undrawn rather than the canvas stalling. A scope with no start ("@scope to (#x)") is
        // left as written.
        if (rule instanceof ScopeRule && typeof rule.start === "string" && depth <= MAX_SCOPE_DEPTH) {
          const prelude = `@scope (${rule.start})${typeof rule.end === "string" ? ` to (${rule.end})` : ""}`;
          const drawnPrelude = `@scope (${drawnSelector(rule.start)})${typeof rule.end === "string" ? ` to (${drawnSelector(rule.end)})` : ""}`;
          if (drawnPrelude !== prelude && rule.cssText.startsWith(`${prelude} {`)) {
            const text = `${drawnPrelude}${rule.cssText.slice(prelude.length)}`;
            try {
              group.deleteRule(index);
              group.insertRule(text, index);
            } catch {
              group.insertRule(rule.cssText, index);
            }
            rule = group.cssRules[index];
            prune(rule);
          }
        }
        if (typeof rule.selectorText === "string") {
          const written = rule.selectorText;
          const drawn = drawnSelector(written);
          if (drawn !== written) rule.selectorText = drawn;
        }
        // The rule's declarations as written, rewritten at once: a shorthand that waits on
        // var() keeps its text only here, and writing properties one by one would reorder a
        // logical and physical pair, which changes which wins.
        if (rule.style !== undefined) {
          const written = rule.style.cssText;
          const drawn = designViewportLengths(renamedAnimations(written, animations));
          if (drawn !== written) rule.style.cssText = drawn;
        }
        if (rule.cssRules !== undefined) lengths(rule, depth + 1);
      }
    };
    lengths(rules[0], 0);
  }

  function build(node) {
    const plan = planElement(node);
    const element = plan.namespace === "svg" ? doc.createElementNS(SVG_NS, plan.tag) : doc.createElement(plan.tag);
    element.setAttribute("data-ninerr-id", node.id);
    stats.created += 1;
    apply(element, node, plan);
    elements.set(node.id, element);
    return element;
  }

  function apply(element, node, plan, { sheet = true } = {}) {
    for (const attribute of [...element.attributes]) {
      // The renderer's own markers stay: identity, mode, and an instance's chain or staleness.
      if (!RENDERER_ATTRIBUTES.has(attribute.name) && !Object.hasOwn(plan.attributes, attribute.name)) element.removeAttribute(attribute.name);
    }
    // The design-system modes this layer takes (ADR-0004): its props.modes, as the attribute the
    // compiled token sheet selects on. tokens.mjs's modeAttribute reads them the same way; this
    // module has no imports.
    const modes = modeAttributeOf(node.props);
    if (modes === null) element.removeAttribute("data-ninerr-mode");
    else if (element.getAttribute("data-ninerr-mode") !== modes) element.setAttribute("data-ninerr-mode", modes);
    for (const [name, value] of Object.entries(plan.attributes)) {
      if (element.getAttribute(name) !== value) element.setAttribute(name, value);
    }
    element.removeAttribute("style");
    let rejected = 0;
    // As in CSS, a declaration marked !important wins over a plain one whatever their order,
    // also where shorthands overlap (border-top and border-color): the plain ones are applied
    // first, then the important ones, each in the plan's order.
    const entries = Object.entries(plan.style);
    for (const pass of [false, true]) {
      for (const [name, raw] of entries) {
        const important = /\s*!important$/iu.test(raw);
        if (important !== pass) continue;
        const value = important ? raw.replace(/\s*!important$/iu, "") : raw;
        element.style.setProperty(name, designViewportLengths(value), important ? "important" : "");
        // The browser's CSS parser is the final judge; count what it refused.
        if (element.style.getPropertyValue(name) === "") rejected += 1;
      }
    }
    element.setAttribute("data-ninerr-type", node.type);
    // A drawn instance layer's scoped stylesheet is its component node's, already applied by id.
    if (sheet) applySheet(node.id, plan.stylesheet);
    stats.dropped += plan.dropped + rejected;
    const first = element.firstChild;
    const textNode = first !== null && first.nodeType === 3 && first.__ninerrText ? first : null;
    if (plan.text === null) textNode?.remove();
    else if (textNode) textNode.data = plan.text;
    else {
      const created = doc.createTextNode(plan.text);
      created.__ninerrText = true;
      element.insertBefore(created, element.firstChild);
    }
  }

  // Put exactly `ids` (in order) as the element children of `parent`, after any text node.
  function reconcileChildren(parent, ids, document) {
    let cursor = parent.firstChild !== null && parent.firstChild.__ninerrText ? parent.firstChild.nextSibling : parent.firstChild;
    const wanted = new Set(ids);
    for (const id of ids) {
      const node = document.nodes[id];
      const element = elements.get(id) ?? buildTree(node, document);
      if (element !== cursor) parent.insertBefore(element, cursor);
      else cursor = cursor.nextSibling;
    }
    // Anything left after the wanted children is no longer a child here.
    for (let extra = cursor; extra !== null;) {
      const next = extra.nextSibling;
      const id = extra.getAttribute?.("data-ninerr-id");
      if (id && !wanted.has(id)) {
        if (!Object.hasOwn(document.nodes, id)) forget(extra);
        extra.remove();
      }
      extra = next;
    }
  }

  function buildTree(node, document) {
    if (node.type === "component-instance") return buildInstance(node, document);
    const element = build(node);
    reconcileChildren(element, node.children, document);
    return element;
  }

  // An instance's element is its own (registered under its id); what it draws inside is built from
  // its expansion and registered under nothing, so it never stands for its component's nodes.
  function drawView(view) {
    const plan = planElement(view);
    const element = plan.namespace === "svg" ? doc.createElementNS(SVG_NS, plan.tag) : doc.createElement(plan.tag);
    element.setAttribute("data-ninerr-id", view.id);
    element.setAttribute("data-ninerr-instance", JSON.stringify(view.chain));
    apply(element, view, plan, { sheet: false });
    if (view.stale) element.setAttribute("data-ninerr-stale", "");
    for (const child of view.children) element.appendChild(drawView(child));
    return element;
  }
  // Draw `node`'s expansion into its element; returns the element, a new one when the
  // component's root takes another tag (the element is then replaced in place and re-registered).
  function expandInto(element, node, document) {
    const view = expandInstance(document, node.id);
    if (view === null) {
      for (const child of [...element.children]) child.remove();
      element.setAttribute("data-ninerr-stale", "");
      element.removeAttribute("data-ninerr-component");
      return element;
    }
    const plan = planElement(view);
    const namespace = plan.namespace === "svg" ? SVG_NS : "http://www.w3.org/1999/xhtml";
    let target = element;
    if (element.localName !== plan.tag || element.namespaceURI !== namespace) {
      target = namespace === SVG_NS ? doc.createElementNS(SVG_NS, plan.tag) : doc.createElement(plan.tag);
      target.setAttribute("data-ninerr-id", node.id);
      element.replaceWith(target);
      elements.set(node.id, target);
    }
    for (const child of [...target.children]) child.remove();
    // A slot on the component's root that cannot draw its choice marks the instance itself.
    if (view.stale) target.setAttribute("data-ninerr-stale", "");
    else target.removeAttribute("data-ninerr-stale");
    // The component it draws, whose root it is: a layer an instance's root override names.
    target.setAttribute("data-ninerr-component", node.props.componentId);
    apply(target, { ...view, id: node.id, type: node.type }, plan);
    for (const child of view.children) target.appendChild(drawView(child));
    return target;
  }
  function buildInstance(node, document) {
    return expandInto(build(node), node, document);
  }

  function forget(element) {
    // An instance's drawn layers stand for no layer of their own: only the elements registered
    // under an id are forgotten.
    for (const descendant of [element, ...element.querySelectorAll("[data-ninerr-id]:not([data-ninerr-instance])")]) {
      const id = descendant.getAttribute("data-ninerr-id");
      elements.delete(id);
      applySheet(id, null);
      stats.removed += 1;
    }
  }

  // The compiled design tokens (ADR-0004): one sheet, given whole by the canvas, which compiles it
  // from the design-system node. It may hold only custom properties, on :root and on mode
  // selectors; anything else, or a sheet that could fetch, is not drawn at all.
  let tokenSheet = null;
  function setTokens(css) {
    if (typeof css !== "string" || css === "" || !safeStylesheet(css)) {
      tokenSheet?.remove();
      tokenSheet = null;
      return;
    }
    if (tokenSheet !== null && tokenSheet.textContent === css) return;
    if (tokenSheet === null) {
      tokenSheet = doc.createElement("style");
      tokenSheet.setAttribute("data-ninerr-tokens", "");
      doc.head.prepend(tokenSheet);
    }
    tokenSheet.textContent = css;
    const rules = [...(tokenSheet.sheet?.cssRules ?? [])];
    const onlyTokens = rules.every((rule) => typeof rule.selectorText === "string"
      && (rule.selectorText === ":root" || /^\[data-ninerr-mode~="[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+"\]$/u.test(rule.selectorText))
      && [...rule.style].every((property) => property.startsWith("--")));
    if (!onlyTokens) {
      tokenSheet.remove();
      tokenSheet = null;
    }
  }

  return {
    stats,
    setTokens,
    /** Render `document` from scratch. */
    render(document) {
      for (const element of elements.values()) element.remove();
      elements.clear();
      for (const sheet of sheets.values()) sheet.remove();
      sheets.clear();
      root.replaceChildren();
      reconcileChildren(root, drawnRoots(document), document);
    },
    /**
     * Bring the DOM up to date after a change touching `affectedNodeIds` (as history reports
     * them: the changed nodes plus the parents whose children changed). Only those nodes
     * and the subtrees they gain are touched.
     */
    patch(document, affectedNodeIds) {
      for (const id of affectedNodeIds) {
        const element = elements.get(id);
        if (!Object.hasOwn(document.nodes, id)) {
          if (element) {
            forget(element);
            element.remove();
          }
          continue;
        }
        const node = document.nodes[id];
        // An instance is drawn from its expansion, below.
        if (element && node.type !== "component-instance") {
          const plan = planElement(node);
          const namespace = plan.namespace === "svg" ? SVG_NS : "http://www.w3.org/1999/xhtml";
          let target = element;
          if (element.localName !== plan.tag || element.namespaceURI !== namespace) {
            // A changed tag or namespace needs a new element; its children move across.
            target = build(node);
            for (const child of [...element.childNodes]) if (!child.__ninerrText) target.appendChild(child);
            element.replaceWith(target);
          } else {
            apply(element, node, plan);
          }
          stats.updated += 1;
          reconcileChildren(target, node.children, document);
        }
      }
      // Each instance the change touches, or that draws a component it touched (nested ones too),
      // is drawn again, once.
      const redraw = new Set(affectedNodeIds.filter((id) => document.nodes[id]?.type === "component-instance"));
      const gone = affectedNodeIds.filter((id) => !Object.hasOwn(document.nodes, id));
      for (const id of instancesDrawing(document, [...definitionsAbove(document, affectedNodeIds), ...gone])) redraw.add(id);
      for (const id of redraw) {
        const element = elements.get(id);
        if (element) expandInto(element, document.nodes[id], document);
      }
      // Roots are reconciled every time; it touches only the top level.
      reconcileChildren(root, drawnRoots(document), document);
      for (const id of affectedNodeIds) {
        const node = document.nodes[id];
        const element = elements.get(id);
        if (node && element && node.parentId !== null) {
          const parent = elements.get(node.parentId);
          if (parent && element.parentNode !== parent) reconcileChildren(parent, document.nodes[node.parentId].children, document);
        }
      }
    },
    elementFor(nodeId) {
      return elements.get(nodeId) ?? null;
    },
    /** The node id of the rendered element at or above `target`, or null. */
    nodeIdFor(target) {
      // Inside an instance, the instance itself: its drawn layers are not layers of their own.
      const element = target?.closest?.("[data-ninerr-id]:not([data-ninerr-instance])");
      return element ? element.getAttribute("data-ninerr-id") : null;
    },
    /**
     * The layer inside an instance drawn at or above `target`: the outermost instance, the path of
     * nested instances inside it, and the component node drawn there (ADR-0005). Null outside one.
     */
    instanceTargetFor(target) {
      const element = target?.closest?.("[data-ninerr-instance]");
      if (!element) return null;
      let chain;
      try {
        chain = JSON.parse(element.getAttribute("data-ninerr-instance"));
      } catch {
        return null;
      }
      if (!Array.isArray(chain) || chain.length === 0 || chain.some((id) => typeof id !== "string")) return null;
      return { instanceId: chain[0], path: chain.slice(1), nodeId: element.getAttribute("data-ninerr-id") };
    },
    /** The element drawn for an instance target, or null. */
    elementForTarget({ instanceId, path, nodeId }) {
      const holder = elements.get(instanceId);
      if (!holder) return null;
      // The instance's own root: its component's root node.
      if (path.length === 0 && holder.getAttribute("data-ninerr-component") === nodeId) return holder;
      const chain = JSON.stringify([instanceId, ...path]);
      for (const element of holder.querySelectorAll("[data-ninerr-instance]")) {
        if (element.getAttribute("data-ninerr-id") === nodeId && element.getAttribute("data-ninerr-instance") === chain) return element;
      }
      return null;
    },
    get size() {
      return elements.size;
    },
  };
}
