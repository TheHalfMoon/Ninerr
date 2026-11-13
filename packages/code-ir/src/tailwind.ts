import { CodeIrValidationError } from "./errors.ts";

export interface TokenMapping {
  fromClass: string;
  toToken: string;
}

export interface TokenMapResult {
  preserved: string[];
  mapped: { fromClass: string; toToken: string }[];
  unmapped: string[];
}

/**
 * Tailwind class lists are preserved verbatim. Mapping to design tokens
 * happens only on exact caller-supplied matches; nothing is evaluated.
 */
export function tokenizeClassList(className: string): string[] {
  if (typeof className !== "string") throw new CodeIrValidationError("class list must be a string");
  if (className.length > 4096) throw new CodeIrValidationError("class list exceeds 4096 characters");
  return className.split(/\s+/u).filter((entry) => entry !== "");
}

export function mapClassTokens(className: string, mapping: TokenMapping[]): TokenMapResult {
  const preserved = tokenizeClassList(className);
  if (!Array.isArray(mapping) || mapping.length > 512) {
    throw new CodeIrValidationError("token mapping must be a bounded array");
  }
  const table = new Map<string, string>();
  for (const entry of mapping) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new CodeIrValidationError("token mapping entries must be objects");
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.fromClass !== "string" || record.fromClass === "" || typeof record.toToken !== "string" || record.toToken === "") {
      throw new CodeIrValidationError("token mapping entries need non-empty fromClass and toToken");
    }
    table.set(record.fromClass, record.toToken);
  }
  const mapped: { fromClass: string; toToken: string }[] = [];
  const unmapped: string[] = [];
  for (const token of preserved) {
    const toToken = table.get(token);
    if (toToken === undefined) unmapped.push(token);
    else mapped.push({ fromClass: token, toToken });
  }
  return { preserved, mapped, unmapped };
}

// ---------- export: a layer's style as Tailwind classes ----------

// Declarations a Tailwind utility says exactly, by property and value.
const KEYWORD_UTILITIES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  display: { block: "block", "inline-block": "inline-block", inline: "inline", flex: "flex", "inline-flex": "inline-flex", grid: "grid", "inline-grid": "inline-grid", contents: "contents", none: "hidden" },
  position: { static: "static", relative: "relative", absolute: "absolute", fixed: "fixed", sticky: "sticky" },
  "flex-direction": { row: "flex-row", "row-reverse": "flex-row-reverse", column: "flex-col", "column-reverse": "flex-col-reverse" },
  "flex-wrap": { wrap: "flex-wrap", nowrap: "flex-nowrap", "wrap-reverse": "flex-wrap-reverse" },
  // items-start and justify-end are flex-start and flex-end: start and end, which differ in a
  // reversed or wrap-reversed flex box, are arbitrary properties.
  "align-items": { "flex-start": "items-start", center: "items-center", "flex-end": "items-end", stretch: "items-stretch", baseline: "items-baseline" },
  "justify-content": { "flex-start": "justify-start", center: "justify-center", "flex-end": "justify-end", "space-between": "justify-between", "space-around": "justify-around", "space-evenly": "justify-evenly" },
  "text-align": { left: "text-left", center: "text-center", right: "text-right", justify: "text-justify", start: "text-start", end: "text-end" },
  "font-style": { italic: "italic", normal: "not-italic" },
  overflow: { hidden: "overflow-hidden", auto: "overflow-auto", scroll: "overflow-scroll", visible: "overflow-visible" },
  "box-sizing": { "border-box": "box-border", "content-box": "box-content" },
});

// Properties whose Tailwind utility takes any length as an arbitrary value: `p-[12px]`. Each
// prefix sets that one property and nothing else (Tailwind's own utilities for them).
const LENGTH_PREFIXES: Readonly<Record<string, string>> = Object.freeze({
  padding: "p", "padding-top": "pt", "padding-right": "pr", "padding-bottom": "pb", "padding-left": "pl",
  margin: "m", "margin-top": "mt", "margin-right": "mr", "margin-bottom": "mb", "margin-left": "ml",
  gap: "gap", "column-gap": "gap-x", "row-gap": "gap-y",
  width: "w", height: "h", "min-width": "min-w", "min-height": "min-h", "max-width": "max-w", "max-height": "max-h",
  top: "top", right: "right", bottom: "bottom", left: "left", inset: "inset",
  "border-radius": "rounded", "z-index": "z", opacity: "opacity",
});
// Font weights as numbers: font-bold and the rest are theme values a project can redefine.
const NUMBER_PREFIXES: Readonly<Record<string, string>> = Object.freeze({ "font-weight": "font" });

// Whether two properties can set the same thing. Two classes on one element are applied in the
// order of Tailwind's stylesheet, not the order they are written in, so properties that overlap
// stay a style, where the later one wins as it does on the canvas. They overlap when one is a
// shorthand of the other (padding and padding-top, border-top and border-top-color); in the
// box-edge families, when either is logical or names no side (margin-left and
// margin-inline-start, border-color and border-top, inset and top, width and inline-size), but not
// two physical sides (top and left, margin-top and margin-left); and in the pairs below.
const LOGICAL = /(?:^|-)(?:inline|block)(?:-|$)/u;
const SIDE = /(?:^|-)(?:top|right|bottom|left|inline|block|start|end)(?:-|$)/u;
const EDGE_FAMILY = /^(?:margin|padding|border|inset|top|right|bottom|left|scroll-margin|scroll-padding|width|height|min-width|max-width|min-height|max-height|inline-size|block-size|min-inline-size|max-inline-size|min-block-size|max-block-size)(?:-|$)/u;
const EDGE_ROOT = (property: string) => /^(?:top|right|bottom|left|inset)(?:-|$)/u.test(property) ? "inset" : /^(?:(?:min|max)-)?(?:width|height|inline-size|block-size)$/u.test(property) ? "size" : /^scroll-(?:margin|padding)/u.exec(property)?.[0] ?? property.split("-")[0]!;
const PAIRS: readonly (readonly [RegExp, RegExp])[] = [
  [/^font$/u, /^line-height$/u],
  [/^place-items$/u, /^(?:align|justify)-items$/u],
  [/^place-content$/u, /^(?:align|justify)-content$/u],
  [/^place-self$/u, /^(?:align|justify)-self$/u],
  [/^flex-flow$/u, /^flex-(?:direction|wrap)$/u],
  [/^(?:grid-)?gap$/u, /^(?:grid-)?(?:row|column)-gap$/u],
  [/^columns$/u, /^column-(?:width|count)$/u],
  [/^grid-area$/u, /^grid-(?:row|column)(?:-|$)/u],
];
function overlap(a: string, b: string): boolean {
  if (a.startsWith("--") || b.startsWith("--")) return false;
  if (a === "all" || b === "all" || b.startsWith(`${a}-`) || a.startsWith(`${b}-`)) return true;
  if (EDGE_FAMILY.test(a) && EDGE_FAMILY.test(b) && EDGE_ROOT(a) === EDGE_ROOT(b)) {
    if (LOGICAL.test(a) || LOGICAL.test(b)) return true;
    // A name with no side (border-color, inset) covers every side; two sides do not meet.
    if (EDGE_ROOT(a) !== "size" && (!SIDE.test(a) || !SIDE.test(b))) return true;
  }
  return PAIRS.some(([x, y]) => (x.test(a) && y.test(b)) || (x.test(b) && y.test(a)));
}
// A plain length, number or percentage (what the prefixes above take without a type hint).
const PLAIN_LENGTH = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vh|vw|vmin|vmax|ch|ex)?$/u;

/**
 * A Tailwind arbitrary value: spaces become underscores and an underscore is escaped, as
 * Tailwind reads them back. A double-quoted string is written single-quoted, which CSS reads
 * the same (`"Inter", serif` is `'Inter',_serif`). Null for a value a class cannot carry (both
 * kinds of quote, a backslash or a bracket that would end it early, or a line break).
 */
function arbitrary(value: string): string | null {
  // An & would make the class be written as a JavaScript string, which doubles its backslashes.
  if (/[\\[\]\r\n\t&]/u.test(value) || (value.includes("\"") && value.includes("'"))) return null;
  // Each space its own underscore: two spaces inside a quoted string are two.
  return value.trim().replace(/"/gu, "'").replace(/_/gu, "\\_").replace(/ /gu, "_");
}

/**
 * A layer's style as Tailwind classes, one per declaration, that set exactly what the style
 * says: a utility where one says it exactly, an arbitrary value for a length (`p-[12px]`), and
 * otherwise an arbitrary property (`[color:#1d4ed8]`). A declaration no class can carry stays in
 * `left`, for the caller to keep as a style, and so does every property that overlaps another in
 * the style (overlap), and `all`.
 */
export function styleToTailwind(style: Readonly<Record<string, string>>): { classes: string[]; left: Record<string, string> } {
  const classes: string[] = [];
  const left: Record<string, string> = {};
  const names = Object.keys(style);
  for (const [property, raw] of Object.entries(style)) {
    const value = String(raw).trim();
    if (property === "all" || names.some((other) => other !== property && overlap(property, other))) {
      left[property] = value;
      continue;
    }
    const keyword = KEYWORD_UTILITIES[property]?.[value];
    if (keyword !== undefined) {
      classes.push(keyword);
      continue;
    }
    const encoded = arbitrary(value);
    const prefix = LENGTH_PREFIXES[property];
    // A name with an underscore is left as a style: in a class an underscore reads as a space.
    if (encoded === null || !/^(?:--[A-Za-z0-9-]+|-?[a-z][a-z-]*)$/u.test(property)) left[property] = value;
    else if (prefix !== undefined && PLAIN_LENGTH.test(value)) classes.push(`${prefix}-[${encoded}]`);
    else if (NUMBER_PREFIXES[property] !== undefined && /^\d+$/u.test(value)) classes.push(`${NUMBER_PREFIXES[property]}-[${value}]`);
    else classes.push(`[${property}:${encoded}]`);
  }
  return { classes, left };
}
