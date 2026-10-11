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
// Rules nest no deeper than this; deeper input is judged as a whole. Each level judges its
// whole subtree again, so the cost is about depth times size: real sheets nest a few levels.
const MAX_DEPTH = 8;

class CssStructureError extends Error {}

interface Item {
  /** The text before the block, or the whole item, exactly as written. */
  prelude: string;
  /** The block's content, exactly as written, or null for an item without a block. */
  block: string | null;
  /** The at-rule's name, lowercase, when the item is one ("" for a bare "@"), else null. */
  atRule: string | null;
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
    else if (urlAt(css, index) && unquotedUrlEnd(css, index) > 0) index = unquotedUrlEnd(css, index);
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

/** The index just past an unquoted url( token starting at `start` ("url("), or -1 if quoted. */
function unquotedUrlEnd(css: string, start: number): number {
  let index = start + 4;
  while (index < css.length && /[ \t\n]/u.test(css[index])) index += 1;
  if (css[index] === "\"" || css[index] === "'") return -1;
  while (index < css.length && css[index] !== ")") index += css[index] === "\\" ? 2 : 1;
  return Math.min(index + 1, css.length);
}

/** Whether `url(` (any case, not part of a longer name) starts at `index`. */
function urlAt(css: string, index: number): boolean {
  // Preceded by a name character (an ASCII one, an escape, or any non-ASCII character), it is
  // part of a longer function name. An escaped spelling (u\72l) is not followed here: that only
  // removes more, as the whole-sheet test still finds it.
  return (css[index] === "u" || css[index] === "U") && css.slice(index, index + 4).toLowerCase() === "url(" && !/[-\w\\\u0080-\u{10ffff}]/u.test(css[index - 1] ?? "");
}

// An at-rule's name, matched where the item starts (sticky: no copy of the rest of the sheet).
const AT_NAME = /@([-\w]+)/uy;

/**
 * The items of a rule list or a declaration list, each exactly as written, in one pass. Each
 * item is classified once, at its first real character (whitespace and comments, and at the
 * top level the HTML comment markers, are skipped): in a rule list only an at-rule statement
 * ends at ";" (a qualified rule's prelude runs to its block); in a declaration list every item
 * but a nested rule ends at ";", and a custom property's value may hold blocks.
 */
function items(css: string, declarations: boolean, top: boolean): Item[] {
  const out: Item[] = [];
  let start = 0;
  let parens = 0;
  let index = 0;
  // Decided at the item's first real character.
  let head = -1;
  let atRule = false;
  let custom = false;
  const close = (end: number, block: string | null) => {
    AT_NAME.lastIndex = head;
    out.push({ prelude: css.slice(start, end), block, atRule: atRule ? AT_NAME.exec(css)?.[1].toLowerCase() ?? "" : null });
    head = -1;
    atRule = false;
    custom = false;
  };
  while (index < css.length) {
    const char = css[index];
    if (char === "/" && css[index + 1] === "*") {
      index = commentEnd(css, index);
      continue;
    }
    if (head < 0) {
      if (/[ \t\n]/u.test(char)) {
        index += 1;
        continue;
      }
      if (top && (css.startsWith("<!--", index) || css.startsWith("-->", index))) {
        index += css[index] === "<" ? 4 : 3;
        continue;
      }
      head = index;
      atRule = char === "@";
      custom = declarations && css.startsWith("--", index);
    }
    if (char === "\\") index += 2;
    else if (char === "\"" || char === "'") index = stringEnd(css, index);
    else if (urlAt(css, index) && unquotedUrlEnd(css, index) > 0) index = unquotedUrlEnd(css, index);
    else if (char === "(" || char === "[") {
      parens += 1;
      index += 1;
    } else if (char === ")" || char === "]") {
      parens = Math.max(0, parens - 1);
      index += 1;
    } else if (char === ";" && parens === 0 && (declarations || atRule)) {
      close(index + 1, null);
      start = index + 1;
      index += 1;
    } else if (char === "{" && parens === 0) {
      const end = blockEnd(css, index);
      if (custom) index = end + 1; // part of the value
      else {
        close(index, css.slice(index + 1, end));
        start = end + 1;
        index = end + 1;
      }
    } else index += 1;
  }
  if (start < css.length) close(css.length, null);
  return out;
}

class Sanitizer {
  removedDeclarations = 0;
  removedRules = 0;

  /** A rule list (the top level, or a group rule's block): its safe parts, as written. */
  ruleList(css: string, depth: number): string {
    if (depth > MAX_DEPTH) throw new CssStructureError("rules nest too deeply");
    return items(css, false, depth === 0).map((item) => this.rule(item, depth, false)).join("");
  }

  /**
   * One rule, or anything else the list holds, as written when it is safe; "" when it is
   * removed. Inside a style rule (`nested`), a group rule's block holds declarations.
   */
  rule(item: Item, depth: number, nested: boolean): string {
    // (`nested` is false directly in an @scope body, where a group rule holds rules.)
    const whole = item.block === null ? item.prelude : `${item.prelude}{${item.block}}`;
    if (!cssLoadsOrExecutes(whole)) return whole;
    // Something in it loads: keep what can be kept.
    if (item.block === null || cssLoadsOrExecutes(item.prelude)) {
      this.removedRules += 1;
      return "";
    }
    const name = item.atRule;
    if (name === null) return `${item.prelude}{${this.declarations(item.block, depth + 1)}}`;
    if (name === "scope") return `${item.prelude}{${this.declarations(item.block, depth + 1, true)}}`;
    if (DECLARATION_RULES.has(name) || (nested && GROUP_RULES.has(name))) return `${item.prelude}{${this.declarations(item.block, depth + 1)}}`;
    if (GROUP_RULES.has(name) || KEYFRAMES.test(name)) return `${item.prelude}{${this.ruleList(item.block, depth + 1)}}`;
    this.removedRules += 1;
    return "";
  }

  /**
   * A declaration list, which may hold nested rules: its safe parts, as written. Directly in an
   * @scope body (`scopeBody`), a group rule holds rules, as in a rule list.
   */
  declarations(css: string, depth: number, scopeBody = false): string {
    if (depth > MAX_DEPTH) throw new CssStructureError("rules nest too deeply");
    return items(css, true, false).map((item) => {
      if (item.block !== null) return this.rule(item, depth, !scopeBody);
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

/**
 * The most CSS a frame's stylesheet holds (#283). An import holds at most maxCssBytes (1 MiB
 * offline); renaming its page selectors to :scope and joining its sheets adds a little, so the
 * frame's limit leaves room above that.
 */
export const MAX_FRAME_STYLESHEET_BYTES = 2 * 1024 * 1024;

/**
 * Whether a "}" in `css` closes a block it did not open (outside strings, comments, escapes
 * and unquoted url()s). The canvas wraps a frame's stylesheet in an @scope block: such a "}"
 * would end that block, and the rest would style every frame (#298 review).
 */
export function cssClosesUnopenedBlock(css: string): boolean {
  let depth = 0;
  let index = 0;
  while (index < css.length) {
    const char = css[index];
    if (char === "\\") index += 2;
    else if (char === "\"" || char === "'") index = stringEnd(css, index);
    else if (char === "/" && css[index + 1] === "*") index = commentEnd(css, index);
    else if (urlAt(css, index) && unquotedUrlEnd(css, index) > 0) index = unquotedUrlEnd(css, index);
    else {
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth < 0) return true;
      }
      index += 1;
    }
  }
  return false;
}

/** A selector list split at its top-level commas, each part exactly as written. */
function selectors(prelude: string): string[] {
  const out: string[] = [];
  let start = 0;
  let parens = 0;
  let index = 0;
  while (index < prelude.length) {
    const char = prelude[index];
    if (char === "\\") index += 2;
    else if (char === "\"" || char === "'") index = stringEnd(prelude, index);
    else {
      if (char === "(" || char === "[") parens += 1;
      if (char === ")" || char === "]") parens = Math.max(0, parens - 1);
      if (char === "," && parens === 0) {
        out.push(prelude.slice(start, index));
        start = index + 1;
      }
      index += 1;
    }
  }
  out.push(prelude.slice(start));
  return out;
}

// A selector's leading html, :root or body, or html body: the page, which in a frame is the
// frame itself.
const PAGE_ROOT = /^(\s*)(?:(?:html|:root)(?:\s*>\s*|\s+)body|html|:root|body)(?=$|[\s>+~.#[:,])/iu;

/** A rule list with each selector that names the page renamed to the frame (:scope). */
function scopedRules(css: string, depth: number): string {
  if (depth > MAX_DEPTH) return css;
  return items(css, false, depth === 0).map((item) => {
    if (item.block === null) return item.prelude;
    const name = item.atRule;
    if (name !== null) return GROUP_RULES.has(name) ? `${item.prelude}{${scopedRules(item.block, depth + 1)}}` : `${item.prelude}{${item.block}}`;
    return `${selectors(item.prelude).map((selector) => selector.replace(PAGE_ROOT, "$1:scope")).join(",")}{${item.block}}`;
  }).join("");
}

/**
 * An imported page's stylesheets as the stylesheet of the frame that holds the import (#283):
 * in document order, with the selectors that name the page (html, :root, body) renamed to the
 * frame, since the canvas applies a frame's stylesheet scoped to that frame. The sheets are
 * already sanitized; a sheet whose structure is not followed here is kept as it is.
 */
export function frameStylesheet(sheets: readonly string[]): string {
  // A sheet with a "}" it did not open would end the frame's scope on the canvas: left out.
  return sheets.filter((css) => !cssClosesUnopenedBlock(css)).map((css) => {
    try {
      return scopedRules(css, 0);
    } catch (error) {
      if (error instanceof CssStructureError) return css;
      throw error;
    }
  }).join("\n");
}
