# Framer — Deep Craft Anything REA (public-surface observations)

**Observed:** 2026-11-07; **tool:** owner-local Craft Anything 0.3.0 in Deep mode, persistent MCP browser session (CDP on Windows).

**Scope boundary:** This is visual, responsive, publicly loaded JavaScript and UI-state analysis of **signed-out public Framer pages**. It is NOT evidence of the private Framer Canvas runtime, authenticated CMS editor, or Framer cloud services. A request from the public homepage to /site/users/me returned HTTP 401 without login; no authentication was attempted.

## 1. Reproducible captures and provenance

Each completed capture includes `capture.json` (design/layout data), `README.md`, `page.html`, and nominal-width 1440/768/390 screenshots. The screenshots are kept in ignored owner-local `.local-evidence`, **not committed to GitHub**. Screenshots stop at 5500 CSS px, so long-page conclusions are limited to the captured portion. Captures use a fresh browser profile with no account history.

| Public surface | Capture status | CSS widths | Measured full document height at 1440 (not screenshot height) | SHA256(capture.json) |
|---|---|---|---:|---|
| [homepage](https://www.framer.com/) | complete (3/3 PNGs) | 1440/768/390 | 13031 | `d3418a0165300ef8adee74c64e95b4ad7c14607f779ec57e7a192bf37f7917bd` |
| [editor-academy](https://www.framer.com/academy/lessons/framer-interface) | complete (3/3 PNGs) | 1440/768/390 | 3308 | `bd0350f0e4b8532bd428ef9561db95a6f074a0915344693beafe396b6f65c994` |
| [cms](https://www.framer.com/cms/) | complete (3/3 PNGs) | 1440/768/390 | 11246 | `895a4bd5a160a570c6fda555051285bb63ca6dc75adc363224630831d17b6fa8` |
| [agents](https://www.framer.com/agents/) | complete (3/3 PNGs) | 1440/768/390 | 23189 | `e13a689f5bed31c98a253b52bed04bd5de9e43da38630c00303f26b9cbf2a620` |
| [plugin-reference](https://www.framer.com/developers/reference) | complete (3/3 PNGs) | 1440/768/390 | 10168 | `ea889028045855145f5afe926ee78cbce16228aeb71bc7c9a048857720d30e99` |

## 2. Layout measurements and visual design evidence

These are **marketing/docs site design tokens**, not the canonical Ninerr product design system and not proof that the signed-in Framer editor uses those tokens. Prefer patterns, not brand cloning.

### homepage — Public product homepage

- Public URL: https://www.framer.com/; page title: Framer: Free website builder and AI design agent.
- Layout: 1440px view ⇒ 1425px page width, 13031px page height, 16 detected layout blocks; 768px view ⇒ 753px page width, 13635px page height, 16 detected layout blocks; 390px view ⇒ 390px page width, 12076px page height, 16 detected layout blocks.
- Media-query thresholds observed: 809, 810, 1199, 1200 CSS px.
- Fonts (observed): "Inter Variable", "Inter Variable Placeholder", sans-serif (165), Inter, "Inter Placeholder", sans-serif (12), "GT Walsheim Medium", "GT Wal.
- Dominant sample text colors: #ffffff99 (109), #ffffff (69), #000000 (4), #050505 (3), #999999 (3), #222222 (2), #0099ff (1).
- Dominant sample backgrounds: #000000 (38), #ffffff (11), #ffffff1a (7), #878787 (3), #000000b3 (1), #121212 (1), #0099ff1a (1).
- Typical radii: 8px (115), 6px (38), 18px (11), 3px (9), 20px (8), 25px (6), 15px (6).
- Typical spacing values: 5px (256), 10px (186), 20px (90), 25px (68), 40px (51), 1px (44), 8px (28).
- Nominal screenshots: screenshot-1440.png SHA256 13552b5e429e; screenshot-768.png SHA256 df261ef951d9; screenshot-390.png SHA256 7d35a0e0245d.

### editor-academy — Public editor interface lesson

- Public URL: https://www.framer.com/academy/lessons/framer-interface; page title: Learn the Framer interface on Framer Academy.
- Layout: 1440px view ⇒ 1425px page width, 3308px page height, 5 detected layout blocks; 768px view ⇒ 753px page width, 4643px page height, 6 detected layout blocks; 390px view ⇒ 390px page width, 5580px page height, 6 detected layout blocks.
- Media-query thresholds observed: 809, 810, 1199, 1200 CSS px.
- Fonts (observed): "Inter Variable", "Inter Variable Placeholder", sans-serif (150), Inter, "Inter Placeholder", sans-serif (5), "GT Walsheim Framer Medium", ".
- Dominant sample text colors: #ffffff99 (104), #ffffff (40), #ffffffcc (10), #000000 (2), #222222 (2), #0099ff (1).
- Dominant sample backgrounds: #000000 (14), #ffffff (7), #ffffff00 (2), #ffffff0d (1), #dedede (1).
- Typical radii: 8px (100), 3px (9), 12px (6), 18px (3), 100px (1), 9px (1), 10px (1).
- Typical spacing values: 5px (238), 10px (123), 20px (48), 15px (41), 3px (36), 4px (20), 12px (14).
- Nominal screenshots: screenshot-1440.png SHA256 9f679a19ab12; screenshot-768.png SHA256 b6a32d90443c; screenshot-390.png SHA256 8555062de384.

### cms — Public CMS feature page

- Public URL: https://www.framer.com/cms/; page title: Framer: AI CMS for dynamic websites.
- Layout: 1440px view ⇒ 1425px page width, 11246px page height, 13 detected layout blocks; 768px view ⇒ 753px page width, 16992px page height, 13 detected layout blocks; 390px view ⇒ 390px page width, 14357px page height, 13 detected layout blocks.
- Media-query thresholds observed: 809, 810, 1199, 1200 CSS px.
- Fonts (observed): Inter, "Inter Placeholder", sans-serif (504), "Inter Variable", "Inter Variable Placeholder", sans-serif (214), "GT Walsheim Medium", "GT Wa.
- Dominant sample text colors: #ffffff (285), #999999 (217), #ffffff99 (131), #666666 (37), #00bb88 (23), #0099ff (8), #ffffffcc (6).
- Dominant sample backgrounds: #242424 (76), #ffffff12 (67), #1e1e1e (37), #000000 (34), #ffffff (30), #666666 (29), #111111 (26).
- Typical radii: 8px (240), 15px (93), 6px (75), 4px (51), 5px (28), 10px (28), 50% (20).
- Typical spacing values: 10px (1197), 15px (1060), 8px (293), 5px (283), 20px (229), 6px (183), 1px (97).
- Nominal screenshots: screenshot-1440.png SHA256 966cdc560280; screenshot-768.png SHA256 91e455f73fe3; screenshot-390.png SHA256 8d728973899f.

### agents — Public Agent marketing page

- Public URL: https://www.framer.com/agents/; page title: Framer: Agents.
- Layout: 1440px view ⇒ 1425px page width, 23189px page height, 7 detected layout blocks; 768px view ⇒ 753px page width, 30257px page height, 7 detected layout blocks; 390px view ⇒ 390px page width, 22955px page height, 7 detected layout blocks.
- Media-query thresholds observed: 809, 810, 1199, 1200 CSS px.
- Fonts (observed): "Inter Variable", "Inter Variable Placeholder", sans-serif (311), Inter (96), Inter, "Inter Placeholder", sans-serif (65), "GT Walsheim Medi.
- Dominant sample text colors: #ffffff (227), #ffffff99 (213), #999999 (36), #ffffffcc (4), #000000 (4), #0099ff (3), #222222 (2).
- Dominant sample backgrounds: #0099ff00 (98), #0066ff (96), #ffffff1a (71), #000000 (38), #303030 (15), #000000e6 (10), #ffffff (9).
- Typical radii: 8px (122), 25px (98), 5px (21), 20px (14), 13px (12), 3px (9), 100px (8).
- Typical spacing values: 10px (728), 20px (352), 30px (340), 5px (280), 15px (61), 25px (50), 8px (43).
- Nominal screenshots: screenshot-1440.png SHA256 3cb529d5b368; screenshot-768.png SHA256 9771805e44e0; screenshot-390.png SHA256 8c64f4777c3b.

### plugin-reference — Official plugin API reference

- Public URL: https://www.framer.com/developers/reference; page title: Framer Developers: Reference.
- Layout: 1440px view ⇒ 1425px page width, 10168px page height, 4 detected layout blocks; 768px view ⇒ 753px page width, 10850px page height, 4 detected layout blocks; 390px view ⇒ 390px page width, 11417px page height, 4 detected layout blocks.
- Media-query thresholds observed: 809, 810, 1199, 1200 CSS px.
- Fonts (observed): "Inter Variable", "Inter Variable Placeholder", sans-serif (229), "JetBrains Mono", "JetBrains Mono Placeholder", sans-serif (69), Inter, "I.
- Dominant sample text colors: #ffffff99 (175), #ffffff (114), #999999 (24), #ffffffcc (6), #0099ff (6), #000000 (2), #222222 (2).
- Dominant sample backgrounds: #000000 (13), #ffffff (7), #ffffff00 (4), #111111 (2), #8855ff26 (1), #dedede (1).
- Typical radii: 8px (100), 3px (6), 12px (5), 10px (4), 6px (2), 14px (1), 18px (1).
- Typical spacing values: 10px (335), 5px (222), 20px (209), 15px (30), 3px (24), 4px (18), 12px (12).
- Nominal screenshots: screenshot-1440.png SHA256 d14f87f2bbdd; screenshot-768.png SHA256 408c6c92a440; screenshot-390.png SHA256 661f3eae9fbb.

## 3. Browser JavaScript/module observations

Craft Anything inspected JavaScript **actually loaded by these public pages**, not an authenticated editor bundle. Browser script graphs may include vendors and marketing widgets; they do not establish Framer internal Canvas source availability.

- mcp-session-results.json: JavaScript analyzer examined 35 of 70 detected entries, partial result saved in Craft Anything evidence ledger.
- mcp-session-results.json: module graph examined 45 of 81 imports/scripts; static graph, not dynamic editor execution.
- mcp-session-results.json: JavaScript analyzer examined 35 of 57 detected entries, partial result saved in Craft Anything evidence ledger.
- mcp-session-results.json: module graph examined 45 of 59 imports/scripts; static graph, not dynamic editor execution.
- mcp-session-results-homepage.json: JavaScript analyzer examined 35 of 76 detected entries, partial result saved in Craft Anything evidence ledger.
- mcp-session-results-homepage.json: module graph examined 45 of 78 imports/scripts; static graph, not dynamic editor execution.
- JS analyzer calls: 3; module graph calls: 3. Source maps were **not** fetched. No secret-bearing network bodies were collected.

## 4. UI-state coverage and observed limitations

Craft Anything attempted to open up to three first-order menus, tabs, dialogs or collapsible controls on selected public pages. Several returned **zero eligible controls**; this is a coverage limitation and must not be reported as a passed interaction test. The homepage pass was also retried after creating capture directories. No forms were submitted, no accounts created and no user data inspected.

- homepage: state-capture manifest present; do not infer in-app editor interaction success from this alone.
- editor-academy: state-capture manifest present; do not infer in-app editor interaction success from this alone.
- agents: state-capture manifest present; do not infer in-app editor interaction success from this alone.
- plugin-reference: state-capture manifest present; do not infer in-app editor interaction success from this alone.

## 5. Product workflow mapping: Framer → offline Ninerr

Framer Academy publicly describes five editor views (Canvas, CMS, Localization, Analytics and Settings) and an editing workspace with Pages/Layers/Assets on the left, contextual properties on the right, and preview/publish controls. This description is **documentation evidence**, not a recorded authenticated editor journey: https://www.framer.com/academy/lessons/framer-interface

| Observed or documented workflow | Ninerr local-desktop adaptation | Required acceptance evidence | Priority |
|---|---|---|---|
| Canvas with Pages/Layers/Assets and property inspector (Academy documentation) | One local canonical document, page/layer tree, inspector and responsive preview | Windows installed app journey: create/reorder/undo/reopen; keyboard focus and RTL | P0 |
| Responsive layouts and component variants (site captures and API reference) | Breakpoint-aware document constraints; do **not** hard-code public marketing-site 810/1200px breakpoints into editor defaults | Desktop/tablet/mobile screenshot baselines + resizing + no horizontal overflow | P0 |
| Public plugin API and popover/window support (official developer docs) | Local sandboxed extension host, permission prompts, owner-only file/network access | UI lifecycle/show/hide/close, focus, resize, local MCP denied grants | P0 |
| CMS, collections, content in context (public CMS page) | Structured local content store and preview; export owned static content locally | Collection schema migration, missing reference, undo, local import/export, offline | P1 |
| Localization and new Content panel (official Nov 2 2026 update) | Human-controlled local locales and RTL; optional external translation **only if separately enabled** | Arabic text shaping, directionality, fallback locale and no-cloud guarantees | P1 |
| Agent-assisted changes and branch review (public Agents page/Academy) | Local MCP controlled patch/preview/reject/commit; no hosted inference/computing requirement | Two independent agents, permission refusal, kill/restart recovery, no remote endpoints | P0 |
| Motion/animation rendering | Optional public MIT Motion adapter with reduced-motion and static export | springs, hover/drag, frame determinism, export frozen state, memory budget | P1 |
| Publish/analytics/settings in Framer hosted workflow | Local-first preview/export, user-owned deployment integration only as optional plugin | No compulsory Ninerr cloud, offline start and export, no telemetry | P0 |

## 6. Known new relevant public changes

- Official Framer Updates dated **2026-11-02** describes the new localization **Content panel**, helping content inclusion/hiding across locales. See https://www.framer.com/updates (captured by public web research).
- Official Framer Updates dated **2026-10-27** describes multiplayer cursors for CMS formatted text fields/Canvas, which is a hosted collaborative feature; Ninerr must not assume cloud multiplayer. See https://www.framer.com/updates.
- The official plugin reference includes branching, Canvas, CMS, CodeFile, localization, permissions, publishing, settings and plugin UI. Each is an API contract, **not** a copy of its server-side implementation. https://www.framer.com/developers/reference

## 7. Scope, IP, security and release gates

- The founder states direct permission for Framer copying/rebranding. This research used only public pages and publicly released SDK/example code, not nonpublic source archives or Framer account data. Preserve verified per-file rights and third-party notices before redistribution; Ninerr project repository LICENSE is Apache-2.0.
- Deep mode may read public website page JavaScript; this is not access to proprietary private code or authentication bypass. A signed-out browser may receive 401 on identity endpoints, which is expected and does not establish a login failure.
- Complete the 12-task native reproducible benchmark in FRAMER_REPRODUCIBLE_BENCHMARKS_2026-11-06.md using a separately authorized Framer test account and an installed Ninerr binary; these screenshots do **not** satisfy the editor functionality benchmark.
- Keep raw HTML/PNG/API captures out of private source history and releases to avoid unnecessary third-party media redistribution. Keep checksums, URL, date and interpretation in the repository.

## 8. Next engineering deliverables and decision

1. Prioritize Ninerr editor shell and Canvas tree correctness, locally authenticated MCP, and deterministic responsive preview; run a minimal installed Windows journey.
2. Add shared design tokens/CodeFile original-byte access/live event subscriptions only after the canonical document and security contract are proven (see FRAMER_NINERR_DIRECT_PORT_CONTRACT_2026-11-07.md).
3. Run Craft Anything again against authenticated Framer **only through a user-authorized account/test project**, capturing feature operations (not private secrets) and comparing with Ninerr.
4. Independent design/product/security review, real benchmark scores and owner release approval must precede parity claims.

**Decision:** Public-facing Deep Craft Anything pass = completed for targets with complete captures; full editor deep parity = OPEN / NOT VERIFIED; bounded Ninerr desktop engineering = CONDITIONAL GO.

## 9. Native Craft Anything engine receipt and reproducibility

- Craft Anything 0.3.0 project (owner-private local): `.local-evidence/framer-2026-11-07/deep-framer-public.cany`; Deep mode + a fresh CDP browser, public URLs only.
- Native evidence ledger: **22 evidence records, 4 explicitly recorded findings**, 0 open questions as of this pass; owner-local `.local-evidence/framer-2026-11-07/CRAFT_ANYTHING_ENGINE_REPORT.md`. This is not a zero-defect claim; in-editor features were out of scope.
- Responsive capture manifest with 15 PNG SHA256 values plus capture.json hashes is owner-local `.local-evidence/framer-2026-11-07/craftanything-capture-manifest.json`. The research branch intentionally stores **hashes and observations, not third-party screenshot binaries**.
- Two initial CLI errors occurred because `captures/` and `states/` parent folders were absent; folders were created and the homepage capture was rerun successfully. Final **5/5 public pages and 15/15 responsive PNGs** were verified present. No repair of a private/Framer login was attempted.
- The public JavaScript analyzer inspected three **bounded, partial** samples (35/70, 35/57, 35/76) and static import graphs (45/81, 45/59, 45/78). Evidence is partial by design and must not be described as a decompilation of the proprietary Framer editor.
