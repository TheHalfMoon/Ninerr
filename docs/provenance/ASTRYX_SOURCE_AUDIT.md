# Meta Astryx: source audit (milestone A)

Audited 2026-11-10 for the founder's request to integrate Meta Astryx into Ninerr's design and component system. Every statement below was checked against the source at the pinned commit; nothing from the repository was run.

## Identity

| | |
| --- | --- |
| Project | Astryx, "an open source design system that's fully customizable and agent ready" |
| Repository | https://github.com/meta/astryx |
| Website | https://astryx.atmeta.com |
| Pinned commit | `2309691dba9533635259113316a2cb14ec832933` (2026-11-10) |
| Packages at that commit | `@astryxdesign/core`, `cli`, `build` and `richtext` 0.7.12, and seven themes (`theme-butter`, `chocolate`, `gothic`, `matcha`, `neutral`, `stone`, `y2k`), released together. `charts`, `lab`, `vega` and `native` are private in git and published only as canaries. |
| License | MIT, "Copyright (c) 2026 Meta Platforms, Inc." Source files carry "Copyright (c) Meta Platforms, Inc. and affiliates". There is no NOTICE file and no SPDX header. `packages/core/src/theme/syntax/THIRD_PARTY_LICENSES.md` credits the MIT editor themes its syntax colors come from (color values only). |

## What it is, from the source

- **Components.** About 120 components and their parts (189 documented, with their parts) in `packages/core/src`, in the categories Layout, Form Controls, Table & List, Navigation, Action, Overlay, Feedback & Status, Content, Container and Chat. They are React 19 components styled with StyleX. Core depends on `intl-messageformat` and takes `@stylexjs/stylex`, React and React DOM as peer dependencies.
- **No third-party primitives.** Astryx uses no Radix, Base UI, React Aria, Floating UI or cmdk. Accessibility is its own code on native platform features: `<dialog>` with focus containment, the Popover API with CSS anchor positioning, combobox and listbox roles with `aria-activedescendant`, and logical properties for RTL. It is tested by about 305 Playwright accessibility specs, axe-core audits and a visual gate of 516 baseline images.
- **Component metadata.** Each component has a `*.doc.mjs` file holding its name, category, keywords, props with type strings and defaults, usage guidance, accessibility criteria, theming targets and examples. These files are plain object literals, which is how Ninerr reads them without running them.
- **Design tokens.**
  - Format: StyleX `defineVars` in `packages/core/src/theme/tokens.stylex.ts`, whose keys are literal CSS custom properties (`--color-accent`, `--spacing-4`, `--radius-element`, `--duration-fast`, `--easing-standard`, `--text-body-size`, and so on). They reach the compiled CSS unchanged.
  - Light and dark: one value per token, written with CSS `light-dark()`.
  - Breakpoints are a theme option, not tokens.
  - No JSON or DTCG token file exists. The framework-neutral form is the CSS: `@astryxdesign/core/astryx.css` and each theme's `theme.css`.
- **Themes.** `defineTheme()` overrides token values and per-component styles through stable `astryx-*` classes and `data-*` attributes. Each theme's `fonts.css` imports Google Fonts over the network.
- **CLI** (`@astryxdesign/cli`, bin `astryx`): `init`, `search`, `docs`, `component`, `template`, `swizzle` (copies a component's source and its internal modules into a project), `theme`, `upgrade` (codemods), `manifest`, `experimental render`, and more.
  - It reads the installed package and bundled assets. It has no remote registry and no shadcn-format registry items.
  - Two commands go online: `blog` (astryx.atmeta.com) and the update check (`npm view`; `NO_UPDATE_NOTIFIER` turns it off). The `core` and `cli` packages run a `postinstall` script.
- **Agent-facing features.** The MCP server is a hosted route of the docs site (`apps/docsite/src/app/mcp/route.ts`, tools `search` and `get`); no published package contains one. There is an `llms.txt`, and the CLI commands take `--json`.
- **Static rendering.** `astryx experimental render` turns a page into one self-contained HTML file. It renders with `renderToStaticMarkup`, trims the CSS to the rules the markup uses, and runs no script. The API is marked experimental.

## How it fits Ninerr

| Astryx capability | Ninerr's existing place for it | Decision |
| --- | --- | --- |
| Component metadata (`*.doc.mjs`) | The catalog's discovery, now with one normalized record schema for every source (`packages/component-sources/src/records.mjs`) | **Done in this milestone.** Records for 189 Astryx components and their documented parts (hooks and factory functions excluded), generated from the pinned commit by static parsing (`scripts/component-sources/astryx-snapshot.mjs`), with each doc file's sha256. The records file itself is pinned by hash in the license register. |
| A design system with its own primitives | The one-primitive-family rule (Base UI, Radix, React Aria) | **Done.** `@astryxdesign/core` is the `astryx` family. A project on Astryx refuses a shadcn item built on Radix or Base UI, and the reverse. |
| CSS custom-property tokens with `light-dark()` | The design-system node (ADR-0004), light as the default mode and dark as a mode | **Done (milestone D).** In Tokens, a CSS file the person chooses (`astryx.css`, a theme's `theme.css`) is read by `tokensFromCss` and planned by the existing token-import rules. Astryx's 269 `:root` properties at the pinned commit give 247 tokens (105 the same in both modes, 142 with light and dark values from `light-dark()`); 22 durations, easings, sizes, border and outline settings and a private property have no Ninerr token type and stay Astryx's CSS. Its neutral theme's `theme.css` (tokens in `@scope (…) { :scope { … } }`) gives 186 tokens and keeps 20; its coarse-pointer sizes and `[data-astryx-media]` rules (for content over media, not the page's dark mode) are skipped. |
| Static HTML from `astryx experimental render` | The HTML importer (`@ninerr/import-stack`) and the script-free canvas | **Done (milestone C).** With the founder's approval (2026-11-10), Astryx's `login-card` template was rendered by its own renderer (`@astryxdesign/cli` 0.7.11 from npm, install scripts off, outside Ninerr). The existing HTML import brings it in as 77 layers with its classes and stylesheet; its source block is removed like any script. On the canvas, seven of its texts match Astryx's own rendering in colour, font size, weight, family, background, size and place in the card (within 1 px), and so do the card's size and the line height it inherits. Two canvas fixes made that true for any imported page: a reset's `:where(html)` and `:where(body)` now name the page frame, and a body declaration of `inherit` no longer undoes the html one now that both are the frame (the inherited line height was lost), and the canvas's own defaults (base font, link look) are in a cascade layer so a page's layered styles win (its links were drawn LinkText). Inputs and icons are not compared. One difference stays: a page that sets no font gets the canvas's `system-ui`, where a browser uses its own default. |
| CLI `swizzle` (copy-first source ownership) | Imports write into the person's codebase only through a reviewed plan | Use Astryx's own `swizzle`, run by the person; Ninerr then brings the copied components in. Ninerr does not re-implement it. |
| Hosted MCP route and CLI | Ninerr's own MCP tools and its local, offline records | **Done (milestone E).** Agents use Ninerr's read tools `search_components` and `get_component` over the pinned local records: exact props, variants, accessibility criteria, limitations and provenance. Ninerr does not call the hosted route: nothing leaves loopback. |

### Compatibility rules

1. **One system per project.** Astryx brings its own accessible components. Do not mix them with shadcn/Base UI/Radix components for the same role. The primitive-family rule enforces it for items built on another family's primitives; an item with no primitives (a hook, a utility, a plain styled element) is not refused, and the choice is the person's. A project that already depends on two families takes no item until it settles on one.
2. **Styling.** Astryx styles are StyleX. A project that installs `@astryxdesign/core` and its prebuilt `astryx.css` needs no StyleX compiler. Copied (swizzled) source needs `@astryxdesign/build`. Astryx ships `tailwind-theme.css`, which maps its tokens into Tailwind v4, so a Tailwind project can use Astryx tokens. Ninerr keeps Tailwind classes and StyleX code parts as they are; it does not translate one into the other.
3. **Tokens.** Ninerr's canonical tokens stay in the design-system node. Astryx token values are translated into it where a Ninerr token type exists. Anything else stays native CSS.
4. **Choosing between equivalents** (for example, Astryx `Toast` against Sonner, or `CommandPalette` against cmdk): first accessibility, then correctness, design quality, customizability, performance, dependency cost, maintainability and integration complexity. In a project already on Astryx, its own component is usually right because a second library adds a second styling system. Astryx is never chosen only because of who publishes it.

### Offline and security notes

- Ninerr fetches nothing from Astryx. Its records are committed at a pinned commit and refreshed only by regenerating them from a checkout.
- Ninerr loads no Astryx theme fonts from Google Fonts.
- A person who installs Astryx runs its `postinstall` scripts in their own project. Ninerr does not install it.

## Decisions this audit leaves to the founder

- **Agent imports.** Today only the person applies an import. Letting an agent apply one, even behind an approval, changes the agent contract.
