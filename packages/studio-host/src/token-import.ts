// Design tokens from a CSS file the person chose (Astryx's astryx.css or a theme's theme.css, or
// any CSS that declares custom properties on :root): read by tokensFromCss, planned against the
// project's design system by the same rules as a registry item's tokens (new, same, extended,
// conflict, refused; nothing there is overwritten), and added as one transaction the person can
// undo. Ninerr fetches nothing: the text is the file's.
import { createHash } from "node:crypto";
import { TOKEN_CSS_LIMITS, TokenCssError, tokensFromCss } from "@ninerr/component-sources";
import { StudioError } from "./errors.ts";
import { planItemTokens } from "./component-import.ts";

export const MAX_TOKEN_CSS_REQUEST_BYTES = TOKEN_CSS_LIMITS.bytes * 6 + 64 * 1024;

export interface TokenCssRequest { css?: unknown; fileName?: unknown; token?: unknown }

const clean = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, " ").trim().slice(0, 200);

/** What adding the file's tokens would do, without changing anything, and the operations that do it. */
export function planTokenCss(document: any, request: TokenCssRequest) {
  if (typeof request?.css !== "string") throw new StudioError(400, "invalid-token-css", "css is the text of a CSS file");
  const fileName = typeof request.fileName === "string" && clean(request.fileName) !== "" ? clean(request.fileName) : null;
  let read: ReturnType<typeof tokensFromCss>;
  try {
    read = tokensFromCss(request.css);
  } catch (error) {
    if (error instanceof TokenCssError) throw new StudioError(422, "token-css-refused", error.message);
    throw error;
  }
  const planned = planItemTokens(document, read);
  const adds = planned.tokens.filter((token) => token.status === "new" || token.status === "extended").length;
  const view = { fileName, source: read.source, tokens: planned.tokens, kept: read.kept, skipped: read.skipped, problem: planned.problem, adds };
  // The plan the person saw, at this revision: apply refuses anything else.
  const token = createHash("sha256").update(JSON.stringify({ view, revision: document.revision })).digest("hex");
  return { plan: { ...view, token }, operations: planned.operations };
}

/** The operations that add the planned tokens, only when they are the plan the person reviewed. */
export function tokenCssOperations(document: any, request: TokenCssRequest) {
  const { plan, operations } = planTokenCss(document, request);
  if (typeof request?.token !== "string" || request.token !== plan.token) throw new StudioError(409, "token-plan-changed", "The tokens or the design system changed since the review; review them again.");
  if (plan.problem !== null) throw new StudioError(422, "token-css-refused", `Its tokens cannot be added to the design system: ${plan.problem}`);
  if (operations.length === 0) throw new StudioError(422, "no-tokens-to-add", "The file adds no token the design system does not already have.");
  const from = plan.fileName ?? "a CSS file";
  return { plan, operations, intent: `Add ${plan.adds} token${plan.adds === 1 ? "" : "s"} from ${from}${plan.source === "astryx" ? " (Astryx)" : ""}` };
}
