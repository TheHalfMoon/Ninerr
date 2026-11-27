// Real-browser multi-viewport rendering and deterministic DOM/computed-style telemetry:
// horizontal overflow, text clipping/truncation, overlapping interactive/text elements,
// computed WCAG contrast, touch/click target dimensions, broken images, and PNG capture.

import { withContainedBrowser } from "./browser.mjs";

export const STANDARD_VIEWPORTS = Object.freeze({
  "compact-mobile": Object.freeze({ id: "compact-mobile", width: 320, height: 640, mobile: true }),
  mobile: Object.freeze({ id: "mobile", width: 375, height: 812, mobile: true }),
  tablet: Object.freeze({ id: "tablet", width: 768, height: 1024, mobile: true }),
  desktop: Object.freeze({ id: "desktop", width: 1440, height: 900, mobile: false }),
  wide: Object.freeze({ id: "wide", width: 1920, height: 1080, mobile: false }),
});

// Self-contained browser evaluation script computing deterministic layout & contrast telemetry.
function telemetryScriptFor(targetWidth, targetHeight) {
  return `(() => {
  const vw = Math.min(window.innerWidth || ${targetWidth}, ${targetWidth});
  const vh = Math.min(window.innerHeight || ${targetHeight}, ${targetHeight});
  const docEl = document.documentElement;
  const scrollWidth = Math.max(docEl.scrollWidth, document.body ? document.body.scrollWidth : 0, window.innerWidth || 0);
  const scrollHeight = Math.max(docEl.scrollHeight, document.body ? document.body.scrollHeight : 0);

  function parseRgba(str) {
    if (!str) return null;
    const m = /^rgba?\\(\\s*(\\d+(?:\\.\\d+)?)[,\\s]+(\\d+(?:\\.\\d+)?)[,\\s]+(\\d+(?:\\.\\d+)?)(?:\\s*[,\\/]\\s*(\\d+(?:\\.\\d+)?))?\\s*\\)$/i.exec(str.trim());
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  }
  function blend(fg, bg) {
    const a = fg[3];
    return [
      Math.round(fg[0] * a + bg[0] * (1 - a)),
      Math.round(fg[1] * a + bg[1] * (1 - a)),
      Math.round(fg[2] * a + bg[2] * (1 - a)),
      1,
    ];
  }
  function effectiveBg(el) {
    const chain = [];
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const c = parseRgba(getComputedStyle(cur).backgroundColor);
      if (c && c[3] > 0) chain.push(c);
      cur = cur.parentElement;
    }
    let acc = [255, 255, 255, 1];
    for (let i = chain.length - 1; i >= 0; i -= 1) acc = blend(chain[i], acc);
    return acc;
  }
  function lum([r, g, b]) {
    const lin = (c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }
  function ratio(c1, c2) {
    const l1 = lum(c1);
    const l2 = lum(c2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function nodeLabel(el) {
    return el.getAttribute("data-ninerr-id") || el.id || (el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/)[0] : ""));
  }

  const all = Array.from(document.querySelectorAll("body *")).slice(0, 2000);
  const overflowing = [];
  const clippedText = [];
  const lowContrast = [];
  const smallTargets = [];
  const brokenImages = [];
  const fonts = new Set();
  const interactiveBoxes = [];
  const headings = [];

  const interactiveSet = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"]);
  for (const el of all) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    const id = el.getAttribute("data-ninerr-id") || null;
    const label = nodeLabel(el);
    const tag = el.tagName.toLowerCase();

    if (style.fontFamily) fonts.add(style.fontFamily.split(",")[0].replace(/['"]/g, "").trim());

    if (rect.right > vw + 2) {
      overflowing.push({ nodeId: id, label, tag, right: Math.round(rect.right), viewportWidth: vw });
    }

    if (/^h[1-6]$/.test(tag)) {
      headings.push({ nodeId: id, tag, fontSizePx: parseFloat(style.fontSize) || 0, text: (el.textContent || "").trim().slice(0, 80) });
    }

    const ownText = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.textContent.trim() !== "").map((n) => n.textContent.trim()).join(" ");
    if (ownText.length > 0) {
      if ((style.overflowX === "hidden" || style.overflowX === "clip") && el.scrollWidth > el.clientWidth + 2) {
        clippedText.push({ nodeId: id, label, tag, axis: "x", scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, sample: ownText.slice(0, 60) });
      }
      if ((style.overflowY === "hidden" || style.overflowY === "clip") && el.scrollHeight > el.clientHeight + 2) {
        clippedText.push({ nodeId: id, label, tag, axis: "y", scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, sample: ownText.slice(0, 60) });
      }
      const fg = parseRgba(style.color);
      const bg = effectiveBg(el);
      if (fg && bg) {
        const effectiveFg = fg[3] < 1 ? blend(fg, bg) : fg;
        const cr = ratio(effectiveFg, bg);
        const fs = parseFloat(style.fontSize) || 16;
        const fw = parseInt(style.fontWeight, 10) || 400;
        const isLarge = fs >= 24 || (fs >= 18.66 && fw >= 700);
        const min = isLarge ? 3.0 : 4.5;
        if (cr < min) {
          lowContrast.push({
            nodeId: id,
            label,
            tag,
            contrastRatio: Math.floor(cr * 100) / 100,
            required: min,
            color: style.color,
            effectiveBackground: "rgb(" + bg[0] + ", " + bg[1] + ", " + bg[2] + ")",
            sample: ownText.slice(0, 60),
          });
        }
      }
    }

    if (interactiveSet.has(el.tagName) || el.getAttribute("role") === "button") {
      interactiveBoxes.push({ nodeId: id, label, tag, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } });
      if (rect.width < 24 || rect.height < 24) {
        smallTargets.push({ nodeId: id, label, tag, width: Math.round(rect.width), height: Math.round(rect.height), severity: "error", threshold: 24 });
      } else if (vw <= 480 && (rect.width < 44 || rect.height < 44)) {
        smallTargets.push({ nodeId: id, label, tag, width: Math.round(rect.width), height: Math.round(rect.height), severity: "warning", threshold: 44 });
      }
    }

    if (el.tagName === "IMG" && el.complete && el.naturalWidth === 0) {
      brokenImages.push({ nodeId: id, label, src: (el.getAttribute("src") || "").slice(0, 120) });
    }
  }

  // Detect overlapping interactive controls (ignoring ancestor/descendant containment).
  const overlaps = [];
  for (let i = 0; i < interactiveBoxes.length && overlaps.length < 30; i += 1) {
    for (let j = i + 1; j < interactiveBoxes.length && overlaps.length < 30; j += 1) {
      const a = interactiveBoxes[i].rect;
      const b = interactiveBoxes[j].rect;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 4 && oy > 4) {
        const aContainsB = a.left <= b.left && a.top <= b.top && a.right >= b.right && a.bottom >= b.bottom;
        const bContainsA = b.left <= a.left && b.top <= a.top && b.right >= a.right && b.bottom >= a.bottom;
        if (!aContainsB && !bContainsA) {
          overlaps.push({ first: interactiveBoxes[i].label, second: interactiveBoxes[j].label, overlapPx: { width: Math.round(ox), height: Math.round(oy) } });
        }
      }
    }
  }

  return {
    viewport: { width: vw, height: vh },
    documentSize: { scrollWidth, scrollHeight },
    horizontalOverflow: scrollWidth > vw + 1,
    overflowPx: Math.max(0, scrollWidth - vw),
    overflowingElements: overflowing.slice(0, 25),
    clippedText: clippedText.slice(0, 25),
    lowContrast: lowContrast.slice(0, 40),
    smallTargets: smallTargets.slice(0, 40),
    brokenImages: brokenImages.slice(0, 20),
    overlappingControls: overlaps,
    computedFonts: Array.from(fonts).slice(0, 20),
    headings: headings.slice(0, 20),
  };
})()`;
}

/**
 * Render HTML (or an explicitly allowed local loopback URL) across one or more viewports
 * inside a 3-layer zero-egress local browser, returning PNG screenshots and computed telemetry.
 */
export async function renderAndInspect({
  html = null,
  url = null,
  allowedOrigin = null,
  viewports = ["desktop"],
  colorScheme = "light",
  contrast = "no-preference",
  reducedMotion = "no-preference",
  captureScreenshot = true,
  fullPage = true,
  selector = null,
  pseudoState = null,
  browserPath = undefined,
} = {}) {
  if (!html && !url) throw new Error("renderAndInspect requires either html or url");
  const resolvedViewports = viewports.map((vp) => {
    if (typeof vp === "string") {
      if (!Object.hasOwn(STANDARD_VIEWPORTS, vp)) throw new Error(`unknown viewport preset: ${vp}`);
      return STANDARD_VIEWPORTS[vp];
    }
    if (vp && Number.isInteger(vp.width) && Number.isInteger(vp.height) && vp.width >= 200 && vp.width <= 3840 && vp.height >= 200 && vp.height <= 4096) {
      return { id: vp.id ?? `${vp.width}x${vp.height}`, width: vp.width, height: vp.height, mobile: vp.mobile ?? vp.width <= 480 };
    }
    throw new Error("viewport must be a preset name or { width, height } within 200..3840 x 200..4096");
  });

  return withContainedBrowser({ browserPath, allowedOrigin: url ? allowedOrigin : null }, async (session) => {
    const features = [
      { name: "prefers-color-scheme", value: colorScheme },
      { name: "prefers-contrast", value: contrast },
      { name: "prefers-reduced-motion", value: reducedMotion },
    ];
    await session.send("Emulation.setEmulatedMedia", { features });

    if (html) await session.setHtml(html);
    else await session.navigate(url);

    const captures = [];
    for (const vp of resolvedViewports) {
      await session.send("Emulation.setDeviceMetricsOverride", {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.mobile,
      });
      await session.send("Runtime.evaluate", {
        expression: "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))",
        awaitPromise: true,
      });

      if (selector && pseudoState && ["hover", "focus", "focus-visible", "active"].includes(pseudoState)) {
        const { root } = await session.send("DOM.getDocument", { depth: -1 });
        const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector });
        if (nodeId) {
          await session.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [pseudoState] });
        }
      }

      const evalRes = await session.send("Runtime.evaluate", {
        expression: telemetryScriptFor(vp.width, vp.height),
        returnByValue: true,
      });
      const telemetry = evalRes.result?.value ?? null;

      let pngBuffer = null;
      if (captureScreenshot) {
        let clip;
        if (selector) {
          const boxRes = await session.send("Runtime.evaluate", {
            expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.max(1, r.width), height: Math.max(1, r.height), scale: 1 }; })()`,
            returnByValue: true,
          });
          if (boxRes.result?.value) clip = boxRes.result.value;
        } else if (fullPage) {
          const docHeight = Math.min(16_000, Math.max(vp.height, telemetry?.documentSize?.scrollHeight ?? vp.height));
          clip = { x: 0, y: 0, width: vp.width, height: docHeight, scale: 1 };
        }
        const shot = await session.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: fullPage || Boolean(selector),
          ...(clip ? { clip } : {}),
        });
        pngBuffer = Buffer.from(shot.data, "base64");
      }

      captures.push({
        viewport: vp,
        telemetry,
        pngBuffer,
        bytes: pngBuffer ? pngBuffer.length : 0,
      });
    }

    return {
      browser: session.executable,
      emulation: { colorScheme, contrast, reducedMotion },
      egress: session.egressReport(),
      captures,
    };
  });
}

/** Convert live Vision telemetry from rendered viewports into normalized Critic findings. */
export function visionTelemetryFindings(captures) {
  const findings = [];
  for (const cap of captures) {
    const vpId = cap.viewport.id;
    const t = cap.telemetry;
    if (!t) continue;
    if (t.horizontalOverflow) {
      findings.push({
        ruleId: "vision:horizontal-overflow",
        kind: "deterministic-defect",
        severity: "error",
        viewport: vpId,
        nodeId: t.overflowingElements?.[0]?.nodeId ?? null,
        message: `Viewport ${vpId} (${t.viewport.width}px) overflows horizontally by ${t.overflowPx}px.`,
        evidence: { viewportWidth: t.viewport.width, scrollWidth: t.documentSize.scrollWidth, elements: t.overflowingElements.slice(0, 5) },
        suggestion: "Replace fixed pixel widths exceeding the viewport with fluid max-width: 100%, flex-wrap, or responsive grid columns.",
      });
    }
    for (const item of t.clippedText ?? []) {
      findings.push({
        ruleId: "vision:clipped-text",
        kind: "deterministic-defect",
        severity: "warning",
        viewport: vpId,
        nodeId: item.nodeId,
        message: `Text "${item.sample}" clips on the ${item.axis}-axis at ${vpId}.`,
        evidence: item,
        suggestion: "Allow text wrapping or increase container height/width so visible copy is never clipped.",
      });
    }
    for (const item of t.lowContrast ?? []) {
      findings.push({
        ruleId: "vision:rendered-low-contrast",
        kind: "deterministic-defect",
        severity: "error",
        viewport: vpId,
        nodeId: item.nodeId,
        message: `Rendered text "${item.sample}" has ${item.contrastRatio}:1 contrast (needs >= ${item.required}:1) at ${vpId}.`,
        evidence: item,
        suggestion: "Increase foreground/background luminance separation to meet WCAG AA.",
      });
    }
    for (const item of t.smallTargets ?? []) {
      findings.push({
        ruleId: item.threshold === 24 ? "vision:target-below-24px" : "vision:mobile-target-below-44px",
        kind: item.threshold === 24 ? "deterministic-defect" : "heuristic-observation",
        severity: item.severity,
        viewport: vpId,
        nodeId: item.nodeId,
        message: `Interactive <${item.tag}> renders at ${item.width}x${item.height}px at ${vpId} (minimum ${item.threshold}px).`,
        evidence: item,
        suggestion: `Set min-height and min-width to at least ${item.threshold}px.`,
      });
    }
    for (const item of t.brokenImages ?? []) {
      findings.push({
        ruleId: "vision:broken-image",
        kind: "deterministic-defect",
        severity: "error",
        viewport: vpId,
        nodeId: item.nodeId,
        message: `Image element rendered with naturalWidth 0 at ${vpId}.`,
        evidence: item,
        suggestion: "Provide a valid embedded data URI or local asset for the image.",
      });
    }
    for (const item of t.overlappingControls ?? []) {
      findings.push({
        ruleId: "vision:overlapping-controls",
        kind: "deterministic-defect",
        severity: "error",
        viewport: vpId,
        nodeId: null,
        message: `Interactive controls ${item.first} and ${item.second} overlap by ${item.overlapPx.width}x${item.overlapPx.height}px at ${vpId}.`,
        evidence: item,
        suggestion: "Add gap or flow layout spacing so interactive controls never collide.",
      });
    }
  }
  return findings;
}
