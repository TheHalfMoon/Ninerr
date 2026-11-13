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
  "align-items": { "flex-start": "items-start", start: "items-start", center: "items-center", "flex-end": "items-end", end: "items-end", stretch: "items-stretch", baseline: "items-baseline" },
  "justify-content": { "flex-start": "justify-start", start: "justify-start", center: "justify-center", "flex-end": "justify-end", end: "justify-end", "space-between": "justify-between", "space-around": "justify-around", "space-evenly": "justify-evenly" },
  "text-align": { left: "text-left", center: "text-center", right: "text-right", justify: "text-justify", start: "text-start", end: "text-end" },
  "font-weight": { "100": "font-thin", "200": "font-extralight", "300": "font-light", "400": "font-normal", "500": "font-medium", "600": "font-semibold", "700": "font-bold", "800": "font-extrabold", "900": "font-black" },
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
// A plain length, number or percentage (what the prefixes above take without a type hint).
const PLAIN_LENGTH = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vh|vw|vmin|vmax|ch|ex)?$/u;

/**
 * A Tailwind arbitrary value: spaces become underscores and an underscore is escaped, as
 * Tailwind reads them back. A double-quoted string is written single-quoted, which CSS reads
 * the same (`"Inter", serif` is `'Inter',_serif`). Null for a value a class cannot carry (both
 * kinds of quote, a backslash or a bracket that would end it early, or a line break).
 */
function arbitrary(value: string): string | null {
  if (/[\\[\]\r\n\t]/u.test(value) || (value.includes("\"") && value.includes("'"))) return null;
  return value.trim().replace(/"/gu, "'").replace(/_/gu, "\\_").replace(/ +/gu, "_");
}

/**
 * A layer's style as Tailwind classes, one per declaration, that set exactly what the style
 * says: a utility where one says it exactly, an arbitrary value for a length (`p-[12px]`), and
 * otherwise an arbitrary property (`[color:#1d4ed8]`). A declaration no class can carry stays in
 * `left`, for the caller to keep as a style.
 */
export function styleToTailwind(style: Readonly<Record<string, string>>): { classes: string[]; left: Record<string, string> } {
  const classes: string[] = [];
  const left: Record<string, string> = {};
  for (const [property, raw] of Object.entries(style)) {
    const value = String(raw).trim();
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
    else classes.push(`[${property}:${encoded}]`);
  }
  return { classes, left };
}
