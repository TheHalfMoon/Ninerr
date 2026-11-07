// React's unitless properties: a number given to any other one is in pixels.
const UNITLESS = new Set(["animationIterationCount", "aspectRatio", "borderImageOutset", "borderImageSlice", "borderImageWidth", "boxFlex", "boxFlexGroup", "boxOrdinalGroup", "columnCount", "columns", "flex", "flexGrow", "flexPositive", "flexShrink", "flexNegative", "flexOrder", "gridArea", "gridRow", "gridRowEnd", "gridRowSpan", "gridRowStart", "gridColumn", "gridColumnEnd", "gridColumnSpan", "gridColumnStart", "fontWeight", "lineClamp", "lineHeight", "opacity", "order", "orphans", "scale", "tabSize", "widows", "zIndex", "zoom", "fillOpacity", "floodOpacity", "stopOpacity", "strokeDasharray", "strokeDashoffset", "strokeMiterlimit", "strokeOpacity", "strokeWidth"]);

/** Whether a CSS value is one declaration's value: no ; outside quotes or brackets. */
function oneValue(value: string): boolean {
  let quote: string | null = null;
  let depth = 0;
  for (const char of value) {
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === "\"" || char === "'") quote = char;
    else if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) return false;
  }
  return quote === null && depth === 0;
}

/**
 * The declarations a React style object says, when it is only literal values, as CSS names
 * and values in source order: style={{ paddingTop: 4, color: "red" }} is [["padding-top",
 * "4px"], ["color", "red"]]. Null for anything else (a spread, a name or call, a computed key,
 * a template, an escape, a line break, a ; that would start another declaration), which stays
 * code (#398). `attribute` is the whole attribute as written, style={…}.
 */
export function readStyleObject(attribute: string): Array<[string, string]> | null {
  const match = /^style\s*=\s*\{\s*\{([\s\S]*)\}\s*\}$/u.exec(attribute.trim());
  if (match === null) return null;
  const body = match[1];
  const declarations: Array<[string, string]> = [];
  let at = 0;
  const space = () => { while (at < body.length && /\s/u.test(body[at])) at += 1; };
  const quoted = (): string | null => {
    const quote = body[at];
    if (quote !== '"' && quote !== "'") return null;
    const end = body.indexOf(quote, at + 1);
    if (end < 0) return null;
    const text = body.slice(at + 1, end);
    // Escapes and line breaks are not read: the style stays code.
    if (/[\\\r\n]/u.test(text)) return null;
    at = end + 1;
    return text;
  };
  for (space(); at < body.length; space()) {
    let key = quoted();
    if (key === null) {
      const name = /^[A-Za-z_$][A-Za-z0-9_$]*/u.exec(body.slice(at));
      if (name === null) return null;
      key = name[0];
      at += key.length;
    }
    space();
    if (body[at] !== ":") return null;
    at += 1;
    space();
    let value = quoted();
    if (value === null) {
      const number = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?![\w.$])/u.exec(body.slice(at));
      if (number === null) return null;
      at += number[0].length;
      const numeric = Number(number[0]);
      if (!Number.isFinite(numeric)) return null;
      // A vendor prefix does not change whether a property takes a unit: WebkitLineClamp is lineClamp.
      const unprefixed = key.replace(/^(?:Webkit|Moz|ms|O)([A-Z])/u, (_, letter: string) => letter.toLowerCase());
      value = numeric === 0 || UNITLESS.has(unprefixed) || key.startsWith("--") ? String(numeric) : `${numeric}px`;
    } else if (!oneValue(value)) return null;
    // backgroundColor is background-color; WebkitTransform and msTransition keep their prefix.
    const property = key.startsWith("--") || key.includes("-") ? key : key.replace(/^ms(?=[A-Z])/u, "-ms").replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
    declarations.push([property, value]);
    space();
    if (body[at] === ",") at += 1;
    else if (at < body.length) return null;
  }
  return declarations;
}

/**
 * A CSS property's name in a React style object: background-color is backgroundColor, a vendor
 * prefix is capitalized (WebkitTransform) except ms (msTransition), and a custom property keeps
 * its name, quoted.
 */
export function reactStyleKey(name: string): string {
  if (name.startsWith("--")) return JSON.stringify(name);
  const camel = (text: string) => text.replace(/-([a-z0-9])/gu, (_, letter: string) => letter.toUpperCase());
  if (name.startsWith("-ms-")) return camel(name.slice(1));
  if (name.startsWith("-")) {
    const key = camel(name.slice(1));
    return key[0].toUpperCase() + key.slice(1);
  }
  return camel(name);
}
