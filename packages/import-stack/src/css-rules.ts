import { ImportSecurityError } from "./errors.ts";
import { cssLoadsOrExecutes, cssWithoutComments, sanitizeImportedCssText } from "./security.ts";

/**
 * An imported stylesheet with its loading and executable parts removed rule by rule (#283).
 * A stylesheet was all or nothing: one `url()` among a site's thousands of rules removed the
 * whole sheet. Now only the @import rules, the declarations that load or execute something,
 * and the rules whose selector or at-rule could, are removed. The result is checked again as a
 * whole with the same test the whole-sheet sanitizer uses, so a parsing mistake here can only
 * remove more, never keep anything that loads: if the result fails, nothing is kept.
 */
export interface SanitizedStylesheet {
  /** The safe CSS, or null when none is left. */
  cssText: string | null;
  /** Whether anything was removed. */
  unsafe: boolean;
  removedDeclarations: number;
  removedRules: number;
}

// At-rules whose block holds rules, and those whose block holds declarations. Any other
// at-rule with a block is removed: what it means is not known here.
const GROUP_RULES = new Set(["media", "supports", "layer", "container", "scope", "starting-style"]);
const KEYFRAMES = /^(?:-webkit-|-moz-|-o-)?keyframes$/u;
const DECLARATION_RULES = new Set(["font-face", "page", "property", "counter-style", "font-palette-values", "font-feature-values"]);
// Rules nest no deeper than this; deeper input is treated as a whole.
const MAX_DEPTH = 32;

class CssStructureError extends Error {}

interface Item {
  /** Everything before the block, or the whole statement. */
  prelude: string;
  /** The block's content, or null for a statement ended by ";". */
  block: string | null;
}

/** The index just past a string that starts at `start` (a quote): a newline also ends it. */
function stringEnd(css: string, start: number): number {
  const quote = css[start];
  let index = start + 1;
  while (index < css.length && css[index] !== quote && css[index] !== "\n") index += css[index] === "\\" ? 2 : 1;
  return Math.min(index + 1, css.length);
}

/** The index of the "}" that closes the block opened at `open`, or a structure error. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  let index = open;
  while (index < css.length) {
    const char = css[index];
    if (char === "\\") index += 2;
    else if (char === "\"" || char === "'") index = stringEnd(css, index);
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

/** The statements and blocks of a rule list or declaration list, in order. */
function items(css: string): Item[] {
  const out: Item[] = [];
  let start = 0;
  let parens = 0;
  let index = 0;
  while (index < css.length) {
    const char = css[index];
    if (char === "\\") index += 2;
    else if (char === "\"" || char === "'") index = stringEnd(css, index);
    else if (char === "(" || char === "[") {
      parens += 1;
      index += 1;
    } else if (char === ")" || char === "]") {
      parens = Math.max(0, parens - 1);
      index += 1;
    } else if (char === ";" && parens === 0) {
      out.push({ prelude: css.slice(start, index), block: null });
      start = index + 1;
      index += 1;
    } else if (char === "{" && parens === 0) {
      const end = blockEnd(css, index);
      out.push({ prelude: css.slice(start, index), block: css.slice(index + 1, end) });
      start = end + 1;
      index = end + 1;
    } else if (char === "}") {
      throw new CssStructureError("a block closes that was not opened");
    } else index += 1;
  }
  if (css.slice(start).trim() !== "") out.push({ prelude: css.slice(start), block: null });
  return out;
}

class Sanitizer {
  removedDeclarations = 0;
  removedRules = 0;

  /** A rule list: the top level, or a group rule's block. */
  ruleList(css: string, depth: number): string {
    if (depth > MAX_DEPTH) throw new CssStructureError("rules nest too deeply");
    return items(css).map((item) => this.rule(item, depth)).filter((text) => text !== "").join("");
  }

  /** One rule of a rule list, safe, or "" when it is removed. */
  rule(item: Item, depth: number): string {
    const prelude = item.prelude.trim();
    if (prelude === "" && item.block === null) return "";
    // A selector or at-rule prelude that loads or executes removes the whole rule; so does
    // every @import, and anything else that is not a rule.
    if (cssLoadsOrExecutes(prelude) || item.block === null) {
      if (prelude.startsWith("@") && !cssLoadsOrExecutes(prelude)) return `${prelude};`; // @charset, @layer a, b;
      this.removedRules += 1;
      return "";
    }
    if (prelude.startsWith("@")) {
      const name = /^@([-\w]+)/u.exec(prelude)?.[1].toLowerCase() ?? "";
      if (GROUP_RULES.has(name) || KEYFRAMES.test(name)) return `${prelude}{${this.ruleList(item.block, depth + 1)}}`;
      if (DECLARATION_RULES.has(name)) return `${prelude}{${this.declarations(item.block, depth + 1)}}`;
      this.removedRules += 1;
      return "";
    }
    return `${prelude}{${this.declarations(item.block, depth + 1)}}`;
  }

  /** A declaration list, which may hold nested rules (CSS nesting). */
  declarations(css: string, depth: number): string {
    if (depth > MAX_DEPTH) throw new CssStructureError("rules nest too deeply");
    const kept: string[] = [];
    for (const item of items(css)) {
      if (item.block !== null) {
        const nested = this.rule(item, depth);
        if (nested !== "") kept.push(nested);
        continue;
      }
      const declaration = item.prelude.trim();
      if (declaration === "") continue;
      if (cssLoadsOrExecutes(declaration)) this.removedDeclarations += 1;
      else kept.push(`${declaration};`);
    }
    return kept.join("");
  }
}

/** Sanitize an imported stylesheet rule by rule, keeping every safe rule and declaration. */
export function sanitizeImportedStylesheet(css: string, maxBytes: number): SanitizedStylesheet {
  if (Buffer.byteLength(css, "utf8") > maxBytes) throw new ImportSecurityError("imported stylesheet exceeds maxCssBytes");
  const whole = (): SanitizedStylesheet => {
    const result = sanitizeImportedCssText(css, maxBytes);
    return { cssText: result.cssText === "" ? null : result.cssText, unsafe: result.unsafe, removedDeclarations: 0, removedRules: result.unsafe ? 1 : 0 };
  };
  const sanitizer = new Sanitizer();
  let cssText: string;
  try {
    cssText = sanitizer.ruleList(cssWithoutComments(css), 0).trim();
  } catch (error) {
    if (error instanceof CssStructureError) return whole();
    throw error;
  }
  // The result as a whole, by the whole-sheet test: anything left that loads fails it all.
  if (cssLoadsOrExecutes(cssText)) return { cssText: null, unsafe: true, removedDeclarations: sanitizer.removedDeclarations, removedRules: sanitizer.removedRules + 1 };
  const removed = sanitizer.removedDeclarations + sanitizer.removedRules;
  // Nothing to remove: the sheet stays exactly as its author wrote it, when it is safe whole.
  if (removed === 0) {
    const original = sanitizeImportedCssText(css, maxBytes);
    if (!original.unsafe) return { cssText: original.cssText === "" ? null : original.cssText, unsafe: false, removedDeclarations: 0, removedRules: 0 };
  }
  return { cssText: cssText === "" ? null : cssText, unsafe: removed > 0, removedDeclarations: sanitizer.removedDeclarations, removedRules: sanitizer.removedRules };
}
