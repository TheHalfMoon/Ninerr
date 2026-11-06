# Framer-associated Motion: direct code and package audit
Date: 2026-11-06. Evidence class: SOURCE_INSPECTED, Git HEAD 78f3ff51b5508f7e8c1c283d8e80bcd26fec37d7.
Public source: https://github.com/motiondivision/motion/tree/78f3ff51b5508f7e8c1c283d8e80bcd26fec37d7. This source belongs to Motion, not the private Framer editor. Do not confuse the naming of the React compatibility package framer-motion with the entire Framer app.

## Provenance and source verification
Windows clone at owner-controlled .local-evidence/framer-2026-11-06/src/motion, inspected directly using git rev-parse, git ls-tree and git show, without downloading other paid models.
- Root LICENSE.md: MIT License, copyright Motion B.V. 2024, requiring preservation of copyright/license notice in copies or substantial portions.
- Source packages actually present: packages/motion, packages/framer-motion, packages/motion-dom, packages/motion-utils, packages/config.
- Manifests at pinned commit: motion=14.10.1 MIT, framer-motion=14.10.1 MIT, motion-dom=14.10.1 MIT, motion-utils=14.7.0 MIT. Current package registry metadata matched these version numbers on 2026-11-06; registry latest can change.
- 268 paths with *.test.ts or *.test.tsx or *.test.js were enumerated under packages at pinned HEAD. This is an inventory count, NOT a passing test suite.

## Actual file-level implementation evidence

| Capability | Real source or associated tests | Engineering interpretation for Ninerr |
|---|---|---|
| Spring/inertia/keyframes | packages/motion-dom/src/animation/generators/{spring,inertia,keyframes}.ts and __tests__ | Deterministic interpolation candidate, but must time-control preview and export |
| Async and native animation | packages/motion-dom/src/animation/{AsyncMotionValueAnimation,JSAnimation,NativeAnimation}.ts plus tests | DOM/Web Animations API coordination; respect Electron/CSP and cancellation |
| Motion scheduler | packages/motion-dom/src/frameloop, animation/drivers/frame.ts | Scheduling can improve canvas preview; must not become a second document writer |
| Drag with keyboard parity | packages/motion-dom/src/gestures/drag/VisualElementDragControls.ts and __tests__/keyboard-accessible.test.ts | Accessibility source to inspect before any Ninerr gesture integration |
| Layout/projection | packages/motion-dom/src/layout/LayoutAnimationBuilder.ts, animate-layout.ts, and src/projection | Visual transitions need before/after snapshot of canonical Ninerr layout; not a layout engine replacement |
| Presence/exiting | packages/framer-motion/src/components/AnimatePresence/ and tests | Animation exit must not change canonical layer identity or corrupt undo |
| Reusable easing/math | packages/motion-utils/src with clamp/progress/memo/subscription tests | Small pure helpers may be reused with provenance rather than taking whole 8MB React package |

## Reuse recommendation

KEEP Ninerr's packages/document-model and studio-host/session as single source of document truth. KEEP existing renderer CSS animation normalization and canvas. ADAPT Motion DOM/React only in visual preview/prototype effects where benchmarks show improvements; preserve accessibility and reduced-motion behavior. PORT pure easing/spring helper logic where compact enough and permitted, under direct tests; avoid copying whole library into Ninerr solely to gain an easing curve. REJECT any approach that makes Framer remote backend or hosted user compute a dependency.

Potential local adapter input: {nodeId, keyframes, duration, easing, reducedMotion, previewOnly}, output an ephemeral visual animation handle with cancel(), snapshots and inert export-mode rendering. The canonical design remains a Ninerr node and saved token/animation declaration. Do not define this as a shipped API until tests exist.

## First acceptance suite (NOT YET EXECUTED)

1. Vary drag input pointer vs keyboard on equivalent selected design element; canonical node position, document revision and history must match.
2. Animate from responsive layout A to B with spring and layout projection; after animation, exact final transforms must match canonical renderer.
3. Enable operating-system reduced motion and stop the animation: timeline must be frozen/shortened correctly; no remote images/fonts.
4. Generate 10 identical SVG/PNG/PDF export snapshots while a looping effect is running; images and bytes must be deterministic in export mode.
5. Cancel a stale agent operation during transition; no visual orphan, node mutation or leaked timer.
6. Test 1000 preview animations on fixed reference hardware with p95 and memory budget, preventing persistent CPU use when canvas is hidden.
7. Verify license and transitive dependency notices under Ninerr's current Apache-2.0 distribution.

## Exclusions and unknowns
Motion is not the complete Framer editor or internal design document model. No actual Ninerr Motion integration was built here. No Motion source unit suite executed. We have not inspected proprietary paid Motion+ source. The founder reports permission to copy Framer's covered code, but this separate MIT upstream already permits reuse subject to notices.
