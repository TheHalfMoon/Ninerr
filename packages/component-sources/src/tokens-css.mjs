// Design tokens from a CSS file a person chooses: the custom properties a library declares for
// the page, read into the shape the token import plans from (light, dark and theme values by name).
// - The page's tokens are those of :root (or html, :host) rules, and of :scope rules inside an
//   @scope block (how Astryx's theme.css declares a theme), inside @layer blocks or none.
// - Light and dark come from CSS light-dark() (Astryx writes every colour so) and from dark-scheme
//   rules: .dark, [data-theme="dark"], and :root inside @media (prefers-color-scheme: dark).
// - Rules inside any other at-rule (another media query, @supports, @container) and rules for
//   other selectors are not the page's tokens: they are skipped and counted.
// - Values Ninerr has no token type for (durations, easings, sizes) are kept out and listed, so
//   they stay the library's own CSS.
// It reads text only: nothing is fetched or run. Work is linear in the text's length.

export const TOKEN_CSS_LIMITS = Object.freeze({ bytes: 1024 * 1024, properties: 5000, selectors: 64 });

export class TokenCssError extends Error {
  constructor(message) {
    super(message);
    this.name = "TokenCssError";
  }
}

// Kinds of value Ninerr's token types (ADR-0004) do not cover; converting them would change what
// they mean, so they stay native.
const KEPT = [
  [/^--_/u, "private to its library"],
  [/^--(duration|transition|delay)(-|$)/u, "a duration: Ninerr has no motion token type"],
  [/^--(ease|easing)(-|$)/u, "an easing: Ninerr has no motion token type"],
  [/^--(z|z-index)(-|$)/u, "a stacking order: Ninerr has no z-index token type"],
  [/^--size-/u, "an element size: Ninerr has no size token type"],
  [/^--border-width$|^--focus-outline-(width|style|offset)$/u, "a border or outline setting: Ninerr has no border token type"],
];

const ROOT = /^(?::root|html|:host|:where\(:root\))$/u;
const DARK = /^(?::root|html|:host)?(?:\.dark|\[data-theme=["']?dark["']?\]|\[data-color-scheme=["']?dark["']?\])$/u;
const DARK_MEDIA = new Set(["(prefers-color-scheme:dark)", "screenand(prefers-color-scheme:dark)", "alland(prefers-color-scheme:dark)"]);

// Split `text` at `separator` where it is outside strings and brackets.
function splitTop(text, separator) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
    } else if (char === "\"" || char === "'") quote = char;
    else if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

// The value with each light-dark(a, b) replaced by a (light) or b (dark); null when it has none.
function inMode(value, mode) {
  let out = "";
  let rest = value;
  let found = false;
  for (let at = rest.search(/\blight-dark\(/u); at !== -1; at = rest.search(/\blight-dark\(/u)) {
    found = true;
    const open = rest.indexOf("(", at);
    let depth = 0;
    let end = -1;
    for (let index = open; index < rest.length; index += 1) {
      if (rest[index] === "(") depth += 1;
      else if (rest[index] === ")" && (depth -= 1) === 0) {
        end = index;
        break;
      }
    }
    const args = end === -1 ? [] : splitTop(rest.slice(open + 1, end), ",").map((part) => part.trim());
    if (args.length !== 2) throw new TokenCssError(`light-dark() takes two values: ${rest.slice(at, at + 80)}`);
    out += rest.slice(0, at) + (mode === "light" ? args[0] : args[1]);
    rest = rest.slice(end + 1);
  }
  return found ? out + rest : null;
}

const normal = (selector) => selector.trim().replace(/\s+/gu, "");

// A nested rule's selectors, with its parent rule's: & stands for the parent, or it is inside it.
function nestedSelectors(parent, own) {
  if (parent === null) return own;
  return parent.flatMap((outer) => own.map((inner) => (inner.includes("&") ? inner.replaceAll("&", outer) : `${outer} ${inner}`)));
}

/**
 * The tokens a CSS file declares for the page: { theme, light, dark } values by name (without the
 * leading --), `kept` (custom properties left native, with why), `skipped` (rules that are not
 * the page's tokens), and `source` ("astryx" when the file is Astryx's own CSS). Later
 * declarations replace earlier ones, as in the cascade.
 */
export function tokensFromCss(text) {
  if (typeof text !== "string") throw new TokenCssError("The CSS is text.");
  if (new TextEncoder().encode(text).length > TOKEN_CSS_LIMITS.bytes) throw new TokenCssError(`The CSS is larger than ${TOKEN_CSS_LIMITS.bytes / 1024} KiB.`);
  const theme = Object.create(null);
  const light = Object.create(null);
  const dark = Object.create(null);
  const kept = new Map();
  let skipped = 0;
  let count = 0;

  // Take one rule's own declarations, in the scope its selectors and at-rules give it.
  const take = (entry, declarations) => {
    const properties = splitTop(declarations, ";").map((declaration) => {
      const colon = declaration.indexOf(":");
      return colon === -1 ? null : [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
    }).filter((pair) => pair !== null && pair[0].startsWith("--"));
    if (properties.length === 0) return;
    const selectors = entry.blocked ? [] : entry.selectors.map(normal);
    const isRoot = selectors.some((selector) => ROOT.test(selector) || (entry.scoped && selector === ":scope"));
    const scope = selectors.some((selector) => DARK.test(selector)) || (entry.dark && isRoot) ? "dark" : isRoot ? "root" : null;
    if (scope === null) {
      skipped += 1;
      return;
    }
    for (const [name, raw] of properties) {
      if ((count += 1) > TOKEN_CSS_LIMITS.properties) throw new TokenCssError(`The CSS declares more than ${TOKEN_CSS_LIMITS.properties} custom properties.`);
      const value = raw.replace(/\s*!important$/iu, "");
      const reason = KEPT.find(([pattern]) => pattern.test(name))?.[1];
      if (reason !== undefined) {
        kept.set(name, { name, value, reason });
        continue;
      }
      const key = name.slice(2);
      if (scope === "dark") {
        dark[key] = inMode(value, "dark") ?? value;
        continue;
      }
      const lightValue = inMode(value, "light");
      if (lightValue === null) {
        // A plain value is the same in both modes: it replaces any light and dark values before it.
        theme[key] = value;
        delete light[key];
        delete dark[key];
      } else {
        light[key] = lightValue;
        dark[key] = inMode(value, "dark");
        delete theme[key];
      }
    }
  };

  // One pass over the text: a stack of open blocks, each knowing its context from when it opened.
  // A rule's own text is gathered around the blocks nested in it (CSS nesting).
  const stack = [];
  const outside = { blocked: false, dark: false, scoped: false, selectors: null, rule: false, own: "", cursor: 0 };
  const current = () => stack.at(-1) ?? outside;
  let start = 0;
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      // A comment is no part of the text around it.
      const parent = current();
      if (parent.rule) parent.own += text.slice(parent.cursor, index);
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 1;
      parent.cursor = index + 1;
      start = index + 1;
      continue;
    }
    if (char === "\"" || char === "'") quote = char;
    else if (char === "{") {
      const parent = current();
      const head = text.slice(start, index);
      const cut = head.lastIndexOf(";") + 1;
      // What comes before a nested rule's selector is its parent's own text, and comes first.
      if (parent.rule) {
        take(parent, parent.own + text.slice(parent.cursor, start + cut));
        parent.own = "";
      }
      const prelude = head.slice(cut).trim();
      const entry = { blocked: parent.blocked, dark: parent.dark, scoped: parent.scoped, selectors: parent.selectors, rule: false, own: "", cursor: index + 1 };
      if (prelude.startsWith("@")) {
        const name = prelude.slice(1).split(/[\s(]/u, 1)[0].toLowerCase();
        if (name === "scope") entry.scoped = true;
        else if (name === "media" && DARK_MEDIA.has(normal(prelude.slice(6)).toLowerCase())) entry.dark = true;
        else if (name !== "layer") entry.blocked = true;
      } else {
        entry.rule = true;
        const selectors = nestedSelectors(parent.rule ? parent.selectors : null, splitTop(prelude, ","));
        // A rule nested so that its selectors multiply past the limit is not read.
        if (selectors.length > TOKEN_CSS_LIMITS.selectors) {
          entry.blocked = true;
          entry.selectors = [];
        } else entry.selectors = selectors;
      }
      stack.push(entry);
      start = index + 1;
    } else if (char === "}") {
      const entry = stack.pop();
      if (entry === undefined) throw new TokenCssError("The CSS has a closing brace with no opening one.");
      if (entry.rule) take(entry, entry.own + text.slice(entry.cursor, index));
      current().cursor = index + 1;
      start = index + 1;
    } else if (char === ";" && !current().rule) start = index + 1;
  }
  if (stack.length > 0 || quote !== null) throw new TokenCssError("The CSS has an unclosed block or string.");
  const source = /@layer\s+astryx-|\.astryx-|--astryx-|data-astryx-theme/u.test(text) ? "astryx" : null;
  return { theme: { ...theme }, light: { ...light }, dark: { ...dark }, kept: [...kept.values()], skipped, source };
}
