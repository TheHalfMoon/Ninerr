# Framer — Authenticated Functional REA Replay (2026-11-07)

**Repository:** TheHalfMoon/Ninerr · **Scope:** authorized owner-managed signed-in macOS Safari project, `Sparkling Pear` on `main` · **Status:** BOUNDED FUNCTIONAL PASS, **not** complete Framer editor parity.

## Safety and provenance

This session performed temporary, reversible edits in a visibly empty existing page to inspect source-to-target behavior. All experimental changes were undone and the final Layers view contained only the original `Desktop` breakpoint. No Publish, Invite, Upgrade, Agent prompt, paid provider, external plugin, account setting, or hosted service was triggered. No private project URL, cookies, user IDs, access tokens or raw screenshot bytes are included in this committed report. All PNGs below are owner-local temporary evidence under `/tmp/ninerr-framer-rea-20261107/` on macOS; checksums cover the original Retina PNG files.

**Toolchain:** Desktop Commander on owner Mac, macOS accessibility scripting plus an ephemeral CoreGraphics pointer drag script, native Safari editor. This is **not** a Craft Anything authenticated CDP capture; the existing Windows Craft Anything process uses a separate unauthenticated browser profile. Official shortcut reference: https://www.framer.com/shortcuts; Frames vs Stacks conceptual explanation: https://www.framer.com/academy/lessons/frames-vs-stacks.

## Replayed functional tests

| ID | Operation | Directly observed result | Cleanup / assertion | Evidence SHA256 |
|---|---|---|---|---|
| FE-01 | Drag the selected primary Desktop breakpoint then `⌘Z` | Selected breakpoint changed Position from `X=0,Y=0` to `X=290,Y=190`. Undo restored `X=0,Y=0`. | **PASS** on visibly restored inspector values and canvas position; no claim about server version history | Changed: `8b72a472450e1e6a7edb8fce778f778c79b4e8a8571541b9b079b77f9d4d3585`; undone: `9e69544877a91b01e8881caa36096079ed9a6523a260fc4baefbe6ae4e61fdc5` |
| FE-02 | Select Framer `F` tool, then drag inside original Desktop white canvas | `Layers: Desktop > Frame`. New `Frame` inspector showed `Width=290 Fixed`, `Height=190 Fixed`, Absolute positioning and offset information. | **PASS** for actual frame insertion and inspector visibility; no exported code or responsive behavior claimed | `aedea98bd91f4bb68d1c042c9e424d87dc998582fdd37377b778c56302ec7d5e` |
| FE-03 | Select new Frame and use `⌘⌥↩` (official Add Stack shortcut) | `Layers: Desktop > Stack > Frame` in a nested tree. Selected Stack inspector displayed `Layout Type=Stack`, width and height `Fit` (`290×190`), plus axis/spacing affordances. | **PASS** for actual wrapping/conversion and model inspector delta; no child responsive resize simulation | `06cb3c0ff15fa75e6114d736cd1c8d76b26bb3f7a0a37924110ea50796f59216` |
| FE-04 | `⌘Z` twice after Stack wrap | The intermediate undo returned to Frame; the second undo removed experimental Frame. Final `Layers` contained only `Desktop` with `X=0,Y=0`, `1200 Fixed × 1000 Fixed` on `main`. | **PASS** for visually reversible stack+frame operations; Framer did not publish any experimental content | `9b6b3199f4d4e7b9bccc56310e70630c2d6fa0cade8da5cbfe98089fc12d5587` |
| FE-05 | Click plus on Desktop breakpoint header | Menu exposed `Generate…`, `Tablet 810`, `Phone 390`, `Custom…`. | **PASS** for menu discovery only, **NOT** for breakpoint creation | `bacd3a6760d3fa5191a432024090abbc91166dde80b09c1d19e10b8c39e90476` |
| FE-06 | Choose `Phone 390` in FE-05 | Clicking a menu item was acknowledged by macOS Accessibility as `Phone 390`, and the menu closed. No second breakpoint appeared in subsequent screenshots; screenshot SHA was identical to known blank Desktop state. | **UNVERIFIED** why no new breakpoint was visible. Do **not** classify responsive breakpoint insertion as passed, failed or paywalled without further evidence. No extra content needed undo. | `9b6b3199f4d4e7b9bccc56310e70630c2d6fa0cade8da5cbfe98089fc12d5587` |

**Important distinction:** FE-01 is a real but reversible change to the primary Desktop position. It is recorded so reviewers can differentiate functional visual undo confirmation from a purely read-only browse. The initial attempt to add a Frame with `⌘↩` did not visibly create a child while the Desktop breakpoint was selected; FE-02 succeeded using the explicit F draw tool. Avoid claiming keyboard-only Frame insertion is qualified from this session.

## Source-to-Ninerr engineering assertions

- **Document model:** Fixed-size nested Frame, Stack wrapper, ordered tree and undo need one canonical local Ninerr document state. Compare with `packages/document-model`, `packages/canvas/src/index.mjs`, `packages/history` and `packages/studio-web`; no shadow per-agent document models.
- **Stack semantics:** Framer dynamically changed container sizing from Fixed to Fit with Stack layout; Ninerr needs a typed transaction with reversible layout and constraint settings. Confirm `gap`, padding, axis, absolute/relative child semantics on synthetic fixtures; **not** verified live by FE-03 beyond displayed UI.
- **Breakpoint gap:** Menu exposes the intended 810/390 and Generate actions, but the actual Phone creation pathway has **no success evidence** in this replay. The Ninerr editor must still test desktop/tablet/phone responsive preview and override propagation independently.
- **Undo:** Tested two clean reversals. Require stronger Ninerr acceptance: source bytes unchanged on no-op, serialized project hash equal to pre-test after undo/reopen, agent permission denial and external I/O isolation.
- **Cost/access:** Do not invoke Framer's Agent model button or any paywalled plan features in a later benchmark until free allowance is verified and the owner approves.
- **Source coverage:** The authenticated editor is a shipped web app, not a disclosed source repository. Browser session and screenshots do not establish rights to reconstruct protected internals or that the full proprietary editor source was obtained.

## Required remaining Framer full-REA gates

1. Investigate FE-06 with a disposable Framer test project/branch and capture before/after *actual* project state. Distinguish asynchronous UI, required selection, plan limits and accessibility click action.
2. Benchmark component variants and overrides, CMS, localization, export, source roundtrip and explicit Agent branch preview/merge/reject in an owner-designated sandbox with free/no-cost gates.
3. Craft Anything authenticated CDP capture is separately blocked by Safari `Allow JavaScript from Apple Events` being off; do **not** silently change browser security settings, transplant cookies or access private APIs to solve it. Browser-accessible comparable read-only workflow is the alternative.
4. Compare with installed Windows/macOS/Linux Ninerr binaries and enforce exact-head automated QA, privacy and IP/third-party notices.
5. Private Framer editor source remains unprovided. A complete source REA is **not** implied by this functional replay.

## Decision

**GO** for bounded source-driven Ninerr engineering of nested Frame/Stack/undo and responsive inspector behaviors; **NO-GO** for claims of complete Framer replication, complete editor source audit, paid/hosted agent parity, or native Ninerr release. Research PR remains Draft.
