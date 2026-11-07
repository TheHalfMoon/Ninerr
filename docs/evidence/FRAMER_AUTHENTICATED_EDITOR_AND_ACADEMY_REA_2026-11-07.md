# Framer authenticated editor + Academy Deep REA — 2026-11-07

**Status:** First **authenticated editor UI observation completed**, six public Academy pages independently captured with owner-local Craft Anything Deep. **This is not full editor source reverse engineering, a functional editing benchmark, or Framer–Ninerr parity.** All Framer project actions in this pass were UI navigation, selection, and inspection only.

## 1. Access and capture provenance

- **Owner device:** macOS Safari, authenticated to Framer in the user's existing session. An owner-accessible editor project titled **Sparkling Pear** was open on branch **main**. The full private project URL and account identifiers are intentionally **not committed**. The user explicitly reported signing in, and the browser UI verified the project open rather than a login redirect.
- **Method:** macOS accessibility-driven *non-mutating* UI clicks, local screen capture and direct visual inspection. Capture area was the Safari window at 1246 × 767 macOS points (Retina PNG 2492 × 1534 px). The native project screenshot and UI states were inspected directly.
- **Scope limitation:** Safari did not enable `Allow JavaScript from Apple Events`, so authenticated DOM/JS extraction was **not attempted**. Craft Anything 0.3.0 on owner Windows uses a separate private Chrome/Edge CDP session and **cannot inherit the Safari login**. An exploratory Craft Anything `triage` call on a copied editor screenshot returned `format not recognised`, so its analysis is **not** misrepresented as a successful authenticated Craft Anything page capture.
- **Data handling:** six compressed screenshot copies are in Windows `.local-evidence/framer-2026-11-07-editor/` (ignored by Git). Raw Mac PNGs are under `/tmp/ninerr-framer-rea-20261107/` and may be temporary. This report stores checksums, not user project screenshots, login data, cookies, or account IDs.

### Owner-local signed-in editor image receipt

| Read-only state | SHA256 of archived JPEG on Windows | Verified observation |
|---|---|---|
| Initial editor | `ec026edb91ab07b3a6bfc2d172179cc8478591a12be54b719f99a15be7449d29` | Project, Canvas, branch, page tree, Agent |
| Layers tab | `c2e90e61b621fc476c69749d42ba128c7552d8fd45d891d8b0b196d110908030` | Home > Desktop, Primary tag |
| Assets tab | `54b53813b184b4812d90d9b9ac72770eb31984df251abafdce4f222a4e64a5b3` | Assets search/empty list in this project |
| Assets + Style | `65246fb23730ed64724dc9c1d5c585e06cf63f51ac995a8d75cc7402c700d50e` | Base typography 16 px, template affordance |
| Selected breakpoint + Style | `083ae4f9ffeccc697f4115bcc2349feda84cddbaffb3c53863ebde6fd88ec798` | Selection boundary, XYWH and typed sizing |
| Canvas switcher/menu | `4ee328b240f56ba1758b1772329ae96d2adf4f055864b4d1b450d22a4934fa8a` | Canvas/CMS/Localization/Analytics/Settings, tools |

These are archival JPEG checksum values and are **not** the checksums of the original Mac PNGs. Captures are not Framer provenance proofs or evidence of unchanged project state beyond visual observation.

## 2. Actual authenticated editor observations

| Area | Directly observed in the user's signed-in editor | What it does **not** establish |
|---|---|---|
| Top bar | Canvas mode, Insert and other tool icons, project name, current `main` branch, Preview, Invite, Publish | No preview export/publication, account plan detail, backend behavior or branch merge was performed |
| Left side | `Pages`, `Layers`, `Assets` tabs; Pages has Home; selected Layers shows Desktop / Primary; Assets blank in this starter project | Does not prove general multi-page behavior, missing assets globally or CMS schema |
| Canvas viewport | A blank white desktop surface, `Desktop 1200` label, zoom set to `50%`, selection outline on click, canvas pan/select tool controls | No resize, drag, breakpoint creation, animation or element insertion was tested |
| Property inspector | When Desktop is selected: `Position X=0, Y=0`; `Width=1200 Fixed`, `Height=1000 Fixed`; `Template`, `Breakpoint`, `Layout`, `Typography Base 16px`, `Overlays`, `Cursor`, `Effects`, `Styles` | No property edits or persisted settings were verified; what is visible can depend on selection |
| Agent surface | `Agent` tab distinct from `Style`; `New chat`, suggestion chips, model selector visibly labeled `GPT 6.1 Sol`, text input, branch `main` status | Display label only: no inference request, agent action, usage charge or agent edit was invoked |
| Canvas switcher | Canvas, CMS, Localization, Analytics, Settings, dashboard and Quick actions; File/Edit/View/Tool/Component/Plugins/Code/Preferences menu groups | Menu existence does not mean every tool is available on this plan or project, nor imply their implementation source was inspected |

**Safety:** No content or style mutations were submitted. No chat prompt was sent. `Publish`, `Invite`, `Upgrade`, account management, plugins and external network integrations were not activated. The project is a visually blank starter; use a dedicated owner-designated **test project** before any destructive or billed action.

## 3. Six new Craft Anything Deep public Academy captures

**Owner Windows** successfully ran Craft Anything 0.3.0 with a **persistent local MCP browser/CDP session**, in Deep mode, for the following Framer Academy pages. Each has **3/3 responsive PNG captures** at 1440/768/390 CSS px, a `capture.json`, rendered `page.html`, and a capture README, retained only in ignored `.local-evidence/framer-2026-11-07-academy/`. These are **public Academy lesson pages, not authenticated Framer editor journeys**.

| Public source / lesson title | SHA256 of `capture.json` | Evidence |
|---|---|---|
| [Build flexible layouts with Frames and Stacks](https://www.framer.com/academy/lessons/frames-vs-stacks) | `45a058eb09afcb71c384d6b8ebbee9a9c377619d4831f92ecb2a1d9905dc5fd8` | Layout concepts |
| [Build layouts that resize correctly](https://www.framer.com/academy/lessons/sizing-modes) | `048ed9eb5ac8b10f27db2e5363caefdf29731c9dadab94947102f1c8ca59ab6e` | Sizing modes |
| [Generate responsive breakpoints with the Agent](https://www.framer.com/academy/lessons/making-a-site-responsive-using-agents) | `27b91adbbcbf743d236b31cc32bc72b6c4f5e7368a3fa558341b60c88d348a46` | Responsive agent UX |
| [Give one Component multiple states with the Agent](https://www.framer.com/academy/lessons/creating-components-and-instances-in-framer) | `c11b1ac990bccab111e8209b2e7c96080ca096637757c7909ae12f4dee5904ac` | Component variants |
| [Review Agent changes safely with Branching](https://www.framer.com/academy/lessons/branching-explore-variations-safely) | `3e3419417c9e625ca044d2909c7b9ccae78ba3788f1e1cc62b1f75bdbe65c9ac` | Review/branching UX |
| [Prompt, build and publish your first site](https://www.framer.com/academy/lessons/build-your-first-site) | `92ca33086da8048ce18b3eb118334e3a777d63311f116cbfe12a5920e1c5bf33` | First-run agent workflow |

**Combined:** six pages, **18 new responsive PNGs**, six HTML/layout/asset manifests. Interactive state capture on selected Academy pages returned zero eligible controls and is **not** a functional editor interaction pass. The selected page URLs and titles were verified from the actual capture JSON files, not guessed.

## 4. Framer observations → Ninerr engineering/test crosswalk

| Target behavior | Ninerr current source anchor | Direct next replay/acceptance gate |
|---|---|---|
| Pages/Layers/Assets shell, stable selected frame | `packages/canvas/src/index.mjs` exports `selectNode`, `normalizeSelection`, DOM-mounted selection and viewport; `packages/studio-web` is its UI host | Owner-installed native app, select root > inspector shows same stable ID, tree after reopen, no ghost overlays |
| Desktop breakpoint `1200×1000`, Fixed size and XY origin | `packages/canvas/src/index.mjs` implements CSS transform/resize operations but there is **no verified one-to-one Framer breakpoint type contract** | Typed width/height modes Fixed/Fill/Fit equivalent **only after** own acceptance results; 390/768/1200 responsive cases and undo |
| Contextual property panel and design styles | `packages/design-components`, `packages/document-model`, and renderer | Editor selection → exact inspector → commit/undo → deterministic render and source-preserving roundtrip |
| Agent chat kept separate from document inspector | `packages/agent-runtime`, `packages/studio-host/src/mcp.ts` local MCP and permission controls | Agent suggests changes, user previews/accepts/rejects; no unapproved source or network mutation |
| Branch `main`, review diff without overwriting user work | `packages/visual-git` and history, with local-only branch/snapshot semantics | Two isolated branches, visual diff, stale base conflict, merge/reject, crash recovery, audit receipt |
| Page switcher/Code/Plugins/CMS/Localization | `studio-web`, `design-components`, `code-ir`, `mcp.ts` only where applicable | Feature-specific tests; menu presence alone never counts as completed capability |
| Craft Anything evidence review | Framer public site and lesson capture manifests, plus authenticated macOS static screenshots | Distinguish public browser CDP from signed-in Safari screenshot evidence and source access |

Existing `FRAMER_NINERR_DIRECT_PORT_CONTRACT_2026-11-07.md` remains the more precise **API-gap contract**: CodeFile inventory/live subscriptions, design token registry and plugin UI do not become complete just because an inspector is visible.

## 5. Local Ninerr verification, executed on owner Windows

`node --test tests/canvas-model.test.mjs tests/design-components.test.mjs tests/visual-git.test.mjs tests/editor-ready.test.mjs`

- **33 test entries: 31 passed, 2 failed to load**, not two proven failing product behaviors.
- `design-components.test.mjs` could not load `@babel/parser` from `packages/code-ir/src/jsx.ts`.
- `editor-ready.test.mjs` could not load `@ninerr/collaboration` from `packages/studio-host/src/session.ts`.
- Missing dependencies are a **research worktree environment/installation blocker**. Do not count those tests as passing, nor assume app defects. No dependency installation or heavy Windows build was made in this pass.
- Local log: `.local-evidence/framer-2026-11-07-editor/ninerr-selected-test-replay.log`. Run exact-head CI and installed native QA before any parity/release claim.

## 6. Outstanding Framer editor benchmark (not attempted)

1. On an explicitly owner-designated Framer **test project**, create Frame and Stack, switch Fixed/Fill/Fit and record exact editable output, saving before/after state.
2. Add desktop/tablet/mobile breakpoints and compare layout on resize, including constraints and override inheritance.
3. Create a local component with two variants, instance override and safe revert/undo.
4. Create a CMS collection and localization entry with non-sensitive synthetic content, validate schema and RTL.
5. Agent request: test non-destructive proposal in a **separate test branch**; inspect diff, reject, approve and merge, and measure control costs only under explicitly permitted free limits.
6. Capture comparisons against the installed Ninerr desktop on Windows and Mac with exact version/hash; do not confuse marketing-site screenshots with application parity tests.
7. If access to authorized proprietary Framer source is later supplied, separately inventory provenance, dependencies, license/grant scope and editor architecture. A signed-in page **does not grant its private source**.

## 7. Decision

| Evidence gate | Status |
|---|---|
| Framer authenticated editor entry / visible UI | **VERIFIED** |
| Read-only left tabs, Canvas menu, selection + properties | **VERIFIED** |
| Craft Anything **public Academy** source/layout capture | **6/6 complete (18 PNGs)** |
| Craft Anything authenticated Safari DOM/CDP inspection | **NOT AVAILABLE IN THIS CONFIGURATION** |
| Framer editor create/edit/undo/agent/plugin functional benchmark | **NOT RUN** |
| Ninerr feature parity and release | **NOT QUALIFIED** |

**Engineering decision:** Conditional GO for local, source-preserving, permission-bounded Ninerr F01–F06 implementation; no claim of completed Framer parity or shippable release. Maintain Draft PR, no automatic merge/publish. `Ninerr` remains Apache-2.0; respect per-file third-party rights and permission-bound project access.
