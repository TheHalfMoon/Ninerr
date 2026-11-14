# Founder decision: Ninerr v0.1.0 is an agent-first, headless design engine (2026-11-14)

**This decision supersedes the Desktop-first release direction**, including the release scope in `FOUNDER_DECISION_2026-11-14_V0_1_0_DESKTOP_UI_OWNERSHIP.md`. The version target stays `v0.1.0`. Earlier records are kept as history and are not rewritten.

## The decision

Ninerr is now first an agent-first design engine, used directly from the conversational tools developers already work in. It is no longer primarily a desktop application.

- **Core: the Ninerr Engine.** Structured design documents and frames; layout, styling, typography and design tokens; components, variants and instances; design-to-code and code-to-design; version history, undo, recovery and persistence; import, export, validation and design quality checks.
- **Interface: MCP and a CLI.** The engine is used through Codex (CLI, IDE and desktop), Claude Code, OpenCode, Cursor, Gemini CLI and other standards-compliant MCP clients.
- **Optional, later: Desktop and web.** The existing Desktop and web-editor code is kept, working and tested, but its product and UI development is frozen. It is neither deleted nor rewritten. Desktop publication is not part of v0.1.0. That work resumes only after customer demand is shown and the founder authorizes it.

## What v0.1.0 must do

- **No graphical interface needed.** An agent starts Ninerr, creates or opens a project, designs, saves and exits, with no Electron, no browser window and no person opening the project first.
- **One engine.** The existing MCP catalog is extended rather than replaced by a second engine. The single writer and the revision safeguards stay.
- **Headless operation keeps every protection:** document-scoped authorization, secure local storage, revision checks, dry runs, undo and history, attribution, and the filesystem and network restrictions. A consequential operation is confirmed by the person through the client where the client supports it, and otherwise denied. It is never approved silently because no dialog exists.
- **Visible results:** editable project files, HTML and CSS previews, SVG or PNG where reliable, React, JSX and Tailwind code, portable tokens, component trees, and validation and accessibility reports.
- **Zero mandatory cloud cost:** local only, with no hosted Ninerr account.
- **Distribution:** a lightweight, reproducible local engine with a CLI and a stdio MCP server. Electron, installers, signing, notarization, graphical onboarding and paid hosting are not prerequisites.
- **Proof:** install, connect MCP, create a project, design, preview, export, save, reopen and edit, all without a desktop application. This is tested in real Codex and Claude Code sessions, with OpenCode tested separately, on Windows, macOS and Linux, and the exact candidate is qualified in CI. MCP unit tests alone do not show the integration is complete.

## What stops

Electron UI refinements, desktop visual redesign, desktop onboarding, installer polish, native signing and notarization, and a hosted web editor. Existing code and earlier evidence stay intact.

## What is still forbidden without the founder

Publishing an npm package, creating a release tag, or publishing a GitHub Release.

## How engineering carries it out

The plan, the audit behind it and the reclassified release gates are in `docs/HEADLESS.md`.
