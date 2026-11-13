// Token drift (#79, LILAC-D8): the design system's tokens against the custom properties a CSS
// file in the connected codebase declares, read by the same reader and planner as a token import
// (tokensFromCss, planItemTokens). Nothing is changed: the answer is what differs, both ways.
import { TokenCssError, tokensFromCss } from "@ninerr/component-sources";
import { designSystemOf } from "@ninerr/document-model";
import { StudioError } from "./errors.ts";
import { planItemTokens } from "./component-import.ts";

export type DriftStatus = "same" | "changed" | "only-in-code" | "only-in-design" | "unreadable-in-code";

export interface DriftEntry {
  name: string;
  status: DriftStatus;
  /** By mode id: the design system's values, and the file's. */
  design?: Record<string, string>;
  code?: Record<string, string>;
  reason?: string;
}

const STATUS_OF: Record<string, DriftStatus> = { same: "same", extended: "changed", conflict: "changed", new: "only-in-code", refused: "unreadable-in-code" };

/** What differs between the design system's tokens and the file's, in name order. */
export function tokenDrift(document: any, css: string, file: string) {
  let read: ReturnType<typeof tokensFromCss>;
  try {
    read = tokensFromCss(css);
  } catch (error) {
    if (error instanceof TokenCssError) throw new StudioError(422, "token-css-refused", error.message);
    throw error;
  }
  const planned = planItemTokens(document, read);
  const system = designSystemOf(document);
  const designTokens: Array<{ name: string; values: Record<string, string> }> = system === null ? [] : (system.props.tokens as any[]);
  const byName = new Map(designTokens.map((token) => [token.name, token]));
  const entries: DriftEntry[] = [];
  for (const token of planned.tokens) {
    const status = STATUS_OF[token.status] ?? "unreadable-in-code";
    const design = byName.get(token.name)?.values;
    // Compared in the modes both have; a mode only the design system has is not a difference
    // (a stylesheet need not restate every mode).
    const entry: DriftEntry = { name: token.name, status, code: { ...token.values } };
    if (design !== undefined) entry.design = { ...design };
    if (status === "unreadable-in-code" && token.reason !== undefined) entry.reason = token.reason;
    // The modes both have agree, but the code sets a mode the design system has no value in.
    if (token.status === "extended") entry.reason = "the code sets a mode the design system has no value in";
    entries.push(entry);
  }
  const inCode = new Set(planned.tokens.map((token) => token.name));
  for (const token of designTokens) {
    if (!inCode.has(token.name)) entries.push({ name: token.name, status: "only-in-design", design: { ...token.values } });
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const counts: Record<DriftStatus, number> = { same: 0, changed: 0, "only-in-code": 0, "only-in-design": 0, "unreadable-in-code": 0 };
  for (const entry of entries) counts[entry.status] += 1;
  return { file, drift: entries.some((entry) => entry.status !== "same"), counts, tokens: entries, kept: read.kept };
}
