import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { MCPAuthorizationError, MCPContractError, assertMCPToolSurface, classifyTool, mcpArgumentsSha256, requireMCPToolCall } from "@ninerr/mcp-protocol";
import { TOKEN_NAME, TOKEN_TYPES, tokenReferences, addMode, briefProblem, compileTokens, deleteToken, designSystemOf, designSystemProblem, isCodePart, newDesignSystemProps, renameToken, setBreakpoints, setToken, textLayerOf, tokenUses } from "@ninerr/document-model";
import { planElement, styleDeclarationProblem } from "@ninerr/renderer";
import { LAYOUT_MODES, componentsFor, componentsOf, createComponent, detachInstance, drawsComponent, insertInstance, instanceLayers, overrideFor, resetInstance, setInstanceOverride, setLayout } from "@ninerr/canvas";
import { NINERR_COMPONENT_CATEGORIES, RECORD_SOURCES, UI_COMPONENT_SOURCES, buildComponentOperations, getNinerrComponent, loadComponentRecords, searchComponents, searchNinerrComponents } from "@ninerr/component-sources";
import { ARCHETYPE_IDS, DOMAIN_ARCHETYPES, MOTION_PRESETS, MOTION_PRESET_IDS, MOTION_TOKENS, compileMotionReact, compileMotionStylesheet, evaluateMotionFrequency, evaluateTaste, getDomainArchetype, getSkill, lintMotionCss, listSkills, planDesignDirections, renderSkillMarkdown } from "@ninerr/design-intelligence";
import { STANDARD_VIEWPORTS, buildCritiqueReport, diffPngBuffers, discoverBrowser, improveDesignInMemory, renderAndInspect } from "@ninerr/vision";
import { exportAstro, exportHtml, exportJsx, exportSvelte, exportTailwind, exportVue, importJsx } from "./code.ts";
import { auditDesignSystem, compileBreakpointsStylesheet, generateHighContrastMode, planThemeMigration } from "./design-system-ops.ts";
import { StudioError } from "./errors.ts";
import { ImportDesk } from "./imports.ts";
import { planTokenCss } from "./token-import.ts";
import { exportDtcgTokens, planDtcgTokens } from "./tokens-dtcg.ts";
import { UntrustedFileError, readTrustedFile, writeTrustedBytes, writeTrustedFile } from "./trusted-file.ts";
import { REDESIGN_LIMITS, analyzeCodebase, applyRedesignPlan, planRedesign, readBoundedWorkspaceFile, rollbackRedesign, validateRollbackTargets } from "./redesign.ts";
import { RESEARCH_LIMITS, createLocalReferencePack, extractPatternsFromSource, listLocalReferencePacks, validatePackFileName, writeLocalReferencePack } from "./research.ts";
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
// The product's version: from the nearest package.json above this module that is Ninerr's own,
// the root of the source tree, the app inside a desktop package, or an installed engine.
function productVersion(): string {
  for (let folder = new URL("./", import.meta.url), depth = 0; depth < 8; folder = new URL("../", folder), depth += 1) {
    try {
      const found = JSON.parse(readFileSync(new URL("package.json", folder), "utf8"));
      if (found?.name === "ninerr" && typeof found.version === "string") return found.version;
    } catch {
      // No package.json here: look further up.
    }
  }
  throw new Error("Ninerr's package.json was not found above the MCP server");
}
const PRODUCT_VERSION = productVersion();
const SERVER_INFO = Object.freeze({ name: "ninerr", title: "Ninerr", version: PRODUCT_VERSION });
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
  now: () => string;
  selection: () => string[];
  references: ReferenceCatalog;
  edit: (operations: unknown[], intent: string, provenance?: Record<string, unknown>) => Json;
  /** The call is a dry run: a tool that does not change the document through `edit` must not act. */
  dryRun: boolean;
  /** Optional human-authorized local codebase folder bound when launching Ninerr MCP. */
  workspaceRoot: string | null;
  /** Owner-only directory where redesign rollback journals are written. */
  redesignJournalDir: string | null;
  /** Whether this session is still the open project session. */
  isOpen: () => boolean;
}

/** Tool arguments are the schema's and nothing else: no directory, URL, tenant or token gets through. */
function onlyArguments(args: unknown, names: string[]): Record<string, unknown> {
  const given = (args ?? {}) as Record<string, unknown>;
  for (const name of Object.keys(given)) if (!names.includes(name)) throw new ToolError(`this tool takes no argument ${JSON.stringify(name.slice(0, 40))}`);
  return given;
}

// Names a person reads and may be asked to approve (layers, components, their properties and
// variant options, tokens, modes, collections and descriptions) look like what they are (#64):
// an agent's label carries no controls, format characters (bidi reordering, zero-width, tag
// "smuggling" characters), separators or blank-looking fillers, and variation selectors only
// where they vary the character before them. ZWNJ and ZWJ stay legal (emoji, complex scripts),
// and a description may break lines. The rule is decision-assurance's and visual-git's. Text
// content and CSS values are not labels: text may need bidi marks, and CSS has its own rules.
const HIDDEN_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u{34f}\u{115f}\u{1160}\u{2800}\u{3164}\u{ffa0}]/u;
const JOINERS = /[\u{200c}\u{200d}]/gu;
const LINE_BREAKS = /[\t\n\r]/gu;
const SELECTOR_SMUGGLING = /(?<![\p{Extended_Pictographic}0-9#*])[\u{fe0e}\u{fe0f}]|[\u{fe00}-\u{fe0d}]|(?<!\p{Ideographic})[\u{e0100}-\u{e01ef}]/u;

// Each tool's labels, as paths into its arguments: `a[]` is every item of the list a, and
// `a[].b` each item's b. A write tool whose schema has a label-like field must list it here
// (checked when the module loads), so a new tool cannot take a label unchecked.
const LABELS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  create_frame: ["name"],
  create_layers: ["nodes[].name"],
  rename_layers: ["renames[].name"],
  create_component: ["name"],
  add_component_property: ["name", "options[]", "default"],
  set_token: ["name", "collection", "description"],
  add_token_mode: ["collection", "name"],
  rename_token: ["to"],
  delete_token: ["name", "replacement.token"],
  set_layer_modes: ["collection"],
  import_source: ["name", "stylesheets[].name"],
  export_design: ["name"],
  instantiate_component: ["label", "title", "description"],
  migrate_theme: ["tokens[].name", "tokens[].description", "breakpoints[].name"],
  render_preview: ["name"],
  import_from_codebase: ["name"],
  manage_references: ["title", "entries[].title"],
});
const LABEL_LIKE = new Set(["name", "names", "title", "label", "description", "collection", "options", "default", "to", "token"]);

/** The values at a label path in a call's arguments. */
function valuesAt(value: unknown, path: string): unknown[] {
  let values = [value];
  for (const segment of path.split(".")) {
    const list = segment.endsWith("[]");
    const key = list ? segment.slice(0, -2) : segment;
    values = values.flatMap((entry) => {
      if (entry === null || typeof entry !== "object" || !Object.hasOwn(entry, key)) return [];
      const next = (entry as Record<string, unknown>)[key];
      return list ? (Array.isArray(next) ? next : []) : [next];
    });
  }
  return values;
}

// What the person is asked to approve shows every character as itself: a control, format or
// blank-looking character in a layer's name or text (one an agent could not give, but an
// imported page or an older project could hold) is written out as [U+XXXX], so it can neither
// hide nor reorder the words around it. ZWNJ and ZWJ stay, as they join what they sit in.
const HIDDEN_GLOBAL = /(?![\u{200c}\u{200d}])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u{34f}\u{115f}\u{1160}\u{2800}\u{3164}\u{ffa0}]|\p{Cs}/gu;
function shownPlainly(text: string): string {
  return text.replace(HIDDEN_GLOBAL, (character) => `[U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}]`);
}

/** The first of a call's labels that hides or reorders what a person reads, as a refusal; null when there is none. */
function hiddenLabel(toolName: string, args: unknown): string | null {
  for (const path of LABELS[toolName] ?? []) {
    const field = path.replace(/\[\]/gu, "").split(".").at(-1);
    for (const entry of valuesAt(args, path)) {
      if (typeof entry !== "string") continue;
      const visible = entry.replace(JOINERS, "");
      const shown = field === "description" ? visible.replace(LINE_BREAKS, "") : visible;
      if (!entry.isWellFormed() || HIDDEN_TEXT.test(shown) || SELECTOR_SMUGGLING.test(entry)) {
        return `${field} must not contain control or hidden characters: a person reads it as it is shown`;
      }
    }
  }
  return null;
}

/** The label-like fields of a tool's schema, as label paths. */
function labelLikeFields(schema: any, prefix = ""): string[] {
  const fields: string[] = [];
  for (const [key, property] of Object.entries<any>(schema?.properties ?? {})) {
    const path = `${prefix}${key}`;
    const items = property?.type === "array" ? property.items : undefined;
    if (LABEL_LIKE.has(key)) fields.push(items === undefined ? path : `${path}[]`);
    if (items?.type === "object") fields.push(...labelLikeFields(items, `${path}[].`));
    if (property?.type === "object") fields.push(...labelLikeFields(property, `${path}.`));
  }
  return fields;
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

// What export_design writes: a file per format, in the project's own exports folder.
const EXPORT_FORMATS = Object.freeze({ html: "html", jsx: "jsx", tsx: "tsx", tailwind: "jsx", vue: "vue", svelte: "svelte", astro: "astro", "tokens-css": "css", "tokens-json": "json" });
const LAYER_TYPES = Object.freeze(["frame", "group", "element", "text", "vector", "image"]);
const MAX_CREATE_LAYERS = 500;
const EXPORT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const MAX_HISTORY = 200;

/** A change as an agent reads it in history. */
const historyLine = (entry: any) => ({
  revision: entry.revision,
  transactionId: entry.transactionId,
  actor: entry.actor,
  actorKind: entry.actorKind,
  ...(typeof entry.actorName === "string" ? { actorName: entry.actorName } : {}),
  intent: entry.intent,
  tool: entry.tool,
  affectedNodeIds: entry.affectedNodeIds.slice(0, 20),
  ...(entry.undoOf ? { undoOf: entry.undoOf } : {}),
  ...(entry.redoOf ? { redoOf: entry.redoOf } : {}),
  ...(entry.revertOf ? { revertOf: entry.revertOf } : {}),
  ...(entry.earlier ? { earlier: true } : {}),
});

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
        "Edit with create_frame, create_layers (add one or a nested tree of HTML or SVG layers in one change), set_text, rename_layers, set_styles, set_attributes (classes, dir for right-to-left text, aria-*), set_layout (children in a row or column), move_layers and duplicate_layers. delete_layers needs the person to approve it in Ninerr.",
        "Design tokens: read them with design_tokens; set_token, add_token_mode, rename_token and set_layer_modes change them, and a layer uses one as var(--name) in set_styles. delete_token needs the person's approval, and a token in use needs its replacement.",
        "Components: list_components lists them; create_component makes a layer a component, add_component_property gives it properties, insert_instance places instances, set_instance_values and set_instance_override change one instance (instance_layers gives the paths), and reset_instance takes its overrides off. detach_instance writes an instance, overrides and all, as real layers that no longer follow the component. An instance's layers are its component's: change the component itself to change every instance.",
        "The person takes back an agent's changes latest first: each new change goes on top of the ones before.",
        "project_history lists the latest changes and who made them; undo_change and redo_change undo and redo your own latest change. import_source brings sanitized HTML, JSX, CSS custom properties or W3C design token JSON into the project in one change. export_design writes a layer or the design tokens into the project's exports folder as html (a complete, script-free preview page), jsx, tsx, tailwind, vue, svelte, astro, tokens-css or tokens-json, and returns the file's path for the person.",
        "Every tool that changes the document takes dryRun: true, which checks the change and says what it would touch (wouldChange) without making it or asking the person anything (a created layer's id there is not the one a real call makes), and baseRevision, the revision you read (project_info gives it): a change to a document that has moved on since is refused, so read it again.",
        "A layer whose props hold codeExpression shows {…} code from its source: its text is only a copy, and set_text refuses it and any element holding one.",
        "Style values are CSS strings (\"24px\", \"#336699\"); null removes a property.",
        "search_design_references and get_design_reference read the local reference pack the person has chosen for this project. They change nothing, and a reference's rights say whether it may be reused. manage_references extracts offline design patterns from local HTML or CSS and creates, lists, or loads observed-inspiration-only reference packs stored strictly inside the project's references folder (zero network egress).",
        "Library components: search_components finds native editable Ninerr components (source: \"ninerr\", 41 components across 8 categories) as well as pinned component source records (Meta Astryx) by name or purpose; get_component gives one's exact props, variants, accessibility criteria, limitations, import path and provenance. instantiate_component places any native Ninerr component into the project in one atomic undoable change (as editable layers or as a reusable component definition and instance).",
        "Design systems: audit_design_system inspects token coverage, duplicates, unused tokens, hardcoded literal matches, and cross-mode WCAG contrast; migrate_theme atomically migrates light and dark semantic tokens, generates a WCAG AAA high-contrast mode, or configures responsive breakpoints and scoped responsive rules.",
        "Design intelligence: design_intelligence reads domain archetypes, plans multi-direction aesthetic tokens, runs brief-aware taste critique, inspects motion presets, checks motion frequency or CSS linting, and lists or renders official Ninerr skills. set_design_brief stores the structured product brief on the design system (optionally seeding a planned direction's tokens), and apply_motion attaches reduced-motion-safe keyframes and transitions to a layer stylesheet along with motion tokens.",
        "Visual assurance and critique: render_preview renders a layer inside a local zero-egress browser across responsive viewports (saving PNG screenshots and optional pixel diffs to exports/previews); critique_design returns a unified deterministic and heuristic critique across accessibility, taste, design systems, and optional live browser telemetry; improve_design runs bounded in-memory non-regressing repairs and commits at most one atomic undoable change.",
        "Existing-app redesign: when the person starts Ninerr MCP with a bound workspace folder, inspect_codebase analyzes its framework, styling, tokens and functional contracts offline; import_from_codebase brings a workspace component, stylesheet or HTML file into the open project in one change; plan_redesign computes a SHA-256 planToken for CSS token updates, JSX class replacements or AST-invariance-verified patches without touching disk; apply_redesign applies a verified plan or rolls back a previous run only with the person's explicit approval.",
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
    name: "create_layers",
    title: "Create layers",
    description: "Create one or up to 500 HTML or SVG layers in one atomic change. Set parentId to an existing layer id, null for a top-level layer, or an earlier entry's tempId in the same list to build a nested tree in one call.",
    inputSchema: object({
      nodes: {
        type: "array",
        minItems: 1,
        maxItems: MAX_CREATE_LAYERS,
        items: object({
          tempId: { type: "string", minLength: 1, maxLength: 64 },
          parentId: { type: ["string", "null"], maxLength: 128 },
          index: { type: "integer", minimum: 0 },
          type: { type: "string", enum: [...LAYER_TYPES] },
          tag: { type: "string", maxLength: 40 },
          name: { type: "string", maxLength: 200 },
          text: { type: "string", maxLength: 100000 },
          attributes: { type: "object", additionalProperties: { type: "string", maxLength: 2000 }, maxProperties: 64 },
          style: { type: "object", additionalProperties: { type: "string", maxLength: 2000 }, maxProperties: 200 },
        }),
      },
    }, ["nodes"]),
    run: ({ session, edit }, args) => {
      if (!Array.isArray(args.nodes) || args.nodes.length === 0 || args.nodes.length > MAX_CREATE_LAYERS) {
        throw new ToolError(`nodes must be a list of 1-${MAX_CREATE_LAYERS} layer definitions`);
      }
      const document = session.document as any;
      const tempMap = new Map<string, string>();
      const childCounts = new Map<string | null, number>();
      const countFor = (parentId: string | null) => {
        if (childCounts.has(parentId)) return childCounts.get(parentId)!;
        const base = parentId === null ? document.rootIds.length : (document.nodes[parentId]?.children?.length ?? 0);
        childCounts.set(parentId, base);
        return base;
      };
      const operations: unknown[] = [];
      const created: Array<{ tempId: string | null; nodeId: string }> = [];
      for (let i = 0; i < args.nodes.length; i += 1) {
        const entry = args.nodes[i];
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new ToolError(`nodes[${i}] must be an object`);
        const type = entry.type === undefined ? (entry.text !== undefined && entry.tag === undefined ? "text" : "element") : entry.type;
        if (typeof type !== "string" || !LAYER_TYPES.includes(type as any)) throw new ToolError(`nodes[${i}].type must be one of ${LAYER_TYPES.join(", ")}`);
        let parentId: string | null = null;
        if (entry.parentId !== undefined && entry.parentId !== null) {
          if (typeof entry.parentId !== "string") throw new ToolError(`nodes[${i}].parentId must be a node id, a tempId, or null`);
          if (tempMap.has(entry.parentId)) {
            parentId = tempMap.get(entry.parentId)!;
          } else {
            const existing = nodeOf(session, entry.parentId);
            if (existing.type === "component-instance" || existing.type === "design-system" || isCodePart(existing)) {
              throw new ToolError(`cannot insert layers inside ${isCodePart(existing) ? "code expression" : existing.type} ${existing.id}`);
            }
            parentId = existing.id;
          }
        }
        const props: Record<string, unknown> = {};
        if (entry.name !== undefined) {
          if (typeof entry.name !== "string") throw new ToolError(`nodes[${i}].name must be a string`);
          const trimmed = entry.name.trim().slice(0, 200);
          if (trimmed !== "") props.name = trimmed;
        }
        if (entry.tag !== undefined) {
          if (typeof entry.tag !== "string" || !/^[a-z][a-z0-9-]{0,39}$/iu.test(entry.tag)) {
            throw new ToolError(`nodes[${i}].tag ${JSON.stringify(String(entry.tag)).slice(0, 40)} is not a valid HTML or SVG tag`);
          }
          const lowered = entry.tag.toLowerCase();
          // Confirm the renderer allowlists this exact tag rather than silently falling back.
          const planned = planElement({ id: "check", type, props: { tag: lowered } });
          if (planned.tag.toLowerCase() !== lowered) {
            throw new ToolError(`nodes[${i}].tag ${JSON.stringify(entry.tag)} is not an allowlisted HTML or SVG tag`);
          }
          props.tag = lowered;
        }
        if (entry.text !== undefined) {
          if (typeof entry.text !== "string" || entry.text.length > 100_000) throw new ToolError(`nodes[${i}].text must be a string of at most 100000 characters`);
          props.text = entry.text;
        }
        if (entry.style !== undefined) {
          if (entry.style === null || typeof entry.style !== "object" || Array.isArray(entry.style)) throw new ToolError(`nodes[${i}].style must be an object`);
          const styleEntries = Object.entries(entry.style);
          if (styleEntries.length > 200) throw new ToolError(`nodes[${i}].style may have at most 200 properties`);
          const style: Record<string, string> = {};
          for (const [property, value] of styleEntries) {
            if (typeof value !== "string" || value.length > 2_000) throw new ToolError(`nodes[${i}].style.${property.slice(0, 64)} must be a string of at most 2000 characters`);
            const problem = styleDeclarationProblem(property, value);
            if (problem !== null) throw new ToolError(`nodes[${i}].style: ${problem}`);
            style[property] = value;
          }
          props.style = style;
        }
        if (entry.attributes !== undefined) {
          if (entry.attributes === null || typeof entry.attributes !== "object" || Array.isArray(entry.attributes)) throw new ToolError(`nodes[${i}].attributes must be an object`);
          const attrEntries = Object.entries(entry.attributes);
          if (attrEntries.length > 64) throw new ToolError(`nodes[${i}].attributes may have at most 64 properties`);
          const attributes: Record<string, string> = {};
          const element = { id: "check", type, props: props.tag === undefined ? {} : { tag: props.tag } };
          const baseline = planElement(element).dropped;
          for (const [rawAttr, attrValue] of attrEntries) {
            const lowerAttr = rawAttr.toLowerCase();
            if (!/^[a-z][a-z0-9-]{0,63}$/u.test(lowerAttr)) {
              throw new ToolError(`nodes[${i}].attributes: ${JSON.stringify(rawAttr).slice(0, 80)} is not an attribute name`);
            }
            if (typeof attrValue !== "string" || attrValue.length > 2_000) {
              throw new ToolError(`nodes[${i}].attributes.${lowerAttr} must be a string of at most 2000 characters`);
            }
            const written = lowerAttr === "class" ? [...new Set(attrValue.split(/[\t\n\f\r ]+/u).filter((part) => part !== ""))].join(" ") : attrValue;
            if (lowerAttr === "dir" && !["ltr", "rtl", "auto"].includes(written)) {
              throw new ToolError(`nodes[${i}].attributes.dir must be "ltr", "rtl" or "auto"`);
            }
            const plan = planElement({ ...element, props: { ...element.props, attributes: { [rawAttr]: written } } });
            if (plan.dropped > baseline) {
              throw new ToolError(`nodes[${i}].attributes: ${lowerAttr} is not an attribute the canvas draws on this ${typeof props.tag === "string" ? `<${props.tag}>` : type}`);
            }
            const existingKey = Object.keys(attributes).find((key) => key.toLowerCase() === lowerAttr);
            if (existingKey !== undefined) delete attributes[existingKey];
            const drawn = Object.values(plan.attributes as Record<string, string>)[0] ?? written;
            if (!(drawn === "" && lowerAttr === "class")) attributes[rawAttr] = drawn;
          }
          if (Object.keys(attributes).length > 0) props.attributes = attributes;
        }
        const id = `${type === "frame" ? "frame" : "layer"}-${randomUUID().slice(0, 12)}`;
        let tempId: string | null = null;
        if (entry.tempId !== undefined) {
          if (typeof entry.tempId !== "string" || entry.tempId.trim() === "" || entry.tempId.length > 64) throw new ToolError(`nodes[${i}].tempId must be 1-64 characters`);
          if (tempMap.has(entry.tempId)) throw new ToolError(`duplicate tempId ${JSON.stringify(entry.tempId)}`);
          tempId = entry.tempId;
          tempMap.set(tempId, id);
        }
        const currentCount = countFor(parentId);
        const index = entry.index === undefined ? currentCount : entry.index;
        if (!Number.isInteger(index) || index < 0 || index > currentCount) {
          throw new ToolError(`nodes[${i}].index must be between 0 and ${currentCount}`);
        }
        childCounts.set(parentId, currentCount + 1);
        childCounts.set(id, 0);
        operations.push({ type: "insert-node", node: { id, type, props }, parentId, index });
        created.push({ tempId, nodeId: id });
      }
      return {
        created,
        nodeIds: created.map((item) => item.nodeId),
        ...(edit(operations, created.length === 1 ? "Create layer" : `Create ${created.length} layers`) as object),
      };
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
    description: "Find components from Ninerr's 41 native editable components (source: \"ninerr\") or pinned component source records (Meta Astryx) by name or purpose, such as \"date picker\", \"pricing\", or \"command palette\", optionally in one category. Gives each one's id for get_component or instantiate_component.",
    inputSchema: object({ query: { type: "string", maxLength: 200 }, category: { type: "string", maxLength: 100 }, source: { type: "string", enum: ["ninerr", ...RECORD_SOURCES] }, limit: { type: "integer", minimum: 1, maximum: 50 } }),
    run: async (_context, given) => {
      const args = onlyArguments(given, ["query", "category", "source", "limit"]);
      if (args.query !== undefined && (typeof args.query !== "string" || args.query.length > 200)) throw new ToolError("query is text of at most 200 characters");
      if (args.category !== undefined && (typeof args.category !== "string" || args.category.length > 100)) throw new ToolError("category is text");
      if (args.limit !== undefined && (!Number.isInteger(args.limit) || (args.limit as number) < 1 || (args.limit as number) > 50)) throw new ToolError("limit is a whole number from 1 to 50");
      const limit = Number.isInteger(args.limit) ? (args.limit as number) : 20;
      if (args.source === "ninerr") {
        const found = searchNinerrComponents({
          query: typeof args.query === "string" ? args.query : "",
          category: typeof args.category === "string" ? args.category : "",
        }).slice(0, limit);
        return {
          categories: [...NINERR_COMPONENT_CATEGORIES],
          sources: [{ id: "ninerr", license: "Apache-2.0", native: true, editable: true }],
          components: found.map((entry: any) => ({
            id: `ninerr:${entry.id}`,
            name: entry.name,
            category: entry.category,
            description: entry.summary,
            variants: entry.variants,
            instantiable: true,
          })),
        };
      }
      const sources = args.source === undefined ? RECORD_SOURCES : [args.source];
      if (!sources.every((id: string) => RECORD_SOURCES.includes(id))) throw new ToolError(`source is one of ninerr, ${RECORD_SOURCES.join(", ")}`);
      const snapshots = await Promise.all(sources.map((id: string) => loadComponentRecords(id)));
      const all = snapshots.flatMap((snapshot: any) => snapshot.components);
      const found = searchComponents(all, { query: typeof args.query === "string" ? args.query : "", category: typeof args.category === "string" ? args.category : null, limit });
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
    description: "One library component's record, by its id from search_components (including native ninerr:<id> blueprints and pinned Astryx records): its variants, tokens, accessibility criteria, guidance, and provenance.",
    inputSchema: object({ id: { type: "string", maxLength: 300 } }, ["id"]),
    run: async (_context, given) => {
      const args = onlyArguments(given, ["id"]);
      const rawId = typeof args.id === "string" && args.id.length <= 300 ? args.id : "";
      const colon = rawId.indexOf(":");
      const source = colon > 0 ? rawId.slice(0, colon) : "";
      if (source === "ninerr") {
        const entry = getNinerrComponent(rawId.slice(colon + 1));
        if (!entry) throw new ToolError("no such component; take ids from search_components");
        return {
          component: { ...entry, id: `ninerr:${entry.id}`, instantiable: true },
          provenance: { source: "ninerr", license: { spdx: "Apache-2.0" }, native: true, editable: true, importPolicy: "native-editable-blueprint" },
        };
      }
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
  {
    name: "project_history",
    title: "History",
    description: "The project's latest changes, newest last: who made each (a person or an agent), with which tool, and its intent. Changes made before the project was opened are marked earlier.",
    inputSchema: object({ limit: { type: "integer", minimum: 1, maximum: MAX_HISTORY } }),
    run: ({ session }, args) => {
      const limit = Number.isSafeInteger(args.limit) && args.limit >= 1 && args.limit <= MAX_HISTORY ? args.limit : 50;
      const log = session.log;
      return { revision: session.revision, total: log.length, changes: log.slice(-limit).map(historyLine) } as Json;
    },
  },
  {
    name: "undo_change",
    title: "Undo",
    description: "Undo your own latest change in this session (a person's or another agent's changes are never undone by you). redo_change puts it back.",
    inputSchema: object({}),
    run: ({ session, actor, dryRun }) => {
      if (dryRun) {
        if (!session.canUndo(actor)) throw new ToolError("there is nothing of yours to undo");
        return { dryRun: true, wouldUndo: "your latest change in this session (project_history lists it)", revision: session.revision } as Json;
      }
      const event = session.undo(actor);
      return { revision: event.revision, transactionId: event.transactionId, affectedNodeIds: event.affectedNodeIds, undoOf: event.undoOf ?? null } as Json;
    },
  },
  {
    name: "redo_change",
    title: "Redo",
    description: "Redo your own change you last undid with undo_change.",
    inputSchema: object({}),
    run: ({ session, actor, dryRun }) => {
      if (dryRun) {
        if (!session.canRedo(actor)) throw new ToolError("there is nothing of yours to redo");
        return { dryRun: true, wouldRedo: "your change you last undid", revision: session.revision } as Json;
      }
      const event = session.redo(actor);
      return { revision: event.revision, transactionId: event.transactionId, affectedNodeIds: event.affectedNodeIds, redoOf: event.redoOf ?? null } as Json;
    },
  },
  {
    name: "import_source",
    title: "Import markup, code or tokens",
    description: "Import sanitized HTML (with optional CSS stylesheets), JSX/TSX, CSS custom-property tokens or W3C DTCG token JSON into the open project in one undoable change. Nothing is fetched from the network.",
    inputSchema: object({
      format: { type: "string", enum: ["html", "jsx", "tokens-css", "tokens-json"] },
      source: { type: "string", minLength: 1, maxLength: 2_000_000 },
      name: { type: "string", maxLength: 120 },
      component: { type: "string", maxLength: 128 },
      stylesheets: {
        type: "array",
        maxItems: 64,
        items: object({ name: { type: "string", minLength: 1, maxLength: 255 }, css: { type: "string", maxLength: 2_000_000 } }, ["name", "css"]),
      },
    }, ["format", "source"]),
    run: ({ session, actor, now, edit }, args) => {
      if (args.format === "html") {
        const desk = new ImportDesk();
        const summaryReport = desk.prepare({ html: args.source, name: args.name ?? "Imported page", stylesheets: args.stylesheets }, actor.actorId, now());
        if (!summaryReport.commitReady) {
          throw new ToolError(`HTML import refused: ${summaryReport.blockingReasons.join("; ")}`);
        }
        const change = desk.change(summaryReport.proposalId, session.document);
        return {
          format: "html",
          frameId: change.frameId,
          layers: summaryReport.counts.nodes,
          accessibilityFindings: summaryReport.accessibilityFindings,
          security: summaryReport.security,
          notes: summaryReport.notes,
          ...(edit(change.operations, change.intent, change.provenance) as object),
        };
      }
      if (args.format === "jsx") {
        const imported = importJsx(args.source, { ...(typeof args.component === "string" && args.component !== "" ? { component: args.component } : {}) });
        const intent = typeof args.name === "string" && args.name.trim() !== "" ? `Import ${args.name.trim().slice(0, 120)}` : `Import ${imported.componentName}`;
        return {
          format: "jsx",
          frameId: imported.frameId,
          componentName: imported.componentName,
          layers: imported.layers,
          layersWithStyleLeftOut: imported.layersWithStyleLeftOut,
          layersWithStyleOutOfOrder: imported.layersWithStyleOutOfOrder,
          ...(edit(imported.operations, intent) as object),
        };
      }
      if (args.format === "tokens-css" || args.format === "tokens-json") {
        const planned = args.format === "tokens-css"
          ? planTokenCss(session.document, { css: args.source, fileName: args.name })
          : planDtcgTokens(session.document, args.source, typeof args.name === "string" ? args.name : undefined);
        if (planned.plan.problem !== null) throw new ToolError(`tokens refused: ${planned.plan.problem}`);
        const refused = planned.plan.tokens
          .filter((token: any) => token.status === "refused")
          .map((token: any) => ({ name: token.name, reason: token.reason ?? "refused" }));
        const conflicts = planned.plan.tokens
          .filter((token: any) => token.status === "conflict")
          .map((token: any) => ({ name: token.name, reason: token.reason ?? "conflict" }));
        if (planned.operations.length === 0) {
          return { format: args.format, adds: 0, skipped: planned.plan.skipped, kept: planned.plan.kept, refused, conflicts, revision: session.revision };
        }
        const from = planned.plan.fileName ?? (args.format === "tokens-css" ? "CSS" : "DTCG JSON");
        return {
          format: args.format,
          adds: planned.plan.adds,
          skipped: planned.plan.skipped,
          kept: planned.plan.kept,
          refused,
          conflicts,
          ...(edit(planned.operations, `Import ${planned.plan.adds} token${planned.plan.adds === 1 ? "" : "s"} from ${from}`) as object),
        };
      }
      throw new ToolError("format must be html, jsx, tokens-css or tokens-json");
    },
  },
  {
    name: "export_design",
    title: "Export a design",
    description: "Write a layer or design tokens into the project's exports folder, and return the file's path: html is a complete, script-free preview page; jsx and tsx are React components; tailwind is a React component styled with Tailwind classes; vue, svelte and astro are static single-file framework components; tokens-css and tokens-json export the design system tokens (nodeId optional). The design itself does not change.",
    inputSchema: object({ nodeId: { type: "string" }, format: { type: "string", enum: Object.keys(EXPORT_FORMATS) }, name: { type: "string", maxLength: 64, description: "The file's name without extension: letters, digits, - and _. Defaults to the layer's component name or tokens." }, replace: { type: "boolean", description: "Replace a file of that name already in exports (it may have been edited since). Without it, an existing file is refused." } }, ["format"]),
    run: ({ session, dryRun }, args) => {
      if (args.replace !== undefined && typeof args.replace !== "boolean") throw new ToolError("replace is true or false");
      if (!Object.hasOwn(EXPORT_FORMATS, args.format)) throw new ToolError(`format is one of ${Object.keys(EXPORT_FORMATS).join(", ")}`);
      if (args.name !== undefined && (typeof args.name !== "string" || !EXPORT_NAME.test(args.name))) throw new ToolError("name is 1-64 letters, digits, - or _, starting with a letter or digit");
      let text: string;
      let componentName: string;
      let layers: number;
      if (args.format === "tokens-css" || args.format === "tokens-json") {
        if (args.format === "tokens-css") {
          const css = compileTokens(session.document);
          if (css.trim() === "") throw new ToolError("this project has no design tokens to export");
          text = `${css.trimEnd()}\n`;
        } else {
          text = exportDtcgTokens(session.document);
        }
        componentName = "tokens";
        layers = designSystemOf(session.document)?.props.tokens.length ?? 0;
      } else {
        if (typeof args.nodeId !== "string" || args.nodeId === "") throw new ToolError(`nodeId is required for ${args.format} export`);
        nodeOf(session, args.nodeId);
        if (args.format === "html") {
          const page = exportHtml(session.document, args.nodeId);
          ({ componentName, layers } = page);
          text = page.html;
        } else if (args.format === "vue" || args.format === "svelte" || args.format === "astro") {
          const fw = args.format === "vue"
            ? exportVue(session.document, args.nodeId)
            : args.format === "svelte"
              ? exportSvelte(session.document, args.nodeId)
              : exportAstro(session.document, args.nodeId);
          ({ componentName, layers } = fw);
          text = fw.code;
        } else {
          const code = args.format === "tailwind" ? exportTailwind(session.document, args.nodeId) : exportJsx(session.document, args.nodeId);
          ({ componentName, layers } = code);
          const emitted = args.format === "tsx"
            ? `import type React from "react";\n\n${code.code.replace(/^(export function [A-Za-z0-9_]+\(\)) \{/mu, "$1: React.JSX.Element {")}`
            : code.code;
          // A component's stylesheet and tokens go with it, in the file, where an import would need them.
          const css = [code.tokens, code.stylesheet].filter((part): part is string => typeof part === "string" && part !== "").join("\n");
          text = css === "" ? emitted : `${emitted}\n\n/* Its stylesheet:\n${css.replace(/\*\//gu, "* /")}\n*/\n`;
        }
      }
      const base = args.name ?? (EXPORT_NAME.test(componentName) ? componentName : "design");
      const folder = join(session.root, "exports");
      const path = join(folder, `${base}.${EXPORT_FORMATS[args.format as keyof typeof EXPORT_FORMATS]}`);
      // Case-insensitive, as a Windows or macOS disk is: another file of that name is the same file there.
      const taken = existsSync(folder) && readdirSync(folder).some((entry) => entry.toLowerCase() === `${base}.${EXPORT_FORMATS[args.format as keyof typeof EXPORT_FORMATS]}`.toLowerCase());
      if (taken && args.replace !== true) throw new ToolError(`exports already has ${base}.${EXPORT_FORMATS[args.format as keyof typeof EXPORT_FORMATS]}; pass replace: true to replace it, or give another name`);
      if (dryRun) return { dryRun: true, wouldWrite: path, replaces: taken, format: args.format, componentName, layers, bytes: Buffer.byteLength(text) } as Json;
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      // The folder must be the project's own: not a link or junction to somewhere else, which a
      // project from a clone, an archive or a shared drive could carry.
      const entry = lstatSync(folder);
      if (entry.isSymbolicLink() || !entry.isDirectory() || realpathSync(folder) !== join(realpathSync(session.root), "exports")) {
        throw new ToolError("the project's exports folder is a link to somewhere else, so nothing was written; make it an ordinary folder");
      }
      writeTrustedFile(path, text);
      return { path, format: args.format, componentName, layers, bytes: Buffer.byteLength(text), replaced: taken } as Json;
    },
  },
  {
    name: "design_intelligence",
    title: "Design intelligence, taste, motion, and skills",
    description: "Read-only local design intelligence: list domain archetypes, plan 3 distinct token-ready aesthetic directions, run context-aware taste critique on the open document, inspect the stored design brief, list motion presets, evaluate motion frequency or lint motion CSS, and list or read Ninerr's 19 official design skills.",
    inputSchema: object({
      action: { type: "string", enum: ["archetypes", "plan", "taste", "brief", "motion_presets", "motion_frequency", "motion_lint", "skills", "skill"] },
      domain: { type: "string", maxLength: 64 },
      productName: { type: "string", maxLength: 160 },
      audience: { type: "string", maxLength: 400 },
      density: { type: "string", enum: ["compact", "balanced", "spacious"] },
      themePreference: { type: "string", enum: ["light", "dark", "system"] },
      nodeId: { type: "string", maxLength: 128 },
      presetId: { type: "string", maxLength: 64 },
      trigger: { type: "string", maxLength: 64 },
      dailyUses: { type: "integer", minimum: 0, maximum: 100000 },
      css: { type: "string", maxLength: 200000 },
      allowAmbient: { type: "boolean" },
      query: { type: "string", maxLength: 120 },
      skillId: { type: "string", maxLength: 64 },
    }, ["action"]),
    run: ({ session }, args) => {
      const action = args.action;
      if (action === "archetypes") {
        if (typeof args.domain === "string" && args.domain !== "") {
          return { archetype: getDomainArchetype(args.domain) as unknown as Json };
        }
        return {
          archetypes: ARCHETYPE_IDS.map((id) => ({
            id,
            title: DOMAIN_ARCHETYPES[id].title,
            summary: DOMAIN_ARCHETYPES[id].summary,
            defaultDensity: DOMAIN_ARCHETYPES[id].defaultDensity,
            defaultTheme: DOMAIN_ARCHETYPES[id].defaultTheme,
          })),
        } as Json;
      }
      if (action === "brief") {
        const system = designSystemOf(session.document as any);
        return {
          brief: (system?.props?.brief ?? null) as Json,
          breakpoints: (system?.props?.breakpoints ?? null) as Json,
          motion: (system?.props?.motion ?? null) as Json,
        };
      }
      if (action === "plan") {
        const system = designSystemOf(session.document as any);
        const stored = system?.props?.brief;
        const input: Record<string, unknown> = {
          productName: typeof args.productName === "string" && args.productName.trim() !== "" ? args.productName.trim() : (stored?.productName ?? (session.document as any).name ?? "Untitled Product"),
          domain: typeof args.domain === "string" && args.domain.trim() !== "" ? args.domain.trim() : (stored?.domain ?? "enterprise-saas"),
        };
        if (typeof args.audience === "string" && args.audience.trim() !== "") input.audience = args.audience.trim();
        else if (stored?.audience) input.audience = stored.audience;
        if (args.density !== undefined) input.density = args.density;
        else if (stored?.density) input.density = stored.density;
        if (args.themePreference !== undefined) input.themePreference = args.themePreference;
        else if (stored?.themePreference) input.themePreference = stored.themePreference;
        try {
          return planDesignDirections(input) as unknown as Json;
        } catch (error) {
          throw new ToolError(error instanceof Error ? error.message : String(error));
        }
      }
      if (action === "taste") {
        const rootId = args.nodeId === undefined ? null : nodeOf(session, args.nodeId).id;
        return evaluateTaste(session.document as any, { rootId }) as unknown as Json;
      }
      if (action === "motion_presets") {
        if (typeof args.presetId === "string" && args.presetId !== "") {
          if (!Object.hasOwn(MOTION_PRESETS, args.presetId)) throw new ToolError(`unknown motion preset ${JSON.stringify(shownPlainly(args.presetId.slice(0, 64)))}`);
          const preset = MOTION_PRESETS[args.presetId as keyof typeof MOTION_PRESETS];
          return {
            preset: { id: preset.id, trigger: preset.trigger, duration: preset.duration, easing: preset.easing, properties: preset.properties, maxFrequency: preset.maxFrequency, summary: preset.summary },
            react: compileMotionReact(preset.id),
          } as unknown as Json;
        }
        return {
          tokens: MOTION_TOKENS,
          presets: MOTION_PRESET_IDS.map((id) => {
            const p = MOTION_PRESETS[id as keyof typeof MOTION_PRESETS];
            return { id: p.id, trigger: p.trigger, duration: p.duration, easing: p.easing, properties: p.properties, maxFrequency: p.maxFrequency, summary: p.summary };
          }),
        } as unknown as Json;
      }
      if (action === "motion_frequency") {
        if (typeof args.trigger !== "string" || typeof args.presetId !== "string") {
          throw new ToolError("motion_frequency requires trigger and presetId");
        }
        try {
          return evaluateMotionFrequency({
            trigger: args.trigger,
            presetId: args.presetId,
            dailyUses: typeof args.dailyUses === "number" ? args.dailyUses : null,
          }) as unknown as Json;
        } catch (error) {
          throw new ToolError(shownPlainly(error instanceof Error ? error.message : String(error)));
        }
      }
      if (action === "motion_lint") {
        if (typeof args.css === "string" && args.css.length > 200_000) {
          throw new ToolError("css input exceeds 200000 characters");
        }
        let css = typeof args.css === "string" ? args.css : "";
        let nodeId: string | null = null;
        if (args.nodeId !== undefined) {
          const node = nodeOf(session, args.nodeId);
          nodeId = node.id;
          css = typeof node.props?.stylesheet === "string" ? node.props.stylesheet : "";
        }
        return { nodeId, findings: lintMotionCss(css, { nodeId, allowAmbient: args.allowAmbient === true }) } as unknown as Json;
      }
      if (action === "skills") {
        return { skills: listSkills(typeof args.query === "string" ? args.query : "") } as unknown as Json;
      }
      if (action === "skill") {
        if (typeof args.skillId !== "string" || args.skillId.trim() === "") throw new ToolError("skill action requires skillId");
        const skill = getSkill(args.skillId);
        if (!skill) throw new ToolError(`unknown Ninerr skill ${JSON.stringify(shownPlainly(args.skillId.slice(0, 64)))}`);
        return { skill, markdown: renderSkillMarkdown(skill) } as unknown as Json;
      }
      throw new ToolError(`unsupported design_intelligence action ${JSON.stringify(shownPlainly(String(action).slice(0, 64)))}`);
    },
  },
  {
    name: "set_design_brief",
    title: "Set product design brief",
    description: "Store a structured product design brief on the project's design-system node (creating it if needed) in one undoable change. Optionally pass applyDirectionId from design_intelligence(action: \"plan\") to seed that direction's full light and dark token palette atomically.",
    inputSchema: object({
      productName: { type: "string", minLength: 1, maxLength: 160 },
      domain: { type: "string", minLength: 1, maxLength: 64 },
      audience: { type: "string", maxLength: 400 },
      brandTone: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 48 } },
      density: { type: "string", enum: ["compact", "balanced", "spacious"] },
      themePreference: { type: "string", enum: ["light", "dark", "system"] },
      aestheticDirection: { type: "string", maxLength: 120 },
      constraints: { type: "array", maxItems: 24, items: { type: "string", minLength: 1, maxLength: 240 } },
      allowExpressiveMotion: { type: "boolean" },
      allowEditorialGradients: { type: "boolean" },
      notes: { type: "string", maxLength: 1000 },
      applyDirectionId: { type: "string", maxLength: 128 },
    }, ["productName", "domain"]),
    run: ({ session, edit }, args) => {
      const checkBriefText = (field: string, value: unknown, multiline = false) => {
        if (typeof value !== "string") return;
        const body = multiline ? value.replace(JOINERS, "").replace(LINE_BREAKS, "") : value.replace(JOINERS, "");
        if (!value.isWellFormed() || HIDDEN_TEXT.test(body) || SELECTOR_SMUGGLING.test(value)) {
          throw new ToolError(`${field} holds hidden or reordering characters, so nothing was changed`);
        }
      };
      checkBriefText("productName", args.productName);
      checkBriefText("domain", args.domain);
      checkBriefText("audience", args.audience);
      checkBriefText("aestheticDirection", args.aestheticDirection);
      checkBriefText("notes", args.notes, true);
      if (Array.isArray(args.brandTone)) args.brandTone.forEach((v, i) => checkBriefText(`brandTone[${i}]`, v));
      if (Array.isArray(args.constraints)) args.constraints.forEach((v, i) => checkBriefText(`constraints[${i}]`, v));

      const brief: Record<string, unknown> = { productName: args.productName, domain: args.domain };
      for (const key of ["audience", "brandTone", "density", "themePreference", "aestheticDirection", "constraints", "allowExpressiveMotion", "allowEditorialGradients", "notes"] as const) {
        if (args[key] !== undefined) brief[key] = args[key];
      }
      const prob = briefProblem(brief);
      if (prob !== null) throw new ToolError(`invalid design brief: ${prob}`);

      const document = session.document as any;
      const system = designSystemOf(document);
      const props = system === null ? newDesignSystemProps(`${args.productName} Design System`) : structuredClone(system.props);
      props.brief = brief;

      let seededTokens = 0;
      if (typeof args.applyDirectionId === "string" && args.applyDirectionId !== "") {
        const planned = planDesignDirections(brief);
        const dir = planned.directions.find((d) => d.id === args.applyDirectionId);
        if (!dir) {
          throw new ToolError(`unknown applyDirectionId ${JSON.stringify(shownPlainly(args.applyDirectionId.slice(0, 64)))}; valid ids: ${planned.directions.map((d) => d.id).join(", ")}`);
        }
        props.brief = { ...brief, aestheticDirection: brief.aestheticDirection ?? dir.name };
        const primaryCollection = props.collections[0];
        const ensureLightAndDarkModes = (col: any) => {
          let lightMode = col.modes.find((m: any) => m.id === "light" || m.name.toLowerCase() === "light");
          let darkMode = col.modes.find((m: any) => m.id !== lightMode?.id && (m.id === "dark" || m.name.toLowerCase() === "dark"));
          const defaultModeObj = col.modes.find((m: any) => m.id === col.defaultMode) ?? col.modes[0];
          if (!lightMode && !darkMode) {
            lightMode = defaultModeObj;
          } else if (!lightMode && darkMode) {
            if (defaultModeObj.id !== darkMode.id) {
              lightMode = defaultModeObj;
            } else {
              const id = col.modes.some((m: any) => m.id === "light") ? `light-${randomUUID().slice(0, 6)}` : "light";
              lightMode = { id, name: "Light" };
              col.modes.push(lightMode);
              for (const existingTok of props.tokens) {
                if (existingTok.collection === col.id && !Object.hasOwn(existingTok.values, lightMode.id) && Object.hasOwn(existingTok.values, col.defaultMode)) {
                  existingTok.values[lightMode.id] = existingTok.values[col.defaultMode];
                }
              }
            }
          }
          if (!darkMode) {
            const id = col.modes.some((m: any) => m.id === "dark") ? `dark-${randomUUID().slice(0, 6)}` : "dark";
            darkMode = { id, name: "Dark" };
            col.modes.push(darkMode);
            for (const existingTok of props.tokens) {
              if (existingTok.collection === col.id && !Object.hasOwn(existingTok.values, darkMode.id) && Object.hasOwn(existingTok.values, col.defaultMode)) {
                existingTok.values[darkMode.id] = existingTok.values[col.defaultMode];
              }
            }
          }
          return { lightModeId: lightMode.id, darkModeId: darkMode.id };
        };

        for (const tok of dir.tokens) {
          const existing = props.tokens.find((t: any) => t.name === tok.name);
          const targetCollection = existing
            ? (props.collections.find((c: any) => c.id === existing.collection) ?? primaryCollection)
            : primaryCollection;
          const { lightModeId, darkModeId } = ensureLightAndDarkModes(targetCollection);
          if (existing) {
            existing.type = tok.type;
            existing.values = { ...existing.values, [lightModeId]: tok.light, [darkModeId]: tok.dark };
            existing.description = tok.description;
          } else {
            const values: Record<string, string> = {};
            for (const mode of targetCollection.modes) {
              values[mode.id] = mode.id === darkModeId ? tok.dark : tok.light;
            }
            props.tokens.push({ name: tok.name, type: tok.type, collection: targetCollection.id, values, description: tok.description });
          }
          seededTokens += 1;
        }
      }

      const dsProb = designSystemProblem(props);
      if (dsProb !== null) throw new ToolError(`design system rejected brief update: ${dsProb}`);
      const dsId = system?.id ?? `design-system-${randomUUID().slice(0, 12)}`;
      const operations = system === null
        ? [{ type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: dsId, type: "design-system", props } }]
        : [{ type: "set-props", nodeId: system.id, set: { collections: props.collections, tokens: props.tokens, brief: props.brief } }];
      return {
        designSystemId: dsId,
        brief: props.brief,
        seededTokens,
        ...(edit(operations, `Set design brief for ${args.productName}`) as object),
      } as Json;
    },
  },
  {
    name: "apply_motion",
    title: "Apply reduced-motion-safe motion presets",
    description: "Attach one or more Ninerr motion presets (hover, focus, press, enter, exit, modal, drawer, toast, stagger, scroll, skeleton, number-transition, spring) with mandatory prefers-reduced-motion CSS to a layer's stylesheet and register motion tokens on the design system in one undoable change.",
    inputSchema: object({
      nodeId: { type: "string", minLength: 1, maxLength: 128 },
      presetIds: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", enum: [...MOTION_PRESET_IDS] } },
      selector: { type: "string", minLength: 1, maxLength: 120 },
      reducedMotion: { type: "string", enum: ["respect", "minimal"] },
      addMotionTokens: { type: "boolean" },
    }, ["nodeId", "presetIds"]),
    run: ({ session, edit }, args) => {
      const node = nodeOf(session, args.nodeId);
      if (node.type === "design-system" || node.type === "component-instance" || isCodePart(node)) {
        throw new ToolError(`cannot apply motion stylesheet directly to ${isCodePart(node) ? "code expression" : node.type} ${node.id}`);
      }
      if (!Array.isArray(args.presetIds) || args.presetIds.length === 0 || args.presetIds.length > 8) {
        throw new ToolError("presetIds must contain 1 to 8 motion preset ids");
      }
      const selector = typeof args.selector === "string" && args.selector.trim() !== ""
        ? args.selector.trim()
        : ":scope";
      const reducedMotion = args.reducedMotion ?? "respect";
      if (reducedMotion !== "respect" && reducedMotion !== "minimal") {
        throw new ToolError("reducedMotion must be \"respect\" or \"minimal\"");
      }
      let compiled;
      try {
        compiled = compileMotionStylesheet({ presetIds: args.presetIds, selector, reducedMotion });
      } catch (error) {
        throw new ToolError(shownPlainly(error instanceof Error ? error.message : String(error)));
      }

      const startMark = "/* ninerr-motion:start */";
      const endMark = "/* ninerr-motion:end */";
      const existingSheet = typeof node.props?.stylesheet === "string" ? node.props.stylesheet : "";
      const stripped = existingSheet.replace(/\/\*\s*ninerr-motion:start\s*\*\/[\s\S]*?\/\*\s*ninerr-motion:end\s*\*\//gu, "").trim();
      const nextSheet = `${stripped === "" ? "" : `${stripped}\n\n`}${startMark}\n${compiled.css}\n${endMark}`;
      if (Buffer.byteLength(nextSheet, "utf8") > 512 * 1024) {
        throw new ToolError("combined node stylesheet exceeds 512 KiB budget");
      }
      const planned = planElement({ id: node.id, type: node.type, props: { stylesheet: nextSheet } } as any);
      if (planned.stylesheet === null || planned.dropped > 0) {
        throw new ToolError("motion stylesheet was rejected by the renderer sanitizer, so nothing was changed");
      }

      const operations: unknown[] = [{ type: "set-props", nodeId: node.id, set: { stylesheet: nextSheet } }];
      const document = session.document as any;
      let addedTokens = 0;

      if (args.addMotionTokens !== false) {
        const system = designSystemOf(document);
        const props = system === null ? newDesignSystemProps() : structuredClone(system.props);
        const collection = props.collections[0];
        for (const tok of MOTION_TOKENS) {
          if (props.tokens.some((existing: any) => existing.name === tok.name)) continue;
          const values: Record<string, string> = {};
          for (const mode of collection.modes) values[mode.id] = tok.value;
          props.tokens.push({ name: tok.name, type: tok.type, collection: collection.id, values, description: tok.description });
          addedTokens += 1;
        }
        const prevMotion = props.motion && typeof props.motion === "object" ? props.motion : null;
        const mergedPresets = new Map<string, any>();
        if (Array.isArray(prevMotion?.presets)) {
          for (const existingPreset of prevMotion.presets) {
            if (existingPreset && typeof existingPreset.id === "string") mergedPresets.set(existingPreset.id, existingPreset);
          }
        }
        for (const p of compiled.presets) {
          mergedPresets.set(p.id, {
            id: p.id,
            trigger: p.trigger,
            duration: p.duration,
            easing: p.easing,
            properties: [...p.properties],
            maxFrequency: p.maxFrequency,
          });
        }
        props.motion = {
          reducedMotion,
          defaultDuration: typeof prevMotion?.defaultDuration === "string" ? prevMotion.defaultDuration : "220ms",
          defaultEasing: typeof prevMotion?.defaultEasing === "string" ? prevMotion.defaultEasing : "cubic-bezier(0.23, 1, 0.32, 1)",
          allowAmbient: prevMotion?.allowAmbient === true,
          presets: [...mergedPresets.values()],
        };
        const dsProb = designSystemProblem(props);
        if (dsProb !== null) throw new ToolError(`design system rejected motion tokens: ${dsProb}`);
        if (system === null) {
          operations.push({ type: "insert-node", parentId: null, index: document.rootIds.length, node: { id: `design-system-${randomUUID().slice(0, 12)}`, type: "design-system", props } });
        } else {
          operations.push({ type: "set-props", nodeId: system.id, set: { tokens: props.tokens, motion: props.motion } });
        }
      }

      return {
        nodeId: node.id,
        selector: compiled.selector,
        presetIds: compiled.presetIds,
        addedTokens,
        ...(edit(operations, `Apply motion presets (${compiled.presetIds.join(", ")})`) as object),
      } as Json;
    },
  },
  {
    name: "instantiate_component",
    title: "Instantiate native Ninerr component",
    description: "Instantiate any of Ninerr's 41 native editable, token-bound, WCAG-AA components into the open project in one atomic undoable change, either as editable layers or as a reusable component-definition (and optional live instance inside parentId).",
    inputSchema: object({
      componentId: { type: "string", minLength: 1, maxLength: 64 },
      parentId: { type: "string", minLength: 1, maxLength: 128 },
      index: { type: "integer", minimum: 0, maximum: 100000 },
      asDefinition: { type: "boolean" },
      variant: { type: "string", maxLength: 32 },
      label: { type: "string", maxLength: 120 },
      title: { type: "string", maxLength: 160 },
      body: { type: "string", maxLength: 600 },
      headline: { type: "string", maxLength: 200 },
      subcopy: { type: "string", maxLength: 600 },
      placeholder: { type: "string", maxLength: 160 },
      helper: { type: "string", maxLength: 240 },
      cta: { type: "string", maxLength: 80 },
      brand: { type: "string", maxLength: 80 },
      product: { type: "string", maxLength: 120 },
      value: { type: "string", maxLength: 80 },
      delta: { type: "string", maxLength: 80 },
      description: { type: "string", maxLength: 400 },
      message: { type: "string", maxLength: 400 },
      legend: { type: "string", maxLength: 120 },
      initials: { type: "string", maxLength: 8 },
      count: { type: "string", maxLength: 24 },
    }, ["componentId"]),
    run: ({ session, edit }, given) => {
      const OPTION_LIMITS: Readonly<Record<string, { max: number; multiline?: boolean }>> = {
        variant: { max: 32 },
        label: { max: 120 },
        title: { max: 160 },
        body: { max: 600, multiline: true },
        headline: { max: 200 },
        subcopy: { max: 600, multiline: true },
        placeholder: { max: 160 },
        helper: { max: 240 },
        cta: { max: 80 },
        brand: { max: 80 },
        product: { max: 120 },
        value: { max: 80 },
        delta: { max: 80 },
        description: { max: 400, multiline: true },
        message: { max: 400, multiline: true },
        legend: { max: 120 },
        initials: { max: 8 },
        count: { max: 24 },
      };
      const args = onlyArguments(given, ["componentId", "parentId", "index", "asDefinition", ...Object.keys(OPTION_LIMITS)]);
      const rawId = typeof args.componentId === "string" ? args.componentId.trim() : "";
      const componentId = rawId.startsWith("ninerr:") ? rawId.slice(7) : rawId;
      const meta = getNinerrComponent(componentId);
      if (!meta) {
        throw new ToolError(`unknown native Ninerr component ${JSON.stringify(shownPlainly(rawId.slice(0, 64)))}; call search_components({ source: "ninerr" }) to list available ids`);
      }

      if (args.asDefinition !== undefined && typeof args.asDefinition !== "boolean") {
        throw new ToolError("asDefinition must be a boolean");
      }

      const options: Record<string, string> = {};
      for (const [key, spec] of Object.entries(OPTION_LIMITS)) {
        if (args[key] === undefined) continue;
        if (typeof args[key] !== "string") throw new ToolError(`${key} must be a string`);
        const val = args[key] as string;
        if (val.length > spec.max) throw new ToolError(`${key} exceeds maximum length of ${spec.max} characters`);
        const visible = val.replace(JOINERS, "");
        const body = spec.multiline ? visible.replace(LINE_BREAKS, "") : visible;
        if (!val.isWellFormed() || HIDDEN_TEXT.test(body) || SELECTOR_SMUGGLING.test(val)) {
          throw new ToolError(`${key} holds hidden or reordering characters, so nothing was changed`);
        }
        if (key === "variant" && !meta.variants.includes(val)) {
          throw new ToolError(`invalid variant ${JSON.stringify(shownPlainly(val))} for ${meta.id}; valid variants: ${meta.variants.join(", ")}`);
        }
        options[key] = val;
      }

      const document = session.document as any;
      let targetParentId: string | null = null;
      let targetSiblings: string[] = document.rootIds;
      if (args.parentId !== undefined) {
        const parent = nodeOf(session, args.parentId);
        if (parent.type === "design-system" || parent.type === "component-instance" || parent.type === "text" || isCodePart(parent)) {
          throw new ToolError(`cannot instantiate a component inside ${isCodePart(parent) ? "code expression" : parent.type} ${parent.id}`);
        }
        targetParentId = parent.id;
        targetSiblings = parent.children;
      }
      let targetIndex = targetSiblings.length;
      if (args.index !== undefined) {
        if (!Number.isInteger(args.index) || (args.index as number) < 0 || (args.index as number) > targetSiblings.length) {
          throw new ToolError(`index must be a whole number from 0 to ${targetSiblings.length}`);
        }
        targetIndex = args.index as number;
      }

      const asDefinition = args.asDefinition === true;
      let idPrefix = `cmp-${meta.id}-${randomUUID().slice(0, 8)}`;
      while (Object.hasOwn(document.nodes, `${idPrefix}-def`) || Object.hasOwn(document.nodes, `${idPrefix}-1`)) {
        idPrefix = `cmp-${meta.id}-${randomUUID().slice(0, 8)}`;
      }

      const built = buildComponentOperations(meta.id, {
        parentId: asDefinition ? null : targetParentId,
        insertIndex: asDefinition ? (targetParentId === null ? targetIndex : document.rootIds.length) : targetIndex,
        idPrefix,
        asDefinition,
        options,
      });

      for (const op of built.operations as any[]) {
        if (op.type !== "insert-node" || op.node.type === "component-definition") continue;
        const planned = planElement(op.node);
        if (planned.dropped > 0) {
          throw new ToolError(`component ${meta.id} failed renderer sanitization (${planned.dropped} dropped), so nothing was changed`);
        }
      }

      const operations: unknown[] = [...built.operations];
      let instanceId: string | null = null;
      if (asDefinition && targetParentId !== null && built.definitionId !== null) {
        instanceId = `${idPrefix}-inst`;
        operations.push({
          type: "insert-node",
          parentId: targetParentId,
          index: targetIndex,
          node: {
            id: instanceId,
            type: "component-instance",
            props: { componentId: built.definitionId, propertyValues: {}, overrides: [] },
          },
        });
      }

      return {
        componentId: `ninerr:${built.componentId}`,
        componentName: built.componentName,
        category: built.category,
        definitionId: built.definitionId,
        rootNodeId: built.rootNodeId,
        instanceId,
        nodeCount: built.nodeCount,
        ...(edit(operations, `Instantiate ${built.componentName}`) as object),
      } as Json;
    },
  },
  {
    name: "audit_design_system",
    title: "Audit design system health",
    description: "Read-only deterministic audit of the project's design system: unused tokens, duplicate literal values, missing mode values, hardcoded layer style values matching existing tokens, and cross-mode WCAG contrast compliance.",
    inputSchema: object({}),
    run: ({ session }, given) => {
      onlyArguments(given, []);
      return auditDesignSystem(session.document as any) as unknown as Json;
    },
  },
  {
    name: "migrate_theme",
    title: "Migrate theme, generate high-contrast mode, or set breakpoints",
    description: "Atomically update or seed semantic design tokens across light and dark modes (action: \"migrate\"), generate a WCAG AAA high-contrast mode (action: \"generate_high_contrast\"), or store responsive breakpoints and optional scoped @media/@container rules (action: \"set_breakpoints\"). Supports dryRun for safe preview.",
    inputSchema: object({
      action: { type: "string", enum: ["migrate", "generate_high_contrast", "set_breakpoints"] },
      themeName: { type: "string", minLength: 1, maxLength: 120 },
      collectionId: { type: "string", minLength: 1, maxLength: 128 },
      tokens: {
        type: "array",
        minItems: 1,
        maxItems: 500,
        items: object({
          name: { type: "string", minLength: 3, maxLength: 128 },
          type: { type: "string", enum: [...TOKEN_TYPES] },
          light: { type: "string", minLength: 1, maxLength: 400 },
          dark: { type: "string", minLength: 1, maxLength: 400 },
          value: { type: "string", minLength: 1, maxLength: 400 },
          description: { type: "string", maxLength: 500 },
        }, ["name"]),
      },
      breakpoints: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: object({
          id: { type: "string", minLength: 1, maxLength: 64 },
          name: { type: "string", minLength: 1, maxLength: 80 },
          minWidth: { type: "integer", minimum: 0, maximum: 10000 },
          maxWidth: { type: "integer", minimum: 0, maximum: 10000 },
        }, ["id", "name"]),
      },
      nodeId: { type: "string", minLength: 1, maxLength: 128 },
      rulesByBreakpoint: { type: "object", additionalProperties: { type: "string", maxLength: 64000 } },
      useContainer: { type: "boolean" },
    }),
    run: ({ session, edit, dryRun }, given) => {
      const args = onlyArguments(given, ["action", "themeName", "collectionId", "tokens", "breakpoints", "nodeId", "rulesByBreakpoint", "useContainer"]);
      const action = args.action ?? "migrate";
      const checkSafeString = (field: string, value: unknown, maxLen: number) => {
        if (value === undefined) return;
        if (typeof value !== "string" || value.trim() === "" || value.length > maxLen) {
          throw new ToolError(`${field} must be a non-empty string of at most ${maxLen} characters`);
        }
        const body = value.replace(JOINERS, "");
        if (!value.isWellFormed() || HIDDEN_TEXT.test(body) || SELECTOR_SMUGGLING.test(value)) {
          throw new ToolError(`${field} holds hidden or reordering characters, so nothing was changed`);
        }
      };
      checkSafeString("themeName", args.themeName, 120);
      checkSafeString("collectionId", args.collectionId, 128);

      const document = session.document as any;
      if (action === "generate_high_contrast") {
        let planned;
        try {
          planned = generateHighContrastMode(document, {
            ...(typeof args.collectionId === "string" ? { collectionId: args.collectionId } : {}),
          });
        } catch (error) {
          throw new ToolError(shownPlainly(error instanceof Error ? error.message : String(error)));
        }
        return {
          action,
          collectionId: planned.collectionId,
          modeId: planned.modeId,
          ...(edit(planned.operations, `Generate high-contrast mode for ${planned.collectionId}`) as object),
        } as Json;
      }

      if (action === "set_breakpoints") {
        if (!Array.isArray(args.breakpoints) || args.breakpoints.length === 0) {
          throw new ToolError("set_breakpoints requires a non-empty breakpoints array");
        }
        if ((args.nodeId !== undefined) !== (args.rulesByBreakpoint !== undefined)) {
          throw new ToolError("set_breakpoints requires both nodeId and rulesByBreakpoint together when attaching responsive CSS");
        }
        const system = designSystemOf(document);
        let operations: unknown[];
        if (system === null) {
          const props = newDesignSystemProps();
          props.breakpoints = args.breakpoints;
          const dsProb = designSystemProblem(props);
          if (dsProb !== null) throw new ToolError(`design system rejected breakpoints: ${dsProb}`);
          operations = [{
            type: "insert-node",
            parentId: null,
            index: document.rootIds.length,
            node: { id: `design-system-${randomUUID().slice(0, 12)}`, type: "design-system", props },
          }];
        } else {
          operations = tokenOperation(() => setBreakpoints(document, args.breakpoints));
        }

        let compiledCss: string | null = null;
        if (args.nodeId !== undefined && args.rulesByBreakpoint !== undefined) {
          if (typeof args.rulesByBreakpoint !== "object" || args.rulesByBreakpoint === null || Array.isArray(args.rulesByBreakpoint)) {
            throw new ToolError("rulesByBreakpoint must be a plain object mapping breakpoint ids to CSS strings");
          }
          for (const [bpKey, cssText] of Object.entries(args.rulesByBreakpoint as Record<string, unknown>)) {
            if (typeof cssText !== "string") throw new ToolError(`rulesByBreakpoint[${JSON.stringify(shownPlainly(bpKey.slice(0, 40)))}] must be a string`);
            if (cssText.length > 64_000) throw new ToolError(`rulesByBreakpoint[${JSON.stringify(shownPlainly(bpKey.slice(0, 40)))}] exceeds 64000 characters`);
          }
          const node = nodeOf(session, args.nodeId);
          if (node.type === "design-system" || node.type === "component-instance" || isCodePart(node)) {
            throw new ToolError(`cannot attach responsive stylesheet directly to ${isCodePart(node) ? "code expression" : node.type} ${node.id}`);
          }
          try {
            compiledCss = compileBreakpointsStylesheet(
              args.breakpoints as any,
              args.rulesByBreakpoint as Record<string, string>,
              { useContainer: args.useContainer === true },
            );
          } catch (error) {
            throw new ToolError(shownPlainly(error instanceof Error ? error.message : String(error)));
          }
          const startMark = "/* ninerr-breakpoints:start */";
          const endMark = "/* ninerr-breakpoints:end */";
          const existingSheet = typeof node.props?.stylesheet === "string" ? node.props.stylesheet : "";
          const stripped = existingSheet.replace(/\/\*\s*ninerr-breakpoints:start\s*\*\/[\s\S]*?\/\*\s*ninerr-breakpoints:end\s*\*\//gu, "").trim();
          const nextSheet = compiledCss === ""
            ? stripped
            : `${stripped === "" ? "" : `${stripped}\n\n`}${startMark}\n${compiledCss}\n${endMark}`;
          if (nextSheet !== existingSheet) {
            if (Buffer.byteLength(nextSheet, "utf8") > 512 * 1024) {
              throw new ToolError("combined node stylesheet exceeds 512 KiB budget");
            }
            if (nextSheet !== "") {
              const plannedNode = planElement({ id: node.id, type: node.type, props: { stylesheet: nextSheet } } as any);
              if (plannedNode.stylesheet === null || plannedNode.dropped > 0) {
                throw new ToolError("responsive stylesheet was rejected by the renderer sanitizer, so nothing was changed");
              }
            }
            operations = [...operations, { type: "set-props", nodeId: node.id, set: { stylesheet: nextSheet } }];
          }
        }

        return {
          action,
          breakpointCount: args.breakpoints.length,
          compiledCss,
          ...(edit(operations, "Set responsive breakpoints") as object),
        } as Json;
      }

      if (action === "migrate") {
        if (!Array.isArray(args.tokens) || args.tokens.length === 0) {
          throw new ToolError("migrate action requires a non-empty tokens array");
        }
        let planned;
        try {
          planned = planThemeMigration(document, {
            tokens: args.tokens as any,
            ...(typeof args.themeName === "string" ? { themeName: args.themeName } : {}),
            ...(typeof args.collectionId === "string" ? { collectionId: args.collectionId } : {}),
          });
        } catch (error) {
          throw new ToolError(shownPlainly(error instanceof Error ? error.message : String(error)));
        }
        if (planned.operations.length === 0) {
          return {
            action,
            themeName: planned.themeName,
            collectionId: planned.collectionId,
            updated: planned.updated,
            added: planned.added,
            unchanged: planned.unchanged,
            ...(dryRun ? { dryRun: true, wouldChange: [], operations: 0 } : {}),
            revision: session.revision,
          } as unknown as Json;
        }
        return {
          action,
          themeName: planned.themeName,
          collectionId: planned.collectionId,
          updated: planned.updated,
          added: planned.added,
          unchanged: planned.unchanged,
          ...(edit(planned.operations, `Migrate theme (${planned.themeName})`) as object),
        } as unknown as Json;
      }

      throw new ToolError(`unsupported migrate_theme action ${JSON.stringify(shownPlainly(String(action).slice(0, 64)))}`);
    },
  },
  {
    name: "render_preview",
    title: "Render multi-viewport visual preview",
    description: "Render a layer in a local 3-layer zero-egress Chromium/Edge browser across responsive viewports (mobile, tablet, desktop, etc.), writing PNG screenshots to the project's exports/previews folder, returning real computed DOM contrast/overflow/clipping/target telemetry, and optionally pixel-diffing against a prior preview.",
    inputSchema: object({
      nodeId: { type: "string", minLength: 1, maxLength: 128 },
      name: { type: "string", minLength: 1, maxLength: 64 },
      viewports: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", enum: Object.keys(STANDARD_VIEWPORTS) } },
      colorScheme: { type: "string", enum: ["light", "dark"] },
      reducedMotion: { type: "string", enum: ["no-preference", "reduce"] },
      mode: { type: "string", minLength: 1, maxLength: 129 },
      compareTo: { type: "string", minLength: 1, maxLength: 64 },
      replace: { type: "boolean" },
    }, ["nodeId"]),
    run: async ({ session, dryRun }, given) => {
      const lstatOrNull = (targetPath: string) => {
        try {
          return lstatSync(targetPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
          throw error;
        }
      };
      const args = onlyArguments(given, ["nodeId", "name", "viewports", "colorScheme", "reducedMotion", "mode", "compareTo", "replace"]);
      const node = nodeOf(session, args.nodeId);
      if (node.type === "design-system") throw new ToolError("cannot render a design-system node; choose a frame or element");

      const baseName = typeof args.name === "string" && args.name !== "" ? args.name : "preview";
      if (!EXPORT_NAME.test(baseName)) {
        throw new ToolError("name must be 1-64 letters, digits, dashes or underscores, starting with a letter or digit");
      }
      if (args.compareTo !== undefined && (typeof args.compareTo !== "string" || !EXPORT_NAME.test(args.compareTo))) {
        throw new ToolError("compareTo must be a valid preview name (1-64 letters, digits, dashes or underscores)");
      }
      if (args.replace !== undefined && typeof args.replace !== "boolean") {
        throw new ToolError("replace must be a boolean");
      }
      const validViewports = Object.keys(STANDARD_VIEWPORTS);
      const requestedViewports = args.viewports === undefined ? ["mobile", "desktop"] : args.viewports;
      if (!Array.isArray(requestedViewports) || requestedViewports.length === 0 || requestedViewports.length > 5) {
        throw new ToolError("viewports must contain 1 to 5 standard viewport ids");
      }
      const viewports: string[] = [];
      for (const vp of requestedViewports) {
        if (typeof vp !== "string" || !validViewports.includes(vp)) {
          throw new ToolError(`unknown viewport ${JSON.stringify(shownPlainly(String(vp).slice(0, 40)))}; valid: ${validViewports.join(", ")}`);
        }
        if (!viewports.includes(vp)) viewports.push(vp);
      }
      if (args.colorScheme !== undefined && args.colorScheme !== "light" && args.colorScheme !== "dark") {
        throw new ToolError("colorScheme must be \"light\" or \"dark\"");
      }
      if (args.reducedMotion !== undefined && args.reducedMotion !== "no-preference" && args.reducedMotion !== "reduce") {
        throw new ToolError("reducedMotion must be \"no-preference\" or \"reduce\"");
      }
      const colorScheme = args.colorScheme === "dark" ? "dark" : "light";
      const reducedMotion = args.reducedMotion === "reduce" ? "reduce" : "no-preference";
      let modeOverride: string | undefined;
      if (args.mode !== undefined) {
        if (typeof args.mode !== "string" || args.mode.length > 129 || !/^[A-Za-z0-9_.-]{1,64}(?::[A-Za-z0-9_.-]{1,64})?$/u.test(args.mode)) {
          throw new ToolError("mode must be a mode id or collection:mode token identifier");
        }
        if (args.mode.includes(":")) {
          modeOverride = args.mode;
        } else {
          const ds = designSystemOf(session.document as any);
          const collections: any[] = ds?.props?.collections ?? [];
          const owning = collections.find((c: any) => Array.isArray(c.modes) && c.modes.some((m: any) => m.id === args.mode));
          const colId = owning?.id ?? collections[0]?.id ?? "base";
          modeOverride = `${colId}:${args.mode}`;
        }
      }

      const realRoot = realpathSync(session.root);
      const exportsDir = join(session.root, "exports");
      const previewsDir = join(exportsDir, "previews");
      for (const dir of [exportsDir, previewsDir]) {
        const st = lstatOrNull(dir);
        if (st !== null && (st.isSymbolicLink() || !st.isDirectory())) {
          throw new ToolError("the project's exports/previews folder is a link to somewhere else, so nothing was written");
        }
      }
      const existingLower = new Set<string>();
      const previewsStatBefore = lstatOrNull(previewsDir);
      if (previewsStatBefore !== null) {
        if (realpathSync(previewsDir) !== join(realRoot, "exports", "previews")) {
          throw new ToolError("the project's exports/previews folder resolves outside the project, so nothing was written");
        }
        for (const entry of readdirSync(previewsDir)) existingLower.add(entry.toLowerCase());
      }

      const plannedPaths = viewports.map((vp) => join(previewsDir, `${baseName}-${vp}.png`));
      const plannedDiffPaths: string[] = [];
      if (typeof args.compareTo === "string") {
        for (const vp of viewports) {
          if (existingLower.has(`${args.compareTo}-${vp}.png`.toLowerCase())) {
            plannedDiffPaths.push(join(previewsDir, `${baseName}-${vp}-diff.png`));
          }
        }
      }
      for (const p of [...plannedPaths, ...plannedDiffPaths]) {
        const st = lstatOrNull(p);
        if (st !== null && (st.isSymbolicLink() || !st.isFile())) {
          throw new ToolError(`refusing to overwrite non-regular file or link ${p}`);
        }
        const fileNameLower = p.slice(previewsDir.length + 1).toLowerCase();
        if ((st !== null || existingLower.has(fileNameLower)) && args.replace !== true) {
          throw new ToolError(`preview ${p} already exists; choose another name or pass replace: true`);
        }
      }

      let browserPath: string | null = null;
      let browserError: string | null = null;
      try {
        browserPath = discoverBrowser();
      } catch (error) {
        browserError = error instanceof Error ? error.message : String(error);
      }
      if (dryRun) {
        return {
          dryRun: true,
          nodeId: node.id,
          viewports,
          wouldWrite: [...plannedPaths, ...plannedDiffPaths],
          browserAvailable: browserPath !== null,
          ...(browserError ? { browserNote: shownPlainly(browserError) } : {}),
          revision: session.revision,
        } as unknown as Json;
      }
      if (!browserPath) {
        throw new ToolError(shownPlainly(browserError ?? "No local Chromium, Chrome, or Edge browser was found. Install Edge/Chrome/Chromium or set NINERR_BROWSER."));
      }

      const { html } = exportHtml(session.document, node.id, { includeNodeIds: true, ...(modeOverride ? { modeOverride } : {}) });
      let rendered;
      try {
        rendered = await renderAndInspect({
          html,
          viewports,
          colorScheme,
          contrast: modeOverride?.includes("high-contrast") ? "more" : "no-preference",
          reducedMotion,
          captureScreenshot: true,
          fullPage: true,
          browserPath,
        });
      } catch (error) {
        throw new ToolError(shownPlainly(error instanceof Error ? error.message : String(error)));
      }

      // Ensure session is still open before writing anything to disk.
      const revisionNow = session.revision;

      // Re-verify exports/ and exports/previews/ after async render to close TOCTOU / symlink escape.
      mkdirSync(exportsDir, { recursive: true, mode: 0o700 });
      mkdirSync(previewsDir, { recursive: true, mode: 0o700 });
      for (const dir of [exportsDir, previewsDir]) {
        const st = lstatOrNull(dir);
        if (!st || st.isSymbolicLink() || !st.isDirectory()) {
          throw new ToolError("the project's exports/previews folder is a link to somewhere else, so nothing was written");
        }
      }
      const realPreviewsDir = realpathSync(previewsDir);
      if (realPreviewsDir !== join(realpathSync(session.root), "exports", "previews")) {
        throw new ToolError("the project's exports/previews folder resolves outside the project, so nothing was written");
      }

      // Read any requested baseline PNGs BEFORE overwriting outPath (handles compareTo === baseName + replace: true).
      const baselinesByVp = new Map<string, { path: string; bytes: Buffer }>();
      if (typeof args.compareTo === "string") {
        for (const cap of rendered.captures) {
          const vpId = cap.viewport.id;
          const baselinePath = join(realPreviewsDir, `${args.compareTo}-${vpId}.png`);
          try {
            const baselineBytes = readTrustedFile(baselinePath, 32 * 1024 * 1024);
            if (baselineBytes !== null) baselinesByVp.set(vpId, { path: baselinePath, bytes: baselineBytes });
          } catch (error) {
            if (error instanceof UntrustedFileError) {
              throw new ToolError(`baseline preview ${baselinePath} is not trusted: ${shownPlainly(error.message)}`);
            }
            throw new ToolError(shownPlainly(error instanceof Error ? error.message : String(error)));
          }
        }
      }

      const results = [];
      for (const cap of rendered.captures) {
        const vpId = cap.viewport.id;
        const outPath = join(realPreviewsDir, `${baseName}-${vpId}.png`);
        const outStat = lstatOrNull(outPath);
        if (outStat !== null && (outStat.isSymbolicLink() || !outStat.isFile())) {
          throw new ToolError(`refusing to write through non-regular file or symbolic link ${outPath}`);
        }
        writeTrustedBytes(outPath, cap.pngBuffer);

        let diffSummary: Record<string, unknown> | null = null;
        const baseline = baselinesByVp.get(vpId);
        if (baseline) {
          let diff;
          try {
            diff = diffPngBuffers(baseline.bytes, cap.pngBuffer, { emitDiffImage: true });
          } catch (error) {
            throw new ToolError(shownPlainly(error instanceof Error ? error.message : String(error)));
          }
          let diffPath: string | null = null;
          if (diff.diffPng) {
            diffPath = join(realPreviewsDir, `${baseName}-${vpId}-diff.png`);
            const diffStat = lstatOrNull(diffPath);
            if (diffStat !== null && (diffStat.isSymbolicLink() || !diffStat.isFile())) {
              throw new ToolError(`refusing to write through non-regular file or symbolic link ${diffPath}`);
            }
            writeTrustedBytes(diffPath, diff.diffPng);
          }
          diffSummary = {
            baselinePath: baseline.path,
            diffPath,
            diffPixels: diff.diffPixels,
            totalPixels: diff.totalPixels,
            diffPercent: diff.diffPercent,
            dimensionMismatch: diff.dimensionMismatch,
            changedRegion: diff.changedRegion,
          };
        }

        results.push({
          viewport: cap.viewport,
          path: outPath,
          bytes: cap.bytes,
          telemetry: cap.telemetry,
          ...(diffSummary ? { diff: diffSummary } : {}),
        });
      }

      return {
        nodeId: node.id,
        emulation: rendered.emulation,
        egressBlocked: rendered.egress.totalBlocked,
        captures: results,
        revision: revisionNow,
      } as unknown as Json;
    },
  },
  {
    name: "critique_design",
    title: "Unified Ninerr Critic",
    description: "Read-only unified design critique combining static WCAG accessibility, brief-aware Ninerr Taste and Motion rules, Design System health audit, and optional real-browser Vision telemetry (overflow, clipping, computed contrast, overlap, touch targets) strictly classified into deterministic defects, heuristic observations, and subjective suggestions.",
    inputSchema: object({
      nodeId: { type: "string", minLength: 1, maxLength: 128 },
      includeVision: { type: "boolean" },
      viewports: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", enum: Object.keys(STANDARD_VIEWPORTS) } },
      colorScheme: { type: "string", enum: ["light", "dark"] },
    }),
    run: async ({ session }, given) => {
      const args = onlyArguments(given, ["nodeId", "includeVision", "viewports", "colorScheme"]);
      const rootId = args.nodeId === undefined ? null : nodeOf(session, args.nodeId).id;
      if (args.includeVision !== undefined && typeof args.includeVision !== "boolean") {
        throw new ToolError("includeVision must be a boolean");
      }
      if (args.colorScheme !== undefined && args.colorScheme !== "light" && args.colorScheme !== "dark") {
        throw new ToolError("colorScheme must be \"light\" or \"dark\"");
      }
      const validViewports = Object.keys(STANDARD_VIEWPORTS);
      const requestedViewports = args.viewports === undefined ? ["mobile", "desktop"] : args.viewports;
      if (!Array.isArray(requestedViewports) || requestedViewports.length === 0 || requestedViewports.length > 3) {
        throw new ToolError("viewports must contain 1 to 3 standard viewport ids");
      }
      const viewports: string[] = [];
      for (const vp of requestedViewports) {
        if (typeof vp !== "string" || !validViewports.includes(vp)) {
          throw new ToolError(`unknown viewport ${JSON.stringify(shownPlainly(String(vp).slice(0, 40)))}`);
        }
        if (!viewports.includes(vp)) viewports.push(vp);
      }

      const document = session.document as any;
      const taste = evaluateTaste(document, { rootId });
      const systemAudit = auditDesignSystem(document);
      let visionCaptures: any[] = [];
      let visionUsed = false;
      let visionNote: string | null = null;

      if (args.includeVision === true) {
        const targetId = rootId ?? (document.rootIds ?? []).find((id: string) => document.nodes[id]?.type !== "design-system") ?? null;
        if (!targetId) {
          visionNote = "No renderable frame or element found in the document.";
        } else {
          let browserPath: string | null = null;
          let browserErr: string | null = null;
          try {
            browserPath = discoverBrowser();
          } catch (error) {
            browserErr = error instanceof Error ? error.message : String(error);
          }
          if (!browserPath) {
            visionNote = browserErr
              ? `${shownPlainly(browserErr)}; static critique returned without live browser telemetry.`
              : "No local Chromium/Chrome/Edge browser found; static critique returned without live browser telemetry.";
          } else {
            const { html } = exportHtml(document, targetId, { includeNodeIds: true });
            try {
              const rendered = await renderAndInspect({
                html,
                viewports,
                colorScheme: args.colorScheme === "dark" ? "dark" : "light",
                captureScreenshot: false,
                browserPath,
              });
              visionCaptures = rendered.captures;
              visionUsed = true;
            } catch (error) {
              throw new ToolError(shownPlainly(error instanceof Error ? error.message : String(error)));
            }
          }
        }
      }

      const report = buildCritiqueReport({
        document,
        rootId,
        tasteFindings: taste.findings,
        systemFindings: systemAudit.hasDesignSystem ? systemAudit.findings : [],
        visionCaptures,
      });

      return {
        nodeId: rootId,
        visionUsed,
        ...(visionNote ? { visionNote } : {}),
        ...report,
      } as unknown as Json;
    },
  },
  {
    name: "improve_design",
    title: "Bounded iterative design improvement",
    description: "Run bounded in-memory non-regressing deterministic repairs (contrast, touch targets, overflow, spacing grid, line-height, heavy shadows, GPU-safe motion, reduced-motion, missing alt) across up to 5 passes and commit at most one collapsed atomic undoable transaction. Supports dryRun preview.",
    inputSchema: object({
      nodeId: { type: "string", minLength: 1, maxLength: 128 },
      maxIterations: { type: "integer", minimum: 1, maximum: 5 },
      includeVision: { type: "boolean" },
      viewports: { type: "array", minItems: 1, maxItems: 2, items: { type: "string", enum: Object.keys(STANDARD_VIEWPORTS) } },
    }),
    run: async ({ session, edit, dryRun }, given) => {
      const args = onlyArguments(given, ["nodeId", "maxIterations", "includeVision", "viewports"]);
      const rootId = args.nodeId === undefined ? null : nodeOf(session, args.nodeId).id;
      if (args.maxIterations !== undefined && (!Number.isInteger(args.maxIterations) || (args.maxIterations as number) < 1 || (args.maxIterations as number) > 5)) {
        throw new ToolError("maxIterations must be a whole number from 1 to 5");
      }
      if (args.includeVision !== undefined && typeof args.includeVision !== "boolean") {
        throw new ToolError("includeVision must be a boolean");
      }
      const validViewports = Object.keys(STANDARD_VIEWPORTS);
      const requestedViewports = args.viewports === undefined ? ["mobile", "desktop"] : args.viewports;
      if (!Array.isArray(requestedViewports) || requestedViewports.length === 0 || requestedViewports.length > 2) {
        throw new ToolError("viewports must contain 1 to 2 standard viewport ids");
      }
      const viewports: string[] = [];
      for (const vp of requestedViewports) {
        if (typeof vp !== "string" || !validViewports.includes(vp)) {
          throw new ToolError(`unknown viewport ${JSON.stringify(shownPlainly(String(vp).slice(0, 40)))}`);
        }
        if (!viewports.includes(vp)) viewports.push(vp);
      }

      let browserPath: string | null = null;
      let visionNote: string | null = null;
      if (args.includeVision === true) {
        try {
          browserPath = discoverBrowser();
          if (!browserPath) {
            visionNote = "No local Chromium/Chrome/Edge browser found; ran static improvement without live browser telemetry.";
          }
        } catch (error) {
          visionNote = `${shownPlainly(error instanceof Error ? error.message : String(error))}; ran static improvement without live browser telemetry.`;
        }
      }
      const visionUsed = args.includeVision === true && browserPath !== null;
      const maxIterations = typeof args.maxIterations === "number" ? args.maxIterations : 3;
      const startRevision = session.revision;

      let result;
      try {
        result = await improveDesignInMemory(session.document as any, {
          maxIterations,
          evaluate: async (candidateDoc: any) => {
            const taste = evaluateTaste(candidateDoc, { rootId });
            const systemAudit = auditDesignSystem(candidateDoc);
            let visionCaptures: any[] = [];
            if (visionUsed && browserPath) {
              const targetId = rootId ?? (candidateDoc.rootIds ?? []).find((id: string) => candidateDoc.nodes[id]?.type !== "design-system") ?? null;
              if (targetId) {
                const { html } = exportHtml(candidateDoc, targetId, { includeNodeIds: true });
                const rendered = await renderAndInspect({
                  html,
                  viewports,
                  captureScreenshot: false,
                  browserPath,
                });
                visionCaptures = rendered.captures;
              }
            }
            return buildCritiqueReport({
              document: candidateDoc,
              rootId,
              tasteFindings: taste.findings,
              systemFindings: systemAudit.hasDesignSystem ? systemAudit.findings : [],
              visionCaptures,
            });
          },
        });
      } catch (error) {
        throw new ToolError(shownPlainly(error instanceof Error ? error.message : String(error)));
      }

      // Guard against concurrent edits landing while async improvement ran.
      if (session.revision !== startRevision) {
        throw new ToolError(`the document changed while improve_design was running (revision ${startRevision} -> ${session.revision}); run improve_design again`);
      }

      if (result.operations.length === 0) {
        return {
          nodeId: rootId,
          improved: false,
          visionUsed,
          ...(visionNote ? { visionNote } : {}),
          iterationsRun: result.iterationsRun,
          baseline: result.baseline,
          final: result.final,
          history: result.history,
          ...(dryRun ? { dryRun: true, wouldChange: [], operations: 0 } : {}),
          revision: session.revision,
        } as unknown as Json;
      }

      return {
        nodeId: rootId,
        improved: result.improved,
        visionUsed,
        ...(visionNote ? { visionNote } : {}),
        iterationsRun: result.iterationsRun,
        baseline: result.baseline,
        final: result.final,
        history: result.history,
        ...(edit(result.operations, `Improve design (${result.baseline.defectScore} -> ${result.final.defectScore})`) as object),
      } as unknown as Json;
    },
  },
  {
    name: "inspect_codebase",
    title: "Inspect bound codebase",
    description: "Analyze the human-bound local codebase workspace offline (never executes target code): detects frameworks, styling systems, routes, components, CSS custom properties, and functional contract counts (hooks, event handlers, test ids).",
    inputSchema: object({}),
    run: ({ workspaceRoot }, args) => {
      onlyArguments(args, []);
      const root = requireBoundWorkspace(workspaceRoot);
      const report = analyzeCodebase(root);
      return {
        workspaceName: basename(root),
        projectName: report.projectName,
        frameworks: report.frameworks,
        styling: report.styling,
        counts: report.counts,
        cssFiles: report.cssFiles,
        routeFiles: report.routeFiles,
        components: report.components,
        tokens: report.tokens,
      } as unknown as Json;
    },
  },
  {
    name: "import_from_codebase",
    title: "Import file from bound codebase",
    description: "Import a component (.tsx/.jsx/.js/.mjs), CSS token stylesheet (.css), or HTML file from the human-bound codebase workspace into the open Ninerr project in one atomic undoable change.",
    inputSchema: object({
      file: { type: "string", minLength: 1, maxLength: 512, description: "Relative forward-slash path inside the bound workspace." },
      component: { type: "string", minLength: 1, maxLength: 128, description: "Optional exported component name when importing a JSX/TSX file with multiple exports." },
      name: { type: "string", maxLength: 120, description: "Optional layer or import label." },
    }, ["file"]),
    run: ({ session, actor, now, edit, workspaceRoot }, args) => {
      onlyArguments(args, ["file", "component", "name"]);
      const root = requireBoundWorkspace(workspaceRoot);
      if (typeof args.file !== "string" || args.file.trim() === "") throw new ToolError("file must be a relative path inside the bound workspace");
      if (args.component !== undefined && (typeof args.component !== "string" || args.component.trim() === "")) throw new ToolError("component must be a non-empty string");
      if (args.name !== undefined && (typeof args.name !== "string" || args.name.length > 120)) throw new ToolError("name must be a string of at most 120 characters");
      const read = readBoundedWorkspaceFile(root, args.file);
      const ext = extname(read.file).toLowerCase();
      if (ext === ".css") {
        const planned = planTokenCss(session.document, { css: read.content, fileName: typeof args.name === "string" && args.name.trim() !== "" ? args.name.trim() : read.file });
        if (planned.plan.problem !== null) throw new ToolError(`tokens refused: ${planned.plan.problem}`);
        const refused = planned.plan.tokens
          .filter((token: any) => token.status === "refused")
          .map((token: any) => ({ name: token.name, reason: token.reason ?? "refused" }));
        const conflicts = planned.plan.tokens
          .filter((token: any) => token.status === "conflict")
          .map((token: any) => ({ name: token.name, reason: token.reason ?? "conflict" }));
        if (planned.operations.length === 0) {
          return { file: read.file, format: "tokens-css", adds: 0, skipped: planned.plan.skipped, kept: planned.plan.kept, refused, conflicts, revision: session.revision } as unknown as Json;
        }
        return {
          file: read.file,
          format: "tokens-css",
          adds: planned.plan.adds,
          skipped: planned.plan.skipped,
          kept: planned.plan.kept,
          refused,
          conflicts,
          ...(edit(planned.operations, `Import ${planned.plan.adds} token${planned.plan.adds === 1 ? "" : "s"} from ${read.file}`) as object),
        } as unknown as Json;
      }
      if (ext === ".tsx" || ext === ".jsx" || ext === ".js" || ext === ".mjs") {
        const imported = importJsx(read.content, { ...(typeof args.component === "string" ? { component: args.component } : {}) });
        const intent = typeof args.name === "string" && args.name.trim() !== "" ? `Import ${args.name.trim()}` : `Import ${imported.componentName} from ${read.file}`;
        return {
          file: read.file,
          format: "jsx",
          frameId: imported.frameId,
          componentName: imported.componentName,
          layers: imported.layers,
          layersWithStyleLeftOut: imported.layersWithStyleLeftOut,
          layersWithStyleOutOfOrder: imported.layersWithStyleOutOfOrder,
          ...(edit(imported.operations, intent) as object),
        } as unknown as Json;
      }
      if (ext === ".html") {
        const desk = new ImportDesk();
        const summaryReport = desk.prepare({ html: read.content, name: typeof args.name === "string" && args.name.trim() !== "" ? args.name.trim() : basename(read.file) }, actor.actorId, now());
        if (!summaryReport.commitReady) {
          throw new ToolError(`HTML import refused: ${summaryReport.blockingReasons.join("; ")}`);
        }
        const change = desk.change(summaryReport.proposalId, session.document);
        return {
          file: read.file,
          format: "html",
          frameId: change.frameId,
          layers: summaryReport.counts.nodes,
          accessibilityFindings: summaryReport.accessibilityFindings,
          security: summaryReport.security,
          notes: summaryReport.notes,
          ...(edit(change.operations, change.intent, change.provenance) as object),
        } as unknown as Json;
      }
      throw new ToolError(`unsupported codebase file extension ${JSON.stringify(ext)}: import .tsx, .jsx, .js, .mjs, .css or .html`);
    },
  },
  {
    name: "plan_redesign",
    title: "Plan existing-app redesign",
    description: "Plan Tier 1 CSS token updates, Tier 2 JSX class replacements, or Tier 3 structural visual patches in the bound workspace without writing any files. Every JSX/TSX patch is verified by Ninerr's Whole-File AST Business-Logic & Functional-Contract Invariance Gate, returning a SHA-256 planToken.",
    inputSchema: object({
      cssTokenUpdates: { type: "object", additionalProperties: { type: "string", maxLength: 512 }, maxProperties: REDESIGN_LIMITS.maxTokenUpdates },
      jsxClassReplacements: { type: "object", additionalProperties: { type: "string", maxLength: 512 }, maxProperties: REDESIGN_LIMITS.maxClassReplacements },
      files: { type: "array", maxItems: REDESIGN_LIMITS.maxPatchFiles * 4, items: { type: "string", minLength: 1, maxLength: 512 } },
      explicitPatches: {
        type: "array",
        maxItems: REDESIGN_LIMITS.maxPatchFiles,
        items: object({
          file: { type: "string", minLength: 1, maxLength: 512 },
          afterContent: { type: "string", maxLength: REDESIGN_LIMITS.maxFileBytes },
          summary: { type: "string", maxLength: 200 },
        }, ["file", "afterContent"]),
      },
    }),
    run: ({ workspaceRoot }, args) => {
      onlyArguments(args, ["cssTokenUpdates", "jsxClassReplacements", "files", "explicitPatches"]);
      const root = requireBoundWorkspace(workspaceRoot);
      const parsed = parseRedesignPlanInput(args);
      const plan = planRedesign(root, parsed);
      return {
        workspaceName: basename(root),
        planToken: plan.planToken,
        fileCount: plan.patches.length,
        files: plan.patches.map(({ file, tier, beforeSha256, afterSha256, summary }) => ({
          file,
          tier,
          beforeSha256,
          afterSha256,
          summary,
        })),
      } as unknown as Json;
    },
  },
  {
    name: "apply_redesign",
    title: "Apply or roll back redesign",
    description: "Apply a verified redesign plan (bound to its SHA-256 planToken with atomic writes and owner-only rollback journal) or roll back a previous redesign run in the human-bound workspace. Requires the person's explicit approval.",
    inputSchema: object({
      action: { type: "string", enum: ["apply", "rollback"] },
      planToken: { type: "string", minLength: 64, maxLength: 64 },
      cssTokenUpdates: { type: "object", additionalProperties: { type: "string", maxLength: 512 }, maxProperties: REDESIGN_LIMITS.maxTokenUpdates },
      jsxClassReplacements: { type: "object", additionalProperties: { type: "string", maxLength: 512 }, maxProperties: REDESIGN_LIMITS.maxClassReplacements },
      files: { type: "array", maxItems: REDESIGN_LIMITS.maxPatchFiles * 4, items: { type: "string", minLength: 1, maxLength: 512 } },
      explicitPatches: {
        type: "array",
        maxItems: REDESIGN_LIMITS.maxPatchFiles,
        items: object({
          file: { type: "string", minLength: 1, maxLength: 512 },
          afterContent: { type: "string", maxLength: REDESIGN_LIMITS.maxFileBytes },
          summary: { type: "string", maxLength: 200 },
        }, ["file", "afterContent"]),
      },
      runId: { type: "string", minLength: 10, maxLength: 64 },
      force: { type: "boolean" },
    }, ["action"]),
    run: ({ dryRun, workspaceRoot, redesignJournalDir }, args) => {
      onlyArguments(args, ["action", "planToken", "cssTokenUpdates", "jsxClassReplacements", "files", "explicitPatches", "runId", "force"]);
      const root = requireBoundWorkspace(workspaceRoot);
      const journalDir = requireRedesignJournalDir(redesignJournalDir);
      if (args.action === "apply") {
        if (typeof args.planToken !== "string" || !/^[a-f0-9]{64}$/u.test(args.planToken)) {
          throw new ToolError("apply requires planToken (64-character SHA-256 hex from plan_redesign)");
        }
        const parsed = parseRedesignPlanInput(args);
        const plan = planRedesign(root, parsed);
        if (plan.patches.length === 0) throw new ToolError("redesign plan contains no file changes");
        if (plan.planToken !== args.planToken) {
          throw new ToolError("planToken does not match the current workspace files; run plan_redesign again");
        }
        if (dryRun) {
          return {
            dryRun: true,
            action: "apply",
            workspaceName: basename(root),
            planToken: plan.planToken,
            wouldChangeFiles: plan.patches.map(({ file, tier, summary }) => ({ file, tier, summary })),
          } as unknown as Json;
        }
        const applied = applyRedesignPlan(plan, { journalDir, expectedPlanToken: args.planToken });
        return {
          action: "apply",
          workspaceName: basename(root),
          runId: applied.runId,
          planToken: applied.planToken,
          filesApplied: applied.filesApplied,
        } as unknown as Json;
      }
      if (args.action === "rollback") {
        if (typeof args.runId !== "string" || args.runId.trim() === "") {
          throw new ToolError("rollback requires runId");
        }
        if (args.force !== undefined && typeof args.force !== "boolean") {
          throw new ToolError("force is true or false");
        }
        if (dryRun) {
          const { targets } = validateRollbackTargets({ workspaceRoot: root, journalDir, runId: args.runId, force: args.force === true });
          return {
            dryRun: true,
            action: "rollback",
            workspaceName: basename(root),
            runId: args.runId,
            wouldRestoreFiles: targets.map((t) => t.file),
          } as unknown as Json;
        }
        const rolled = rollbackRedesign({ workspaceRoot: root, journalDir, runId: args.runId, force: args.force === true });
        return {
          action: "rollback",
          workspaceName: basename(root),
          runId: rolled.runId,
          restoredFiles: rolled.restoredFiles,
        } as unknown as Json;
      }
      throw new ToolError("action must be \"apply\" or \"rollback\"");
    },
  },
  {
    name: "manage_references",
    title: "Manage local design reference packs",
    description: "Extract offline design patterns from local HTML/CSS, and create, list, or load observed-inspiration-only reference packs stored strictly inside the open project's references folder (zero network egress).",
    inputSchema: object({
      action: { type: "string", enum: ["extract_patterns", "list_packs", "create_pack", "load_pack"] },
      fileName: { type: "string", minLength: 6, maxLength: 69, description: "Pack filename inside the project's references folder (lowercase letters, digits, ., _, - ending in .json)." },
      packId: { type: "string", minLength: 1, maxLength: 128 },
      title: { type: "string", minLength: 1, maxLength: 200 },
      html: { type: "string", maxLength: RESEARCH_LIMITS.maxInputBytes },
      css: { type: "string", maxLength: RESEARCH_LIMITS.maxInputBytes },
      tags: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 32 } },
      entries: {
        type: "array",
        maxItems: RESEARCH_LIMITS.maxEntries,
        items: object({
          id: { type: "string", minLength: 1, maxLength: 128 },
          kind: { type: "string", enum: ["screen", "flow", "pattern", "asset", "token", "component"] },
          title: { type: "string", minLength: 1, maxLength: 200 },
          tags: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 32 } },
          confidence: { type: "string", enum: ["observed", "documented", "inferred", "unknown"] },
        }, ["title"]),
      },
      replace: { type: "boolean" },
    }, ["action"]),
    run: async ({ session, references, dryRun, now, isOpen }, args) => {
      onlyArguments(args, ["action", "fileName", "packId", "title", "html", "css", "tags", "entries", "replace"]);
      const projectRefsDir = () => {
        const rootReal = realpathSync.native(session.root);
        const dir = join(rootReal, "references");
        try {
          const stat = lstatSync(dir);
          if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync.native(dir) !== dir) {
            throw new ToolError("the project's references folder is a symlink or not a directory; refusing access");
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
            if (error instanceof ToolError) throw error;
            throw new ToolError("could not verify the project's references folder");
          }
        }
        return dir;
      };

      if (args.action === "extract_patterns") {
        const html = args.html ?? "";
        const css = args.css ?? "";
        if (typeof html !== "string" || typeof css !== "string") throw new ToolError("html and css must be strings");
        if (html.trim() === "" && css.trim() === "") throw new ToolError("provide html and/or css text to extract patterns");
        return extractPatternsFromSource({ html, css }) as unknown as Json;
      }

      if (args.action === "list_packs") {
        const dir = projectRefsDir();
        return { project: session.name, packs: listLocalReferencePacks(dir) } as unknown as Json;
      }

      if (args.action === "load_pack") {
        const validName = validatePackFileName(args.fileName);
        const dir = projectRefsDir();
        const target = join(dir, validName);
        let stat = null;
        try {
          stat = lstatSync(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== "ENOENT" && (error as NodeJS.ErrnoException)?.code !== "ENOTDIR") {
            throw new ToolError(`could not inspect reference pack ${validName}`);
          }
        }
        if (stat === null) {
          throw new ToolError(`reference pack ${validName} was not found in this project's references folder`);
        }
        if (stat.isSymbolicLink() || !stat.isFile()) {
          throw new ToolError(`reference pack ${validName} is not a regular non-symlink file`);
        }
        // Require exact filename match on case-insensitive filesystems.
        if (!readdirSync(dir).includes(validName)) {
          throw new ToolError(`reference pack ${validName} was not found in this project's references folder`);
        }
        if (dryRun) {
          return { dryRun: true, action: "load_pack", project: session.name, fileName: validName } as unknown as Json;
        }
        return await references.load(session, isOpen, dir, validName) as unknown as Json;
      }

      if (args.action === "create_pack") {
        if (args.replace !== undefined && typeof args.replace !== "boolean") throw new ToolError("replace is true or false");
        const validName = validatePackFileName(args.fileName);
        const packId = typeof args.packId === "string" && args.packId.trim() !== ""
          ? args.packId.trim()
          : validName.replace(/\.json$/u, "");
        const extracted = (typeof args.html === "string" && args.html.trim() !== "") || (typeof args.css === "string" && args.css.trim() !== "")
          ? extractPatternsFromSource({ html: typeof args.html === "string" ? args.html : "", css: typeof args.css === "string" ? args.css : "" })
          : null;

        // Agent-created packs are ALWAYS marked restricted / observed-inspiration-only (never self-certified redistributable).
        const forcedRights = { status: "restricted" as const, license: null, redistributable: false };
        let normalizedEntries: any[];
        if (Array.isArray(args.entries) && args.entries.length > 0) {
          normalizedEntries = args.entries.map((entry: any, idx: number) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new ToolError(`entries[${idx}] must be an object`);
            onlyArguments(entry, ["id", "kind", "title", "tags", "confidence"]);
            return {
              ...(typeof entry.id === "string" ? { id: entry.id } : {}),
              ...(typeof entry.kind === "string" ? { kind: entry.kind } : {}),
              title: entry.title,
              ...(Array.isArray(entry.tags) ? { tags: entry.tags } : {}),
              ...(typeof entry.confidence === "string" ? { confidence: entry.confidence } : {}),
              ...(extracted && idx === 0 ? { patterns: extracted } : {}),
              rights: forcedRights,
            };
          });
        } else if (typeof args.title === "string" && args.title.trim() !== "") {
          normalizedEntries = [{
            kind: "pattern",
            title: args.title.trim(),
            tags: Array.isArray(args.tags) ? args.tags : ["local", "observed"],
            confidence: "observed",
            ...(extracted ? { patterns: extracted } : {}),
            rights: forcedRights,
          }];
        } else {
          throw new ToolError("create_pack requires entries (non-empty list) or title");
        }

        const { pack, digest } = createLocalReferencePack({ packId, entries: normalizedEntries, now });
        const dir = projectRefsDir();
        const target = join(dir, validName);
        let existingStat = null;
        try {
          existingStat = lstatSync(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== "ENOENT" && (error as NodeJS.ErrnoException)?.code !== "ENOTDIR") {
            throw new ToolError(`could not inspect reference pack ${validName}`);
          }
        }
        if (existingStat !== null && (existingStat.isSymbolicLink() || !existingStat.isFile())) {
          throw new ToolError(`refusing to overwrite symlink or non-regular file ${validName}`);
        }
        const caseCollision = existsSync(dir) && readdirSync(dir).some((entry) => entry.toLowerCase() === validName.toLowerCase());
        if ((existingStat !== null || caseCollision) && args.replace !== true) {
          throw new ToolError(`reference pack ${validName} already exists (pass replace: true to overwrite)`);
        }
        if (dryRun) {
          return {
            dryRun: true,
            action: "create_pack",
            fileName: validName,
            packId: pack.packId,
            packDigest: digest,
            objects: pack.objects.length,
            rightsPolicy: "observed-inspiration-only",
            ...(extracted ? { patterns: extracted } : {}),
          } as unknown as Json;
        }
        const written = writeLocalReferencePack({ directory: dir, fileName: validName, pack, replace: args.replace === true });
        const loaded = await references.load(session, isOpen, dir, validName);
        return {
          action: "create_pack",
          fileName: written.fileName,
          packId: loaded.packId,
          packDigest: loaded.packDigest,
          objects: loaded.objects,
          rightsPolicy: "observed-inspiration-only",
          ...(extracted ? { patterns: extracted } : {}),
        } as unknown as Json;
      }

      throw new ToolError("action must be extract_patterns, list_packs, create_pack or load_pack");
    },
  },
];

function requireBoundWorkspace(workspaceRoot: string | null): string {
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim() === "") {
    throw new ToolError("No codebase workspace is bound. Restart Ninerr MCP with --workspace <folder> (or set NINERR_WORKSPACE) to inspect or redesign a local codebase.");
  }
  return workspaceRoot;
}

function requireRedesignJournalDir(journalDir: string | null): string {
  if (typeof journalDir !== "string" || journalDir.trim() === "") {
    throw new ToolError("Redesign journaling is not configured in this session.");
  }
  return journalDir;
}

function parseRedesignPlanInput(args: Record<string, any>) {
  const isStringRecord = (val: unknown, label: string, maxKeys: number): Record<string, string> => {
    if (val === undefined) return {};
    if (val === null || typeof val !== "object" || Array.isArray(val)) throw new ToolError(`${label} must be an object mapping strings to strings`);
    const entries = Object.entries(val);
    if (entries.length > maxKeys) throw new ToolError(`${label} may contain at most ${maxKeys} entries`);
    const out: Record<string, string> = Object.create(null);
    for (const [k, v] of entries) {
      if (typeof v !== "string") throw new ToolError(`${label}[${JSON.stringify(k.slice(0, 40))}] must be a string`);
      out[k] = v;
    }
    return out;
  };
  const cssTokenUpdates = isStringRecord(args.cssTokenUpdates, "cssTokenUpdates", REDESIGN_LIMITS.maxTokenUpdates);
  const jsxClassReplacements = isStringRecord(args.jsxClassReplacements, "jsxClassReplacements", REDESIGN_LIMITS.maxClassReplacements);
  let files: string[] = [];
  if (args.files !== undefined) {
    if (!Array.isArray(args.files) || args.files.length > REDESIGN_LIMITS.maxPatchFiles * 4 || args.files.some((f) => typeof f !== "string" || f.trim() === "")) {
      throw new ToolError(`files must be a list of up to ${REDESIGN_LIMITS.maxPatchFiles * 4} relative file paths`);
    }
    files = args.files;
  }
  let explicitPatches: Array<{ file: string; afterContent: string; summary?: string }> = [];
  if (args.explicitPatches !== undefined) {
    if (!Array.isArray(args.explicitPatches) || args.explicitPatches.length > REDESIGN_LIMITS.maxPatchFiles) {
      throw new ToolError(`explicitPatches must be a list of up to ${REDESIGN_LIMITS.maxPatchFiles} patches`);
    }
    explicitPatches = args.explicitPatches.map((item, idx) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) throw new ToolError(`explicitPatches[${idx}] must be an object`);
      onlyArguments(item, ["file", "afterContent", "summary"]);
      if (typeof item.file !== "string" || typeof item.afterContent !== "string") {
        throw new ToolError(`explicitPatches[${idx}] requires file and afterContent strings`);
      }
      if (item.summary !== undefined && typeof item.summary !== "string") {
        throw new ToolError(`explicitPatches[${idx}].summary must be a string`);
      }
      return { file: item.file, afterContent: item.afterContent, ...(item.summary !== undefined ? { summary: item.summary } : {}) };
    });
  }
  if (Object.keys(cssTokenUpdates).length === 0 && Object.keys(jsxClassReplacements).length === 0 && explicitPatches.length === 0) {
    throw new ToolError("provide at least one of cssTokenUpdates, jsxClassReplacements or explicitPatches");
  }
  return { cssTokenUpdates, jsxClassReplacements, files, explicitPatches };
}

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));
// The definitions the server announces must satisfy the MCP contract validators and be exactly
// the tools of Ninerr's catalog, which carries the classification each tool is authorized by.
assertMCPToolSurface({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
for (const tool of TOOLS) {
  const kind = classifyTool(tool.name);
  if (kind !== "write" && kind !== "consequential") continue;
  for (const field of labelLikeFields(tool.inputSchema)) {
    if (!(LABELS[tool.name] ?? []).includes(field)) throw new Error(`${tool.name} takes ${field}, which is not among its checked labels`);
  }
}
for (const [name, paths] of Object.entries(LABELS)) {
  const tool = TOOL_BY_NAME.get(name);
  const fields = tool === undefined ? [] : labelLikeFields(tool.inputSchema);
  for (const path of paths) if (!fields.includes(path)) throw new Error(`${name} has no label ${path}`);
}

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
   * Ask the person, reusing an identical open request (unless `singleWaiter` is set for
   * non-idempotent tools like `apply_redesign`). Resolves with their decision (an approval
   * carries its time), "timeout", or "busy" when too many requests are waiting: at most 20 in
   * all, 5 per agent, and 4 calls waiting on one request (1 when `singleWaiter` is true).
   */
  request(input: Omit<PendingConfirmation, "id" | "requestedAt"> & { subjectSha256?: string; singleWaiter?: boolean }, at: string, waitMs: number): Promise<Decision> {
    this.#prune();
    const { singleWaiter, ...entryInput } = input;
    let item = [...this.#items.values()].find((candidate) => candidate.decision === "pending" && candidate.agentId === entryInput.agentId && candidate.toolName === entryInput.toolName && candidate.documentId === entryInput.documentId && candidate.argumentsSha256 === entryInput.argumentsSha256 && candidate.subjectSha256 === entryInput.subjectSha256);
    if (item === undefined) {
      const pending = this.pending();
      if (pending.length >= 20 || pending.filter((other) => other.agentId === entryInput.agentId).length >= 5) return Promise.resolve({ outcome: "busy" });
      item = { ...entryInput, id: `confirm-${randomUUID()}`, requestedAt: at, expires: Date.now() + CONFIRMATION_TTL_MS, decision: "pending", waiters: [] };
      this.#items.set(item.id, item);
      this.#notify(this.pending());
    } else if ((singleWaiter === true && item.waiters.length >= 1) || item.waiters.length >= 4) {
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
  /**
   * Why the person cannot be asked to approve a consequential call here, or null when they can.
   * The headless engine says so when its client cannot ask (no MCP elicitation): the call is then
   * refused, never approved without the person.
   */
  confirmationUnavailable?: (toolName?: string) => string | null;
  /** Optional human-bound local codebase folder (headless `--workspace` / `NINERR_WORKSPACE`). */
  workspaceRoot?: () => string | null;
  /** Optional owner-only directory for redesign rollback journals. */
  redesignJournalDir?: () => string | null;
}

// Read tools that show the open project; reading one is what lets an agent change it.
const PROJECT_READS = new Set(["project_info", "layer_tree", "layer_details", "layer_children", "find_layers", "selection", "layer_code", "design_tokens", "list_components", "instance_layers", "project_history", "design_intelligence", "audit_design_system", "critique_design"]);

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
      const hidden = changes ? hiddenLabel(toolName, args) : null;
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
  const hidden = changes ? hiddenLabel(toolName, args) : null;
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
      now: context.now,
      dryRun: dryRun === true,
      selection: context.selection,
      references: context.references,
      workspaceRoot: context.workspaceRoot?.() ?? null,
      redesignJournalDir: context.redesignJournalDir?.() ?? null,
      isOpen: () => context.session() === session,
      edit: (operations, intent, provenance) => {
        if (operations.length === 0) throw new ToolError("nothing to change");
        if (dryRun === true) {
          const preview = session.preview(actor, { baseRevision: baseRevision ?? session.revision, operations, intent, tool: toolName }, "mcp");
          // Nothing is made: the result says so, and what the change would touch.
          throw new DryRun({ dryRun: true, wouldChange: preview.affectedNodeIds, operations: preview.operations, revision: preview.revision, intent });
        }
        const event = session.edit(actor, { baseRevision: baseRevision ?? session.revision, operations, intent, tool: toolName }, "mcp", provenance);
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
  let redesignSummary: string | null = null;
  let redesignSubjectOf: (() => string) | null = null;

  if (toolName === "apply_redesign") {
    const root = context.workspaceRoot?.() ?? null;
    const journalDir = context.redesignJournalDir?.() ?? null;
    if (typeof root !== "string" || root.trim() === "") {
      return "No codebase workspace is bound. Restart Ninerr MCP with --workspace <folder> (or set NINERR_WORKSPACE) to redesign a local codebase.";
    }
    if (typeof journalDir !== "string" || journalDir.trim() === "") {
      return "Redesign journaling is not configured in this session.";
    }
    // Check elicitation availability before touching workspace/journal files.
    const unavailableEarly = context.confirmationUnavailable?.(toolName) ?? null;
    if (unavailableEarly !== null) return unavailableEarly;
    try {
      const given = onlyArguments(args, ["action", "planToken", "cssTokenUpdates", "jsxClassReplacements", "files", "explicitPatches", "runId", "force"]);
      if (given.action === "apply") {
        if (typeof given.planToken !== "string" || !/^[a-f0-9]{64}$/u.test(given.planToken)) {
          return "apply requires planToken (64-character SHA-256 hex from plan_redesign)";
        }
        const parsed = parseRedesignPlanInput(given);
        const plan = planRedesign(root, parsed);
        if (plan.patches.length === 0) return "redesign plan contains no file changes";
        if (plan.planToken !== given.planToken) {
          return "planToken does not match the current workspace files; run plan_redesign again";
        }
        redesignSubjectOf = () => {
          try {
            return planRedesign(root, parsed).planToken;
          } catch {
            return "";
          }
        };
        const tierCounts = [1, 2, 3].map((t) => plan.patches.filter((p) => p.tier === t).length);
        const tierBreakdown = `T1:${tierCounts[0]}/T2:${tierCounts[1]}/T3:${tierCounts[2]}`;
        const tier3Files = plan.patches.filter((p) => p.tier === 3).map((p) => `${p.file} [tier 3]`);
        const otherFiles = plan.patches.filter((p) => p.tier !== 3);
        const listed = [
          ...tier3Files,
          ...otherFiles.slice(0, 5).map((p) => `${p.file} [tier ${p.tier}]`),
        ];
        const omitted = otherFiles.length > 5 ? `, … (+${otherFiles.length - 5} tier 1/2)` : "";
        redesignSummary = `Apply redesign to ${plan.patches.length} file${plan.patches.length === 1 ? "" : "s"} (${tierBreakdown}) in ${basename(root)} (plan ${plan.planToken.slice(0, 12)}): ${listed.join(", ")}${omitted}`;
      } else if (given.action === "rollback") {
        if (typeof given.runId !== "string" || given.runId.trim() === "") return "rollback requires runId";
        if (given.force !== undefined && typeof given.force !== "boolean") return "force is true or false";
        const initial = validateRollbackTargets({ workspaceRoot: root, journalDir, runId: given.runId, force: given.force === true });
        const digestTargets = () => {
          try {
            const check = validateRollbackTargets({ workspaceRoot: root, journalDir, runId: given.runId as string, force: given.force === true });
            return createHash("sha256").update(JSON.stringify({
              workspaceRoot: check.rootReal,
              journalSha256: check.journalSha256,
              runId: given.runId,
              force: given.force === true,
              files: check.targets.map((t) => ({ file: t.file, sha: t.preRollback.missing ? null : t.preRollback.sha256 })),
            })).digest("hex");
          } catch {
            return "";
          }
        };
        redesignSubjectOf = digestTargets;
        redesignSummary = `Roll back redesign run ${given.runId} in ${basename(root)} (${initial.targets.length} file${initial.targets.length === 1 ? "" : "s"}: ${initial.targets.slice(0, 8).map((t) => t.file).join(", ")}${initial.targets.length > 8 ? ", …" : ""})${given.force === true ? " [force overwrite]" : ""}`;
      } else {
        return "action must be \"apply\" or \"rollback\"";
      }
    } catch (error) {
      return error instanceof ToolError || error instanceof StudioError ? error.message : "Invalid apply_redesign arguments.";
    }
  }

  const subjectOf = () => {
    if (toolName === "delete_token") return createHash("sha256").update(JSON.stringify(tokenSubject(session.document, (args as any)?.name))).digest("hex");
    if (redesignSubjectOf !== null) return redesignSubjectOf();
    return undefined;
  };
  const subjectSha256 = subjectOf();
  const key = { agentId: actor.actorId, toolName, documentId: session.documentId, argumentsSha256, subjectSha256 };
  const approvedAt = context.confirmations.takeApproval(key);
  if (approvedAt !== null) return { documentId: session.documentId, toolName, argumentsSha256, actorId: actor.ownerActorId!, confirmedAt: approvedAt };
  const unavailable = context.confirmationUnavailable?.(toolName) ?? null;
  if (unavailable !== null) return unavailable;
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
  const summary = shownPlainly(
    redesignSummary !== null
      ? redesignSummary
      : toolName === "delete_token"
        ? tokenSummary()
        : `${toolName === "delete_layers" ? "Delete" : toolName} ${ids.length} layer${ids.length === 1 ? "" : "s"}: ${ids.slice(0, 5).map(describeNode).join(", ")}${ids.length > 5 ? ", …" : ""}`,
  );
  const decision = await context.confirmations.request({ ...key, agentName: actor.displayName, summary, ...(toolName === "apply_redesign" ? { singleWaiter: true } : {}) }, at, context.confirmationWaitMs ?? CONFIRMATION_WAIT_MS);
  // What was approved must still be what runs: a token or workspace file changed while the call waited is asked about again.
  if (decision.outcome === "approved" && subjectOf() !== subjectSha256) {
    return toolName === "apply_redesign"
      ? "The workspace files changed while waiting for the person's approval; run plan_redesign again."
      : "What this would delete changed while it waited for the person; call again to ask them about it as it is now.";
  }
  // A switch to another project drops the request: say so, rather than that the person declined.
  if (decision.outcome === "denied") return context.session() === session ? "The person declined this change." : "The open project changed while the call was waiting.";
  if (decision.outcome === "busy") return "Too many changes are already waiting for the person's approval. Wait for them to decide, then call again.";
  if (decision.outcome === "timeout") return "Waiting for the person to approve this in Ninerr. Call again with the same arguments once they have.";
  return { documentId: session.documentId, toolName, argumentsSha256, actorId: actor.ownerActorId!, confirmedAt: decision.confirmedAt };
}
