# Ninerr — Component Source System

Status (2026-11-09): **Source catalog and in-editor offline discovery implemented.** Component ingestion, live React preview, registry installation, conversion and design/code round trips are **not** yet implemented by this change.

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
| Gallery | Beautiful UI (Turbo), beautifului.dev | AI-native interface states, streaming, approval and agent workflows |
| Gallery | RareUI (Swappy), rareui.in | Expressive buttons, motion and effects |
| Gallery | Magic UI | Animated UI and polished sections |
| Gallery | Aceternity UI | Landing-page motion and visual layouts |
| Marketplace | 21st.dev | Per-author React components, themes and templates |

The live curated metadata lives in `packages/studio-web/src/ui-sources.mjs` and is accessible from the **Component sources** button in the Ninerr editor. Search and category filters run entirely in the browser with **no network access**. Selecting an entry shows its source, intent, usage, license review gate and a manual setup example. No components are downloaded, installed, copied, imported or executed by the catalog.

### Source identity cautions

- **Beautiful UI (Turbo)** is `https://www.beautifului.dev`, *not* the unrelated `https://beautiful-ui.dev` (Notchset). Both can be evaluated separately, but they are not interchangeable.
- **RareUI (Swappy)** is `https://rareui.in` / `Codewithswappy/RareUI`, *not* the distinct `rareui.com` / `swamimalode07/rare-ui`. The latter has additional restrictions on component redistribution.
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

### Default experience once the remaining integration is built

A person searches *Command palette* → Ninerr suggests **cmdk**, shows a source-aware preview, proposes a Base UI or Radix wrapper consistent with the target, checks rights, then adds a version-pinned, editable local component to the project. The same model supports Sonner, Vaul, NumberFlow, and individual gallery components.

### Acceptance gates for the next implementation

- [ ] Real authenticated source selection and version-pinned, offline-replayable import.
- [ ] Component model covers props, variants, states, slots, styling, motion and dependencies.
- [ ] Base UI and Radix outputs are tested separately; no duplicated primitive import for a given component.
- [ ] Native and generated component previews never bypass Ninerr's script-free canonical canvas.
- [ ] Accessibility: keyboard, focus, screen-reader, contrast, reduced-motion and RTL.
- [ ] Security: blocked scripts/assets, no silent egress, no path traversal, no registry prompt injection.
- [ ] Licensing: item-level evidence, third-party notices, SBOM and no restricted source distribution.
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
