# Ninerr — Component Source System

Status (2026-11-09): **implemented:** the offline catalog with each source's license and import policy; reading a registry item into a checked, bounded form (`@ninerr/component-sources`); and importing an item the person chose into their connected codebase, planned first, then created as new files only, with its component brought onto the canvas through the existing Bring in. **Not yet implemented:** fetching items from a registry, design tokens and component instances on the canvas (they need the document schema the design-platform ADRs propose), an interactive React preview, and three-way updates of an imported item. Each is listed under "What remains" with what it waits on.

## Required sources

| Family | Source | Role |
| --- | --- | --- |
| Foundation | shadcn/ui | Owned source files, design tokens, component composition, registry format |
| Foundation | Base UI | Default accessible React primitives for **new** generated projects |
| Foundation | Radix UI | Accessible alternative for existing/imported Radix projects |
| Specialist | Sonner | Toasts and notifications |
| Specialist | Vaul | Gesture-driven drawers |
| Specialist | cmdk | Command palettes and searchable choices |
| Specialist | NumberFlow | Localized animated numbers |
| Gallery | Beautiful UI (Turbo), www.beautifului.dev | AI-native interface states, streaming, approval and agent workflows |
| Gallery | Beautiful UI (Notchset), beautiful-ui.dev | React 19 components, charts, Base UI and Radix variants |
| Gallery | RareUI (Swappy), rareui.in | Expressive buttons, motion and effects |
| Gallery | Rare UI (Swami), rareui.com | Separate animated registry with Commons Clause restrictions |
| Gallery | Magic UI | Animated UI and polished sections |
| Gallery | Aceternity UI | Landing-page motion and visual layouts |
| Marketplace | 21st.dev | Per-author React components, themes and templates |

The live curated metadata lives in `packages/component-sources/src/catalog.mjs` and is accessible from the **Component sources** button in the Ninerr editor. Search and category filters run entirely in the browser with **no network access**. Selecting an entry shows its source, intent, usage, license review gate and a manual setup example. No components are downloaded, installed, copied, imported or executed by the catalog.

### Licenses and what Ninerr may import

Checked against each publisher's own license file or terms on 2026-11-09. Nothing from any source is bundled with Ninerr; the catalog names them, and an import puts an item into the person's own project under the item's license. Each catalog entry carries this as `license` and `importPolicy`.

| Source | License | Import policy | Registry items | Evidence |
| --- | --- | --- | --- | --- |
| shadcn/ui | MIT, Copyright (c) 2023 shadcn | allowed | `https://ui.shadcn.com/r/styles/<style>/<name>.json` | https://github.com/shadcn-ui/ui/blob/main/LICENSE.md |
| Base UI | MIT, Copyright (c) 2019 Material-UI SAS | allowed | npm `@base-ui/react` | https://github.com/mui/base-ui/blob/master/LICENSE |
| Radix UI | MIT, Copyright (c) 2022 WorkOS | allowed | npm `radix-ui`, `@radix-ui/react-*` | https://github.com/radix-ui/primitives/blob/main/LICENSE |
| Sonner | MIT, Copyright (c) 2023 Emil Kowalski | allowed | npm `sonner` | https://github.com/emilkowalski/sonner/blob/main/LICENSE.md |
| Vaul | MIT, Copyright (c) 2023 Emil Kowalski | allowed | npm `vaul` | https://github.com/emilkowalski/vaul/blob/main/LICENSE.md |
| cmdk | MIT, Copyright (c) 2022 Paco Coursey | allowed | npm `cmdk` | https://github.com/dip/cmdk/blob/main/LICENSE.md |
| NumberFlow | MIT, Copyright (c) 2024 Maxwell Barvian | allowed | npm `@number-flow/react` | https://github.com/barvian/number-flow/blob/main/LICENSE.md |
| Magic UI | MIT, Copyright (c) Magic UI (Pro is separate) | allowed | `https://magicui.design/r/<name>.json` | https://github.com/magicuidesign/magicui/blob/main/LICENSE.md |
| Beautiful UI (Turbo) | MIT, Copyright (c) 2026 Shane Levine | allowed | `https://www.beautifului.dev/r/<name>.json` | https://www.beautifului.dev/license |
| Beautiful UI (Notchset) | Free items MIT; Pro items commercial | free items only | `https://beautiful-ui.dev/r/<name>.json` (Pro items answer HTTP 402) | https://beautiful-ui.dev/license |
| RareUI (Swappy) | MIT, Copyright (c) 2025 Swapnil Kalambe (RareUI) | allowed | `https://rareui.in/r/<Name>.json` | https://github.com/Codewithswappy/RareUI/blob/main/LICENSE |
| Rare UI (Swami) | MIT + Commons Clause + Attribution, Copyright (c) 2026 Swami Malode | allowed with attribution: the project must show a visible link to https://rareui.com, and the components may not be sold or redistributed themselves | GitHub raw `public/r/<name>.json` | https://github.com/swamimalode07/rare-ui/blob/main/LICENSE |
| Aceternity UI | No open-source license: site terms reserve all rights; Pro is commercial | **permission required** | not used | https://ui.aceternity.com/terms, https://ui.aceternity.com/licence |
| 21st.dev | Terms of Service: no automated collection or redistribution without written consent; registry requires sign-in | **permission required** | not used | https://21st.dev/terms |

Aceternity UI and 21st.dev stay in the catalog so a person can find them, but Ninerr will import nothing from them until the publisher grants permission in writing. The project owner decides whether to seek it.

### Source identity cautions

- **Beautiful UI** names two distinct sources, **Turbo** (`https://www.beautifului.dev`) and **Notchset** (`https://beautiful-ui.dev`); both are now indexed separately. Notchset free items are MIT, while Pro items restrict distribution as a component collection.
- **RareUI** also names two distinct sources, **Swappy** (`https://rareui.in`) and **Swami** (`https://rareui.com` / `swamimalode07/rare-ui`); both are indexed separately. Swami's registry uses MIT plus Commons Clause and attribution; do not treat this as unconditional permission to redistribute component kits.
- 21st.dev is a marketplace: each author's item requires separate license and provenance review.
- Free vs Pro items must be distinguished by *item*, not by the overall marketing site.

## Architecture: one Ninerr design system, many sources

Ninerr's existing editor is a local-first JavaScript/CSS canvas; these are React component sources, **not** new runtime dependencies of the Electron shell. The imported/generated **target project** chooses its runtime. The source system must respect Ninerr's existing single-writer transaction, document graph, code IR, local reference pack, security and attribution boundaries.

1. **Discover:** offline curated source metadata (implemented); later, explicit opt-in registry browsing and indexing into a locally saved, provenance-aware catalog.
2. **Inspect:** exact component name, source version or commit SHA, license text, dependency closure, framework, primitive base, CSS, motion, assets and network behavior. Never treat a marketplace listing as a grant.
3. **Select:** choose one **Base UI or Radix UI** primitive family per project/component. Prefer Base UI for new projects, retain Radix when existing. Do not overwrite modified shadcn components with another library's identically named file.
4. **Acquire:** owner-authorized, user-initiated import only; verify source URL and pinned content hash, preserve upstream notices. Never download paid/Pro content without a verified license. No implicit remote call on opening Ninerr, the canvas or the component picker.
5. **Convert/preview:** build reviewed, offline-compatible output via the existing code IR and renderer. A React component cannot be executed in the existing script-free canvas. Interactive previews require an **isolated, permission-scoped preview runner** with explicit opt-in and no unapproved network, host filesystem or Node integration.
6. **Apply:** create preview/dry-run and use the **existing one atomic history transaction** for an accepted change; preserve exact inverse, Undo, accessibility and deterministic output.
7. **Export:** source-owned React/TSX + Tailwind styles + design tokens + exact dependency/license manifest; never silently export an inert screenshot as though it were functional code.

### Importing an item (implemented)

In **Component sources**, under *Import a registry item*, the person chooses a saved item file or pastes its JSON, and may say which URL it came from. Ninerr fetches nothing.

1. **Read.** `parseRegistryItem` (`packages/component-sources/src/index.mjs`) reads the item: at most 1 MiB, 64 files of 256 KiB each. It refuses:
   - a path that leaves the project, however it is percent-encoded, or that names a hidden file, `node_modules`, a Windows device or a stream;
   - a file that is build configuration, a lockfile, or not component source or a stylesheet;
   - a dependency that is not an npm name with a plain version range (no URL, git, file, link or alias spec);
   - a style, base or font item, which reconfigures a project, and any request for environment variables;
   - CSS variables or rules that hide markup, a URL or an import.
2. **Judge.** A stated URL must belong to a catalog registry, and that source's import policy decides: Aceternity UI and 21st.dev URLs are recognised and refused, a Notchset item needs the person's word that it is free, and a Rare UI (Swami) item carries its required credit. An item given as a file is the person's to judge.
3. **Plan.** `POST /api/components/plan` (`packages/studio-host/src/component-import.ts`) shows every file and where it goes, using the codebase's `components.json` folders when it has one, and whether each is new, already there or in conflict. It lists the packages to add (Ninerr installs nothing), the other items needed, and the design tokens the item defines. It refuses an item that mixes primitive families, or whose family differs from the project's: a Radix project gets Radix items, a Base UI project Base UI items.
4. **Create.** `POST /api/components/apply` re-plans and goes ahead only if nothing changed. It creates each new file exclusively, never replacing one, and never through a link; if a write fails, the files and folders it created are removed. Each file starts with a notice of where it came from, its source's license and any credit its license requires; the upstream text follows unchanged.
5. **Bring in.** The components the files export are offered to **Bring in**, the codebase's existing path: one transaction on the canvas, undone by Undo. Undo does not remove the created files, which the editor says.

Only the person, through the editor's session, plans or applies an import; agents have no tool for it.

### What remains, and what it waits on

- **Fetching from a registry.** A pinned, per-item fetch from the catalog's licensed registries needs network access the host does not have today, and a decision on how a person grants it.
- **Design tokens and variants on the canvas.** The item's CSS variables are listed, not applied. Tokens, component instances and variants need document schema v2, proposed in `docs/design-platform/adr/0003` to `0005` and not approved (P13 and P14 in the design-platform plan, PR #359).
- **Interactive preview.** A React component cannot run on the script-free canvas. A preview needs an isolated, permission-scoped runner with React available offline: a separate decision.
- **Updating an imported item.** Today a changed upstream item conflicts with the created file. A three-way update against the imported version can reuse `threeWayMerge` from `@ninerr/code-ir`.
- **Aceternity UI and 21st.dev.** Their terms grant no license to import; that needs the publishers' written permission.

### Default experience once the remaining integration is built

A person searches *Command palette* → Ninerr suggests **cmdk**, shows a source-aware preview, proposes a Base UI or Radix wrapper consistent with the target, checks rights, then adds a version-pinned, editable local component to the project. The same model supports Sonner, Vaul, NumberFlow, and individual gallery components.

### Acceptance gates for the next implementation

- [ ] Real authenticated source selection and version-pinned, offline-replayable import. (Import from a file the person chose is implemented; fetching is not.)
- [ ] Component model covers props, variants, states, slots, styling, motion and dependencies.
- [x] One primitive family per component and per project: a mixed item, or one whose family differs from the project's, is refused (`tests/component-sources.test.mjs`, `tests/component-import.test.mjs`).
- [ ] Native and generated component previews never bypass Ninerr's script-free canonical canvas.
- [ ] Accessibility: keyboard, focus, screen-reader, contrast, reduced-motion and RTL.
- [x] Security for import: no fetch, no path traversal however encoded, no build configuration, lockfile or environment written, no file replaced, no write through a link, item text treated as data only.
- [ ] Security for preview and fetch: blocked scripts and assets, no silent egress.
- [x] Licensing for import: each source's license and import policy with evidence, a notice at the top of each created file, and no import from a source whose terms grant no license. Nothing from any source is distributed with Ninerr.
- [ ] Full Windows/macOS/Linux CI and packaged app E2E.
- [ ] Code ↔ design round trip and undo/redo maintain the single document authority.

## Provenance

Official references:
- https://ui.shadcn.com/docs
- https://base-ui.com
- https://www.radix-ui.com/primitives
- https://github.com/emilkowalski/sonner
- https://github.com/emilkowalski/vaul
- https://github.com/dip/cmdk
- https://github.com/barvian/number-flow
- https://www.beautifului.dev/license
- https://github.com/Codewithswappy/RareUI
- https://github.com/magicuidesign/magicui
- https://ui.aceternity.com/installation
- https://21st.dev

Refer to `docs/design-platform/REUSE.md` and `docs/provenance/LICENSE_REGISTER.json` for Ninerr's existing adoption process. This catalog is a list of references, **not** a claim that any new donor source code is bundled or that all source terms permit redistribution.
