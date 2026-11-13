# Founder directive: finish the product (2026-11-13)

The founder directed engineering to continue until Ninerr meets its completion and release-readiness criteria. Ninerr is to be a local-first, desktop-first design and AI-agent platform with no mandatory cloud, paid APIs or telemetry. This record holds what the directive authorizes, so later work can cite it.

## Authorized engineering scope

The 10-13 authorization forbade "unrelated product features". The directive names the following as **committed product scope**. Each is to be implemented, strengthened and verified, not only documented:

- **Canvas and components:** the visual canvas, layers, frames, components and instances; properties, variants, slots, overrides and reusable components.
- **Layout:** auto layout, responsive design, constraints and alignment.
- **Design systems:** design tokens, variables, typography, colours and themes; component libraries and design-system management.
- **Design and code:** design-to-code and code-to-design workflows; React, TypeScript, CSS and Tailwind interoperability; reliable HTML/CSS import with browser rendering parity.
- **Component sources:** discovery, preview, import and safe application. Issue #405 is an implementation requirement for shadcn/ui, Base UI, Radix UI, Sonner, Vaul, cmdk, NumberFlow, Beautiful UI, Rare UI, Magic UI, Aceternity UI, 21st.dev and Meta Astryx. The workflow is discover → preview → inspect → configure → validate → import → edit → export.
  - Base UI is the default primitive family for new projects. Radix or Astryx is kept where a project needs it.
  - Primitive families are never mixed silently.
- **Agents:** local agent tools and MCP integration.
- **Reliability:** deterministic export and reproducible builds; undo and redo, transactions, autosave and recovery.
- **Accessibility:** keyboard access, screen readers, RTL and reduced motion.
- **Desktop:** robust installation and operation on Windows, and installer, upgrade and uninstall checks.

This covers the canvas-precision features the design-platform plan had grouped as P12: layout, constraints, alignment and typography.

## Agent permission boundary

- Agents may discover, plan, preview and dry-run operations on their own.
- Importing executable components, or anything that needs elevated permissions, requires the person's explicit confirmation.
- Changes are atomic transactions with reliable undo.

## Unchanged constraints

- Local-first. No mandatory cloud inference, paid API dependency, founder-funded infrastructure, telemetry without consent, silent network downloads or unnecessary background processes.
- External models and APIs stay optional, configured by the user.
- Do not install whole UI-framework ecosystems into Electron where adapters or project-level dependencies suffice.
- Never run untrusted third-party code in the canonical canvas.
- Keep source provenance and legal notices accurate.

## Process

- Small, reviewed, tested increments, each merged only after exact-head CI.
- Independent review uses free tools. Jev is retired (`FOUNDER_DECISION_2026-11-13_RETIRE_JEV.md`).
- Progress is recorded in `docs/COMPLETION_LEDGER.md` and on issue #405.

## Still the founder's to decide

The directive leaves these with the founder:
- spending money;
- publishing a release or deploying hosted services;
- obtaining proprietary sources it cannot reach (for example, the written permission Aceternity UI and 21st.dev require);
- changing an established security boundary.

Under that last item, these still wait for a decision:
- host network access, for fetching component registries;
- a live React preview runner;
- the desktop's refusal of downloads.

A platform without suitable hardware stays an open qualification gate and is never marked as passed.
