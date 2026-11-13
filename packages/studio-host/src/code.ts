import { randomUUID } from "node:crypto";
import { buildCodeIr, designToCode, expressionShown, exportedComponents, readStyleObject, type DesignDoc, type DesignDocNode, designToMarkup } from "@ninerr/code-ir";
import { DRAWN_ID, planElement, withInstancesExpanded } from "@ninerr/renderer";
import { compileTokens, designSystemOf, isCodePart, modeAttribute, styleValuesOf, tokenReferences } from "@ninerr/document-model";
import { StudioError } from "./errors.ts";
import { importedStyle, styleOutOfWrittenOrder, styleProperties } from "./imports.ts";

// The design/code workflow (PC6, gate 11), over @ninerr/code-ir.
//
// Export: a layer and what is inside it become one JSX function component. Each layer is
// first reduced by the renderer's own sanitizer (planElement), so the code says exactly
// what the canvas shows: the same tags, attributes and style. A text layer folds into its
// parent's text when it is the parent's only content. `class` becomes `className`; style
// is a React style object (#398), which import reads back. A {…} part of imported code
// is written as its exact source, never as text (#361): it is code the sanitizer does not
// reach, which the result counts (codeParts) so the person is told.
//
// Import: JSX in code-ir's supported subset becomes layers, inside a new page frame, as
// one history transaction. Anything outside the subset is refused by code-ir, not guessed.

const MAX_CODE_BYTES = 256 * 1024;
const MAX_EXPORT_DEPTH = 32;
const MAX_EXPORT_NODES = 5_000;
// Each part is parsed, on the host's thread: this bounds the time a document can make it take.
const MAX_EXPORT_CODE_PARTS_BYTES = 1024 * 1024;

const pascal = (value: string, fallback: string) => {
  const name = value.replace(/[^A-Za-z0-9]+/gu, " ").trim().split(" ").filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join("");
  return /^[A-Z][A-Za-z0-9]*$/u.test(name) ? name.slice(0, 64) : fallback;
};

/** No tag, attributes or style of its own. */
function plainLayer(props: any): boolean {
  return props.tag === undefined
    && (props.attributes === undefined || Object.keys(props.attributes).length === 0)
    && (props.style === undefined || Object.keys(props.style).length === 0);
}

/** A bare text layer: nothing of its own but its words, so its text can fold. */
function bareText(node: any): string | null {
  if (node.type !== "text" || node.children.length > 0 || typeof node.props?.text !== "string" || isCodePart(node)) return null;
  return plainLayer(node.props) ? node.props.text : null;
}

/**
 * A code part's exact source. What the canvas shows must be what that source shows: an edit to
 * the shown copy has no code to give, and a document saying one thing and holding another
 * would export code nobody saw. Both are refused rather than exported as something else.
 */
function expressionSource(node: any): string {
  const source = node.props.codeExpression;
  const text = String(node.props.text ?? "a {…} part").slice(0, 100);
  if (typeof source !== "string") {
    throw new StudioError(422, "export-refused", `the source of ${text} is not recorded; bring this code in again to export it`);
  }
  let shown: string;
  try {
    shown = expressionShown(source);
  } catch (error) {
    throw new StudioError(422, "export-refused", error instanceof Error ? error.message.slice(0, 300) : "a {…} part cannot be exported");
  }
  if (node.props.text !== shown || node.children.length > 0) {
    throw new StudioError(422, "export-refused", `${text} is not the code this layer holds, ${shown.slice(0, 100)}; undo the change, delete the layer, or bring the code in again to export`);
  }
  return source;
}

/** The JSX for a layer and everything inside it. */
/**
 * The stylesheet that applies to a layer (#283): its own, or the nearest one above it, or
 * null. The canvas applies it to that layer alone; exported code carries it beside the code.
 */
function appliedStylesheet(document: any, nodeId: string): string | null {
  for (let id: string | null = nodeId, depth = 0; id !== null && depth <= MAX_EXPORT_DEPTH; depth += 1) {
    const node = document.nodes[id];
    if (node === undefined) return null;
    if (typeof node.props?.stylesheet === "string") return node.props.stylesheet;
    id = node.parentId;
  }
  return null;
}

/**
 * Whether a layer is the page imported code was placed in, as import made it: a top-level
 * frame holding one layer, with the page style and nothing else of its own.
 */
function isCodePage(document: any, node: any): boolean {
  if (node?.type !== "frame" || node.parentId !== null || node.children?.length !== 1 || !Object.hasOwn(document.nodes, node.children[0])) return false;
  const props = node.props ?? {};
  if (Object.keys(props).some((key) => !["tag", "name", "style", "attributes"].includes(key))) return false;
  if (props.tag !== "div" || Object.keys(props.attributes ?? {}).length > 0) return false;
  const style = props.style ?? {};
  const keys = Object.keys(style);
  return keys.length === Object.keys(CODE_PAGE_STYLE).length && keys.every((key) => style[key] === CODE_PAGE_STYLE[key]);
}

/**
 * The compiled design tokens (ADR-0004) when the layers under `nodeId` use any of them, so the
 * code carries the custom properties its var() values need; otherwise null.
 */
function tokensUsedUnder(document: any, nodeId: string): string | null {
  const system = designSystemOf(document);
  if (system === null || system.props.tokens.length === 0) return null;
  const names = new Set(system.props.tokens.map((token: any) => token.name));
  const stack = [nodeId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = document.nodes[id];
    if (!node) continue;
    // Its style, stylesheet and overrides; and, for an instance, its component's layers, which it draws.
    if (styleValuesOf(node).some(({ value }: { value: string }) => tokenReferences(value).some((name: string) => names.has(name)))) return compileTokens(document);
    stack.push(...node.children);
    if (node.type === "component-instance" && typeof node.props.componentId === "string") stack.push(node.props.componentId);
  }
  return null;
}

// A layer and what it holds as the design subset code-ir writes, as the canvas draws it.
function exportDesign(document: any, nodeId: unknown): { design: DesignDoc; componentName: string; layers: number; codeParts: number; stylesheet: string | null; tokens: string | null } {
  if (typeof nodeId !== "string" || !Object.hasOwn(document.nodes, nodeId)) throw new StudioError(404, "node-not-found", "no such layer");
  // Instances export as the layers they draw (ADR-0005), as the canvas shows them.
  const stored = document;
  try {
    document = withInstancesExpanded(document, nodeId);
  } catch (error) {
    throw new StudioError(422, "export-too-large", error instanceof Error ? error.message : "these instances draw too many layers to export");
  }
  // The page imported code was placed in, as import made it, exports as the component inside
  // it, under the page's name. Wrapping it instead would nest one more element each time the
  // export is brought in again (#398). A page the person has styled exports as itself.
  const named = document.nodes[nodeId];
  if (isCodePage(document, named)) nodeId = named.children[0] as string;
  let layers = 0;
  let codeParts = 0;
  let codePartBytes = 0;
  // Ids, and the labels that name controls by them (for → id). The canvas draws ids under a
  // name of its own (DRAWN_ID), which the code never carries, but the code keeps them: each id
  // is unique in the export (a second copy of a form gets email-2), and a label points to its
  // control's. A label names the next control with its id in document order, or else the last
  // before; the ids of controls named by a label are given first.
  const order: string[] = [];
  const walkOrder = (id: string, depth: number) => {
    if (depth > MAX_EXPORT_DEPTH || !document.nodes[id]) return;
    // The same limit convert enforces, before any work is done on a larger export.
    if (order.length >= MAX_EXPORT_NODES) throw new StudioError(422, "export-too-large", `at most ${MAX_EXPORT_NODES} layers can be exported at once`);
    order.push(id);
    for (const child of document.nodes[id].children) walkOrder(child, depth + 1);
  };
  walkOrder(nodeId, 1);
  const SIMPLE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
  const attr = (id: string, name: string) => {
    const value = document.nodes[id]?.props?.attributes?.[name];
    return typeof value === "string" && SIMPLE_ID.test(value) ? value : null;
  };
  const exportedId = new Map<string, string>(); // layer → its id in the code
  const labelTarget = new Map<string, string>(); // label node → id in the code
  const taken = new Set<string>();
  // An id unique in the export: as wanted, or with the next free suffix (email-2). The next
  // suffix to try is kept per id, so many copies of one id cost linear time.
  const nextSuffix = new Map<string, number>();
  const unique = (wanted: string): string => {
    let candidate = wanted;
    let copy = nextSuffix.get(wanted) ?? 2;
    while (taken.has(candidate)) candidate = `${wanted}-${copy++}`;
    nextSuffix.set(wanted, copy);
    taken.add(candidate);
    return candidate;
  };
  // Each id's positions in document order (ascending), so a label finds its control by
  // binary search: linear in the export, not labels × controls.
  const positionsOf = new Map<string, number[]>();
  order.forEach((id, position) => {
    const value = attr(id, "id");
    if (value === null) return;
    if (!positionsOf.has(value)) positionsOf.set(value, []);
    positionsOf.get(value)!.push(position);
  });
  order.forEach((labelId, position) => {
    const wanted = attr(labelId, "for");
    if (wanted === null) return;
    const positions = positionsOf.get(wanted);
    if (positions === undefined) return;
    let low = 0;
    let high = positions.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (positions[middle] <= position) low = middle + 1;
      else high = middle;
    }
    // The next control after the label, or else the last one before it (never the label itself).
    let at = low < positions.length ? low : low - 1;
    if (at >= 0 && positions[at] === position) at -= 1;
    if (at < 0) return;
    const control = order[positions[at]];
    if (!exportedId.has(control)) {
      exportedId.set(control, unique(wanted));
    }
    labelTarget.set(labelId, exportedId.get(control)!);
  });
  // Every other layer with an id keeps it too, unique in the export like a control's, so the
  // exported stylesheet's #id rules match the code (#310). A copy's gets a suffix (card-2).
  for (const id of order) {
    const wanted = attr(id, "id");
    if (wanted === null || exportedId.has(id)) continue;
    exportedId.set(id, unique(wanted));
  }
  const convert = (id: string, depth: number): DesignDocNode => {
    if (depth > MAX_EXPORT_DEPTH) throw new StudioError(422, "export-too-deep", `layers nested more than ${MAX_EXPORT_DEPTH} deep cannot be exported`);
    layers += 1;
    if (layers > MAX_EXPORT_NODES) throw new StudioError(422, "export-too-large", `at most ${MAX_EXPORT_NODES} layers can be exported at once`);
    const node = document.nodes[id];
    const plan = planElement(node);
    const props: Record<string, string> = {};
    for (const [name, value] of Object.entries(plan.attributes as Record<string, string>)) {
      if (name === DRAWN_ID) continue;
      if (name === "data-ninerr-href") props.href = value;
      else if (name === "class") props.className = value;
      else if (name === "for") props.htmlFor = value;
      else if (/^[A-Za-z_][A-Za-z0-9_:.-]*$/u.test(name) && !/[\r\n]/u.test(value)) props[name] = value;
    }
    // The design-system modes it takes (ADR-0004), which the exported token CSS selects on.
    const modes = modeAttribute(node.props);
    if (modes !== null) props["data-ninerr-mode"] = modes;
    if (exportedId.has(id)) props.id = exportedId.get(id)!;
    if (labelTarget.has(id)) props.htmlFor = labelTarget.get(id)!;
    else if (props.htmlFor !== undefined) delete props.htmlFor; // names nothing in this export
    // Styles are written as React style objects (#398), which import reads back.
    const style = Object.keys(plan.style).length > 0 ? { ...plan.style as Record<string, string> } : undefined;
    if (isCodePart(node)) {
      codeParts += 1;
      codePartBytes += typeof node.props.codeExpression === "string" ? node.props.codeExpression.length : 0;
      if (codePartBytes > MAX_EXPORT_CODE_PARTS_BYTES) throw new StudioError(422, "export-too-large", "the {…} parts of these layers are too large to export at once");
      const part: DesignDocNode = { tag: "#expression", props: {}, code: expressionSource(node) };
      // Styled, or exported alone, it keeps the element the canvas draws around it.
      return depth > 1 && plainLayer(node.props) ? part : { tag: plan.tag, props, ...(style ? { style } : {}), children: [part] };
    }
    const out: DesignDocNode = { tag: plan.tag, props, ...(style ? { style } : {}) };
    const childIds: string[] = node.children;
    const folded = childIds.length > 0 && childIds.every((child) => bareText(document.nodes[child]) !== null);
    let text = typeof plan.text === "string" ? plan.text : "";
    if (folded) text += childIds.map((child) => bareText(document.nodes[child])).join("");
    if (text !== "") out.text = text;
    if (!folded && childIds.length > 0) {
      const wordsOf = (child: string | undefined) => child === undefined || document.nodes[child] === undefined ? null : bareText(document.nodes[child]);
      out.children = childIds.map((child, at) => {
        const words = wordsOf(child);
        // Two runs side by side keep the element the canvas draws for each: bare, they would
        // read back as one run with a space where the line break is.
        if (words === null || wordsOf(childIds[at - 1]) !== null || wordsOf(childIds[at + 1]) !== null) return convert(child, depth + 1);
        layers += 1;
        return { tag: "#text", props: {}, text: words };
      });
    }
    return out;
  };
  const componentName = pascal(typeof named.props?.name === "string" ? named.props.name : "", "Layer");
  const design: DesignDoc = { componentName, root: convert(nodeId, 1) };
  return { design, componentName, layers, codeParts, stylesheet: appliedStylesheet(document, nodeId), tokens: tokensUsedUnder(stored, nodeId) };
}

const refused = (error: unknown) => new StudioError(422, "export-refused", error instanceof Error ? error.message.slice(0, 300) : "this layer cannot be exported");

export function exportJsx(document: any, nodeId: unknown): { componentName: string; code: string; layers: number; codeParts: number; stylesheet: string | null; tokens: string | null } {
  const { design, ...exported } = exportDesign(document, nodeId);
  try {
    return { ...exported, code: designToCode(design) };
  } catch (error) {
    throw refused(error);
  }
}

// The page an exported HTML file is: no script, nothing loaded from anywhere, its own styles.
const HTML_EXPORT_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

/**
 * A layer as a standalone HTML page, as the canvas draws it: its markup, the design tokens it
 * uses, and its page's stylesheet, which applies inside the page as it does in its frame on the
 * canvas (@scope, whose root takes what the canvas renamed html, body and :root to). A {…} part
 * is code and is written as a comment. The page loads nothing and runs nothing.
 */
export function exportHtml(document: any, nodeId: unknown): { componentName: string; html: string; layers: number; codeParts: number } {
  const { design, componentName, layers, codeParts, stylesheet, tokens } = exportDesign(document, nodeId);
  let markup: string;
  try {
    markup = designToMarkup(design);
  } catch (error) {
    throw refused(error);
  }
  const title = typeof document.nodes[nodeId as string]?.props?.name === "string" && document.nodes[nodeId as string].props.name.trim() !== "" ? document.nodes[nodeId as string].props.name.trim() : componentName;
  const escape = (value: string) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  // `</style` inside a style would end it early; the stylesheets are sanitized CSS, which never needs it.
  const css = [tokens, stylesheet === null ? null : `@scope ([data-ninerr-page]) {\n${stylesheet}\n}`].filter((part) => part !== null).join("\n").replace(/<\/style/giu, "<\\/style");
  const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta http-equiv="Content-Security-Policy" content="${HTML_EXPORT_CSP}">\n<title>${escape(title)}</title>\n${css === "" ? "" : `<style>\n${css}\n</style>\n`}</head>\n<body>\n<div data-ninerr-page>${markup}</div>\n</body>\n</html>\n`;
  return { componentName, html, layers, codeParts };
}

/** Layers for JSX source, inside a new page frame, as one operation. */
/** Where a layer brought in from a connected codebase came from (PC11). */
export interface CodeSource {
  file: string;
  component: string;
  /** Child indexes from the component's root element ("" is the root). */
  path: string;
  /** The element's tag; "#text" for a run of text inside an element with children. */
  tag: string;
  /** For a run of text: its index among the element's texts. */
  textIndex?: number;
  /** The source's literal values when it was brought in (or last written back). */
  base: { text?: string; props: Record<string, string> };
  /**
   * What is code in the source and never written back (P08-G11, #282): for an element, its
   * attributes that are code (by their layer names, class for className); for a {…} part
   * ("#expression"), its source text as the layer shows it.
   */
  code?: string[];
  /**
   * For an element or fragment: its children in the source when it was brought in, in order
   * (each child's tag, "#expression", "#fragment", or "#text" for a run of text). A layer is
   * found in the file by its position, so when these no longer line up, nothing under the
   * element is written back (#285).
   */
  shape?: string[];
  /**
   * A write-back recorded before its file was renamed into place and not yet confirmed: the
   * bases it writes, the SHA-256 the file has once it lands, and the name of the temporary
   * file next to it that becomes the file (#185). See codebase.ts, pendingState.
   */
  pending?: { base: { text?: string; props: Record<string, string> }; sha256: string; temp?: string };
}

/** The frame a piece of imported code is placed in: a page, not part of the component (#398). */
const CODE_PAGE_STYLE: Readonly<Record<string, string>> = Object.freeze({ position: "relative", width: "800px", "min-height": "400px", background: "#ffffff" });

/**
 * The CSS an object style says, when it is only literal values: style={{ padding: "40px",
 * zIndex: 2 }} is "padding: 40px; z-index: 2". Null for anything else, which stays code
 * (code-ir's readStyleObject, #398). `attribute` is the whole attribute as written, style={…}.
 */
export function objectStyleText(attribute: string): string | null {
  const declarations = readStyleObject(attribute);
  return declarations === null ? null : declarations.map(([name, value]) => `${name}: ${value}`).join("; ");
}

/**
 * The CSS an element's object style (style={{ … }}) says, read from the source it was parsed
 * from: undefined when it has none, null when it is not only literal values.
 */
export function objectStyleOf(symbol: any, content: string): string | null | undefined {
  const prop = (symbol.codeProps ?? []).find((candidate: any) => candidate.name === "style");
  return prop === undefined ? undefined : objectStyleText(content.slice(prop.range.startOffset, prop.range.endOffset));
}

/** An element tag the canvas draws as itself (svg's linearGradient too); others are named boxes. */
const PLAIN_TAG = /^[a-z][A-Za-z0-9]*$/u;
/** A prop name a layer attribute can take: what the design subset allows. */
const DESIGN_NAME = /^[A-Za-z][A-Za-z0-9-]*$/u;
/** The layer's name for a source prop: class for className, for for htmlFor. */
const LAYER_NAMES = new Map([["className", "class"], ["htmlFor", "for"]]);
export const layerName = (prop: string) => LAYER_NAMES.get(prop) ?? prop;

/** An element's children in source order, as CodeSource.shape records them. */
export function sourceShape(ir: any, symbol: any): string[] {
  return [
    ...symbol.texts.filter((entry: any) => entry.value !== "").map((entry: any) => ({ at: entry.range.startOffset, name: "#text" })),
    ...symbol.children.map((child: string) => ({ at: ir.symbols[child].range.startOffset, name: ir.symbols[child].name })),
  ].sort((a, b) => a.at - b.at).map((piece) => piece.name);
}

export interface ImportJsxOptions {
  /** The source file's path, as code-ir records it (its extension picks JSX or TSX). */
  path?: string;
  /** The exported component to bring in; by default, the first one. */
  component?: string;
  /** Record each element layer's source in props.codeSource, for writing edits back. */
  bind?: boolean;
}

export function importJsx(source: unknown, options: ImportJsxOptions = {}): { operations: unknown[]; frameId: string; componentName: string; layers: number; layersWithStyleLeftOut: number; layersWithStyleOutOfOrder: number } {
  if (typeof source !== "string" || source.trim() === "") throw new StudioError(400, "invalid-code", "code must be a non-empty string");
  if (Buffer.byteLength(source) > MAX_CODE_BYTES) throw new StudioError(413, "code-too-large", "code is limited to 256 KiB");
  const refuse = (message: string) => new StudioError(422, "code-refused", message.slice(0, 300));
  // Pasted code is read as TSX, which also reads JSX; a file by its own extension.
  const sourcePath = options.path ?? "Imported.tsx";
  let ir: any;
  let exportedNames: string[];
  try {
    // Each component once, by the name it is defined with.
    exportedNames = exportedComponents(sourcePath, source);
    ir = buildCodeIr([{ path: sourcePath, content: source }]);
  } catch (error) {
    throw refuse(error instanceof Error ? error.message : "the code could not be read");
  }
  // The exported component's own element, by name, not whichever element came first.
  // A component's definition is the component symbol whose element is a root; a JSX use of
  // the same name (<Button>) is also a component symbol, but inside another element. The
  // first exported function with a definition is brought in (others in the file are not).
  // Built once, so finding definitions stays linear in the symbols however many names there are.
  const roots = new Set(ir.rootIds);
  const definitions = new Map<string, any>();
  for (const symbol of Object.values(ir.symbols) as any[]) {
    if (symbol.kind === "component" && symbol.children.length > 0 && roots.has(symbol.children[0]) && !definitions.has(symbol.name)) definitions.set(symbol.name, symbol);
  }
  const definitionOf = (name: string) => definitions.get(name);
  if (options.component !== undefined && !exportedNames.includes(options.component)) throw refuse(`${options.component} is not an exported function component of this file`);
  const declared = options.component ?? exportedNames.find((name) => definitionOf(name) !== undefined) ?? exportedNames[0] ?? null;
  const component = declared === null ? undefined : definitionOf(declared);
  const rootId = component ? component.children[0] : (declared === null && ir.rootIds.length === 1 ? ir.rootIds[0] : null);
  // JSX that code-ir cannot read gives no element at all (it is refused whole, never partly
  // imported), so a component whose own JSX cannot be read has no element here; the file's
  // first such construct is named. What cannot be read elsewhere is not this component's.
  if (!rootId) {
    const first = ir.unsupported[0];
    const why = first === undefined ? "" : ` (this file uses something Ninerr cannot bring in yet: ${String(first.reason)}, line ${first.range?.startLine ?? "?"})`;
    throw refuse(declared === null ? "bring in one exported function component, e.g. export function Card() { return <section>…</section>; }" : `${declared} does not return a JSX element Ninerr can read${why}`);
  }
  const componentName = declared ?? "Imported";

  const frameId = `page-code-${randomUUID().slice(0, 12)}`;
  const suffix = randomUUID().slice(0, 8);
  let count = 0;
  let layersWithStyleLeftOut = 0;
  let layersWithStyleOutOfOrder = 0;
  const nodes: unknown[] = [];
  const nextId = () => `code-${suffix}-${++count}`;
  const convert = (symbolId: string, parentId: string, name?: string, path: number[] = []): string => {
    const symbol = ir.symbols[symbolId];
    const id = nextId();
    if (symbol.kind === "expression") {
      // A {…} part is code: a text layer that shows it, bound so a write-back knows to leave it.
      const shown = `{${symbol.code}}`;
      // The whole part as written, for export: `shown` is shortened and its whitespace collapsed.
      const exact = source.slice(symbol.range.startOffset, symbol.range.endOffset);
      const props: Record<string, unknown> = { name: "Code", text: shown, codeExpression: exact };
      if (options.bind) props.codeSource = { file: options.path ?? "", component: componentName, path: path.join("."), tag: "#expression", base: { props: {} }, code: [shown] } satisfies CodeSource;
      nodes.push({ id, type: "text", parentId, children: [], props, metadata: {} });
      return id;
    }
    const attributes: Record<string, string> = {};
    let style: Record<string, string> = {};
    // Only names a design attribute can have (no __proto__): others stay code in the source.
    const designable = (prop: any) => DESIGN_NAME.test(prop.name);
    for (const prop of symbol.props.filter(designable)) {
      const value = prop.literal.value;
      if (value === false) continue; // absent, as in JSX
      const text = value === true ? "" : String(value);
      if (prop.name === "className") attributes.class = text;
      else if (prop.name === "htmlFor") attributes.for = text;
      else if (prop.name === "style" && typeof value === "string") {
        style = importedStyle({ cssText: value });
        if (Object.keys(style).length < Object.keys(styleProperties({ cssText: value })).length) layersWithStyleLeftOut += 1;
        if (styleOutOfWrittenOrder({ cssText: value })) layersWithStyleOutOfOrder += 1;
      }
      else attributes[prop.name] = text;
    }
    // An object style (style={{ … }}) is code in the source: the layer shows what its literal
    // values say, and one that cannot be read is counted as left out, never dropped silently.
    const cssText = objectStyleOf(symbol, source);
    if (cssText !== undefined) {
      if (cssText === null) layersWithStyleLeftOut += 1;
      else {
        style = importedStyle({ cssText });
        if (Object.keys(style).length < Object.keys(styleProperties({ cssText })).length) layersWithStyleLeftOut += 1;
        if (styleOutOfWrittenOrder({ cssText })) layersWithStyleOutOfOrder += 1;
      }
    }
    // A component (Button, Item.Skeleton) or a name that is not a plain tag is kept as a named
    // layer the canvas draws as a box; a fragment is a box that takes no part in layout.
    const fragment = symbol.kind === "fragment";
    const named = fragment || !PLAIN_TAG.test(symbol.name);
    if (fragment) style = { display: "contents" };
    const label = name ?? (fragment ? "Fragment" : symbol.name);
    const record: any = {
      id,
      type: "element",
      parentId,
      children: [],
      props: { tag: named ? "div" : symbol.name, ...(named || name ? { name: label } : {}), attributes, style },
      metadata: {},
    };
    if (options.bind) {
      // The source's literal values, the base a later write-back compares against.
      const base: CodeSource["base"] = { props: {} };
      for (const prop of symbol.props.filter(designable)) if (typeof prop.literal.value === "string") base.props[prop.name] = prop.literal.value;
      if (symbol.children.length === 0 && symbol.texts.length === 1) base.text = symbol.texts[0].value;
      const codeSource: CodeSource = { file: options.path ?? "", component: componentName, path: path.join("."), tag: symbol.name, base };
      // Attributes that are code, by the names a layer would give them.
      const code = [...(symbol.codeProps ?? []).map((prop: any) => layerName(prop.name)), ...symbol.props.filter((prop: any) => !designable(prop)).map((prop: any) => prop.name)];
      if (code.length > 0) codeSource.code = code;
      codeSource.shape = sourceShape(ir, symbol);
      record.props.codeSource = codeSource;
    }
    nodes.push(record);
    // Text and elements in the order they appear in the source: text alone is the
    // element's own text; mixed with elements, each run of text is its own text layer.
    const pieces = [
      ...symbol.texts.map((entry: any, textIndex: number) => ({ at: entry.range.startOffset, text: entry.value, textIndex })),
      ...symbol.children.map((child: string, childIndex: number) => ({ at: ir.symbols[child].range.startOffset, child, childIndex })),
    ].sort((a, b) => a.at - b.at);
    if (symbol.children.length === 0) {
      const text = symbol.texts.map((entry: any) => entry.value).join("");
      if (text !== "") record.props.text = text;
    } else {
      for (const piece of pieces) {
        if (piece.child !== undefined) record.children.push(convert(piece.child, id, undefined, [...path, piece.childIndex]));
        else if (piece.text !== "") {
          const textId = nextId();
          const textProps: Record<string, unknown> = { text: piece.text };
          // A run of text is bound too, by its element and its index among the element's texts.
          if (options.bind) textProps.codeSource = { file: options.path ?? "", component: componentName, path: path.join("."), tag: "#text", textIndex: piece.textIndex, base: { text: piece.text, props: {} } } satisfies CodeSource;
          nodes.push({ id: textId, type: "text", parentId: id, children: [], props: textProps, metadata: {} });
          record.children.push(textId);
        }
      }
    }
    return id;
  };
  const frame = { id: frameId, type: "frame", parentId: null, children: [] as string[], props: { tag: "div", name: componentName, style: { ...CODE_PAGE_STYLE } }, metadata: {} };
  frame.children = [convert(rootId, frameId, componentName)];
  return { operations: [{ type: "restore-subtree", rootId: frameId, parentId: null, nodes: [frame, ...nodes] }], frameId, componentName, layers: count, layersWithStyleLeftOut, layersWithStyleOutOfOrder };
}
