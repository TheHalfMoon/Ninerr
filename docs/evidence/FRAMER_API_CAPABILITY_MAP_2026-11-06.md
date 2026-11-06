# Framer Developer API surface and offline-Ninerr relevance
Date: 2026-11-06. Evidence: Framer's official publicly accessible documentation at https://www.framer.com/developers/reference and 46 indexed developer documentation pages captured by OpenCode/DeepSeek at .local-evidence/framer-2026-11-06/raw/dev-pages-index.txt. This is an official API census, NOT private editor source or full implemented API source.

## Official reference categories (11)

| Area on official reference | Example documented public methods | Offline Ninerr decision |
|---|---|---|
| Branching APIs | getActiveBranch(), getBranch(), getBranches(), createBranch(), subscribeToBranches(), subscribeToActiveBranch() | Reuse Ninerr local history/visual-git; review before merge, no Framer cloud |
| Canvas APIs | getSelection(), setSelection(), getCanvasRoot(), createFrameNode(), removeNodes(), cloneNode(), getNode(), getParent(), getChildren(), getRect() | Typed canonical document operations through studio host and MCP; reject unauthorized mutation |
| CMS APIs | getActiveManagedCollection(), getManagedCollections(), getCollection(), getActiveCollection(), getCollections(), createCollection(), createManagedCollection() | Local structured collection abstraction if needed; no hosted CMS dependency |
| Code File APIs | create/read/update/manage CodeFile and code components/overrides | Source-preserving code-ir, no-op byte identity and owner-reviewed writes |
| Localization APIs | locales, groups, sources, localized values | Optional local translation data with no model and no cloud |
| Navigation APIs | canvas/node/code/CMS focus and selection | Accessible local navigation; UI/MCP consistent IDs |
| Permissions APIs | plugin may act only as signed-in user; allowed-action checks | Agent grant never exceeds owner/project permission |
| Plugin UI APIs | show/hide, sizing, background text | Local desktop plugin sandbox may have UI or no UI; no remote renderer needed |
| Publishing APIs | start publish, inspect deployment/optimization, staging/production | Offline local exports first; user-selected deployment optionally later |
| Settings APIs | redirect URL and site configuration | Local project settings; no default domain/host integrations |
| User APIs | current user/workspace access | Installed per-device owner permission; no mandatory Ninerr account |

The examples above are confirmed as documented method names in the current official reference for the named areas where functions were enumerated. Do not assume Framer plugins expose all internal private objects, or that every method is permission-free; the official permissions guide conditions access.

## Other pages in the 46-page public documentation corpus

The indexed capture also includes: overrides introduction/examples, code component reference, property controls, fetch examples/introduction, workspace plugins, product comparison, FAQ, Server API introduction/quick-start/reference/FAQ, plugins introduction/quick-start, beta and stable changelogs, publishing, plugin concepts, plugin interface, site info, modes, CMS, plugins permissions, plugins with components, plugins localization, nodes, styles, assets, sharing, OAuth, storing data, fonts, editor, drag-and-drop, configuration, CORS, custom code, upgrading, troubleshooting, component sharing, auto-sizing, component examples. Not all pages have independent deep in-editor replay; all are public documentation reads.

## High-value API facts from actual captured text

- Property Controls: addPropertyControls, ControlType enum families for text, number, color, image, file, boolean, component instance, array, enum, transition, padding, radius, shadow, gap, font and cursor; some deprecated controls (Image, FusedNumber, SegmentedEnum). Use a versioned Ninerr property schema and skip copying deprecated controls without tests.
- Code Overrides: React higher-order wrappers applied to a canvas layer, active in preview and published site, not the same as stored editable canvas state. Preserve semantics or refuse unsupported conversion.
- RenderTarget and Framer Motion: code components have canvas/export preview distinctions. Framer documentation recommends static renders for animated components on canvas/exports, or quality/tiling problems may result; Ninerr must suspend/freeze effects during deterministic asset export.
- Plugin Modes: a plugin launched from Image Picker uses limited methods; image and editImage may use getImage/setImage. Expose equivalent capability-specific local permissions, not a general arbitrary function executor.
- CMS: managed vs unmanaged collections; managed sync requires specific config/sync modes; fields have stable IDs and may be userEditable; cross-collection references have scope constraints. All local Ninerr designs remain editable without a remote managed collection.
- Fetch/OAuth/hosting: documented integrations intentionally rely on external services, users or backend workers. They are OPTIONAL source references and prohibited as mandatory Ninerr runtime dependencies.

## Current 2026 Agents/MCP difference

At 2026-10-30, Framer introduced a remote OAuth MCP server https://mcp.framer.com/mcp. Its official help documents branch edits, pages/breakpoints, CMS and SEO changes, with the editor allowed to be closed. It does not support localization at launch. The separate local @framer/agent CLI remains supported for localization and existing local workflows.
Sources: https://www.framer.com/help/articles/what-you-can-do-with-framer-mcp/ ; https://www.framer.com/help/articles/getting-started-with-framer-mcp/ ; https://www.framer.com/help/articles/what-you-can-do-with-local-agents/ ; https://www.framer.com/blog/framer-3/ .
These are Framer's cloud and local bridge architectures, not evidence that its private server is in the public agent-plugins source. Ninerr must keep its own currently installed local authenticated MCP and add headless features only if native-tested.

## Missing evidence
Authenticated live Framer editor recording and exact private engine code were not accessed. API source-availability and method scope for all 46 pages have not been independently mapped to every internal implementation; do not claim full source reverse engineering. Framer founder permission is declared but proprietary source grant/delivery is not attached to these files. No native Ninerr parity or benchmark run was performed from this documentation audit.
