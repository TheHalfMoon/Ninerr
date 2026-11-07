import { CodeIrValidationError } from "./errors.ts";
import { buildCodeIr } from "./ir.ts";
import { reactStyleKey, readStyleObject } from "./style.ts";
import {
  type CodeIr,
  type DesignDoc,
  type DesignDocNode,
} from "./types.ts";
import { canonicalCodeIrStringify, normalizeCodeIr, normalizeDesignDoc, sha256Text } from "./validation.ts";

// Raw JSX text is entity-decoded and whitespace-trimmed by every JSX parser, so only text
// that survives both exactly is written raw (with & < > { } as entities). Anything else
// (edge spaces, tabs, line breaks) is written as a string literal child, which is exact.
function emitText(text: string): string {
  if (text !== "" && !/[\t\n\r]/u.test(text) && !/^\s|\s$/u.test(text)) {
    return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/\{/gu, "&#123;").replace(/\}/gu, "&#125;");
  }
  return `{${JSON.stringify(text)}}`;
}

// JSX attribute strings have no escapes, so a value with a quote or an ampersand is written
// as a string literal expression instead.
function emitAttrValue(value: string): string {
  return /["&]/u.test(value) ? `{${JSON.stringify(value)}}` : `"${value}"`;
}

/**
 * What the canvas shows for a {…} part's exact source. The part is written exactly as its source
 * has it, so it must be one JSX child, valid in the plain function export writes, and nothing
 * else: source that closes the element around it, or uses await, is refused here, never written.
 */
export function expressionShown(code: string): string {
  const open = "function part() { return <>";
  let ir: CodeIr;
  try {
    ir = buildCodeIr([{ path: "Part.tsx", content: `${open}${code}</>; }` }]);
  } catch {
    throw new CodeIrValidationError("a {…} part of this design is not valid TSX in a plain function");
  }
  const root = ir.rootIds.length === 1 ? ir.symbols[ir.rootIds[0]] : undefined;
  const part = root?.kind === "fragment" && root.children.length === 1 && root.texts.length === 0 ? ir.symbols[root.children[0]] : undefined;
  if (part?.kind !== "expression" || part.range.startOffset !== open.length || part.range.endOffset !== open.length + code.length) {
    throw new CodeIrValidationError("a {…} part of this design is not one JSX child");
  }
  return `{${part.code}}`;
}

function emitExpression(code: string): string {
  expressionShown(code);
  return code;
}

// A style value as a JS string: quoted so that it needs no escape when it can.
function styleValue(value: string): string {
  if (!/[\\"]/u.test(value)) return `"${value}"`;
  if (!/[\\']/u.test(value)) return `'${value}'`;
  return JSON.stringify(value);
}

function emitStyle(style: Record<string, string> | undefined): string {
  if (style === undefined) return "";
  return ` style={{ ${Object.entries(style).map(([name, value]) => `${reactStyleKey(name)}: ${styleValue(value)}`).join(", ")} }}`;
}

const isPart = (node: DesignDocNode) => node.tag === "#text" || node.tag === "#expression";
const emitPart = (node: DesignDocNode) => node.tag === "#text" ? emitText(node.text ?? "") : emitExpression(node.code ?? "");

function emitNode(node: DesignDocNode, indent: string): string {
  if (isPart(node)) return `${indent}${emitPart(node)}`;
  for (const [key, value] of Object.entries(node.props)) {
    if (typeof value === "string" && /[\r\n]/u.test(value)) {
      throw new CodeIrValidationError(`design prop ${key} must not span lines`);
    }
  }
  const props = Object.entries(node.props)
    .map(([key, value]) => {
      if (typeof value === "boolean") return ` ${key}={${value ? "true" : "false"}}`;
      if (typeof value === "number") return ` ${key}={${String(value)}}`;
      return ` ${key}=${emitAttrValue(value)}`;
    })
    .join("") + emitStyle(node.style);
  const text = node.text === undefined ? "" : emitText(node.text);
  // Text and code parts alone stay on the element's line, as a source would write them.
  if (node.children !== undefined && node.children.every(isPart)) {
    return `${indent}<${node.tag}${props}>${text}${node.children.map(emitPart).join("")}</${node.tag}>`;
  }
  // One child per line: whitespace that touches a line break is not text in JSX.
  const children = (node.children ?? []).map((child) => `${emitNode(child, `${indent}  `)}\n`).join("");
  if (children === "" && text === "") return `${indent}<${node.tag}${props} />`;
  return `${indent}<${node.tag}${props}>${text}${children === "" ? "" : `\n${children}${indent}`}</${node.tag}>`;
}

/**
 * Emit a subset function component from a design document. Output is
 * deterministic for identical input; only the documented subset is emitted.
 */
export function designToCode(docInput: DesignDoc): string {
  const doc = normalizeDesignDoc(docInput);
  const body = emitNode(doc.root, "    ");
  return `export function ${doc.componentName}() {\n  return (\n${body}\n  );\n}\n`;
}

function symbolToDesignNode(ir: CodeIr, symbolId: string, depth: number, sources: Readonly<Record<string, string>>): DesignDocNode {
  if (depth > 32) throw new CodeIrValidationError("round-trip design exceeds maxDepth");
  const symbol = ir.symbols[symbolId];
  if (!symbol) throw new CodeIrValidationError(`round-trip symbol ${symbolId} is missing`);
  if (symbol.kind !== "element" && symbol.kind !== "component") {
    throw new CodeIrValidationError(`round-trip symbol ${symbolId} is not renderable`);
  }
  // The design subset is literal: an attribute that is code has no design value, except a style
  // object of literal values, read from its source when the source is given (#398).
  let style: Record<string, string> | undefined;
  for (const prop of symbol.codeProps ?? []) {
    const content = prop.name === "style" && Object.hasOwn(sources, prop.range.file) ? sources[prop.range.file] : undefined;
    const declarations = content === undefined ? null : readStyleObject(content.slice(prop.range.startOffset, prop.range.endOffset));
    if (declarations === null) throw new CodeIrValidationError(`round-trip symbol ${symbolId} has attributes that are code`);
    style = Object.fromEntries(declarations);
  }
  // defineProperty, so a prop named __proto__ is an own key that the design normal form
  // refuses, not an assignment that silently drops it.
  const props: Record<string, string | number | boolean> = {};
  for (const prop of symbol.props) {
    Object.defineProperty(props, prop.name, { value: prop.literal.value, enumerable: true, writable: true, configurable: true });
  }
  const node: DesignDocNode = { tag: symbol.name, props };
  if (style !== undefined && Object.keys(style).length > 0) node.style = style;
  const texts = symbol.texts.map((entry) => entry.value).join("");
  if (texts !== "") node.text = texts;
  const children = symbol.children.map((child) => symbolToDesignNode(ir, child, depth + 1, sources));
  if (children.length > 0) node.children = children;
  return node;
}

/**
 * Convert parsed code back to a design document. Symbols outside the
 * renderable subset raise unsupported errors instead of guessing. With the
 * parsed files' contents by path, a style object of literal values is read
 * back as the node's style; without them it is code, and refused.
 */
export function codeToDesign(irInput: CodeIr, rootSymbolId: string, componentName: string, sources: Readonly<Record<string, string>> = {}): DesignDoc {
  if (typeof rootSymbolId !== "string" || rootSymbolId === "") {
    throw new CodeIrValidationError("round-trip root symbol is required");
  }
  if (typeof componentName !== "string" || !/^[A-Z][A-Za-z0-9]*$/u.test(componentName)) {
    throw new CodeIrValidationError("round-trip component name must be a capitalized identifier");
  }
  const ir = normalizeCodeIr(irInput);
  const root = symbolToDesignNode(ir, rootSymbolId, 0, sources);
  return normalizeDesignDoc({ componentName, root });
}

export function roundTripFingerprint(doc: DesignDoc): string {
  return sha256Text(canonicalCodeIrStringify(normalizeDesignDoc(doc)));
}
