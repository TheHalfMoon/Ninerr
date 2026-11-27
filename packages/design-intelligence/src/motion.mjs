// Ninerr Motion System: canonical easing and duration tokens, motion presets,
// interaction frequency gating, GPU-only compositor linting, and reduced-motion-compliant
// CSS and React emission. Motion CSS attaches to frame/component props.stylesheet and
// NEVER injects @keyframes or @media rules into compileTokens().

export const MOTION_TOKENS = Object.freeze([
  Object.freeze({ name: "--duration-instant", type: "duration", value: "100ms", description: "Immediate micro-feedback (press, toggle, checkbox)" }),
  Object.freeze({ name: "--duration-fast", type: "duration", value: "150ms", description: "Hover transitions, tooltips, small popovers" }),
  Object.freeze({ name: "--duration-normal", type: "duration", value: "220ms", description: "Default enter, exit, and modal transitions" }),
  Object.freeze({ name: "--duration-deliberate", type: "duration", value: "300ms", description: "Upper bound for UI drawer and sheet transitions" }),
  Object.freeze({ name: "--ease-out", type: "easing", value: "cubic-bezier(0.23, 1, 0.32, 1)", description: "Default ease-out curve for enters and user-initiated feedback" }),
  Object.freeze({ name: "--ease-in-out", type: "easing", value: "cubic-bezier(0.77, 0, 0.175, 1)", description: "Smooth curve for elements moving already on screen" }),
  Object.freeze({ name: "--ease-drawer", type: "easing", value: "cubic-bezier(0.32, 0.72, 0, 1)", description: "Decelerating curve tuned for sheets and drawers" }),
  Object.freeze({ name: "--ease-spring-snappy", type: "easing", value: "cubic-bezier(0.22, 1.12, 0.36, 1)", description: "Crisp CSS spring approximation for tactile UI affordances" }),
]);

export const MOTION_PRESETS = Object.freeze({
  hover: Object.freeze({
    id: "hover",
    trigger: "pointer-hover",
    duration: "var(--duration-fast, 150ms)",
    durationMs: 150,
    easing: "var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1))",
    properties: Object.freeze(["opacity", "transform", "background-color", "border-color"]),
    maxFrequency: "medium",
    summary: "Subtle hover confirmation without layout shift; gated behind @media (hover: hover).",
    css: (selector) => [
      `${selector} {`,
      `  transition: opacity var(--duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)), transform var(--duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)), background-color var(--duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)), border-color var(--duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));`,
      `}`,
      `@media (hover: hover) and (pointer: fine) {`,
      `  ${selector}:hover { transform: translateY(-1px); }`,
      `}`,
    ].join("\n"),
  }),
  focus: Object.freeze({
    id: "focus",
    trigger: "keyboard-focus",
    duration: "var(--duration-instant, 100ms)",
    durationMs: 100,
    easing: "var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1))",
    properties: Object.freeze(["outline-offset", "box-shadow"]),
    maxFrequency: "high",
    summary: "Immediate accessible focus ring visibility for keyboard navigation.",
    css: (selector) => [
      `${selector}:focus-visible {`,
      `  outline: 2px solid var(--accent-primary, #0f766e);`,
      `  outline-offset: 2px;`,
      `}`,
    ].join("\n"),
  }),
  press: Object.freeze({
    id: "press",
    trigger: "pointer-active",
    duration: "var(--duration-instant, 100ms)",
    durationMs: 100,
    easing: "var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1))",
    properties: Object.freeze(["transform"]),
    maxFrequency: "high",
    summary: "Tactile active press detent using compositor-only scale(0.97).",
    css: (selector) => [
      `${selector} { transition: transform var(--duration-instant, 100ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)); }`,
      `${selector}:active { transform: scale(0.97); }`,
    ].join("\n"),
  }),
  enter: Object.freeze({
    id: "enter",
    trigger: "mount",
    duration: "var(--duration-normal, 220ms)",
    durationMs: 220,
    easing: "var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1))",
    properties: Object.freeze(["opacity", "transform"]),
    maxFrequency: "low",
    summary: "Short-distance GPU-composited entrance starting from opacity 0 and translateY(6px).",
    keyframes: "@keyframes ninerr-enter {\n  from { opacity: 0; transform: translateY(6px) scale(0.98); }\n  to { opacity: 1; transform: translateY(0) scale(1); }\n}",
    css: (selector) => `${selector} {\n  animation: ninerr-enter var(--duration-normal, 220ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)) both;\n}`,
  }),
  exit: Object.freeze({
    id: "exit",
    trigger: "unmount",
    duration: "var(--duration-fast, 150ms)",
    durationMs: 150,
    easing: "var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1))",
    properties: Object.freeze(["opacity", "transform"]),
    maxFrequency: "low",
    summary: "Crisp dismissal slightly faster than enter so exits never feel sluggish.",
    keyframes: "@keyframes ninerr-exit {\n  from { opacity: 1; transform: scale(1); }\n  to { opacity: 0; transform: scale(0.97); }\n}",
    css: (selector) => `${selector}[data-state="closing"] {\n  animation: ninerr-exit var(--duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)) forwards;\n}`,
  }),
  modal: Object.freeze({
    id: "modal",
    trigger: "dialog-open",
    duration: "var(--duration-normal, 220ms)",
    durationMs: 220,
    easing: "var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1))",
    properties: Object.freeze(["opacity", "transform"]),
    maxFrequency: "low",
    summary: "Modal reveal starting at scale(0.95) rather than 0 for physical continuity.",
    keyframes: "@keyframes ninerr-modal-in {\n  from { opacity: 0; transform: translateY(8px) scale(0.95); }\n  to { opacity: 1; transform: translateY(0) scale(1); }\n}",
    css: (selector) => `${selector} {\n  animation: ninerr-modal-in var(--duration-normal, 220ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)) both;\n}`,
  }),
  drawer: Object.freeze({
    id: "drawer",
    trigger: "sheet-open",
    duration: "var(--duration-deliberate, 300ms)",
    durationMs: 300,
    easing: "var(--ease-drawer, cubic-bezier(0.32, 0.72, 0, 1))",
    properties: Object.freeze(["transform", "opacity"]),
    maxFrequency: "low",
    summary: "Side or bottom drawer glide tuned to Apple-style deceleration curve.",
    keyframes: "@keyframes ninerr-drawer-in {\n  from { opacity: 0; transform: translateX(24px); }\n  to { opacity: 1; transform: translateX(0); }\n}",
    css: (selector) => `${selector} {\n  animation: ninerr-drawer-in var(--duration-deliberate, 300ms) var(--ease-drawer, cubic-bezier(0.32, 0.72, 0, 1)) both;\n}`,
  }),
  toast: Object.freeze({
    id: "toast",
    trigger: "notification",
    duration: "var(--duration-normal, 220ms)",
    durationMs: 220,
    easing: "var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1))",
    properties: Object.freeze(["opacity", "transform"]),
    maxFrequency: "low",
    summary: "Non-intrusive notification entrance sliding 10px into place.",
    keyframes: "@keyframes ninerr-toast-in {\n  from { opacity: 0; transform: translateY(10px) scale(0.98); }\n  to { opacity: 1; transform: translateY(0) scale(1); }\n}",
    css: (selector) => `${selector} {\n  animation: ninerr-toast-in var(--duration-normal, 220ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)) both;\n}`,
  }),
  stagger: Object.freeze({
    id: "stagger",
    trigger: "list-reveal",
    duration: "var(--duration-normal, 220ms)",
    durationMs: 220,
    easing: "var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1))",
    properties: Object.freeze(["opacity", "transform"]),
    maxFrequency: "rare",
    summary: "Tight 30ms-to-50ms child stagger capped so total sequence stays under 450ms.",
    keyframes: "@keyframes ninerr-enter {\n  from { opacity: 0; transform: translateY(6px) scale(0.98); }\n  to { opacity: 1; transform: translateY(0) scale(1); }\n}",
    css: (selector) => [
      `${selector} > * {`,
      `  animation: ninerr-enter var(--duration-normal, 220ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)) both;`,
      `}`,
      `${selector} > *:nth-child(2) { animation-delay: 35ms; }`,
      `${selector} > *:nth-child(3) { animation-delay: 70ms; }`,
      `${selector} > *:nth-child(4) { animation-delay: 105ms; }`,
      `${selector} > *:nth-child(5) { animation-delay: 140ms; }`,
    ].join("\n"),
  }),
  scroll: Object.freeze({
    id: "scroll",
    trigger: "scroll-reveal",
    duration: "var(--duration-deliberate, 300ms)",
    durationMs: 300,
    easing: "var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1))",
    properties: Object.freeze(["opacity", "transform"]),
    maxFrequency: "rare",
    summary: "Subtle section reveal on scroll without layout shift or scroll-jacking.",
    keyframes: "@keyframes ninerr-enter {\n  from { opacity: 0; transform: translateY(6px) scale(0.98); }\n  to { opacity: 1; transform: translateY(0) scale(1); }\n}",
    css: (selector) => `${selector}[data-visible="true"] {\n  animation: ninerr-enter var(--duration-deliberate, 300ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)) both;\n}`,
  }),
  skeleton: Object.freeze({
    id: "skeleton",
    trigger: "loading",
    duration: "1400ms",
    durationMs: 1400,
    easing: "var(--ease-in-out, cubic-bezier(0.77, 0, 0.175, 1))",
    properties: Object.freeze(["opacity"]),
    maxFrequency: "loading-only",
    summary: "Calm opacity-only loading shimmer disabled under reduced motion.",
    keyframes: "@keyframes ninerr-skeleton {\n  0%, 100% { opacity: 0.45; }\n  50% { opacity: 0.85; }\n}",
    css: (selector) => `${selector} {\n  animation: ninerr-skeleton 1400ms var(--ease-in-out, cubic-bezier(0.77, 0, 0.175, 1)) infinite;\n}`,
  }),
  "number-transition": Object.freeze({
    id: "number-transition",
    trigger: "metric-update",
    duration: "var(--duration-normal, 220ms)",
    durationMs: 220,
    easing: "var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1))",
    properties: Object.freeze(["opacity", "transform"]),
    maxFrequency: "low",
    summary: "Tabular numeric formatting with crisp opacity crossfade on metric changes.",
    css: (selector) => `${selector} {\n  font-variant-numeric: tabular-nums;\n  transition: opacity var(--duration-normal, 220ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));\n}`,
  }),
  spring: Object.freeze({
    id: "spring",
    trigger: "interactive-state",
    duration: "var(--duration-normal, 220ms)",
    durationMs: 220,
    easing: "var(--ease-spring-snappy, cubic-bezier(0.22, 1.12, 0.36, 1))",
    properties: Object.freeze(["transform", "opacity"]),
    maxFrequency: "low",
    summary: "Low-bounce physical spring curve for toggles, switches, and segmented controls.",
    css: (selector) => `${selector} {\n  transition: transform var(--duration-normal, 220ms) var(--ease-spring-snappy, cubic-bezier(0.22, 1.12, 0.36, 1)), opacity var(--duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));\n}`,
  }),
});

export const MOTION_PRESET_IDS = Object.freeze(Object.keys(MOTION_PRESETS));

const LAYOUT_THRASHING_PROPS = new Set([
  "all",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "top",
  "left",
  "right",
  "bottom",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-width",
  "font-size",
  "line-height",
]);

const HIGH_FREQUENCY_TRIGGERS = new Set([
  "keyboard",
  "keyboard-shortcut",
  "command-palette",
  "tab-switch",
  "inline-edit",
  "typing",
  "table-sort",
  "100-per-day",
]);

/**
 * Evaluate whether a motion preset is appropriate for the user interaction frequency.
 * High-frequency repeated actions should stay instant or under 120ms without travel.
 */
export function evaluateMotionFrequency({ trigger, presetId, dailyUses = null }) {
  const normalizedTrigger = typeof trigger === "string" ? trigger.trim().toLowerCase() : "";
  const preset = Object.hasOwn(MOTION_PRESETS, presetId) ? MOTION_PRESETS[presetId] : null;
  const highFreq = HIGH_FREQUENCY_TRIGGERS.has(normalizedTrigger) || (typeof dailyUses === "number" && dailyUses >= 100);
  if (highFreq && preset && preset.durationMs > 120 && preset.id !== "focus" && preset.id !== "press") {
    return Object.freeze({
      allowed: false,
      severity: "warning",
      ruleId: "motion:high-frequency-restraint",
      recommendation: `High-frequency action (${normalizedTrigger || `${dailyUses} uses/day`}) should avoid ${preset.id} (${preset.durationMs}ms); use instant feedback, focus, or press (<=100ms).`,
    });
  }
  return Object.freeze({
    allowed: true,
    severity: "info",
    ruleId: "motion:frequency-ok",
    recommendation: "Motion cadence is appropriate for the declared interaction frequency.",
  });
}

/**
 * Deterministically lint CSS for animation performance, restraint, and reduced-motion compliance.
 */
export function lintMotionCss(cssText, { nodeId = null, allowAmbient = false } = {}) {
  if (typeof cssText !== "string" || cssText.trim() === "") return [];
  const findings = [];
  const hasMotion = /\b(?:transition|transition-property|transition-duration|animation|animation-duration|@keyframes)\b/iu.test(cssText);
  if (!hasMotion) return [];

  for (const match of cssText.matchAll(/\btransition(?:-property)?\s*:\s*([^;{}]+)/giu)) {
    const raw = match[1].trim().toLowerCase();
    for (const part of raw.split(",")) {
      const prop = part.trim().split(/\s+/u)[0];
      if (LAYOUT_THRASHING_PROPS.has(prop)) {
        findings.push({
          ruleId: "motion:gpu-composited-only",
          kind: "deterministic-defect",
          severity: prop === "all" ? "error" : "warning",
          nodeId,
          message: `Transition animates non-composited property "${prop}", risking layout thrash or jank.`,
          evidence: { declaration: match[0].trim(), property: prop },
          suggestion: "Animate compositor-only properties (transform, opacity, clip-path) instead of layout geometry or 'all'.",
        });
      }
    }
  }

  for (const match of cssText.matchAll(/\b(?:transition|animation)(?:-duration)?\s*:\s*([^;{}]+)/giu)) {
    const raw = match[1];
    const isSkeleton = /skeleton|pulse|spin/iu.test(raw);
    for (const durMatch of raw.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/giu)) {
      const ms = durMatch[2].toLowerCase() === "s" ? Number(durMatch[1]) * 1000 : Number(durMatch[1]);
      if (!isSkeleton && ms > 350) {
        findings.push({
          ruleId: "motion:duration-cap",
          kind: "heuristic-observation",
          severity: "warning",
          nodeId,
          message: `UI motion duration ${durMatch[0]} (${Math.round(ms)}ms) exceeds the 300ms responsiveness budget.`,
          evidence: { declaration: match[0].trim(), durationMs: ms },
          suggestion: "Keep interactive UI transitions at 100ms to 300ms using --duration-fast (150ms) or --duration-normal (220ms).",
        });
      }
    }
  }

  if (!allowAmbient && /\banimation(?:-iteration-count)?\s*:[^;{}]*\binfinite\b/iu.test(cssText) && !/skeleton|loading|spinner/iu.test(cssText)) {
    findings.push({
      ruleId: "motion:ambient-infinite-loop",
      kind: "heuristic-observation",
      severity: "warning",
      nodeId,
      message: "Infinite CSS animation detected outside a loading or skeleton state.",
      evidence: { infinite: true },
      suggestion: "Remove ambient infinite motion unless the design brief explicitly opts in, and always stop it under prefers-reduced-motion.",
    });
  }

  if (!/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/iu.test(cssText)) {
    findings.push({
      ruleId: "motion:missing-reduced-motion",
      kind: "deterministic-defect",
      severity: "error",
      nodeId,
      message: "Motion stylesheet defines transitions or animations without a @media (prefers-reduced-motion: reduce) fallback.",
      evidence: { hasReducedMotionRule: false },
      suggestion: "Include @media (prefers-reduced-motion: reduce) disabling animations and collapsing transition durations to 0.01ms.",
    });
  }

  return findings;
}

const SAFE_SELECTOR = /^[A-Za-z0-9_.\-#:\[\]="~\s>+*-]{1,120}$/u;

/**
 * Compile one or more named Ninerr motion presets into a safe scoped stylesheet block
 * with mandatory @media (prefers-reduced-motion: reduce) compliance.
 */
export function compileMotionStylesheet({ presetIds, selector = ".ninerr-motion", reducedMotion = "respect" }) {
  if (!Array.isArray(presetIds) || presetIds.length === 0) {
    throw new Error("presetIds must be a non-empty array of motion preset ids");
  }
  if (typeof selector !== "string" || !SAFE_SELECTOR.test(selector.trim())) {
    throw new Error("selector must be a valid bounded CSS selector");
  }
  const cleanSelector = selector.trim();
  const keyframes = new Map();
  const rules = [];
  const appliedPresets = [];

  for (const id of presetIds) {
    if (!Object.hasOwn(MOTION_PRESETS, id)) {
      throw new Error(`unknown motion preset: ${id}`);
    }
    const preset = MOTION_PRESETS[id];
    appliedPresets.push(preset);
    if (preset.keyframes) {
      const nameMatch = /@keyframes\s+([A-Za-z0-9_-]+)/u.exec(preset.keyframes);
      if (nameMatch && !keyframes.has(nameMatch[1])) keyframes.set(nameMatch[1], preset.keyframes);
    }
    rules.push(preset.css(cleanSelector));
  }

  const reducedBlock = reducedMotion === "none"
    ? ""
    : [
      "@media (prefers-reduced-motion: reduce) {",
      `  ${cleanSelector}, ${cleanSelector} * {`,
      "    animation-duration: 0.01ms !important;",
      "    animation-iteration-count: 1 !important;",
      "    transition-duration: 0.01ms !important;",
      "    scroll-behavior: auto !important;",
      "  }",
      "}",
    ].join("\n");

  const css = [...keyframes.values(), ...rules, ...(reducedBlock ? [reducedBlock] : [])].join("\n\n");
  return Object.freeze({
    selector: cleanSelector,
    presetIds: Object.freeze([...presetIds]),
    presets: Object.freeze(appliedPresets),
    css,
    tokens: MOTION_TOKENS,
  });
}

/**
 * Generate a reduced-motion-aware React/CSS motion config snippet for a preset.
 */
export function compileMotionReact(presetId) {
  if (!Object.hasOwn(MOTION_PRESETS, presetId)) {
    throw new Error(`unknown motion preset: ${presetId}`);
  }
  const preset = MOTION_PRESETS[presetId];
  return Object.freeze({
    presetId: preset.id,
    durationSec: Number((preset.durationMs / 1000).toFixed(3)),
    easing: preset.easing,
    properties: preset.properties,
    reactProps: Object.freeze({
      initial: preset.id === "enter" || preset.id === "modal" || preset.id === "toast"
        ? { opacity: 0, y: preset.id === "toast" ? 10 : 6, scale: preset.id === "modal" ? 0.95 : 0.98 }
        : { opacity: 1 },
      animate: { opacity: 1, y: 0, scale: 1 },
      exit: { opacity: 0, scale: 0.97 },
      transition: { duration: Number((preset.durationMs / 1000).toFixed(3)), ease: [0.23, 1, 0.32, 1] },
      reducedMotionNote: "Respect useReducedMotion() or CSS prefers-reduced-motion: reduce by collapsing travel and duration to 0.",
    }),
  });
}
