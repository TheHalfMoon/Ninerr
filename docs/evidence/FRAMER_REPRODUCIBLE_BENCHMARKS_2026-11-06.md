# Framer vs Ninerr: reproducible desktop and agent benchmarking contract
Date: 2026-11-06. Status: TEST PLAN, no results fabricated. Must use owner-authorized Framer test project; websites alone are NOT equivalent to logged-in product workflows.

## Setup and evidence
Record for EVERY run: run ID, timestamp, Framer app build/plan and project ID alias (never private tokens), Ninerr installed SHA and package checksum, OS, CPU/GPU/RAM, network status, browser/editor version, identical input fixture source hashes, screen recordings or ordered screenshots if allowed, outcome, elapsed time, exact wrong/error states, source code diff hash, final editable node counts and affected asset rights. When a competitor feature is inaccessible or only officially described, status UNKNOWN or DOCUMENTED, not FAIL or WIN.

## Head-to-head task corpus

| Task ID | Same input and required observed outcome | Source/quality oracle | Security / negative control |
|---|---|---|---|
| F-B01 | Create responsive landing page at 1440/768/390 widths, identical content and component hierarchy | editable nodes and a11y visual snapshots, inspect overflow | no hidden cloud request in strict Ninerr offline mode |
| F-B02 | Build component with variants, instance props and override | change default token updates instances predictably | recursive/cyclic definition must be refused |
| F-B03 | Create spring entrance and drag interaction | repeatable frame timing, reduced-motion support | keyboard-only parity and no leaked timers |
| F-B04 | Animate responsive transition on content reflow | exact before/after node geometry and final layout identity | cancellation doesn't modify saved document |
| F-B05 | Create design tokens (colors/font/spacing) and bulk update 100 items | token reference IDs, render fidelity and undo history | private/external token references fail closed |
| F-B06 | Import a real JSX/TSX component, edit one string, export back | no-op byte identity and one-edit minimal source diff | unknown expression AST must be retained or refused |
| F-B07 | Clone/move/delete nested frame through GUI and agent | same resulting canonical doc hash, stable node IDs, undo | stale revision/project switch/revoked agent refused |
| F-B08 | Search 1,000 canvas nodes and component/code references | same result IDs in local Ninerr UI and MCP, query p95 | cross-project metadata and untrusted HTML not revealed |
| F-B09 | Make an AI agent change on a review branch | human inspect, accept/reject, deterministic merge/journal | second agent/human edit conflicts rather than overwrite |
| F-B10 | Export SVG, PNG and PDF from animated design | static deterministic pixels/path/page boxes across 10 exports | no restricted assets, remote fonts or unexpected egress |
| F-B11 | Structured collection import and content editing | stable field IDs and reversible edit | invalid CSV, injection payload, wrong-tenant data rejected |
| F-B12 | Clean install and use offline/no account/no provider | launch, create, edit, save, reopen, export supported outputs | external packet sink positive negative-control and blocked request |

## Scoring methodology
Use *observed* success over identical fixture, not advertising:
- Workflow completion and correctness 35%
- Visual/source-code fidelity 20%
- Time, responsiveness and memory 15%
- Agent safety/auditability 15%
- Accessibility and usability 10%
- Offline/privacy capability 5%

Score only mutually accessible tasks; separate untested/plan-locked functions. A public landing-page screenshot is not a task completion. Record fixed five-run p95 latency and memory on the same test environment where repeatability is possible. For Framer cloud-hosted tasks, mark cloud-required instead of falsely measuring it as equivalent to Ninerr's offline design goal.

## Entry criteria and exit criteria
Entry: verified Framer user project access and allowed benchmarking account, current Framer editor/methods, matching Ninerr installed package and documented fixtures. Exit: evidence pack of both runs, code diff, rights notices, pass/fail/unknown matrix, independent review, no private screenshot redistribution without grant. Only then can a comparative quality claim be made.
