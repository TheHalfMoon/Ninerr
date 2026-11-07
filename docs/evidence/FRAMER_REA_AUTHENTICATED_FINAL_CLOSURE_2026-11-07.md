# Ninerr — Framer REA: Final Owner-Session Research Closure and Opus Handoff
**Research cut:** 2026-11-07, 18:08 Asia/Riyadh · **Scope:** reachable public Framer sources + public Craft Anything + bounded authenticated owner-editor UI journeys. **Verdict:** bounded source/UX REA and handoff **COMPLETE**; Framer proprietary editor internals, full parity, and release **NOT QUALIFIED**.

## 1. Definition of completion

Research is considered **complete for our authorized, no-paid, non-destructive investigation tranche** when: the source census and public code audits are indexed; the public site/Academy was captured in real Craft Anything; authenticated app views and safe reversible interaction behaviors were checked; each unresolved gap is clearly named; the Ninerr implementation work orders and next research owner are documented; and this exact report passes local checks.

This definition **does not** assert availability of Framer's internal editor source, functional equivalence, executed paid-Agent workflows, or a production-ready Ninerr desktop. It is not a substitute for future owner-provided private source, dedicated test-project authorization, or independent CI/native platform QA.

## 2. Verified research evidence

| Evidence track | Verified scope | Qualification |
|---|---|---|
| Public source census | 20 public Framer org repos (6 original, 14 forks), 32 official public plugins | **Public org scope complete** at pinned snapshot; not private org completeness |
| Plugin tree inspection | 670 repository paths, 395 JS/TS paths, 17 test file paths, 58 source-matched literal `framer.*` symbols | **Static inventory complete**, dynamic execution/dependency tests incomplete |
| Motion / API | Public MIT Motion family, public APIs/docs, OAuth/remote MCP documented | **Source mapping complete for candidate engineering grains**; actual private service implementation inaccessible |
| Craft Anything signed-out pages | 5 public feature/docs pages × 3 widths = 15 PNGs | **Captured**; raw third-party media retained only owner-local |
| Craft Anything Academy | 6 actual public lessons × 3 widths = 18 PNGs | **Captured**; public instructional pages ≠ editor interaction tests |
| Signed-in Framer editor | Safari on owner Mac, existing blank project, real Layers/Pages/Assets/Inspector/Agent/Canvas/CMS/Localization surface | **Authenticated UI observed**, not authenticated Craft Anything DOM/CDP |
| Canvas edits | Real Frame 290×190 Fixed creation, wrapping in Stack 290×190 Fit, `⌘Z` twice; separate Desktop move/undo | **PASS**, inspected layer tree and inspector restoration |
| CMS edit/undo | In authenticated CMS: Collections tab, click `+` created a new empty `Collection` and editable Title/Status/Slug/Content grid; escape + `⌘Z` removed it; **page reload confirmed no collections persisted** | **PASS** for reversible create+undo+reload on empty collection only |
| Localization | Signed-in Localization view shows `Content`, `Locales`, `Plugins`, and empty-state `Add locale` | **OBSERVED VIEW ONLY**; no locale creation/RTL/translation executed |
| Breakpoint creation | Header offers Generate, Tablet 810, Phone 390, Custom; both Tablet and Phone menu-clicks were acknowledged but **did not produce a visible breakpoint** on blank project in this session | **UNRESOLVED**; menu discovery PASS, creation NOT QUALIFIED; no claim why |
| Components / Agent Branching | Public example/docs + signed-in `Agent` tab/branch badge, no live variant or paid Agent edit/branch merge test | **UNTESTED / DEPENDENT ON SANDBOX AND PERMISSION** |

## 3. New MAC screenshot receipts (raw images not committed)

All files were captured with native macOS window screenshots in `/tmp/ninerr-framer-final-20261107/`, under a user-owned authenticated Safari session. Git stores checksums only.

- Breakpoint menu: `breakpoint-options.png` SHA256 `bacd3a6760d3fa5191a432024090abbc91166dde80b09c1d19e10b8c39e90476`.
- Tablet menu selection: `tablet-click.png` SHA256 `9b6b3199f4d4e7b9bccc56310e70630c2d6fa0cade8da5cbfe98089fc12d5587`. Same pixel hash as visually blank selected Desktop state after the menu closed.
- Localization view: `cms-view-after-select.png` SHA256 `bcc8d8f69586d71588c33d1dda84bd42aa71f1a4edece7a0b9bf52030cd95c98`.
- CMS view before creating collection and after undo: `cms-mode.png` / `cms-after-undo.png` identical SHA256 `dd500de677a32a41dfcfcc70cf9479c269d803724625c59eff41be38618dc752`.
- New empty collection before undo: `cms-new-collection-menu.png` SHA256 `ea58131acb81d033d6bb699899220f95dcc3fa69f10fb691a1b825888aca5141`.
- CMS after reload with **no collection present**: `cms-after-undo-reload.png` SHA256 `17fee48422bd3bc6602b8cfdf835412863c2d6ee9119e9b0be42986920a6853b`.

Prior owner-local raw screenshots/CSVs/HTML are listed in:
- `FRAMER_DEEP_CRAFT_ANYTHING_REA_2026-11-07.md`
- `FRAMER_AUTHENTICATED_EDITOR_AND_ACADEMY_REA_2026-11-07.md`
- `FRAMER_AUTHENTICATED_FUNCTIONAL_REPLAY_2026-11-07.md`

The blank current CMS and one Desktop canvas are visual observations; no API-based confirmation of service-side revision history is claimed.

## 4. Hard constraints and unresolved work for an *actual full Framer editor clone*

1. Framer's **private editor source code was not supplied**; the founder's stated permission is not a file/source archive. Re-evaluate any delivered private code as a new signed-off provenance task rather than assuming private editor code has already been audited.
2. Breakpoint Tablet/Phone insertion did not visually succeed; do not invent pass/fail reasons. A fresh dedicated test project, exact site/plan state, mutation receipts and real tablet/phone preview must be reproduced first.
3. Component creation, two variant states and instance override, CMS custom schema/entry/link/export, Localization RTL, and agent review branch merge were not benchmarked in the owner project. Owner-initiated paid or external-agent operations stay opt-in.
4. Craft Anything 0.3.0 **cannot attach to the authenticated macOS Safari session in current setup**. Do not transfer cookies, enable unsafe automation without permission, or claim a screenshot is an authenticated browser-JS audit. Public CraftAnything work was genuine and independent.
5. Exact-head remote CI, full native installed Windows/macOS/Linux E2E, source/exports equivalence, per-file licensing and legal provenance remain **release blockers**.

## 5. Resulting Ninerr engineering decision

**Conditional GO** to implement local-first independent slices on separate engineering PRs using existing canonical document, renderer, canvas, history, visual-git, local MCP, code-ir and typed security model. Suggested ordered slices:
1. F01 original local Frame + Stack + Fit/Fixed layout + stable tree + two-step undo/reopen exact hash.
2. F02 breakpoint semantics: validate 390/810/1200, overrides, exact serialization, viewport-resize and accessibility; do not claim Framer equivalence until FE breakpoint path is observed.
3. F03 local CMS schema/collection create-undo-reload + synthetic content import, no compulsory cloud or agent.
4. F04 component variants/instance override + source preservation.
5. F05 local agent suggestion/preview/reject/merge branches and scoped permissions.
6. F06 source-preserving CodeFile + named tokens + plugin UI and optional Motion adapters.

Each slice requires named automated fixtures and installed native QA. This PR contains **research only**, not those features.

## 6. Opus handoff

The user's next goal is independent **Deep Claude Design REA and Craft Anything** with Opus for Ninerr. Use:
`docs/research/CLAUDE_DESIGN_OPUS_CRAFT_ANYTHING_REA_HANDOFF_2026-11-07.md`
plus the separately pasteable prompt:
`docs/research/OPUS_CLAUDE_DESIGN_DEEP_REA_COPY_PROMPT_2026-11-07.md` (if present in this PR).

**Official Anthropic current information as of this research cut:**
- https://support.claude.com/en/articles/14604416-get-started-with-claude-design — integrated Claude, Artifacts and Claude Code `/design`/`/design-sync`, design canvas and comments; shared plan usage limits; limitations include lack of version history and basic multi-person editing.
- https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design — design systems in paid-tier beta, owner settings and import restrictions; do not infer user's account eligibility.
- https://support.claude.com/en/articles/17440474-move-from-standalone-claude-design-to-claude — the standalone `claude.ai/design` closes 2026-12-14; prioritize integrated product.

**Opus was not launched by this research session.** The prompt is a handoff artifact, not evidence of action.

## 7. Final signoff state

Research tranche: **DONE WITH EXPLICIT BOUNDARIES**. Product parity: **NOT DONE**. Proprietary source clone: **NOT DONE**. Release readiness: **NO-GO**. No purchase or publish actions. The owner-controlled Framer project was visually restored after temporary test edits (CMS undo verified again after page reload); no permanent sample content was intentionally retained. Keep PR Draft pending independent source/provenance review and CI.
