import { createHash, randomUUID } from "node:crypto";
import { MCPAuthorizationError, MCPContractError, assertMCPToolSurface, classifyTool, mcpArgumentsSha256, requireMCPToolCall } from "@ninerr/mcp-protocol";
import { TOKEN_NAME, TOKEN_TYPES, tokenReferences, addMode, deleteToken, designSystemOf, designSystemProblem, isCodePart, newDesignSystemProps, renameToken, setToken, textLayerOf, tokenUses } from "@ninerr/document-model";
import { planElement, styleDeclarationProblem } from "@ninerr/renderer";
import { LAYOUT_MODES, componentsFor, componentsOf, createComponent, detachInstance, drawsComponent, insertInstance, instanceLayers, overrideFor, resetInstance, setInstanceOverride, setLayout } from "@ninerr/canvas";
import { RECORD_SOURCES, UI_COMPONENT_SOURCES, loadComponentRecords, searchComponents } from "@ninerr/component-sources";
import { exportHtml, exportJsx, exportTailwind } from "./code.ts";
import { StudioError } from "./errors.ts";
import type { ReferenceCatalog } from "./reference-catalog.ts";
import type { StudioActor, StudioSession } from "./session.ts";

// Ninerr's MCP server. It runs inside the studio host, so agent edits go through the same
// single writer as the editor's, and every one is a history transaction attributed to the
// agent. The transport is MCP's Streamable HTTP in its plain request/response form
// (POST /mcp, one JSON-RPC message, one JSON answer) on the host's loopback listener; the
// stdio relay (relay.ts) forwards a stdio MCP client to it.
//
// Every tools/call is authorized by requireMCPToolCall before anything is dispatched. The
// actor is the agent the request's credential belongs to, never anything in the payload,
// and a confirmation for a consequential tool comes only from the person approving it in
// the editor (the host's own confirmation flow), never from the client (#82, P06 G8).

export const MCP_PROTOCOL_VERSIONS = Object.freeze(["2025-06-18", "2025-03-26", "2024-11-05"]);
const SERVER_INFO = Object.freeze({ name: "ninerr", title: "Ninerr", version: "0.0.0" });
const MAX_RESULT_NODES = 500;
const MAX_TREE_DEPTH = 12;
const MAX_DUPLICATED_NODES = 5_000;
// How long a consequential call waits for the person before answering "still pending".
export const CONFIRMATION_WAIT_MS = 50_000;
// How long a request, or an approval not yet used by a retry, stays valid.
const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (context: ToolContext, args: Record<string, any>) => Json | Promise<Json>;
}
interface ToolContext {
  session: StudioSession;
  actor: StudioActor;
  toolName: string;
  selection: () => string[];
  references: ReferenceCatalog;
  edit: (operations: unknown[], intent: string) => Json;
}

/** Tool arguments are the schema's and nothing else: no directory, URL, tenant or token gets through. */
function onlyArguments(args: unknown, names: string[]): Record<string, unknown> {
  const given = (args ?? {}) as Record<string, unknown>;
  for (const name of Object.keys(given)) if (!names.includes(name)) throw new ToolError(`this tool takes no argument ${JSON.stringify(name.slice(0, 40))}`);
  return given;
}

// Names a person reads and may be asked to approve (layers, components, their properties,
// tokens, modes, collections and descriptions) look like what they are (#64): an agent's label
// carries no controls, format characters (bidi reordering, zero-width, tag "smuggling"
// characters), separators or blank-looking fillers, and variation selectors only where they
// vary the character before them. ZWNJ and ZWJ stay legal (emoji, complex scripts), and a
// description may break lines. The rule is decision-assurance's and visual-git's.
const LABEL_KEYS = new Set(["name", "collection", "description"]);
const HIDDEN_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u{34f}\u{115f}\u{1160}\u{2800}\u{3164}\u{ffa0}]/u;
const JOINERS = /[\u{200c}\u{200d}]/gu;
const LINE_BREAKS = /[\t\n\r]/gu;
const SELECTOR_SMUGGLING = /(?<![\p{Extended_Pictographic}0-9#*])[\u{fe0e}\u{fe0f}]|[\u{fe00}-\u{fe0d}]|(?<!\p{Ideographic})[\u{e0100}-\u{e01ef}]/u;
const MAX_LABEL_DEPTH = 4;

/** The first label among a call's arguments that hides or reorders what a person reads, as a refusal; null when there is none. */
function hiddenLabel(value: unknown, depth = 0): string | null {
  if (depth > MAX_LABEL_DEPTH || value === null || typeof value !== "object") return null;
  for (const [key, entry] of Object.entries(value)) {
    if (LABEL_KEYS.has(key) && typeof entry === "string") {
      const visible = entry.replace(JOINERS, "");
      const shown = key === "description" ? visible.replace(LINE_BREAKS, "") : visible;
      if (!entry.isWellFormed() || HIDDEN_TEXT.test(shown) || SELECTOR_SMUGGLING.test(entry)) {
        return `${key} must not contain control or hidden characters: a person reads it as it is shown`;
      }
    }
    const nested = hiddenLabel(entry, depth + 1);
    if (nested !== null) return nested;
  }
  return null;
}

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const idList = { type: "array", items: { type: "string" }, minItems: 1, maxItems: 500 };

function nodeOf(session: StudioSession, id: unknown) {
  const document = session.document as any;
  if (typeof id !== "string" || !Object.hasOwn(document.nodes, id)) throw new ToolError(`no node ${JSON.stringify(String(id)).slice(0, 80)}`);
  return document.nodes[id];
}

function summary(node: any, document: any) {
  const props = node.props ?? {};
  // The words a person sees: the element's own text, or its only text layer's (#235).
  const words = textLayerOf(document, node.id);
  const text = words === null ? undefined : document.nodes[words].props?.text;
  return {
    id: node.id,
    type: node.type,
    ...(typeof props.tag === "string" ? { tag: props.tag } : {}),
    ...(typeof props.name === "string" ? { name: props.name } : {}),
    ...(typeof text === "string" ? { text: text.slice(0, 200) } : {}),
    childCount: node.children.length,
  };
}

class ToolError extends Error {}

// The operations a shared builder makes; what it refuses is said to the agent as a tool error.
function tokenOperation(build: () => unknown[]): unknown[] {
  try {
    return build();
  } catch (error) {
    throw new ToolError(error instanceof Error ? error.message : String(error));
  }
}

const strings = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500 || value.some((item) => typeof item !== "string")) throw new ToolError(`${label} must be a list of 1-500 node ids`);
  return value as string[];
};

const TOOLS: Tool[] = [
  {
    name: "project_info",
    title: "Project information",
    description: "The open project: its name, document id and name, revision, node count and root layers.",
    inputSchema: object({}),
    run: ({ session }) => {
      const document = session.document as any;
      return { project: session.name, documentId: document.id, documentName: document.name, revision: session.revision, nodeCount: Object.keys(document.nodes).length, roots: document.rootIds.map((id: string) => summary(document.nodes[id], document)) };
    },
  },
  {
    name: "layer_tree",
    title: "Layer tree",
    description: "The layer tree under a node (or the whole document), to a depth (default 3, at most 12), at most 500 nodes.",
    inputSchema: object({ nodeId: { type: "string" }, depth: { type: "integer", minimum: 1, maximum: MAX_TREE_DEPTH } }),
    run: ({ session }, args) => {
      const document = session.document as any;
      const depth = Math.min(MAX_TREE_DEPTH, Math.max(1, Number.isInteger(args.depth) ? args.depth : 3));
      let budget = MAX_RESULT_NODES;
      let truncated = false;
      // Depth-first, taking one node of the budget per node shown and stopping when it runs out.
      const walk = (id: string, level: number): Json => {
        budget -= 1;
        const node = document.nodes[id];
        const out: Record<string, Json> = summary(node, document);
        if (level < depth && node.children.length > 0) {
          const children: Json[] = [];
          for (const child of node.children) {
            if (budget <= 0) {
              truncated = true;
              break;
            }
            children.push(walk(child, level + 1));
          }
          out.children = children;
        }
        return out;
      };
      const roots = args.nodeId === undefined ? document.rootIds : [nodeOf(session, args.nodeId).id];
      const tree: Json[] = [];
      for (const id of roots) {
        if (budget <= 0) {
          truncated = true;
          break;
        }
        tree.push(walk(id, 1));
      }
      return { revision: session.revision, tree, truncated };
    },
  },
  {
    name: "layer_details",
    title: "Layer details",
    description: "One layer: its type, parent, children and properties (tag, text, name, attributes, style), and the words a person sees in it.",
    inputSchema: object({ nodeId: { type: "string" } }, ["nodeId"]),
    run: ({ session }, args) => {
      const node = nodeOf(session, args.nodeId);
      const words = textLayerOf(session.document as any, node.id);
      const text = words === null ? undefined : (session.document as any).nodes[words].props?.text;
      return { id: node.id, type: node.type, parentId: node.parentId, children: node.children, props: node.props, ...(typeof text === "string" ? { text } : {}) };
    },
  },
  {
    name: "layer_children",
    title: "Child layers",
    description: "The direct children of a layer, or the root layers.",
    inputSchema: object({ nodeId: { type: "string" } }),
    run: ({ session }, args) => {
      const document = session.document as any;
      const ids = args.nodeId === undefined ? document.rootIds : nodeOf(session, args.nodeId).children;
      return { children: ids.slice(0, MAX_RESULT_NODES).map((id: string) => summary(document.nodes[id], document)) };
    },
  },
  {
    name: "find_layers",
    title: "Find layers",
    description: "Layers whose name or text contains `query` (case-insensitive), optionally of a type or tag; at most `limit` (default 50, at most 500).",
    inputSchema: object({ query: { type: "string" }, type: { type: "string" }, tag: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: MAX_RESULT_NODES } }),
    run: ({ session }, args) => {
      const document = session.document as any;
      const query = typeof args.query === "string" ? args.query.toLowerCase() : null;
      const limit = Number.isInteger(args.limit) ? Math.min(MAX_RESULT_NODES, Math.max(1, args.limit)) : 50;
      const found = [];
      for (const node of Object.values(document.nodes) as any[]) {
        if (found.length >= limit) break;
        if (args.type !== undefined && node.type !== args.type) continue;
        if (args.tag !== undefined && node.props?.tag !== args.tag) continue;
        if (query !== null && ![node.props?.name, node.props?.text].some((value) => typeof value === "string" && value.toLowerCase().includes(query))) continue;
        found.push(summary(node, document));
      }
      return { nodes: found };
    },
  },
  {
    name: "selection",
    title: "Selection",
    description: "The layers selected in the Ninerr editor right now.",
    inputSchema: object({}),
    run: ({ session, selection }) => {
      const document = session.document as any;
      return { nodes: selection().filter((id) => Object.hasOwn(document.nodes, id)).map((id) => summary(document.nodes[id], document)) };
    },
  },
  {
    name: "layer_code",
    title: "Layer as JSX",
    description: "A layer and everything inside it as a JSX function component (through code-ir), with the tags, attributes and style the canvas renders. format \"tailwind\" writes each style as Tailwind classes that set exactly what it says, keeping in a style object what no class can carry; format \"html\" gives a standalone HTML page instead, which loads and runs nothing. codeParts counts {…} parts copied exactly from the source this design was brought in from: they are not sanitized, and the names they use must exist where the code runs (in HTML they are written as comments).",
    inputSchema: object({ nodeId: { type: "string" }, format: { type: "string", enum: ["jsx", "tailwind", "html"] } }, ["nodeId"]),
    run: ({ session }, args) => {
      try {
        if (args.format !== undefined && !["jsx", "tailwind", "html"].includes(args.format as string)) throw new ToolError("format is \"jsx\", \"tailwind\" or \"html\"");
        if (args.format === "tailwind") return exportTailwind(session.document, args.nodeId);
        if (args.format === "html") return exportHtml(session.document, args.nodeId);
        return exportJsx(session.document, args.nodeId);
      } catch (error) {
        throw new ToolError(error instanceof Error ? error.message : "the layer cannot be exported");
      }
    },
  },
  {
    name: "search_design_references",
    title: "Search design references",
    description: "Search the local reference pack the person has read into this project: public references with their rights. Read-only and offline. status is not-loaded when there is none, and nothing is fetched instead.",
    inputSchema: object({
      query: { type: "string", maxLength: 200 },
      kinds: { type: "array", maxItems: 6, items: { type: "string", enum: ["screen", "flow", "pattern", "asset", "token", "component"] } },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    }),
    run: ({ session, references }, args) => references.search(session, session.name, onlyArguments(args, ["query", "kinds", "limit"])),
  },
  {
    name: "get_design_reference",
    title: "Read a design reference",
    description: "One reference from the project's local pack by id: its metadata, source and rights, and whether reuse is allowed. Never file bytes. Reuse stays not allowed until a grant outside the pack confirms it.",
    inputSchema: object({ id: { type: "string", maxLength: 144 } }, ["id"]),
    run: ({ session, references }, args) => references.get(session, session.name, onlyArguments(args, ["id"]).id),
  },
  {
    name: "guide",
    title: "How to work with Ninerr",
    description: "How Ninerr documents, layers and edits work for an agent.",
    inputSchema: object({}),
    run: () => ({
      guide: [
        "A Ninerr document is a tree of layers. Each layer has an id, a type (frame, element, text, ...) and props: tag (an HTML element), text, name (the layer name), attributes and style (CSS properties).",
        "Every edit you make is one history transaction attributed to you; the person sees it live on the canvas and can undo it.",
        "Read with project_info, layer_tree, layer_children, layer_details, find_layers and selection; layer_code gives a layer as JSX.",
        "Edit with create_frame, set_text, rename_layers, set_styles, set_attributes (classes, dir for right-to-left text, aria-*), set_layout (children in a row or column), move_layers and duplicate_layers. delete_layers needs the person to approve it in Ninerr.",
        "Design tokens: read them with design_tokens; set_token, add_token_mode, rename_token and set_layer_modes change them, and a layer uses one as var(--name) in set_styles. delete_token needs the person's approval, and a token in use needs its replacement.",
        "Components: list_components lists them; create_component makes a layer a component, add_component_property gives it properties, insert_instance places instances, set_instance_values and set_instance_override change one instance (instance_layers gives the paths), and reset_instance takes its overrides off. detach_instance writes an instance, overrides and all, as real layers that no longer follow the component. An instance's layers are its component's: change the component itself to change every instance.",
        "The person takes back an agent's changes latest first: each new change goes on top of the ones before.",
        "Every tool that changes the document takes dryRun: true, which checks the change and says what it would touch (wouldChange) without making it or asking the person anything (a created layer's id there is not the one a real call makes), and baseRevision, the revision you read (project_info gives it): a change to a document that has moved on since is refused, so read it again.",
        "A layer whose props hold codeExpression shows {…} code from its source: its text is only a copy, and set_text refuses it and any element holding one.",
        "Style values are CSS strings (\"24px\", \"#336699\"); null removes a property.",
        "search_design_references and get_design_reference read the local reference pack the person has chosen for this project. They change nothing, and a reference's rights say whether it may be reused.",
        "Library components: search_components finds components of the component sources Ninerr has records of (Meta Astryx, pinned) by name or purpose; get_component gives one's exact props, variants, accessibility criteria, limitations, import path and provenance. Use only props a record lists. They change nothing and fetch nothing.",
      ].join("\n"),
    }),
  },
  {
    name: "finish_task",
    title: "Finish working",
    description: "Tell Ninerr you have finished with these layers. Changes nothing.",
    inputSchema: object({ nodeIds: idList }),
    run: () => ({ ok: true }),
  },
  {
    name: "create_frame",
    title: "Create frame",
    description: "Add a new top-level frame of a size, optionally named.",
    inputSchema: object({ name: { type: "string", maxLength: 200 }, width: { type: "number", minimum: 1, maximum: 100000 }, height: { type: "number", minimum: 1, maximum: 100000 } }, ["width", "height"]),
    run: ({ session, edit }, args) => {
      const size = (value: unknown, label: string) => {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 100_000) throw new ToolError(`${label} must be a number from 1 to 100000`);
        return `${Math.round(value * 100) / 100}px`;
      };
      const id = `frame-${randomUUID().slice(0, 12)}`;
      const document = session.document as any;
      const props: Record<string, unknown> = { tag: "main", style: { position: "relative", width: size(args.width, "width"), height: size(args.height, "height"), background: "#ffffff" } };
      if (typeof args.name === "string" && args.name.trim() !== "") props.name = args.name.trim().slice(0, 200);
      return { nodeId: id, ...(edit([{ type: "insert-node", node: { id, type: "frame", props }, parentId: null, index: document.rootIds.length }], "Create frame") as object) };
    },
  },
  {
    name: "set_text",
    title: "Set text",
    description: "Replace a layer's text. For an element whose only content is a text layer, that layer's text. A layer that shows {…} code from its source is refused.",
    inputSchema: object({ nodeId: { type: "string" }, text: { type: "string", maxLength: 100000 } }, ["nodeId", "text"]),
    run: ({ session, edit }, args) => {
      const node = nodeOf(session, args.nodeId);
      if (typeof args.text !== "string") throw new ToolError("text must be a string");
      // A {…} part is code: its text is only what the canvas shows of it (#370). Text set on an
      // element holding one, at any depth, would sit beside the code, and never reach the source.
      const nodes = (session.document as any).nodes;
      const below: any[] = [node];
      let holdsCode = false;
      while (!holdsCode && below.length > 0) {
        const each = below.pop();
        holdsCode = isCodePart(each);
        for (const id of each.children) below.push(nodes[id]);
      }
      if (holdsCode) {
        throw new ToolError("this layer shows {…} code from its source, so its text cannot be set here; change it in the code. Its style, name and position can still change.");
      }
      // The words a person sees: an element's own text, or its only text layer's (#235).
      const target = textLayerOf(session.document, node.id) ?? node.id;
      return edit([{ type: "set-props", nodeId: target, set: { text: args.text } }], "Set text");
    },
  },
  {
    name: "rename_layers",
    title: "Rename layers",
    description: "Set layer names; an empty name removes it.",
    inputSchema: object({ renames: { type: "array", minItems: 1, maxItems: 500, items: object({ nodeId: { type: "string" }, name: { type: "string", maxLength: 200 } }, ["nodeId", "name"]) } }, ["renames"]),
    run: ({ session, edit }, args) => {
      if (!Array.isArray(args.renames) || args.renames.length === 0 || args.renames.length > 500) throw new ToolError("renames must be a list of 1-500 renames");
      const operations = args.renames.map((rename: any) => {
        const node = nodeOf(session, rename?.nodeId);
        if (typeof rename.name !== "string") throw new ToolError("each rename needs a name");
        const name = rename.name.trim().slice(0, 200);
        return name === "" ? { type: "set-props", nodeId: node.id, set: {}, unset: ["name"] } : { type: "set-props", nodeId: node.id, set: { name } };
      });
      return edit(operations, args.renames.length === 1 ? "Rename layer" : "Rename layers");
    },
  },
  {
    name: "set_styles",
    title: "Set styles",
    description: "Change CSS properties of layers. Values are CSS strings; null removes the property.",
    inputSchema: object({ updates: { type: "array", minItems: 1, maxItems: 500, items: object({ nodeId: { type: "string" }, styles: { type: "object", additionalProperties: { type: ["string", "null"] } } }, ["nodeId", "styles"]) } }, ["updates"]),
    run: ({ session, edit }, args) => {
      if (!Array.isArray(args.updates) || args.updates.length === 0 || args.updates.length > 500) throw new ToolError("updates must be a list of 1-500 updates");
      const operations = args.updates.map((update: any) => {
        const node = nodeOf(session, update?.nodeId);
        if (update.styles === null || typeof update.styles !== "object" || Array.isArray(update.styles)) throw new ToolError("each update needs a styles object");
        const current = node.props?.style && typeof node.props.style === "object" ? node.props.style : {};
        const style: Record<string, string> = { ...current };
        for (const [property, value] of Object.entries(update.styles)) {
          if (!/^-?[a-z][a-z0-9-]{0,63}$/u.test(property)) throw new ToolError(`${JSON.stringify(property).slice(0, 80)} is not a CSS property name`);
          if (value === null) delete style[property];
          else if (typeof value === "string" && value.length <= 2000) style[property] = value;
          else throw new ToolError(`the value for ${property} must be a CSS string of at most 2000 characters, or null`);
        }
        return { type: "set-props", nodeId: node.id, set: { style } };
      });
      return edit(operations, "Set styles");
    },
  },
  {
    name: "set_attributes",
    title: "Set attributes",
    description: "Set or remove HTML attributes of layers: class (space-separated), dir (\"ltr\", \"rtl\" or \"auto\", for right-to-left text), lang, title, role, aria-*, data-*, alt, and the others the canvas draws for each element. null removes one. An attribute the canvas would not draw (an event handler, style, a link that is not http, https, mailto or tel) is refused, saying why.",
    inputSchema: object({ updates: { type: "array", minItems: 1, maxItems: 500, items: object({ nodeId: { type: "string" }, attributes: { type: "object", additionalProperties: { type: ["string", "null"] } } }, ["nodeId", "attributes"]) } }, ["updates"]),
    run: ({ session, edit }, args) => {
      if (!Array.isArray(args.updates) || args.updates.length === 0 || args.updates.length > 500) throw new ToolError("updates must be a list of 1-500 updates");
      const operations = args.updates.map((update: any) => {
        const node = nodeOf(session, update?.nodeId);
        if (update.attributes === null || typeof update.attributes !== "object" || Array.isArray(update.attributes)) throw new ToolError("each update needs an attributes object");
        if (node.type === "component-instance") throw new ToolError(`${node.id} is an instance, which draws its component's attributes: set them on the component, or use set_instance_override`);
        const attributes: Record<string, string> = { ...(node.props?.attributes && typeof node.props.attributes === "object" ? node.props.attributes : {}) };
        // The element as the canvas draws it, without attributes: what it drops already (a tag it
        // does not know) is not counted against an attribute.
        const element = { type: node.type, props: node.props?.tag === undefined ? {} : { tag: node.props.tag } };
        const baseline = planElement(element).dropped;
        for (const [raw, value] of Object.entries(update.attributes)) {
          const name = raw.toLowerCase();
          if (!/^[a-z][a-z0-9-]{0,63}$/u.test(name)) throw new ToolError(`${JSON.stringify(raw).slice(0, 80)} is not an attribute name`);
          // Names match whatever their case (an SVG's viewBox is stored as written); the key already
          // there keeps its spelling, so a change replaces it and null removes it.
          const key = Object.keys(attributes).find((existing) => existing.toLowerCase() === name) ?? raw;
          if (value === null) {
            delete attributes[key];
            continue;
          }
          if (typeof value !== "string" || value.length > 2000) throw new ToolError(`the value for ${name} must be a string of at most 2000 characters, or null`);
          const written = name === "class" ? [...new Set(value.split(/[\t\n\f\r ]+/u).filter((part) => part !== ""))].join(" ") : value;
          if (name === "dir" && !["ltr", "rtl", "auto"].includes(written)) throw new ToolError("dir is \"ltr\", \"rtl\" or \"auto\"");
          // The canvas's own rule for this element (planElement): what it would not draw is refused,
          // and what it draws is stored as it draws it (a link trimmed, an input type lowercased).
          const plan = planElement({ ...element, props: { ...element.props, attributes: { [key]: written } } });
          if (plan.dropped > baseline) {
            throw new ToolError(`${name}${name === "href" || name === "src" ? `="${written.slice(0, 60)}"` : ""} is not an attribute the canvas draws on this ${typeof node.props?.tag === "string" ? `<${node.props.tag}>` : node.type}`);
          }
          const drawn = Object.values(plan.attributes as Record<string, string>)[0] ?? written;
          delete attributes[key];
          if (!(drawn === "" && name === "class")) attributes[key] = drawn;
        }
        return { type: "set-props", nodeId: node.id, ...(Object.keys(attributes).length === 0 ? { set: {}, unset: ["attributes"] } : { set: { attributes } }) };
      });
      return edit(operations, "Set attributes");
    },
  },
  {
    name: "set_layout",
    title: "Set auto layout",
    description: "Place a layer's children in a row or a column (CSS flex), or freely. With row or column, gap, padding, align (align-items) and justify (justify-content) and wrap may be given; children placed by left and top join the row. free turns a row or column off: children are no longer laid out by it, and those not positioned flow in the page (the editor's Freely keeps each where it was drawn, which needs the canvas).",
    inputSchema: object({ nodeId: { type: "string" }, mode: { type: "string", enum: ["row", "column", "free"] }, gap: { type: "string" }, padding: { type: "string" }, align: { type: "string", enum: ["flex-start", "center", "flex-end", "stretch", "baseline"] }, justify: { type: "string", enum: ["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"] }, wrap: { type: "boolean" } }, ["nodeId", "mode"]),
    run: ({ session, edit }, args) => {
      const node = nodeOf(session, args.nodeId);
      if (!(LAYOUT_MODES as readonly string[]).includes(args.mode as string)) throw new ToolError("mode is \"row\", \"column\" or \"free\"");
      if (node.type === "component-instance" || node.type === "text") throw new ToolError(`${node.id} is ${node.type === "text" ? "a text layer" : "an instance"}, which does not lay out children of its own`);
      if (args.mode === "free" && ["gap", "padding", "align", "justify", "wrap"].some((argument) => args[argument] !== undefined)) {
        throw new ToolError("gap, padding, align, justify and wrap are for a row or a column");
      }
      const display = node.props?.style?.display;
      if (args.mode === "free" && display !== "flex" && display !== "inline-flex") throw new ToolError(`${node.id} has no auto layout to turn off (display is ${typeof display === "string" ? display : "not set"})`);
      const operations = setLayout(session.document, node.id, args.mode, {}) as any[];
      const extras: Record<string, string | null> = {};
      if (args.mode !== "free") {
        const choices: [string, string, readonly string[] | null][] = [["gap", "gap", null], ["padding", "padding", null], ["align", "align-items", ["flex-start", "center", "flex-end", "stretch", "baseline"]], ["justify", "justify-content", ["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"]]];
        for (const [argument, property, allowed] of choices) {
          const value = args[argument];
          if (value === undefined) continue;
          if (typeof value !== "string" || (allowed !== null && !allowed.includes(value))) throw new ToolError(`${argument} is ${allowed === null ? "a CSS value" : allowed.join(", ")}`);
          const problem = styleDeclarationProblem(property, value);
          if (problem !== null) throw new ToolError(problem);
          extras[property] = value;
        }
        if (args.wrap !== undefined) {
          if (typeof args.wrap !== "boolean") throw new ToolError("wrap is true or false");
          extras["flex-wrap"] = args.wrap ? "wrap" : null;
        }
      }
      const own = operations[0].set.style as Record<string, string>;
      for (const [property, value] of Object.entries(extras)) {
        if (value === null) delete own[property];
        else own[property] = value;
      }
      return edit(operations, args.mode === "free" ? "Place children freely" : args.mode === "row" ? "Auto layout in a row" : "Auto layout in a column");
    },
  },
  {
    name: "move_layers",
    title: "Move layers",
    description: "Move layers to a new parent (null for top level) at an index.",
    inputSchema: object({ moves: { type: "array", minItems: 1, maxItems: 500, items: object({ nodeId: { type: "string" }, parentId: { type: ["string", "null"] }, index: { type: "integer", minimum: 0 } }, ["nodeId", "parentId"]) } }, ["moves"]),
    run: ({ session, edit }, args) => {
      if (!Array.isArray(args.moves) || args.moves.length === 0 || args.moves.length > 500) throw new ToolError("moves must be a list of 1-500 moves");
      const operations = args.moves.map((move: any) => {
        const node = nodeOf(session, move?.nodeId);
        const parentId = move.parentId === null ? null : nodeOf(session, move.parentId).id;
        return { type: "move-node", nodeId: node.id, parentId, ...(Number.isInteger(move.index) && move.index >= 0 ? { index: move.index } : {}) };
      });
      return edit(operations, args.moves.length === 1 ? "Move layer" : "Move layers");
    },
  },
  {
    name: "duplicate_layers",
    title: "Duplicate layers",
    description: "Copy layers (with everything inside them) next to the originals; returns the copies' ids.",
    inputSchema: object({ nodeIds: idList }, ["nodeIds"]),
    run: ({ session, edit }, args) => {
      const document = session.document as any;
      const operations: unknown[] = [];
      const copies: Record<string, string> = {};
      const ids = [...new Set(strings(args.nodeIds, "nodeIds"))].map((id) => nodeOf(session, id).id);
      const siblingsOf = (node: any) => (node.parentId === null ? document.rootIds : document.nodes[node.parentId].children);
      // Later siblings first, so each copy's index (just after its original) is not shifted
      // by the copies inserted before it.
      ids.sort((a, b) => siblingsOf(document.nodes[b]).indexOf(b) - siblingsOf(document.nodes[a]).indexOf(a));
      let copied = 0;
      for (const id of ids) {
        const root = document.nodes[id];
        const fresh = new Map<string, string>();
        const order: string[] = [];
        const collect = (nodeId: string) => {
          fresh.set(nodeId, `${nodeId.slice(0, 40)}-copy-${randomUUID().slice(0, 8)}`);
          order.push(nodeId);
          for (const child of document.nodes[nodeId].children) collect(child);
        };
        collect(root.id);
        copied += order.length;
        if (copied > MAX_DUPLICATED_NODES) throw new ToolError(`at most ${MAX_DUPLICATED_NODES} layers may be copied in one call`);
        const siblings = root.parentId === null ? document.rootIds : document.nodes[root.parentId].children;
        operations.push({
          type: "restore-subtree",
          rootId: fresh.get(root.id),
          parentId: root.parentId,
          index: siblings.indexOf(root.id) + 1,
          nodes: order.map((nodeId) => {
            const node = document.nodes[nodeId];
            return { id: fresh.get(nodeId), type: node.type, parentId: nodeId === root.id ? root.parentId : fresh.get(node.parentId), children: node.children.map((child: string) => fresh.get(child)), props: structuredClone(node.props), metadata: {} };
          }),
        });
        copies[id] = fresh.get(root.id)!;
      }
      return { copies, ...(edit(operations, "Duplicate layers") as object) };
    },
  },
  {
    name: "delete_layers",
    title: "Delete layers",
    description: "Delete layers and everything inside them. The person must approve this in Ninerr; the call waits for their answer.",
    inputSchema: object({ nodeIds: idList }, ["nodeIds"]),
    run: ({ session, edit }, args) => {
      const ids = strings(args.nodeIds, "nodeIds").map((id) => nodeOf(session, id).id);
      // Deleting a layer deletes what is inside it: only the outermost selected ones are removed.
      const document = session.document as any;
      const chosen = new Set(ids);
      const outermost = [...chosen].filter((id) => {
        for (let parent = document.nodes[id].parentId; parent !== null; parent = document.nodes[parent]?.parentId ?? null) if (chosen.has(parent)) return false;
        return true;
      });
      return edit(outermost.map((nodeId) => ({ type: "remove-node", nodeId })), outermost.length === 1 ? "Delete layer" : "Delete layers");
    },
  },
  // ---------- design tokens and components (ADR-0004, ADR-0005) ----------
  {
    name: "design_tokens",
    title: "Design tokens",
    description: "The project's design system: its collections with their modes, and every token with its type, collection, value per mode and how many layer values use it. Layers use a token as var(--name) in a style value.",
    inputSchema: object({}),
    run: ({ session }) => {
      const document = session.document as any;
      const system = designSystemOf(document);
      if (system === null) return { designSystem: null, note: "No design system yet: set_token creates one with its first token." };
      return {
        designSystem: system.id,
        collections: system.props.collections,
        tokens: system.props.tokens.map((token: any) => ({ ...token, uses: tokenUses(document, token.name).length })),
      };
    },
  },
  {
    name: "set_token",
    title: "Set a design token",
    description: "Add a token, or change its values (one CSS value per mode id; another token as var(--other)). A new token needs its type and collection. Creates the design system with the first token. One undoable change.",
    inputSchema: object({ name: { type: "string", maxLength: 129 }, type: { type: "string", enum: [...TOKEN_TYPES] }, collection: { type: "string", maxLength: 128 }, values: { type: "object", additionalProperties: { type: "string", maxLength: 1024 }, maxProperties: 32 }, description: { type: "string", maxLength: 2000 } }, ["name", "values"]),
    run: ({ session, edit }, args) => {
      const document = session.document as any;
      if (typeof args.name !== "string" || args.values === null || typeof args.values !== "object" || Array.isArray(args.values)) throw new ToolError("give the token's name and its values by mode");
      if (designSystemOf(document) === null) {
        const props: any = newDesignSystemProps();
        const collection = typeof args.collection === "string" ? args.collection : props.collections[0].id;
        if (collection !== props.collections[0].id) throw new ToolError(`a new design system has one collection, ${props.collections[0].id}; add the token to it`);
        props.tokens.push({ name: args.name, type: args.type, collection, values: args.values, ...(typeof args.description === "string" ? { description: args.description } : {}) });
        const problem = designSystemProblem(props);
        if (problem !== null) throw new ToolError(problem);
        return edit([{ type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: `design-system-${randomUUID()}`, type: "design-system", props } }], `Set ${args.name}`);
      }
      return edit(tokenOperation(() => setToken(document, { name: args.name, type: args.type, collection: args.collection, values: args.values, description: args.description })), `Set ${args.name}`);
    },
  },
  {
    name: "add_token_mode",
    title: "Add a token mode",
    description: "Add a mode (Dark, say) to a collection of the design system; each of its tokens starts with its default value in the new mode.",
    inputSchema: object({ collection: { type: "string", maxLength: 128 }, name: { type: "string", maxLength: 200 }, id: { type: "string", maxLength: 128 } }, ["collection", "name"]),
    run: ({ session, edit }, args) => {
      if (typeof args.name !== "string" || args.name.trim() === "") throw new ToolError("give the mode a name");
      let id = typeof args.id === "string" ? args.id : args.name.toLowerCase().replace(/[^a-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "") || "mode";
      if (typeof args.id !== "string") {
        const modes = designSystemOf(session.document)?.props.collections.find((entry: any) => entry.id === args.collection)?.modes ?? [];
        const stem = id;
        for (let at = 2; modes.some((mode: any) => mode.id === id); at += 1) id = `${stem}-${at}`;
      }
      return edit(tokenOperation(() => addMode(session.document, args.collection, { id, name: args.name.trim() })), `Add mode ${args.name.trim()}`);
    },
  },
  {
    name: "rename_token",
    title: "Rename a design token",
    description: "Rename a token and every use of it (style values, stylesheets, overrides, aliases) in one undoable change.",
    inputSchema: object({ from: { type: "string", maxLength: 129 }, to: { type: "string", maxLength: 129 } }, ["from", "to"]),
    run: ({ session, edit }, args) => edit(tokenOperation(() => renameToken(session.document, args.from, args.to)), `Rename ${args.from} to ${args.to}`),
  },
  {
    name: "delete_token",
    title: "Delete a design token",
    description: "Delete a token. One in use needs what replaces it: { token: \"--other\" } or { literal: true } (its own value). The person approves it in Ninerr.",
    inputSchema: object({ name: { type: "string", maxLength: 129 }, replacement: object({ token: { type: "string", maxLength: 129 }, literal: { type: "boolean" } }) }, ["name"]),
    run: ({ session, edit }, args) => {
      const replacement = args.replacement === undefined ? undefined : args.replacement?.token !== undefined ? { token: args.replacement.token } : args.replacement?.literal === true ? { literal: true } : undefined;
      return edit(tokenOperation(() => deleteToken(session.document, args.name, replacement)), `Delete ${args.name}`);
    },
  },
  {
    name: "set_layer_modes",
    title: "Set layers' token mode",
    description: "Give layers a collection's mode (mode null for the collection's default): the canvas draws their tokens in that mode.",
    inputSchema: object({ nodeIds: idList, collection: { type: "string", maxLength: 128 }, mode: { type: ["string", "null"], maxLength: 128 } }, ["nodeIds", "collection", "mode"]),
    run: ({ session, edit }, args) => {
      const document = session.document as any;
      const system = designSystemOf(document);
      const collection = system?.props.collections.find((entry: any) => entry.id === args.collection);
      if (!collection) throw new ToolError(`${String(args.collection).slice(0, 80)} is not a collection of the design system`);
      if (args.mode !== null && !collection.modes.some((mode: any) => mode.id === args.mode)) throw new ToolError(`${String(args.mode).slice(0, 80)} is not a mode of ${collection.id}`);
      const operations = strings(args.nodeIds, "nodeIds").map((id) => {
        const node = nodeOf(session, id);
        const modes = { ...(node.props.modes ?? {}) };
        if (args.mode === null || args.mode === collection.defaultMode) delete modes[collection.id];
        else modes[collection.id] = args.mode;
        return Object.keys(modes).length === 0 ? { type: "set-props", nodeId: node.id, unset: ["modes"] } : { type: "set-props", nodeId: node.id, set: { modes } };
      });
      return edit(operations, "Set the layers' mode");
    },
  },
  {
    name: "list_components",
    title: "Components",
    description: "The project's components: each with its name, properties (id, name, kind, default, options) and how many instances it has.",
    inputSchema: object({}),
    run: ({ session }) => {
      const document = session.document as any;
      const instances = Object.values(document.nodes).filter((node: any) => node.type === "component-instance") as any[];
      return { components: componentsOf(document).map(({ id, name }) => ({ id, name, properties: document.nodes[id].props.properties ?? [], instances: instances.filter((node) => node.props.componentId === id).length })) };
    },
  },
  {
    name: "create_component",
    title: "Make a layer a component",
    description: "Make a layer a component: the component takes its place, with its look and children. Then place instances with insert_instance.",
    inputSchema: object({ nodeId: { type: "string" }, name: { type: "string", maxLength: 200 } }, ["nodeId"]),
    run: ({ session, edit }, args) => {
      const id = `component-${randomUUID()}`;
      return { componentId: id, ...(edit(tokenOperation(() => createComponent(session.document, args.nodeId, { id, name: args.name })), "Make a component") as object) };
    },
  },
  {
    name: "add_component_property",
    title: "Add a component property",
    description: "Give a component a property its instances set: text (a layer's text), boolean (whether a layer is shown), variant (a class added to a layer, from options), instance-swap (the component a nested instance draws; targetNodeId is that instance) or slot (a component drawn in a layer in place of its children). targetNodeId is one of the component's own layers.",
    inputSchema: object({ componentId: { type: "string" }, name: { type: "string", maxLength: 200 }, kind: { type: "string", enum: ["text", "boolean", "variant", "instance-swap", "slot"] }, targetNodeId: { type: "string" }, options: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 64 }, default: { type: ["string", "boolean"] } }, ["componentId", "name", "kind", "targetNodeId"]),
    run: ({ session, edit }, args) => {
      const component = nodeOf(session, args.componentId);
      if (component.type !== "component-definition") throw new ToolError("componentId must name a component");
      if (typeof args.name !== "string" || args.name.trim() === "") throw new ToolError("give the property a name");
      const target = nodeOf(session, args.targetNodeId);
      const properties = Array.isArray(component.props.properties) ? component.props.properties : [];
      const stem = `p-${args.name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "property"}`;
      let id = stem;
      for (let at = 2; properties.some((property: any) => property.id === id); at += 1) id = `${stem}-${at}`;
      if (!["text", "boolean", "variant", "instance-swap", "slot"].includes(args.kind)) throw new ToolError("kind is text, boolean, variant, instance-swap or slot");
      if (args.kind === "instance-swap" && target.type !== "component-instance") throw new ToolError("an instance-swap property targets an instance inside the component");
      if (args.kind === "slot" && target.type === "component-instance") throw new ToolError("a slot targets a layer that holds what is put in it, not an instance");
      const options = Array.isArray(args.options) ? [...new Set(args.options as string[])] : [];
      if (args.kind === "variant" && options.length === 0) throw new ToolError("a variant property needs its options");
      // A swap or slot default is "" or a component, never one that draws this component.
      if ((args.kind === "instance-swap" || args.kind === "slot") && typeof args.default === "string" && args.default !== "") {
        const chosen = (session.document as any).nodes[args.default];
        if (!chosen || chosen.type !== "component-definition") throw new ToolError("default takes a component's id, or \"\" for none");
        if (drawsComponent(session.document, args.default, component.id)) throw new ToolError("that default draws this component, so it cannot go inside it");
      }
      const property = args.kind === "instance-swap" || args.kind === "slot"
        ? { id, name: args.name.trim(), kind: args.kind, default: typeof args.default === "string" ? args.default : "", target: { nodeId: target.id, field: "children" } }
        : args.kind === "boolean"
        ? { id, name: args.name.trim(), kind: "boolean", default: typeof args.default === "boolean" ? args.default : true, target: { nodeId: target.id, field: "visible" } }
        : args.kind === "variant"
          ? { id, name: args.name.trim(), kind: "variant", default: typeof args.default === "string" ? args.default : options[0], options, target: { nodeId: target.id, field: "attributes.class" } }
          : { id, name: args.name.trim(), kind: "text", default: typeof args.default === "string" ? args.default : typeof target.props.text === "string" ? target.props.text : "", target: { nodeId: target.id, field: "text" } };
      return { propertyId: id, ...(edit([{ type: "set-props", nodeId: component.id, set: { name: typeof component.props.name === "string" && component.props.name !== "" ? component.props.name : "Component", properties: [...properties, property] } }], `Add property ${args.name.trim()}`) as object) };
    },
  },
  {
    name: "insert_instance",
    title: "Place an instance",
    description: "Place an instance of a component after a layer (or at the top level). It is drawn from the component; a change to the component reaches it.",
    inputSchema: object({ componentId: { type: "string" }, afterId: { type: "string" } }, ["componentId"]),
    run: ({ session, edit }, args) => {
      const id = `instance-${randomUUID()}`;
      if (args.afterId !== undefined) nodeOf(session, args.afterId);
      return { instanceId: id, ...(edit(tokenOperation(() => insertInstance(session.document, args.componentId, { id, afterId: typeof args.afterId === "string" ? args.afterId : null })), "Place an instance") as object) };
    },
  },
  {
    name: "instance_layers",
    title: "Layers of an instance",
    description: "The layers an instance draws, its root first: each with the path and nodeId that set_instance_override takes, its label, its text, whether it is hidden, and the instance's own override for it.",
    inputSchema: object({ instanceId: { type: "string" } }, ["instanceId"]),
    run: ({ session }, args) => {
      const instance = nodeOf(session, args.instanceId);
      if (instance.type !== "component-instance") throw new ToolError("instanceId must name an instance");
      return { layers: instanceLayers(session.document, instance.id).map((layer: any) => ({ path: layer.path, nodeId: layer.nodeId, componentId: layer.mainId !== layer.nodeId ? layer.mainId : null, label: layer.label, text: layer.text, hidden: layer.hidden, stale: layer.stale, override: overrideFor(session.document, instance.id, layer)?.set ?? null })) };
    },
  },
  {
    name: "set_instance_values",
    title: "Set an instance's property values",
    description: "Set an instance's property values by property id (text: a string; boolean: true or false; variant: one of its options).",
    inputSchema: object({ instanceId: { type: "string" }, values: { type: "object", additionalProperties: { type: ["string", "boolean"] }, maxProperties: 200 } }, ["instanceId", "values"]),
    run: ({ session, edit }, args) => {
      const instance = nodeOf(session, args.instanceId);
      if (instance.type !== "component-instance") throw new ToolError("instanceId must name an instance");
      const component = (session.document as any).nodes[instance.props.componentId];
      const properties = new Map((component?.props.properties ?? []).map((property: any) => [property.id, property]));
      if (args.values === null || typeof args.values !== "object" || Array.isArray(args.values)) throw new ToolError("values must map property ids to values");
      for (const [id, value] of Object.entries(args.values)) {
        const property: any = properties.get(id);
        if (!property) throw new ToolError(`${id.slice(0, 80)} is not a property of its component`);
        if (property.kind === "boolean" ? typeof value !== "boolean" : typeof value !== "string") throw new ToolError(`${property.name} takes ${property.kind === "boolean" ? "true or false" : "text"}`);
        if (property.kind === "variant" && !property.options.includes(value)) throw new ToolError(`${property.name} is one of ${property.options.join(", ")}`);
        // An instance swap or slot names a component ("" for the default); one that would draw
        // this instance's own component inside itself is refused.
        if ((property.kind === "instance-swap" || property.kind === "slot") && value !== "") {
          const chosen = (session.document as any).nodes[value as string];
          if (!chosen || chosen.type !== "component-definition") throw new ToolError(`${property.name} takes a component's id, or "" for the layer's own content`);
          if (!componentsFor(session.document, instance.id).some((entry: any) => entry.id === value)) throw new ToolError(`${chosen.props.name ?? "That component"} draws this instance's component or one it sits in, so it cannot go inside it`);
        }
      }
      return edit([{ type: "set-props", nodeId: instance.id, set: { propertyValues: { ...(instance.props.propertyValues ?? {}), ...args.values } } }], "Set the instance's values");
    },
  },
  {
    name: "set_instance_override",
    title: "Change a layer inside an instance",
    description: "Change one layer an instance draws, for that instance alone: its text, style (property: value; an empty value takes one off) or visible. path and nodeId come from instance_layers. The component is not changed.",
    inputSchema: object({ instanceId: { type: "string" }, path: { type: "array", items: { type: "string" }, maxItems: 64 }, nodeId: { type: "string" }, text: { type: ["string", "null"], maxLength: 100000 }, style: { type: "object", additionalProperties: { type: "string", maxLength: 1024 }, maxProperties: 200 }, visible: { type: ["boolean", "null"] } }, ["instanceId", "nodeId"]),
    run: ({ session, edit }, args) => {
      const path = Array.isArray(args.path) ? args.path : [];
      if (!instanceLayers(session.document, args.instanceId).some((layer: any) => layer.nodeId === args.nodeId && JSON.stringify(layer.path) === JSON.stringify(path))) throw new ToolError("that instance draws no such layer; take path and nodeId from instance_layers");
      if (args.style !== undefined) {
        for (const [name, value] of Object.entries(args.style as Record<string, string>)) {
          const problem = value === "" ? null : styleDeclarationProblem(name, value);
          if (problem !== null) throw new ToolError(problem);
        }
      }
      return edit(tokenOperation(() => setInstanceOverride(session.document, args.instanceId, { path, nodeId: args.nodeId }, { text: args.text, style: args.style, visible: args.visible })), "Change a layer in the instance");
    },
  },
  {
    name: "reset_instance",
    title: "Reset an instance's overrides",
    description: "Take off an instance's overrides: of one layer (path and nodeId), or all; its property values stay.",
    inputSchema: object({ instanceId: { type: "string" }, path: { type: "array", items: { type: "string" }, maxItems: 64 }, nodeId: { type: "string" } }, ["instanceId"]),
    run: ({ session, edit }, args) => edit(tokenOperation(() => resetInstance(session.document, args.instanceId, typeof args.nodeId === "string" ? { path: Array.isArray(args.path) ? args.path : [], nodeId: args.nodeId } : null)), "Reset the instance's overrides"),
  },
  {
    name: "detach_instance",
    title: "Detach an instance",
    description: "Write what an instance draws as real layers in its place, in one undoable change; it no longer follows its component.",
    inputSchema: object({ instanceId: { type: "string" } }, ["instanceId"]),
    run: ({ session, edit }, args) => {
      let detached: any;
      try {
        detached = detachInstance(session.document, args.instanceId, () => `layer-${randomUUID()}`);
      } catch (error) {
        throw new ToolError(error instanceof Error ? error.message : String(error));
      }
      return { nodeId: detached.rootId, ...(edit(detached.operations, "Detach instance") as object) };
    },
  },
  {
    name: "search_components",
    title: "Search library components",
    description: "Find components of the component sources Ninerr has records of (Meta Astryx, at a pinned commit) by name or purpose, such as \"date picker\" or \"command palette\", optionally in one category (the answer lists the categories). Gives each one's id for get_component.",
    inputSchema: object({ query: { type: "string", maxLength: 200 }, category: { type: "string", maxLength: 100 }, source: { type: "string", enum: [...RECORD_SOURCES] }, limit: { type: "integer", minimum: 1, maximum: 50 } }),
    run: async (_context, given) => {
      const args = onlyArguments(given, ["query", "category", "source", "limit"]);
      if (args.query !== undefined && (typeof args.query !== "string" || args.query.length > 200)) throw new ToolError("query is text of at most 200 characters");
      if (args.category !== undefined && (typeof args.category !== "string" || args.category.length > 100)) throw new ToolError("category is text");
      if (args.limit !== undefined && (!Number.isInteger(args.limit) || (args.limit as number) < 1 || (args.limit as number) > 50)) throw new ToolError("limit is a whole number from 1 to 50");
      const sources = args.source === undefined ? RECORD_SOURCES : [args.source];
      if (!sources.every((id: string) => RECORD_SOURCES.includes(id))) throw new ToolError(`source is one of ${RECORD_SOURCES.join(", ")}`);
      const snapshots = await Promise.all(sources.map((id: string) => loadComponentRecords(id)));
      const all = snapshots.flatMap((snapshot: any) => snapshot.components);
      const found = searchComponents(all, { query: typeof args.query === "string" ? args.query : "", category: typeof args.category === "string" ? args.category : null, limit: Number.isInteger(args.limit) ? args.limit : 20 });
      return {
        categories: [...new Set(all.map((record: any) => record.category).filter(Boolean))].sort(),
        sources: snapshots.map((snapshot: any) => ({ id: snapshot.source, repository: snapshot.repository, commit: snapshot.commit, package: snapshot.package })),
        components: found.map((record: any) => ({ id: record.id, name: record.name, category: record.category, partOf: record.subComponentOf, description: record.description.slice(0, 300), importPath: record.importPath, rendering: record.rendering })),
      };
    },
  },
  {
    name: "get_component",
    title: "Library component",
    description: "One library component's record, by its id from search_components: its exact props and variants, accessibility criteria, guidance, examples, limitations, import path and dependencies, and where the record came from (repository, commit, doc file and its sha256, license, and what Ninerr may import from the source).",
    inputSchema: object({ id: { type: "string", maxLength: 300 } }, ["id"]),
    run: async (_context, given) => {
      const args = onlyArguments(given, ["id"]);
      const source = typeof args.id === "string" && args.id.length <= 300 ? args.id.slice(0, args.id.indexOf(":")) : "";
      if (!RECORD_SOURCES.includes(source)) throw new ToolError("no such component; take ids from search_components");
      const snapshot: any = await loadComponentRecords(source);
      const record = snapshot.components.find((entry: any) => entry.id === args.id);
      if (!record) throw new ToolError("no such component; take ids from search_components");
      const catalog: any = UI_COMPONENT_SOURCES.find((entry: any) => entry.id === source);
      return {
        component: record,
        provenance: { repository: snapshot.repository, commit: snapshot.commit, package: snapshot.package, doc: record.doc, license: snapshot.license, importPolicy: catalog?.importPolicy ?? null, rights: catalog?.rights ?? null },
      };
    },
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));
// The definitions the server announces must satisfy the MCP contract validators and be exactly
// the tools of Ninerr's catalog, which carries the classification each tool is authorized by.
assertMCPToolSurface({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });

// Every tool that changes the document also takes these: a dry run checks the change and says
// what it would touch, changing nothing; baseRevision refuses the call if the document has moved
// on since the agent read it (ADR-0006).
const CHANGE_ARGUMENTS = {
  dryRun: { type: "boolean", description: "Check the change and say what it would touch, without making it." },
  baseRevision: { type: "integer", minimum: 0, description: "The document revision the change is based on; refused if the document has changed since." },
};

export function mcpToolDefinitions() {
  return TOOLS.map(({ name, title, description, inputSchema }) => {
    const toolClass = classifyTool(name);
    const changes = toolClass === "write" || toolClass === "consequential";
    const schema = changes ? { ...inputSchema, properties: { ...(inputSchema as any).properties, ...CHANGE_ARGUMENTS } } : inputSchema;
    return { name, title, description, inputSchema: schema, annotations: { readOnlyHint: toolClass === "read", destructiveHint: toolClass === "consequential", idempotentHint: toolClass === "read", openWorldHint: false } };
  });
}

export interface PendingConfirmation {
  id: string;
  agentId: string;
  agentName: string;
  toolName: string;
  summary: string;
  documentId: string;
  argumentsSha256: string;
  requestedAt: string;
}

type Decision = { outcome: "approved"; confirmedAt: string } | { outcome: "denied" | "timeout" | "busy" };

interface ConfirmationState extends PendingConfirmation {
  // A digest of what the call would affect, read from the document when the person was asked
  // (for delete_token: the token, its uses and its aliases): an approval holds only while that is
  // unchanged, so a name moved to another token is not deleted on an approval for the first.
  subjectSha256?: string;
  expires: number;
  decision: "pending" | "approved" | "denied";
  confirmedAt?: string;
  waiters: Array<(decision: Decision) => void>;
}

/**
 * The person's side of consequential calls: requests waiting for them, the decision they
 * make in the editor, and single-use approvals bound to the exact call (document, tool,
 * argument hash and agent).
 */
export class ConfirmationBroker {
  #items = new Map<string, ConfirmationState>();
  readonly #notify: (pending: PendingConfirmation[]) => void;

  constructor(notify: (pending: PendingConfirmation[]) => void) {
    this.#notify = notify;
  }

  pending(): PendingConfirmation[] {
    this.#prune();
    return [...this.#items.values()].filter((item) => item.decision === "pending").map(({ expires: _e, decision: _d, confirmedAt: _c, waiters: _w, subjectSha256: _s, ...rest }) => rest);
  }

  /** An approval for exactly this call, consumed; or null. */
  takeApproval(key: { agentId: string; toolName: string; documentId: string; argumentsSha256: string; subjectSha256?: string }): string | null {
    this.#prune();
    for (const [id, item] of this.#items) {
      if (item.decision === "approved" && item.agentId === key.agentId && item.toolName === key.toolName && item.documentId === key.documentId && item.argumentsSha256 === key.argumentsSha256 && item.subjectSha256 === key.subjectSha256) {
        this.#items.delete(id);
        return item.confirmedAt!;
      }
    }
    return null;
  }

  /**
   * Ask the person, reusing an identical open request. Resolves with their decision (an
   * approval carries its time), "timeout", or "busy" when too many requests are waiting:
   * at most 20 in all, 5 per agent, and 4 calls waiting on one request.
   */
  request(input: Omit<PendingConfirmation, "id" | "requestedAt"> & { subjectSha256?: string }, at: string, waitMs: number): Promise<Decision> {
    this.#prune();
    let item = [...this.#items.values()].find((candidate) => candidate.decision === "pending" && candidate.agentId === input.agentId && candidate.toolName === input.toolName && candidate.documentId === input.documentId && candidate.argumentsSha256 === input.argumentsSha256 && candidate.subjectSha256 === input.subjectSha256);
    if (item === undefined) {
      const pending = this.pending();
      if (pending.length >= 20 || pending.filter((other) => other.agentId === input.agentId).length >= 5) return Promise.resolve({ outcome: "busy" });
      item = { ...input, id: `confirm-${randomUUID()}`, requestedAt: at, expires: Date.now() + CONFIRMATION_TTL_MS, decision: "pending", waiters: [] };
      this.#items.set(item.id, item);
      this.#notify(this.pending());
    } else if (item.waiters.length >= 4) {
      return Promise.resolve({ outcome: "busy" });
    }
    const target = item;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        target.waiters = target.waiters.filter((waiter) => waiter !== done);
        resolve({ outcome: "timeout" });
      }, waitMs);
      timer.unref?.();
      const done = (decision: Decision) => {
        clearTimeout(timer);
        resolve(decision);
      };
      target.waiters.push(done);
    });
  }

  /**
   * The person's decision, made in the editor. An approval serves the calls waiting on the
   * request; if none is waiting (they timed out), it is kept for one identical retry.
   * Identical waiting calls (at most 4) each run once: the consequential tools, delete_layers
   * and delete_token, find nothing left to delete on a repeat (a repeat of delete_token is told
   * the token is gone). A consequential tool that is not idempotent must run once and share its
   * result instead.
   */
  decide(id: unknown, approve: boolean, at: string): void {
    this.#prune();
    const item = typeof id === "string" ? this.#items.get(id) : undefined;
    if (item === undefined || item.decision !== "pending") throw new StudioError(404, "confirmation-not-found", "that request is no longer waiting for a decision");
    const waiters = item.waiters.splice(0);
    if (approve && waiters.length === 0) {
      item.decision = "approved";
      item.confirmedAt = at;
      item.expires = Date.now() + CONFIRMATION_TTL_MS;
    } else {
      this.#items.delete(item.id);
    }
    for (const waiter of waiters) waiter(approve ? { outcome: "approved", confirmedAt: at } : { outcome: "denied" });
    this.#notify(this.pending());
  }

  /** Forget everything for an agent (revoked) or a document (closed). */
  drop(match: (item: PendingConfirmation) => boolean): void {
    let changed = false;
    for (const [id, item] of this.#items) {
      if (match(item)) {
        this.#items.delete(id);
        for (const waiter of item.waiters.splice(0)) waiter({ outcome: "denied" });
        changed = true;
      }
    }
    if (changed) this.#notify(this.pending());
  }

  #prune(): void {
    for (const [id, item] of this.#items) {
      if (item.expires < Date.now()) {
        this.#items.delete(id);
        for (const waiter of item.waiters.splice(0)) waiter({ outcome: "denied" });
      }
    }
  }
}

export interface McpContext {
  session: () => StudioSession | null;
  selection: () => string[];
  references: ReferenceCatalog;
  confirmations: ConfirmationBroker;
  now: () => string;
  confirmationWaitMs?: number;
  /**
   * The project each agent last connected to or read, by agent id. An agent's change is
   * refused when another project is open now, so it never lands in a project the agent has
   * not looked at (#260).
   */
  lastRead: Map<string, string>;
}

// Read tools that show the open project; reading one is what lets an agent change it.
const PROJECT_READS = new Set(["project_info", "layer_tree", "layer_details", "layer_children", "find_layers", "selection", "layer_code", "design_tokens", "list_components", "instance_layers"]);

const rpcError = (id: Json, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const toolResult = (value: Json, isError = false) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : { structuredContent: typeof value === "object" && value !== null && !Array.isArray(value) ? value : { value } }),
});

/** Answer one JSON-RPC message from `actor`; null for a notification (no answer). */
export async function handleMcpMessage(context: McpContext, actor: StudioActor, message: unknown): Promise<unknown> {
  if (message === null || typeof message !== "object" || Array.isArray(message)) return rpcError(null, -32600, "a JSON-RPC message object is required");
  const { jsonrpc, id, method, params } = message as Record<string, any>;
  const isNotification = id === undefined;
  if (jsonrpc !== "2.0" || typeof method !== "string") return isNotification ? null : rpcError(id ?? null, -32600, "invalid JSON-RPC request");
  if (!isNotification && !(typeof id === "string" || (typeof id === "number" && Number.isFinite(id)))) return rpcError(null, -32600, "id must be a string or number");
  if (isNotification) return null; // notifications/initialized, cancellations: nothing to answer
  switch (method) {
    case "initialize": {
      const open = context.session();
      if (open !== null) context.lastRead.set(actor.actorId, open.name);
      const requested = params?.protocolVersion;
      const protocolVersion = MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0];
      return { jsonrpc: "2.0", id, result: { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: "Ninerr design documents. Call guide first." } };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: mcpToolDefinitions() } };
    case "tools/call":
      return { jsonrpc: "2.0", id, result: await callTool(context, actor, params) };
    default:
      return rpcError(id, -32601, `method ${JSON.stringify(method).slice(0, 80)} is not supported`);
  }
}

async function callTool(context: McpContext, actor: StudioActor, params: any) {
  const toolName = params?.name;
  const given = params?.arguments === undefined ? {} : params.arguments;
  // dryRun and baseRevision belong to the call, not to the tool: taken off before it runs.
  const changes = typeof toolName === "string" && (classifyTool(toolName) === "write" || classifyTool(toolName) === "consequential");
  // Only from an object: anything else is left as it came, and refused as tool arguments.
  const plain = changes && given !== null && typeof given === "object" && !Array.isArray(given);
  const { dryRun, baseRevision, ...rest } = plain ? given : { dryRun: undefined, baseRevision: undefined };
  const args = plain ? rest : given;
  if (dryRun !== undefined && typeof dryRun !== "boolean") return toolResult("dryRun is true or false", true);
  if (baseRevision !== undefined && (!Number.isSafeInteger(baseRevision) || baseRevision < 0)) return toolResult("baseRevision is a revision number", true);
  if (typeof toolName !== "string" || toolName === "") return toolResult("tools/call needs a tool name", true);
  const session = context.session();
  if (session === null) return toolResult("No project is open in Ninerr. Ask the person to open one.", true);
  if (session.failure !== null) return toolResult("The project must be reopened in Ninerr before it can be used.", true);
  const toolClass = classifyTool(toolName);
  // An agent changes only the project it connected to or last read (#260); one it has never
  // seen here (a host restarted under it, a client that did not initialize) reads first.
  const notRead = (): string | null => {
    if (toolClass !== "write" && toolClass !== "consequential") return null;
    const lastRead = context.lastRead.get(actor.actorId);
    if (lastRead === session.name) return null;
    if (lastRead === undefined) return `Call project_info first: Ninerr changes only a project you have read, and ${JSON.stringify(session.name)} is open.`;
    return `The open project in Ninerr is now ${JSON.stringify(session.name)}, not ${JSON.stringify(lastRead)}, the one you last read. Call project_info, and make sure you mean to change this project, before changing anything.`;
  };
  const at = context.now();
  const call = { actor, toolName, arguments: args, at };
  // A change based on a revision the document has moved on from is refused: after the caller is
  // authorized (so a refused caller learns nothing), before the person is asked anything; and
  // the change itself is made at that revision, so one made while the person was asked is too.
  const stale = (): string | null => (baseRevision !== undefined && baseRevision !== session.revision ? `The document has changed: your change is based on revision ${baseRevision}, and it is at ${session.revision}. Read it again first.` : null);
  // Authorize before anything else, including before a consequential call asks the person.
  try {
    requireMCPToolCall(session.accessPolicy(), call);
  } catch (error) {
    if (!(error instanceof MCPAuthorizationError) || error.decision.outcome !== "confirmation-required") return refusal(error);
    // Reaching here, the caller may change the document. A dry run changes nothing, so the
    // person is not asked to confirm it.
    if (dryRun !== true) {
      // Before the person is asked to confirm anything.
      const unread = notRead();
      if (unread !== null) return toolResult(unread, true);
      const hidden = changes ? hiddenLabel(args) : null;
      if (hidden !== null) return toolResult(hidden, true);
      const before = stale();
      if (before !== null) return toolResult(before, true);
      const confirmation = await confirm(context, session, actor, toolName, args, at);
      if (typeof confirmation === "string") return toolResult(confirmation, true);
      try {
        requireMCPToolCall(session.accessPolicy(), { ...call, at: context.now(), confirmation });
      } catch (again) {
        return refusal(again);
      }
    }
  }
  const changed = stale();
  if (changed !== null) return toolResult(changed, true);
  const unread = notRead();
  if (unread !== null) return toolResult(unread, true);
  const hidden = changes ? hiddenLabel(args) : null;
  if (hidden !== null) return toolResult(hidden, true);
  const tool = TOOL_BY_NAME.get(toolName);
  // Unreachable while the server's tools are exactly the catalog (checked at load); fail closed.
  if (tool === undefined) return toolResult(`Ninerr has no tool ${toolName}.`, true);
  if (context.session() !== session) return toolResult("The open project changed while the call was waiting.", true);
  try {
    const value = await tool.run({
      session,
      actor,
      toolName,
      selection: context.selection,
      references: context.references,
      edit: (operations, intent) => {
        if (operations.length === 0) throw new ToolError("nothing to change");
        if (dryRun === true) {
          const preview = session.preview(actor, { baseRevision: baseRevision ?? session.revision, operations, intent, tool: toolName }, "mcp");
          // Nothing is made: the result says so, and what the change would touch.
          throw new DryRun({ dryRun: true, wouldChange: preview.affectedNodeIds, operations: preview.operations, revision: preview.revision, intent });
        }
        const event = session.edit(actor, { baseRevision: baseRevision ?? session.revision, operations, intent, tool: toolName }, "mcp");
        return { revision: event.revision, transactionId: event.transactionId, affectedNodeIds: event.affectedNodeIds };
      },
    }, args);
    if (PROJECT_READS.has(toolName) || toolClass === "write" || toolClass === "consequential") context.lastRead.set(actor.actorId, session.name);
    return toolResult(value);
  } catch (error) {
    if (error instanceof DryRun) return toolResult(error.result);
    if (error instanceof ToolError) return toolResult(error.message, true);
    if (error instanceof StudioError) return toolResult(error.message, true);
    return toolResult("Ninerr could not complete the call.", true);
  }
}

// A dry run's answer: thrown from edit, so the tool stops where it would have made the change.
class DryRun extends Error {
  readonly result: Record<string, unknown>;
  constructor(result: Record<string, unknown>) {
    super("dry run");
    this.result = result;
  }
}

function refusal(error: unknown) {
  if (error instanceof MCPAuthorizationError) return toolResult(`Not allowed: ${error.decision.reason}.`, true);
  if (error instanceof MCPContractError) return toolResult(`Invalid call: ${error.message}`, true);
  return toolResult("Ninerr could not authorize the call.", true);
}

/** The person's confirmation for this exact call, or the message to return instead. */
/**
 * What a delete_token call would affect, from the document: the token, every value that uses it,
 * and every token that aliases it. Its digest binds the person's approval.
 */
function tokenSubject(document: any, name: unknown) {
  const system = designSystemOf(document);
  const token = typeof name === "string" ? system?.props.tokens.find((entry: any) => entry.name === name) ?? null : null;
  const uses = token === null ? [] : tokenUses(document, token.name);
  const aliases = token === null ? [] : system.props.tokens.filter((entry: any) => entry.name !== token.name && Object.values(entry.values).some((value) => tokenReferences(value).includes(token.name))).map((entry: any) => entry.name);
  return { token, uses, aliases };
}

/** The person's confirmation for this exact call, or the message to return instead. */
async function confirm(context: McpContext, session: StudioSession, actor: StudioActor, toolName: string, args: unknown, at: string) {
  const argumentsSha256 = mcpArgumentsSha256(args);
  const subjectOf = () => (toolName === "delete_token" ? createHash("sha256").update(JSON.stringify(tokenSubject(session.document, (args as any)?.name))).digest("hex") : undefined);
  const subjectSha256 = subjectOf();
  const key = { agentId: actor.actorId, toolName, documentId: session.documentId, argumentsSha256, subjectSha256 };
  const approvedAt = context.confirmations.takeApproval(key);
  if (approvedAt !== null) return { documentId: session.documentId, toolName, argumentsSha256, actorId: actor.ownerActorId!, confirmedAt: approvedAt };
  const ids = Array.isArray((args as any)?.nodeIds) ? [...new Set((args as any).nodeIds.filter((id: unknown) => typeof id === "string"))] as string[] : [];
  const document = session.document as any;
  // What the person is shown: each layer's name or text and its kind, and how many layers
  // inside it go with it, from the document (an agent controls names, not structure).
  const describeNode = (id: string) => {
    const node = Object.hasOwn(document.nodes, id) ? document.nodes[id] : null;
    if (node === null) return "(missing layer)";
    const label = typeof node.props?.name === "string" ? node.props.name : typeof node.props?.text === "string" ? `“${node.props.text.slice(0, 30)}”` : null;
    const kind = typeof node.props?.tag === "string" ? node.props.tag : node.type;
    let inside = -1;
    const stack = [id];
    while (stack.length > 0) {
      inside += 1;
      stack.push(...document.nodes[stack.pop()!].children);
    }
    return `${label === null ? kind : `${label} (${kind})`}${inside > 0 ? ` with ${inside} layer${inside === 1 ? "" : "s"} inside` : ""}`;
  };
  // A token's deletion: which token, how many layer values use it, and what takes its place, from
  // the document; a name that is not a token name is shown as such, never as given.
  const tokenSummary = () => {
    const name = (args as any)?.name;
    const shown = typeof name === "string" && TOKEN_NAME.test(name) ? name : "(not a token name)";
    const { token, uses, aliases } = tokenSubject(document, name);
    const values = uses.reduce((total: number, use: any) => total + use.fields.length, 0);
    const replacement = (args as any)?.replacement;
    const collection = token === null ? null : designSystemOf(document)?.props.collections.find((entry: any) => entry.id === token.collection);
    const literal = token === null || collection === null || collection === undefined ? "" : token.values[collection.defaultMode] ?? "";
    const by = typeof replacement?.token === "string" && TOKEN_NAME.test(replacement.token)
      ? `replaced by ${replacement.token}`
      : replacement?.literal === true ? `replaced by its default-mode value ${literal.slice(0, 60)} on layers (in every mode) and by its own value per mode in the tokens that alias it` : "with nothing in its place";
    const aliased = aliases.length === 0 ? "" : `, aliased by ${aliases.slice(0, 5).join(", ")}${aliases.length > 5 ? ", …" : ""}`;
    return `Delete token ${shown}, used by ${values} value${values === 1 ? "" : "s"} on ${uses.length} layer${uses.length === 1 ? "" : "s"}${aliased}, ${by}`;
  };
  const summary = toolName === "delete_token" ? tokenSummary() : `${toolName === "delete_layers" ? "Delete" : toolName} ${ids.length} layer${ids.length === 1 ? "" : "s"}: ${ids.slice(0, 5).map(describeNode).join(", ")}${ids.length > 5 ? ", …" : ""}`;
  const decision = await context.confirmations.request({ ...key, agentName: actor.displayName, summary }, at, context.confirmationWaitMs ?? CONFIRMATION_WAIT_MS);
  // What was approved must still be what runs: a token changed while the call waited is asked about again.
  if (decision.outcome === "approved" && subjectOf() !== subjectSha256) return "What this would delete changed while it waited for the person; call again to ask them about it as it is now.";
  // A switch to another project drops the request: say so, rather than that the person declined.
  if (decision.outcome === "denied") return context.session() === session ? "The person declined this change." : "The open project changed while the call was waiting.";
  if (decision.outcome === "busy") return "Too many changes are already waiting for the person's approval. Wait for them to decide, then call again.";
  if (decision.outcome === "timeout") return "Waiting for the person to approve this in Ninerr. Call again with the same arguments once they have.";
  return { documentId: session.documentId, toolName, argumentsSha256, actorId: actor.ownerActorId!, confirmedAt: decision.confirmedAt };
}
