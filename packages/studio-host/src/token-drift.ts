// Token drift (#79, parity row D8): the design system's tokens against the custom properties a CSS
// file in the connected codebase declares (read by tokensFromCss, the token import's reader).
// Each design token is compared in its own collection: the file's :root value with that
// collection's default mode, and its dark value with the collection's Dark mode. Nothing is
// changed: the answer is what differs, both ways.
import { TokenCssError, tokensFromCss } from "@ninerr/component-sources";
import { designSystemOf } from "@ninerr/document-model";
import { StudioError } from "./errors.ts";

export type DriftStatus = "same" | "changed" | "only-in-code" | "only-in-design";

export interface DriftEntry {
  name: string;
  status: DriftStatus;
  /** By mode id: the design system's values, and the file's (in that collection's modes). */
  design?: Record<string, string>;
  code?: Record<string, string>;
  reason?: string;
}

// Spelling that draws the same: spaces, spaces inside parentheses, and a hex colour's case.
const normal = (value: string): string => {
  const text = value.trim().replace(/\s+/gu, " ").replace(/\(\s+/gu, "(").replace(/\s+\)/gu, ")").replace(/\s*,\s*/gu, ", ");
  return /^#[0-9a-f]{3,8}$/iu.test(text) ? text.toLowerCase() : text;
};

/** What differs between the design system's tokens and the file's, in name order. */
export function tokenDrift(document: any, css: string, file: string) {
  let read: ReturnType<typeof tokensFromCss>;
  try {
    read = tokensFromCss(css);
  } catch (error) {
    if (error instanceof TokenCssError) throw new StudioError(422, "token-css-refused", error.message);
    throw error;
  }
  const plain = (scope: Record<string, string> | undefined, key: string) => (scope !== undefined && Object.hasOwn(scope, key) ? scope[key] : undefined);
  const system = designSystemOf(document);
  const collections: any[] = system === null ? [] : system.props.collections;
  const designTokens: Array<{ name: string; collection: string; values: Record<string, string> }> = system === null ? [] : system.props.tokens;
  const entries: DriftEntry[] = [];
  const compared = new Set<string>();
  for (const token of designTokens) {
    const key = token.name.slice(2);
    const collection = collections.find((entry) => entry.id === token.collection) ?? collections[0];
    const defaultMode: string = collection.defaultMode;
    const darkMode: string | undefined = collection.modes.find((mode: any) => mode.id !== defaultMode && (mode.id === "dark" || String(mode.name).toLowerCase() === "dark"))?.id;
    const light = plain(read.theme, key) ?? plain(read.light, key);
    const dark = plain(read.dark, key);
    compared.add(key);
    if (light === undefined && dark === undefined) {
      entries.push({ name: token.name, status: "only-in-design", design: { ...token.values } });
      continue;
    }
    const code: Record<string, string> = {};
    const reasons: string[] = [];
    let differs = false;
    if (light !== undefined) {
      code[defaultMode] = light;
      const value = token.values[defaultMode];
      if (value === undefined) {
        differs = true;
        reasons.push("the design system has no value in its default mode");
      } else if (normal(value) !== normal(light)) differs = true;
    }
    if (dark !== undefined) {
      if (darkMode === undefined) {
        differs = true;
        reasons.push("the code sets a dark value, and the token's collection has no Dark mode");
      } else {
        code[darkMode] = dark;
        const value = token.values[darkMode];
        if (value === undefined) {
          differs = true;
          reasons.push("the code sets a dark value the design system has none for");
        } else if (normal(value) !== normal(dark)) differs = true;
      }
    }
    // A design token that aliases another (var(--x)) is a reference; the code may hold its value.
    if (differs && Object.values(token.values).some((value) => /^var\(--/u.test(value.trim()))) reasons.push("the design system's value is an alias of another token");
    entries.push({ name: token.name, status: differs ? "changed" : "same", design: { ...token.values }, code, ...(reasons.length > 0 ? { reason: reasons.join("; ") } : {}) });
  }
  const onlyInCode = new Set([...Object.keys(read.theme ?? {}), ...Object.keys(read.light ?? {}), ...Object.keys(read.dark ?? {})].filter((key) => !compared.has(key)));
  for (const key of onlyInCode) {
    const light = plain(read.theme, key) ?? plain(read.light, key);
    const dark = plain(read.dark, key);
    entries.push({ name: `--${key}`, status: "only-in-code", code: { ...(light === undefined ? {} : { default: light }), ...(dark === undefined ? {} : { dark }) } });
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const counts: Record<DriftStatus, number> = { same: 0, changed: 0, "only-in-code": 0, "only-in-design": 0 };
  for (const entry of entries) counts[entry.status] += 1;
  return { file, drift: entries.some((entry) => entry.status !== "same"), counts, tokens: entries, kept: read.kept };
}
