# Framer Developer APIs and Public npm Package Audit — 2026-11-06

Observation: technical metadata and official developer docs examined from owner-authorized Windows OpenCode/DeepSeek research session on 2026-11-06. This file is an **evidence audit**, not a reconstruction of Framer's proprietary editor. The founder states direct Framer source reuse permission, but no Framer private editor archive or grant document was supplied.

## Source corpus and versions

- Public official Framer developer docs: https://www.framer.com/developers/reference and /developers/property-controls, /developers/components-reference, /developers/overrides-introduction, /developers/fetch-examples.
- Raw developer page text extracts retained owner-locally under `.local-evidence/framer-2026-11-06/raw/dev-pages-extract.json`, with summary `dev-pages-digest.md`. These are saved from official public pages and are not private implementation source.
- Public npm registry JSON from `registry.npmjs.org` was read and retained locally under `.local-evidence/framer-2026-11-06/raw/npm/`. **Package versions and metadata are as observed on 2026-11-06; future releases may supersede them.**

## npm registry records (actual observed latest tags)

| npm name | Observed latest | Registry metadata license | Source claim / relevance |
|---|---|---|---|
| `motion` | 14.10.1 | MIT | https://github.com/motiondivision/motion, user-side DOM/JS animation |
| `framer-motion` | 14.10.1 | MIT | Same Motion source, React animations and variants |
| `motion-dom` | 14.10.1 | MIT | Motion DOM runtime engine |
| `motion-utils` | 14.7.0 | MIT | Pure animation math/utilities |
| `framer-plugin` | 3.10.3 | not declared in the parsed latest package object | Inspect contents/terms separately; don't infer permission from package name |
| `@framer/plugin` | 5.1.0 | not declared in parsed latest metadata | Public package API does **not** expose private Framer editor implementation |
| `framer-api` | 5.1.0 | MIT in parsed latest metadata | Verify origin, package contents and dependencies before any port |
| `@framer/agent` | 0.0.48 | not declared in parsed latest metadata | Legacy local agent bridge, NOT the current remote official Framer MCP |

The npm package metadata is not a grant over transitive libraries or Framer's proprietary backend. Verify exact tarball hashes, upstream license files and owner before reusing bundled code. Do not install these packages just for a site feature comparison. Motion 14.10.1 came from npm modified date 2026-11-06; Motion Utils 14.7.0 was modified 2026-10-27. A registry latest tag may be ahead of a git HEAD or differ from source release tags.

## Specific APIs and editor-side behavior from official Framer Developer docs

**Canvas and selection:** `getCanvasRoot`, `getSelection`, `setSelection`, `createFrameNode`, `removeNodes`, `cloneNode`, `getNode`, `getParent`, `getChildren`, `getRect` are published plugin API capabilities. Inspect the current API reference for signatures, authentication and constraints; the public docs alone do not expose underlying document engine source.

**Branching:** `getActiveBranch`, `createBranch`, `subscribeToActiveBranch` and branch listing and selection APIs provide a reference contract for agent isolation. Ninerr must implement a genuinely **local** equivalent on the existing history/visual-git stack rather than connect to Framer's remote version-control service.

**Code components:** official `/developers/components-reference` documents `RenderTarget.current()`, `Localization`, `Property Controls`, and Motion for React exports. For components that animate, Framer advises a special static-render hook on Canvas/export to avoid tiling/performance issues caused by animation during asset generation. This is a useful quality requirement for Ninerr: **design-time snapshot and export must be deterministic despite effects**.

**Property Controls:** `/developers/property-controls` documents `addPropertyControls` with `ControlType` fields, default values, conditional `hidden`, `ComponentInstance` outlets, arrays, booleans, colors, date/time, enum, event handler, file, responsive image, number, object, string, transition, padding, border radius, border, shadows, gap, font, cursor, and analytics identifiers. Some older controls such as `SegmentedEnum`, `Image` and `FusedNumber` are deprecated according to the docs. Ninerr can use equivalent typed inspector schemas; do not reproduce deprecated API bugs blindly.

**Overrides:** official `/developers/overrides-introduction` documents React higher-order component overrides and `forwardRef`, active only in preview/published site, not identical to editable canvas state. Framer warns overrides can break built-in behavior and that many use cases were replaced by first-class editor features. Ninerr should distinguish **canonical editable properties** from **preview-only runtime effects**.

**Fetch examples:** `/developers/fetch-examples` describes user-configured backend worker and frontend Fetch patterns. Ninerr must not make Framer-compatible remote functions a required service; treat user-authored Fetch URLs as an **explicit online preview feature** disabled in strict offline mode.

**Framer agent and MCP:** public `framer/agent-plugins` `.mcp.json` explicitly sets a remote HTTP MCP destination `https://mcp.framer.com/mcp`; it does not contain the editor engine nor a local standalone MCP implementation. Official help updates dated 2026-10-30 describe remote OAuth client; localization may require legacy local `@framer/agent`. Ninerr's current local authenticated loopback MCP remains authoritative; parity is a proposal requiring real tests.

## Engineer-ready Ninerr tasks from these discoveries

1. **Framer-style typed inspector**: map each currently supported ControlType to a Ninerr document property schema; preserve instance reference identity, sensible default, conditional inspector visibility, and type-safe code export. Negative tests reject invalid color, oversized lists, broken reference and unsafe content.
2. **Static motion snapshot/export**: implement export-mode effect suspension and deterministic rendering, using Motion capabilities only when they meet offline, accessibility and asset-rights requirements. Test frame captures for a looping spring and scroll-bound effect with equal frame output each run.
3. **Canonical editing versus overrides**: treat React HOC/preview overrides as source-authored code/preview state, never automatically transform them into editable normal document nodes if semantics cannot be preserved.
4. **Local reversible branches**: add create/select/preview/merge/reject on user-owned project history, agent-aware, with revision checks and no remote source-of-truth.
5. **Local MCP permission parity**: create/remove/clone/select/read/edit operations with the same access control as GUI and explicit transaction/confirmation semantics. Do not expose an arbitrary function-runner.
6. **Offline network trap**: test that external Fetch/preview, remote agents, fonts, and external CMS connectors cannot open automatically; user can opt in to direct connections without founder proxy/compute.
7. **Real editor benchmark**: use only an authorized Framer project/editor account if available. The plugin API docs alone cannot establish actual ergonomic speed, exported correctness or native feature parity.

## Access truth

Motion's MIT source is available publicly. Official plugin example source and package interfaces are available publicly. Framer's complete private Canvas editor and remote backend source were NOT observed, and browsing framer.com does not yield those repositories. The founder's asserted grant does not itself deliver private source files. To copy them, an explicitly authorized Framer source archive/private repo and source-level permission ledger must be provided. Do not attempt privileged or unauthorized extraction.
