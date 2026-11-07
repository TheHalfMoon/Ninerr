# Framer public plugins: full 32-example static source inventory
**Observed 2026-11-07** from pinned source df96c6d0b9427b1157aac5c87a37e39d42348a27. Source: https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27

**Method:** read-only `git ls-tree` of every file under `plugins/`; inspect each `plugins/<name>/package.json`; static `git grep -o` for literal `framer.method` calls. This is an exhaustive inventory of *the public plugin example tree at this SHA*, not a full semantic code audit of each example and not the private Framer editor.

**Coverage:** 32 examples; 670 repository file paths; 395 JavaScript/TypeScript source file paths; 17 test file paths (enumerated, **not executed**). Methods are regex-detected names, not a complete dynamic call graph.

| Public example | Total files | JS/TS files | Test files | Distinct literal Framer API references | Sample API calls (first eight by frequency) |
|---|---:|---:|---:|---:|---|
| [3rd-party-optimizer](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/3rd-party-optimizer) | 10 | 3 | 0 | 3 | `setCustomCode`, `showUI`, `subscribeToCustomCode` |
| [airtable](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/airtable) | 24 | 16 | 1 | 9 | `notify`, `showUI`, `closePlugin`, `setMenu`, `getActiveManagedCollection`, `getManagedCollections`, `hideUI`, `isAllowedTo` |
| [ascii](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/ascii) | 26 | 15 | 0 | 8 | `mode`, `setImage`, `showContextMenu`, `showUI`, `subscribeToImage`, `addImage`, `closePlugin`, `notify` |
| [ashby](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/ashby) | 23 | 15 | 3 | 9 | `notify`, `closePlugin`, `isAllowedTo`, `getActiveManagedCollection`, `getManagedCollections`, `getPluginData`, `mode`, `setPluginData` |
| [cms-export](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/cms-export) | 13 | 5 | 0 | 4 | `notify`, `getActiveCollection`, `getCollections`, `showUI` |
| [code-link](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/code-link) | 22 | 15 | 4 | 11 | `getCodeFiles`, `showUI`, `getProjectInfo`, `closePlugin`, `createCodeFile`, `hideUI`, `isAllowedTo`, `setBackgroundMessage` |
| [code-versions](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/code-versions) | 35 | 28 | 4 | 8 | `closePlugin`, `mode`, `getCodeFile`, `hideUI`, `showUI`, `subscribeToCodeFiles`, `subscribeToOpenCodeFile`, `subscribeToSelection` |
| [color-extract](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/color-extract) | 11 | 3 | 0 | 4 | `setAttributes`, `closePlugin`, `showUI`, `subscribeToSelection` |
| [concentric](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/concentric) | 11 | 3 | 0 | 4 | `setAttributes`, `closePlugin`, `showUI`, `subscribeToSelection` |
| [csv-import](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/csv-import) | 29 | 22 | 0 | 10 | `notify`, `setCloseWarning`, `closePlugin`, `createCollection`, `getActiveCollection`, `getCollection`, `getCollections`, `hideUI` |
| [design-system](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/design-system) | 22 | 5 | 0 | 4 | `addDetachedComponentLayers`, `createColorStyle`, `getColorStyles`, `showUI` |
| [dither](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/dither) | 24 | 11 | 0 | 8 | `mode`, `setImage`, `showContextMenu`, `showUI`, `subscribeToImage`, `addImage`, `closePlugin`, `notify` |
| [doodles](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/doodles) | 11 | 3 | 0 | 7 | `closePlugin`, `mode`, `addImage`, `notify`, `setImage`, `showUI`, `uploadImage` |
| [flip-image](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/flip-image) | 9 | 3 | 0 | 4 | `closePlugin`, `getImage`, `isAllowedTo`, `setImage` |
| [global-search](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/global-search) | 55 | 48 | 4 | 10 | `getNodesWithType`, `showUI`, `notify`, `closePlugin`, `getCanvasRoot`, `getCodeFiles`, `getCollections`, `getNode` |
| [google-search-console](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/google-search-console) | 42 | 25 | 1 | 3 | `showUI`, `notify`, `subscribeToPublishInfo` |
| [google-sheets](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/google-sheets) | 26 | 18 | 0 | 10 | `notify`, `setCloseWarning`, `closePlugin`, `showUI`, `isAllowedTo`, `getActiveManagedCollection`, `hideUI`, `mode` |
| [greenhouse](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/greenhouse) | 20 | 11 | 0 | 9 | `notify`, `closePlugin`, `isAllowedTo`, `getActiveManagedCollection`, `getManagedCollections`, `getPluginData`, `mode`, `setPluginData` |
| [hubspot](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/hubspot) | 51 | 42 | 0 | 11 | `notify`, `getActiveManagedCollection`, `closePlugin`, `mode`, `setCustomCode`, `getCustomCode`, `setMenu`, `addComponentInstance` |
| [locale-sync](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/locale-sync) | 13 | 6 | 0 | 7 | `notify`, `getLocales`, `getActiveLocale`, `getDefaultLocale`, `listLocalizationGroups`, `setLocalizationData`, `showUI` |
| [notion](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/notion) | 24 | 14 | 0 | 9 | `notify`, `setCloseWarning`, `showUI`, `closePlugin`, `setMenu`, `getActiveManagedCollection`, `getCollections`, `isAllowedTo` |
| [phosphor](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/phosphor) | 11 | 3 | 0 | 2 | `addSVG`, `showUI` |
| [photobooth](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/photobooth) | 10 | 3 | 0 | 5 | `addImage`, `closePlugin`, `mode`, `setImage`, `showUI` |
| [pong](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/pong) | 14 | 7 | 0 | 4 | `getRect`, `setAttributes`, `showUI`, `subscribeToSelection` |
| [prco](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/prco) | 19 | 11 | 0 | 12 | `notify`, `closePlugin`, `isAllowedTo`, `getActiveManagedCollection`, `getManagedCollections`, `getPluginData`, `mode`, `setPluginData` |
| [recruitee](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/recruitee) | 19 | 11 | 0 | 9 | `notify`, `closePlugin`, `isAllowedTo`, `getPluginData`, `setPluginData`, `getActiveManagedCollection`, `getManagedCollections`, `mode` |
| [redirect-sync](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/redirect-sync) | 13 | 6 | 0 | 4 | `notify`, `getRedirects`, `addRedirects`, `showUI` |
| [renamer](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/renamer) | 30 | 21 | 0 | 9 | `getNodesWithType`, `getCanvasRoot`, `getNode`, `notify`, `setSelection`, `showUI`, `subscribeToCanvasRoot`, `subscribeToSelection` |
| [rss-feeds](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/rss-feeds) | 13 | 6 | 0 | 5 | `closePlugin`, `getActiveManagedCollection`, `isAllowedTo`, `mode`, `showUI` |
| [threshold](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/threshold) | 15 | 6 | 0 | 5 | `showUI`, `closePlugin`, `hideUI`, `setImage`, `subscribeToImage` |
| [tidyup](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/tidyup) | 13 | 5 | 0 | 4 | `getNode`, `showUI`, `subscribeToCanvasRoot`, `subscribeToSelection` |
| [unsplash](https://github.com/framer/plugins/tree/df96c6d0b9427b1157aac5c87a37e39d42348a27/plugins/unsplash) | 12 | 5 | 0 | 5 | `mode`, `addImage`, `closePlugin`, `setImage`, `showUI` |

## Selected source-to-feature groups

- **Local-canvas/capability examples:** design-system, global-search, code-versions, renamer, tidyup, color-extract, dither and ascii may yield reusable source patterns, but each must undergo dependency/UI/permissions testing before porting.
- **Data integration/CMS examples:** airtable, notion, google-sheets, csv-import, cms-export, rss-feeds, hubspot and recruiting/job-system integrations show contracts; keep third-party login/network as optional, never mandatory for Ninerr core.
- **Code/source tooling:** code-link, code-versions and associated root packages code-link-cli, code-link-shared and plugin-tools merit additional review for minimal-diff write-back and source provenance.
- **Utilities, media and demos:** photobooth, flip-image, phosphor, unsplash, pong and others illustrate plugin host usage but are not evidence of the private Framer Canvas engine.

## Data quality and rights

- There are 58 distinct literal `framer.*` names across these plugins; counts include properties/modes and may miss destructured, aliased, dynamically computed or indirect SDK calls. These are **not** verified API parity claims.
- Root GitHub repo reports MIT. Individual package manifests may omit a `license` field. Review third-party assets, dependencies, copyright files and licenses before bundling them. See FRAMER_RIGHTS_AND_ACCESS_LEDGER_2026-11-06.md.
- The fork/source Census has 20 public repositories but does not enumerate Framer private repositories. This inventory is complete only for the specific 32 plugin examples at pinned HEAD.
- No screenshots, generated code, user data, proprietary editor source or network credentials were copied into this report.

## Testing the top five candidates

1. **global-search:** bounded incremental index, project switch and permission scope, >500 results, stale node references and query UX.
2. **code-link:** source path safety, disconnection/reconnection, source attribution and conflict on external file write; review its bundled CLI separately.
3. **code-versions:** selected CodeFile version history, no-op byte identity, rollback integrity, test FileDiff behavior.
4. **design-system:** named color style registry and component-token alias references, ownership and undo.
5. **tidyup:** document mutation preview, selection scope, axis/position invariants and single-transaction undo.

## Reproduction command examples

git -C .local-evidence/framer-2026-11-06/src/framer-plugins rev-parse HEAD
git -C .local-evidence/framer-2026-11-06/src/framer-plugins ls-tree -r --name-only HEAD -- plugins
git -C .local-evidence/framer-2026-11-06/src/framer-plugins grep -o -E "framer\.[A-Za-z_][A-Za-z0-9_]*" HEAD -- plugins

**Status: public-plugin source inventory complete; native benchmark, private Framer engine access and actual Ninerr implementations remain open.**
