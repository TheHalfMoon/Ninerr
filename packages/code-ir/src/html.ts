import { CodeIrValidationError } from "./errors.ts";
import type { DesignDoc, DesignDocNode } from "./types.ts";
import { normalizeDesignDoc } from "./validation.ts";

// The design subset as HTML markup: what designToCode writes as JSX, written for a browser.
// Nothing is added between elements (whitespace between inline elements is text in HTML), text
// and attribute values are escaped, and a {…} part, which is code, becomes a comment saying so:
// HTML runs none of it. Script and style elements are refused, so the markup runs nothing.

// Elements that have no end tag.
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const REFUSED = new Set(["script", "style", "noscript", "template", "iframe", "object", "embed"]);
// React's names for HTML attributes, where they differ.
const HTML_NAMES: Record<string, string> = { className: "class", htmlFor: "for" };

const escapeText = (value: string) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
const escapeAttribute = (value: string) => value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;");

function emit(node: DesignDocNode): string {
  if (node.tag === "#text") return escapeText(node.text ?? "");
  // `--` would end the comment; the code is shown, not run.
  if (node.tag === "#expression") return `<!-- code: ${(node.code ?? "").replace(/-(?=-)/gu, "- ").replace(/-$/u, "- ")} -->`;
  const tag = node.tag.toLowerCase();
  if (REFUSED.has(tag)) throw new CodeIrValidationError(`a <${tag}> element is not exported as HTML`);
  let attributes = "";
  for (const [key, value] of Object.entries(node.props)) {
    if (value === false) continue;
    const name = HTML_NAMES[key] ?? key;
    if (/^on/iu.test(name)) throw new CodeIrValidationError(`the event handler ${name} is not exported as HTML`);
    attributes += value === true ? ` ${name}` : ` ${name}="${escapeAttribute(String(value))}"`;
  }
  if (node.style !== undefined && Object.keys(node.style).length > 0) {
    attributes += ` style="${escapeAttribute(Object.entries(node.style).map(([name, value]) => `${name}: ${value}`).join("; "))}"`;
  }
  if (VOID.has(tag)) return `<${node.tag}${attributes}>`;
  const text = node.text === undefined ? "" : escapeText(node.text);
  return `<${node.tag}${attributes}>${text}${(node.children ?? []).map(emit).join("")}</${node.tag}>`;
}

/** The design document's root element as HTML markup. Deterministic for identical input. */
export function designToMarkup(docInput: DesignDoc): string {
  return emit(normalizeDesignDoc(docInput).root);
}
