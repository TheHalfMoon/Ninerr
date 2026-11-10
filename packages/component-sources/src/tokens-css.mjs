// Design tokens from a CSS file a person chooses: the custom properties a library declares for
// the page (its :root rules), read into the shape the token import plans from (light, dark and
// theme values by name). Light and dark come from CSS light-dark() (Astryx writes every colour so)
// and from dark-scheme rules (.dark, [data-theme="dark"], @media (prefers-color-scheme: dark)).
// Values Ninerr has no token type for (durations, easings, sizes) are kept out and listed, so
// they stay the library's own CSS. This reads text only: nothing is fetched or run.

export const TOKEN_CSS_LIMITS = Object.freeze({ bytes: 1024 * 1024, properties: 5000 });

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
  [/^--(z|z-index|layer)(-|$)/u, "a stacking order: Ninerr has no z-index token type"],
  [/^--size(-|$)/u, "an element size: Ninerr has no size token type"],
  [/^--border-width$|^--focus-outline-(width|style|offset)$/u, "a border or outline setting: Ninerr has no border token type"],
];

// The text with comments blanked out (strings kept), so braces and semicolons in comments and
// strings are not read as structure.
function withoutComments(text) {
  let out = "";
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      out += char;
      if (char === "\\") out += text[++index] ?? "";
      else if (char === quote) quote = null;
    } else if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 1;
      out += " ";
    } else {
      if (char === "\"" || char === "'") quote = char;
      out += char;
    }
  }
  return out;
}

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

// Each rule's selector and declarations, with the at-rules around it, read through nested blocks.
function rules(text) {
  const found = [];
  const stack = [];
  let start = 0;
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
    } else if (char === "\"" || char === "'") quote = char;
    else if (char === "{") {
      if (stack.length > 0) stack.at(-1).parent = true;
      stack.push({ prelude: text.slice(start, index).split(";").at(-1).trim(), body: index + 1, parent: false });
      start = index + 1;
    } else if (char === "}") {
      const open = stack.pop();
      if (open === undefined) throw new TokenCssError("The CSS has a closing brace with no opening one.");
      const body = text.slice(open.body, index);
      if (!open.parent && !open.prelude.startsWith("@")) found.push({ selector: open.prelude, body, within: stack.map((entry) => entry.prelude) });
      start = index + 1;
    }
  }
  if (stack.length > 0 || quote !== null) throw new TokenCssError("The CSS has an unclosed block or string.");
  return found;
}

const ROOT = /^(?::root|html|:host|:where\(:root\))$/u;
const DARK = /^(?:(?::root|html|:host))?(?:\.dark|\[data-theme=["']?dark["']?\]|\[data-color-scheme=["']?dark["']?\])$/u;
const DARK_MEDIA = /^@media\b.*prefers-color-scheme\s*:\s*dark/u;

// The value with each light-dark(a, b) replaced by a (light) or b (dark); null when it has none.
function inMode(value, mode) {
  const at = value.search(/\blight-dark\(/u);
  if (at === -1) return null;
  const open = value.indexOf("(", at);
  let depth = 0;
  let end = -1;
  for (let index = open; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")" && (depth -= 1) === 0) {
      end = index;
      break;
    }
  }
  const args = end === -1 ? [] : splitTop(value.slice(open + 1, end), ",").map((part) => part.trim());
  if (args.length !== 2) throw new TokenCssError(`light-dark() takes two values: ${value.slice(at, at + 80)}`);
  const rest = value.slice(end + 1);
  const chosen = mode === "light" ? args[0] : args[1];
  return value.slice(0, at) + chosen + (inMode(rest, mode) ?? rest);
}

/**
 * The tokens a CSS file declares for the page: { theme, light, dark } values by name (without the
 * leading --), `kept` (custom properties left native, with why), `skipped` (rules for other
 * selectors), and `source` ("astryx" when the file is Astryx's own CSS).
 */
export function tokensFromCss(text) {
  if (typeof text !== "string") throw new TokenCssError("The CSS is text.");
  if (new TextEncoder().encode(text).length > TOKEN_CSS_LIMITS.bytes) throw new TokenCssError(`The CSS is larger than ${TOKEN_CSS_LIMITS.bytes / 1024} KiB.`);
  const theme = Object.create(null);
  const light = Object.create(null);
  const dark = Object.create(null);
  const kept = [];
  const keptNames = new Set();
  let skipped = 0;
  let count = 0;
  for (const rule of rules(withoutComments(text))) {
    const selectors = splitTop(rule.selector, ",").map((part) => part.trim().replace(/\s+/gu, ""));
    const darkMedia = rule.within.some((prelude) => DARK_MEDIA.test(prelude));
    const scope = selectors.some((selector) => DARK.test(selector)) || (darkMedia && selectors.some((selector) => ROOT.test(selector))) ? "dark"
      : selectors.some((selector) => ROOT.test(selector)) && !rule.within.some((prelude) => /^@(media|supports|container)\b/u.test(prelude)) ? "root"
      : null;
    if (scope === null) {
      skipped += 1;
      continue;
    }
    for (const declaration of splitTop(rule.body, ";")) {
      const colon = declaration.indexOf(":");
      const name = declaration.slice(0, colon).trim();
      if (colon === -1 || !name.startsWith("--")) continue;
      const value = declaration.slice(colon + 1).trim().replace(/\s*!important$/iu, "");
      if ((count += 1) > TOKEN_CSS_LIMITS.properties) throw new TokenCssError(`The CSS declares more than ${TOKEN_CSS_LIMITS.properties} custom properties.`);
      const reason = KEPT.find(([pattern]) => pattern.test(name))?.[1];
      if (reason !== undefined) {
        if (!keptNames.has(name)) kept.push({ name, value, reason });
        keptNames.add(name);
        continue;
      }
      const key = name.slice(2);
      if (scope === "dark") {
        dark[key] = inMode(value, "dark") ?? value;
        continue;
      }
      const lightValue = inMode(value, "light");
      if (lightValue === null) theme[key] = value;
      else {
        light[key] = lightValue;
        dark[key] = inMode(value, "dark");
      }
    }
  }
  const source = /@layer\s+astryx-|\.astryx-|--astryx-/u.test(text) ? "astryx" : null;
  return { theme: { ...theme }, light: { ...light }, dark: { ...dark }, kept, skipped, source };
}
