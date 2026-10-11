import { ImportSecurityError } from "./errors.ts";
import { cssLoadsOrExecutes, sanitizeImportedCssText } from "./security.ts";

/**
 * An imported stylesheet with its loading and executable parts removed rule by rule (#283).
 * A stylesheet was all or nothing: one `url()` among a site's thousands of rules removed the
 * whole sheet. Now only the parts that load or execute are removed: an @import, a declaration,
 * a rule whose selector or at-rule prelude could, an at-rule whose meaning is not known here
 * when anything in it could. Everything else is kept exactly as written, whitespace and
 * comments included, so the browser reads the rest as it read the original. The result is
 * judged again as a whole with the same test the whole-sheet sanitizer uses: a structural
 * mistake here can only remove more, never keep anything that loads.
 */
export interface SanitizedStylesheet {
  /** The safe CSS, or null when none is left. */
  cssText: string | null;
  /** Whether anything was removed. */
  unsafe: boolean;
  removedDeclarations: number;
  removedRules: number;
}

// At-rules whose block holds rules (or, nested in a style rule, declarations), and those
// whose block holds declarations and their own at-rules. Any other at-rule is kept whole when
// nothing in it loads, and removed whole when anything does.
const GROUP_RULES = new Set(["media", "supports", "layer", "container", "starting-style"]);
const KEYFRAMES = /^(?:-webkit-|-moz-|-o-)?keyframes$/u;
const DECLARATION_RULES = new Set([
  "font-face", "page", "property", "counter-style", "font-palette-values", "font-feature-values", "view-transition", "position-try",
  // Inside @page and @font-feature-values.
  "top-left-corner", "top-left", "top-center", "top-right", "top-right-corner", "bottom-left-corner", "bottom-left", "bottom-center",
  "bottom-right", "bottom-right-corner", "left-top", "left-middle", "left-bottom", "right-top", "right-middle", "right-bottom",
  "stylistic", "styleset", "character-variant", "swash", "ornaments", "annotation", "historical-forms",
]);
// Rules nest no deeper than this; deeper input is judged as a whole.
const MAX_DEPTH = 32;
const CUSTOM_PROPERTY = /^\s*--[^:]*:/u;

class CssStructureError extends Error {}

interface Item {
  /** The text before the block, or the whole item, exactly as written. */
  prelude: string;
  /** The block's content, exactly as written, or null for an item without a block. */
  block: string | null;
}

/** The index just past a string that starts at `start`; a newline ends a bad string before it. */
function stringEnd(css: string, start: number): number {
  const quote = css[start];
  let index = start + 1;
  while (index < css.length && css[index] !== quote && css[index] !== "\n") index += css[index] === "\\" ? 2 : 1;
  if (index >= css.length) return css.length;
  return css[index] === "\n" ? index : index + 1;
}

/** The index just past a comment that starts at `start` ("/*"). */
function commentEnd(css: string, start: number): number {
  const end = css.indexOf("*/", start + 2);
  return end < 0 ? css.length : end + 2;
}

/** The index of the "}" that closes the block opened at `open`, or a structure error. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  let index = open;
  while (index < css.length) {
    const char = css[index];
    if (char === "\\") index += 2;
    else if (char === "\"" || char === "'") index = stringEnd(css, index);
    else if (char === "/" && css[index + 1] === "*") index = commentEnd(css, index);
    else {
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) return index;
      }
      index += 1;
    }
  }
  throw new CssStructureError("a block is not closed");
}

/**
 * The items of a rule list or a declaration list, each exactly as written. In a rule list
 * only an at-rule statement ends at ";" (a qualified rule's prelude runs to its block); in a
 * declaration list every item but a nested rule ends at ";", and a custom property's value
 * may hold blocks.
 */
function items(css: string, declarations: boolean): Item[] {
  const out: Item[] = [];
  let start = 0;
  let parens = 0;
  let index = 0;
  const statementAt = () => declarations || /^\s*@/u.test(css.slice(start, index));
  while (index < css.length) {
    const char = css[index];
    if (char === "\\") index += 2;
    else if (char === "\"" || char === "'") index = stringEnd(css, index);
    else if (char === "/" && css[index + 1] === "*") index = commentEnd(css, index);
    else if (char === "(" || char === "[") {
      parens += 1;
      index += 1;
    } else if (char === ")" || char === "]") {
      parens = Math.max(0, parens - 1);
      index += 1;
    } else if (char === ";" && parens === 0 && statementAt()) {
      out.push({ prelude: css.slice(start, index + 1), block: null });
      start = index + 1;
      index += 1;
    } else if (char === "{" && parens === 0) {
      const end = blockEnd(css, index);
      if (declarations && CUSTOM_PROPERTY.test(css.slice(start, index))) index = end + 1; // part of the value
      else {
        out.push({ prelude: css.slice(start, index), block: css.slice(index + 1, end) });
        start = end + 1;
        index = end + 1;
      }
    } else index += 1;
  }
  if (start < css.length) out.push({ prelude: css.slice(start), block: null });
  return out;
}

const atRuleName = (prelude: string): string | null => /^\s*@([-\w]+)/u.exec(prelude)?.[1].toLowerCase() ?? null;

class Sanitizer {
  removedDeclarations = 0;
  removedRules = 0;

  /** A rule list (the top level, or a group rule's block): its safe parts, as written. */
  ruleList(css: string, depth: number): string {
    if (depth > MAX_DEPTH) throw new CssStructureError("rules nest too deeply");
    return items(css, false).map((item) => this.rule(item, depth, false)).join("");
  }

  /**
   * One rule, or anything else the list holds, as written when it is safe; "" when it is
   * removed. Inside a style rule (`nested`), a group rule's block holds declarations.
   */
  rule(item: Item, depth: number, nested: boolean): string {
    const whole = item.block === null ? item.prelude : `${item.prelude}{${item.block}}`;
    if (!cssLoadsOrExecutes(whole)) return whole;
    // Something in it loads: keep what can be kept.
    if (item.block === null || cssLoadsOrExecutes(item.prelude)) {
      this.removedRules += 1;
      return "";
    }
    const name = atRuleName(item.prelude);
    if (name === null) return `${item.prelude}{${this.declarations(item.block, depth + 1)}}`;
    if (name === "scope" || DECLARATION_RULES.has(name) || (nested && GROUP_RULES.has(name))) return `${item.prelude}{${this.declarations(item.block, depth + 1)}}`;
    if (GROUP_RULES.has(name) || KEYFRAMES.test(name)) return `${item.prelude}{${this.ruleList(item.block, depth + 1)}}`;
    this.removedRules += 1;
    return "";
  }

  /** A declaration list, which may hold nested rules: its safe parts, as written. */
  declarations(css: string, depth: number): string {
    if (depth > MAX_DEPTH) throw new CssStructureError("rules nest too deeply");
    return items(css, true).map((item) => {
      if (item.block !== null) return this.rule(item, depth, true);
      if (!cssLoadsOrExecutes(item.prelude)) return item.prelude;
      this.removedDeclarations += 1;
      return "";
    }).join("");
  }
}

/** Sanitize an imported stylesheet rule by rule, keeping every safe part as written. */
export function sanitizeImportedStylesheet(css: string, maxBytes: number): SanitizedStylesheet {
  if (Buffer.byteLength(css, "utf8") > maxBytes) throw new ImportSecurityError("imported stylesheet exceeds maxCssBytes");
  const original = sanitizeImportedCssText(css, maxBytes);
  // Nothing loads: the sheet stays exactly as its author wrote it.
  if (!original.unsafe) return { cssText: original.cssText === "" ? null : original.cssText, unsafe: false, removedDeclarations: 0, removedRules: 0 };
  const sanitizer = new Sanitizer();
  let cssText: string;
  try {
    cssText = sanitizer.ruleList(css.replace(/\r\n|[\r\f]/gu, "\n"), 0).trim();
  } catch (error) {
    // A sheet whose structure is not followed here is judged whole, as before.
    if (error instanceof CssStructureError) return { cssText: null, unsafe: true, removedDeclarations: 0, removedRules: 1 };
    throw error;
  }
  // The result as a whole, by the whole-sheet test: anything left that loads fails it all.
  if (cssLoadsOrExecutes(cssText)) return { cssText: null, unsafe: true, removedDeclarations: 0, removedRules: 1 };
  return { cssText: cssText === "" ? null : cssText, unsafe: true, removedDeclarations: sanitizer.removedDeclarations, removedRules: sanitizer.removedRules };
}
