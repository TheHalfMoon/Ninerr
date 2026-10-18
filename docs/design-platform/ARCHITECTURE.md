# Design platform architecture (proposal)

Status: proposal, not approved ([README](README.md)). The evidence IDs (E-…) refer to [the study records](../research/rea-design-platforms/EVIDENCE_2026-10-18.md).

## 1. Principles carried forward unchanged

In the products studied, these points are weaker (E-PD-12, E-PD-13) or undocumented (E-FG-05). The extension keeps them as hard constraints:

- **One document authority:**
  - the project's document graph (`packages/document-model`), changed only through history transactions (`packages/history`), committed by the single-writer studio host (`packages/studio-host/src/session.ts`);
  - no second store, cache of record, or per-feature database.
- **Every change is one atomic, validated, attributed transaction** with an exact inverse. Agents, imports, layout tools and generation all go through it.
- **Real HTML and CSS are the design.** A node keeps its tag, attributes, style and text, and the renderer draws them as the browser would. A design concept ("hug", "constraint", "token") is a *view over CSS*, or compiles to CSS deterministically. It is never a second representation that can disagree with the CSS.
- **Local first and offline.** Nothing leaves loopback (the web-mode tests). No feature may fetch remote content implicitly (contrast E-PD-13).
- **The sandboxed canvas runs no scripts,** imported content is sanitized, and trusted files are checked (#268).
- **Accessibility is a gate:** `auditAccessibility` covers every new UI state.

## 2. Document model changes

Today, schema v1 (`DOCUMENT_SCHEMA_VERSION = 1`):
- nodes `{id, type, parentId, children, props, metadata}`;
- node types include the reserved `component-definition`, `token-reference`, `interaction` and `source-binding`, unused by the editor (`vector` is drawn by the renderer and produced by HTML import).

### 2.1 What stays as it is

- **Layout and constraints stay CSS** (ADR-0002). No new fields.
  - **Flex layout:** `display`, `flex-direction`, `gap`, `padding`, `align-items`, `justify-content` and `flex-wrap` on the parent.
  - **Hug, fill and fixed sizing:**
    - *hug* is `width: fit-content`;
    - *fill* is `flex: 1 1 0` on the main axis, or `align-self: stretch` on the cross axis;
    - *fixed* is a length.
  - **Constraints** of an absolutely placed layer are the insets set on it:
    - left only, right only, or left and right (stretch);
    - centre is `left: 50%` with `translate: -50% 0`;
    - scale is percentage insets and size.
  - The inspector *reads* these back into the design vocabulary (E-FG-02) and *writes* only CSS.
- **Text** follows whatever P09 decides for #235. The proposal on the #235 branch keeps both shapes, with a `textLayerOf` helper; it is not merged.

### 2.2 What is added: schema v2 (ADR-0003)

v1 documents open unchanged.

- **Lazy upgrade:** a project stays v1, readable by older builds, until the first v2 node or prop is added. That transaction also changes `schemaVersion` to 2. So no older build loses a project that uses no v2 feature.
- **Journal and snapshots:** v1 journal entries and snapshots replay unchanged under v2, because v2 only adds optional keys and node types; validation accepts both versions. The migration corpus (`tests/migration-corpus.test.mjs`) gains v1 cases that must open, edit and save as v2.

```ts
// packages/document-model/src/index.mjs: NODE_TYPES gains "component-instance" and "design-system".
type DesignSystemProps = {                 // one node of type "design-system", root level, not drawn
  name: string;
  collections: Array<{ id: string; name: string; modes: Array<{ id: string; name: string }>; defaultMode: string }>;
  tokens: Array<{
    name: string;                          // a CSS custom property name, /^--[A-Za-z0-9_-]{1,127}$/ (real codebases use camelCase and capitals)
    type: "color" | "spacing" | "radius" | "fontFamily" | "fontSize" | "fontWeight" | "lineHeight" | "letterSpacing" | "opacity" | "shadow" | "breakpoint";
    collection: string;
    values: Record<string /* mode id */, string /* a CSS value or var(--other) */>;
    description?: string;
  }>;
  source?: { codebase: true; file: string; extractedAt: string };   // when derived from the codebase (P13)
};

type ComponentDefinitionProps = {          // node type "component-definition": its subtree is the main component
  name: string;
  properties: Array<{
    id: string; name: string;
    kind: "boolean" | "text" | "variant" | "instance-swap" | "slot";
    default: string | boolean;
    options?: string[];                    // variant values
    target: { nodeId: string; field: "visible" | "text" | "attributes.class" | "style" | "children" };
  }>;
  variants?: Array<{ values: Record<string, string>; overrides: Override[] }>;
  codeSource?: unknown;                    // the existing codeSource binding, when the component comes from code
};

type ComponentInstanceProps = {            // node type "component-instance": no children are stored
  componentId: string;                     // a component-definition node
  propertyValues: Record<string, string | boolean>;
  overrides: Override[];                   // keyed by definition node IDs, which are stable
  style?: Record<string, string>;          // the instance's own placement and size
};

type Override = {
  path: string[];                          // the chain of instance IDs inside the definition, outermost first ([] for the definition's own nodes)
  nodeId: string;                          // a definition node at the end of that chain
  set: { text?: string; style?: Record<string, string>; attributes?: Record<string, string> };
};
```

**Binding.** A style value containing `var(--name)` is a binding, anywhere in the value (inside `calc()`, with or without a fallback). The host parses values with one tokenizer shared with the renderer. A `var()` naming no token is left alone and reported as unbound. No separate binding table exists (ADR-0004).
- Renaming a token is one transaction: the `design-system` node's `set-props`, plus each bound value's `set-props`. Its inverse restores all of them.
- Modes are applied by `data-ninerr-mode="<collection>:<mode>"` on a frame. The compiled stylesheet maps each mode to its values.

**Validation** (in `validateNodes` / `changedPartIsValid`):
- token names are unique, their types are known, and every alias resolves;
- an alias cycle is refused;
- `componentId` exists and is a `component-definition`, and an instance never contains its own definition, directly or through nesting;
- override `nodeId`s lie in the definition's subtree; a stale override is kept and reported, not dropped;
- size limits: at most 5,000 tokens, 2,000 component definitions, 10,000 instances and 500 overrides per instance. These are proposed and checked by the scale suite.

## 3. Rendering (ADR-0005)

The renderer (`packages/renderer`, `planElement`, `mountSandboxedRenderer`) stays the only drawing path for the canvas and for export.

- **Instances:** the renderer expands an instance at draw time.
  - It clones the definition's plan, applies variant overrides, then property values, then instance overrides.
  - **Drawn identity.** Each drawn element keeps `data-ninerr-id` as its definition node's ID, and gains `data-ninerr-instance` holding the instance chain, a JSON array of IDs, as an attribute value the renderer escapes. Node IDs may contain any character, so no separator scheme is used.
  - **Scoped stylesheets** (`@scope ([data-ninerr-id="…"])`) keep matching inside instances, because they select by `data-ninerr-id`.
  - **Selection** is a pair `(instancePath, nodeId)`. The canvas resolves it from both attributes, and MCP tools take it as `{ nodeId, instancePath }`.
  - **Edits:** an edit inside an instance becomes an override keyed by that path. When the person chooses "edit main component", it becomes an edit to the definition.
  - **Nesting:** nested instances are expanded recursively, and the depth limit is the document's.
  - Nothing expanded is ever stored, so one definition change updates every instance, in one transaction.
- **Tokens:** compiled into one `:root`-scoped sheet per project (custom properties per mode), applied inside the canvas frame and exported with the code. This goes through the existing stylesheet sanitizer and its 16 MiB budget (#299).
- **Invalidation:** a change to a definition or a token invalidates exactly the dependent instances and bindings. The host computes `affectedNodeIds` for them, and the canvas patch is limited to those (as `patchLayers` does today).
- **Text:** shaping is the browser's. Fonts must be local or bundled, and the font lookup only reads (§5).

## 4. Editor (packages/studio-web, packages/canvas)

| Capability | Where | Notes |
|---|---|---|
| Snapping and smart guides | `packages/canvas` overlay | to sibling edges and centres, parent padding, and an 8 px grid when enabled; a pure function `snap(rects, moving, threshold)` that the canvas and agents share (`align_layers`) |
| Align and distribute; rotation handle | canvas and toolbar | rotation writes the CSS `rotate` property |
| Layout panel | inspector | reads and writes the CSS of §2.1: direction, gap, padding, alignment, wrap, hug/fill/fixed, constraints |
| Tokens panel | new panel | collections, modes, tokens; bind a field to a token; find uses |
| Components | layers tree, inspector | create a component from a selection; insert an instance; properties; variants; overrides with reset; detach; edit main component |
| Vector | canvas | pen and path editing on `vector` nodes (SVG `d`); booleans through a library (REUSE.md) |
| Export | Code dialog | PNG, SVG and PDF of a layer, rendered by the editor's own browser, offline |
| Comments | side panel | anchored to a node ID; stored as host records outside the document; an agent may read them and propose fixes |

## 5. Agents and AI creation

See [AGENT_CONTRACT.md](AGENT_CONTRACT.md).

- **Agent writes:** they gain revision preconditions, dry runs and proposals that a person previews, accepts or rejects. Accepted proposals become attributed transactions that Undo agent change reverses (#350).
- **Built-in generation:** it is an agent like any other, through that same contract. It has no private write path.
- **Model provider:** chosen and configured by the person. With none configured the feature is off, and nothing leaves the computer.

## 6. Performance budgets (proposed, measured where stated)

Measured baselines come from `docs/evidence/P08_G4_REMEASURE_2026-10-13.md`: 4870d30, the reference machine's hardware, but Balanced power mode under background load, so the figures are conservative. The earlier P08-G4 record (`docs/evidence/P08_G4_SCALE_2026-10-10.md`) predates the edit-cost work of #252:

| Measure | 1,000 layers | 10,000 layers |
|---|---|---|
| Edit, p95 | 6 ms | 15 ms |
| Agent edit, p95 | 12 ms | 42 ms |
| Reopen | — | 205 ms |

Proposed for the new features. None is measured yet; each is enforced by a new scale workload before its phase closes:

| Feature | Proposed budget |
|---|---|
| Instance expansion | ≤ 50 ms p95 for 1,000 instances of a 20-node component |
| Token rename | ≤ 300 ms p95 with 10,000 bound values |
| Snapping | ≤ 4 ms per pointer move at 1,000 siblings (one frame at 240 Hz) |
| Dry run | ≤ 1.2× the same edit's commit time |
| Proposal preview | ≤ 100 ms to draw for 200 operations |

## 7. Security

- **Generation and proposals:** every agent and generation path keeps the existing protections:
  - attribution;
  - person approval for destructive operations;
  - no network beyond the person's chosen model provider, when they enable it.
- **Importing a design system from code** reads only the connected codebase folder, with the codebase trust checks. Tokens are values, never code, and are sanitized as CSS values.
- **Vector paths:**
  - lengths are limited to 200,000 commands;
  - numbers must be finite;
  - path data is never interpreted as markup.
- **Export:**
  - writes only where the person chooses;
  - no file goes into a fixed folder without asking (contrast E-PD-13);
  - the font lookup is read-only.
