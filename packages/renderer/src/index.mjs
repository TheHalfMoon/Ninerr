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
const UNSAFE_STYLE = /url\s*\(|image-set|expression\s*\(|javascript:|vbscript:|@import|behavior\s*:|-moz-binding|[\\;{}<>]/iu;
// A stylesheet that could fetch or execute is not drawn at all. It is judged with its escapes
// decoded: a comment can hide a url( from a browser but never create one, so this raw view
// holds every function and at-rule the browser would see. The frame's policy loads nothing but
// data: URLs in any case.
// The host takes a stylesheet of up to 2 MiB in UTF-8, which is at most this many characters.
const MAX_STYLESHEET = 2 * 1024 * 1024;
const UNSAFE_STYLESHEET = /url\s*\(|image-set\s*\(|image\s*\(|(?:^|[^-\w])src\(|expression\s*\(|javascript:|vbscript:|@import|behavior\s*:|-moz-binding|<\/style/u;
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

/** A short, stable hash of a layer's id, for names that must be the layer's own. */
function frameHash(nodeId) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < nodeId.length; index += 1) hash = Math.imul(hash ^ nodeId.charCodeAt(index), 0x01000193) >>> 0;
  return hash.toString(36);
}

const ANIMATION_DECLARATION = /(^|;\s*)(animation(?:-name)?\s*:\s*)([^;"']*)(?=;|$)/giu;
const ANIMATION_NAME = /(^|[\s,])(-?[A-Za-z_][\w-]*)(?=$|[\s,!])/gu;

/**
 * Declarations (a rule's cssText as the browser writes it) with the animation names in
 * `renamed` written as their frame's names, in animation and animation-name only; a quoted
 * name and everything else are left as written.
 */
export function renamedAnimations(cssText, renamed) {
  if (renamed.size === 0 || !/animation/iu.test(cssText)) return cssText;
  return cssText.replace(ANIMATION_DECLARATION, (whole, start, property, value) => start + property + value.replace(ANIMATION_NAME, (token, before, name) => (renamed.has(name) ? before + renamed.get(name) : token)));
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
      if (typeof value !== "string" || !STYLE_NAME.test(name) || value.length > MAX_VALUE || UNSAFE_STYLE.test(value)) dropped += 1;
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
  return { tag, namespace, attributes, style, text, stylesheet, dropped };
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

export function frameSrcdoc() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><style>html,body{margin:0;padding:0}body{font-family:system-ui,sans-serif}[data-ninerr-root]{position:relative;min-height:100vh}a[data-ninerr-href]{color:LinkText;text-decoration:underline}</style></head><body><div data-ninerr-root inert></div></body></html>`;
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
    // too, but named: each is kept under a name of this frame's (grow becomes grow--n<hash>),
    // and the sheet's animations name it so, so frames' animations never meet (#299).
    const kept = [view.CSSStyleRule, view.CSSMediaRule, view.CSSSupportsRule, view.CSSContainerRule, ScopeRule, view.CSSLayerBlockRule, view.CSSStartingStyleRule, view.CSSNestedDeclarations].filter((type) => type !== undefined);
    const suffix = `--n${frameHash(nodeId)}`;
    const animations = new Map();
    const prune = (group) => {
      for (let index = group.cssRules.length - 1; index >= 0; index -= 1) {
        const rule = group.cssRules[index];
        if (view.CSSKeyframesRule !== undefined && rule instanceof view.CSSKeyframesRule) {
          // Renamed once: a rule put back by a rebuild below is pruned again.
          if (!rule.name.endsWith(suffix)) {
            const renamed = `${rule.name}${suffix}`;
            animations.set(rule.name, renamed);
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

  function apply(element, node, plan) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name !== "data-ninerr-id" && !Object.hasOwn(plan.attributes, attribute.name)) element.removeAttribute(attribute.name);
    }
    for (const [name, value] of Object.entries(plan.attributes)) {
      if (element.getAttribute(name) !== value) element.setAttribute(name, value);
    }
    element.removeAttribute("style");
    let rejected = 0;
    for (const [name, raw] of Object.entries(plan.style)) {
      const important = /\s*!important$/iu.test(raw);
      const value = important ? raw.replace(/\s*!important$/iu, "") : raw;
      element.style.setProperty(name, designViewportLengths(value), important ? "important" : "");
      // The browser's CSS parser is the final judge; count what it refused.
      if (element.style.getPropertyValue(name) === "") rejected += 1;
    }
    element.setAttribute("data-ninerr-type", node.type);
    applySheet(node.id, plan.stylesheet);
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
    const element = build(node);
    reconcileChildren(element, node.children, document);
    return element;
  }

  function forget(element) {
    for (const descendant of [element, ...element.querySelectorAll("[data-ninerr-id]")]) {
      const id = descendant.getAttribute("data-ninerr-id");
      elements.delete(id);
      applySheet(id, null);
      stats.removed += 1;
    }
  }

  return {
    stats,
    /** Render `document` from scratch. */
    render(document) {
      for (const element of elements.values()) element.remove();
      elements.clear();
      for (const sheet of sheets.values()) sheet.remove();
      sheets.clear();
      root.replaceChildren();
      reconcileChildren(root, document.rootIds, document);
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
        if (element) {
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
      // Roots are reconciled every time; it touches only the top level.
      reconcileChildren(root, document.rootIds, document);
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
      const element = target?.closest?.("[data-ninerr-id]");
      return element ? element.getAttribute("data-ninerr-id") : null;
    },
    get size() {
      return elements.size;
    },
  };
}
