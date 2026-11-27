import test from "node:test";
import assert from "node:assert/strict";
import { createDocument } from "@ninerr/document-model";
import { applyTransaction } from "@ninerr/history";
import {
  STANDARD_VIEWPORTS,
  buildCritiqueReport,
  decodePng,
  diffPngBuffers,
  discoverBrowser,
  encodePng,
  improveDesignInMemory,
  renderAndInspect,
  visionTelemetryFindings,
} from "../packages/vision/src/index.mjs";

function solidPng(width, height, [r, g, b, a = 255]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return encodePng({ width, height, data });
}

test("pure-JS PNG encoder, decoder, and visual pixel diff work deterministically with zero deps", () => {
  const a = solidPng(32, 24, [255, 255, 255, 255]);
  const bData = new Uint8Array(32 * 24 * 4).fill(255);
  // Paint a 4x4 crimson square at (10, 8)
  for (let y = 8; y < 12; y += 1) {
    for (let x = 10; x < 14; x += 1) {
      const idx = (y * 32 + x) * 4;
      bData[idx] = 15;
      bData[idx + 1] = 118;
      bData[idx + 2] = 110;
      bData[idx + 3] = 255;
    }
  }
  const b = encodePng({ width: 32, height: 24, data: bData });
  const decoded = decodePng(b);
  assert.equal(decoded.width, 32);
  assert.equal(decoded.height, 24);
  assert.equal(decoded.data[(8 * 32 + 10) * 4], 15);

  const same = diffPngBuffers(a, a);
  assert.equal(same.diffPixels, 0);
  assert.equal(same.diffPercent, 0);
  assert.equal(same.changedRegion, null);

  const diff = diffPngBuffers(a, b);
  assert.equal(diff.diffPixels, 16);
  assert.deepEqual(diff.changedRegion, { x: 10, y: 8, width: 4, height: 4 });
  assert.ok(Buffer.isBuffer(diff.diffPng));
  assert.equal(decodePng(diff.diffPng).width, 32);
});

test("real local browser renders multi-viewport PNGs, detects visual defects, and enforces 3-layer zero-egress", { timeout: 60_000 }, async (t) => {
  const browser = discoverBrowser();
  if (!browser) {
    t.skip("no local Chromium/Edge/Chrome installed on this host");
    return;
  }

  // Intentionally includes: external egress attempt, horizontal overflow on mobile,
  // low-contrast text, tiny button target, and clipped text.
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        body { margin: 0; font-family: system-ui, sans-serif; background: #ffffff; color: #0f172a; }
        .wide { width: 520px; background: #f1f5f9; padding: 12px; }
        .low-contrast { color: #c4c4c4; background: #ffffff; font-size: 14px; }
        .tiny-btn { width: 16px; height: 16px; padding: 0; border: 0; background: #0f766e; color: #fff; }
        .clipped { width: 60px; white-space: nowrap; overflow: hidden; }
      </style>
    </head>
    <body>
      <main data-ninerr-id="root-main" class="wide">
        <h1 data-ninerr-id="h1-title">Vision Live Test</h1>
        <p data-ninerr-id="p-faint" class="low-contrast">Barely readable text on white background</p>
        <p data-ninerr-id="p-clip" class="clipped">This long sentence clips horizontally inside sixty pixels</p>
        <button data-ninerr-id="btn-tiny" class="tiny-btn" type="button">x</button>
        <img data-ninerr-id="img-leak" src="https://egress-test.invalid/leak.png" alt="Blocked external" />
      </main>
    </body>
  </html>`;

  const result = await renderAndInspect({
    html,
    viewports: ["mobile", "desktop"],
    colorScheme: "light",
    captureScreenshot: true,
    fullPage: true,
  });

  assert.equal(result.captures.length, 2);
  assert.equal(result.captures[0].viewport.width, STANDARD_VIEWPORTS.mobile.width);
  assert.equal(result.captures[1].viewport.width, STANDARD_VIEWPORTS.desktop.width);

  // Zero-egress check: external img request was intercepted and blocked.
  assert.ok(result.egress.totalBlocked >= 1, "external egress attempt was caught and blocked");

  // Screenshots are valid decodable PNGs with real dimensions.
  const mobilePng = decodePng(result.captures[0].pngBuffer);
  const desktopPng = decodePng(result.captures[1].pngBuffer);
  assert.equal(mobilePng.width, 375);
  assert.equal(desktopPng.width, 1440);

  // Live visual telemetry catches overflow on mobile, low contrast, tiny target, and clipped text.
  const findings = visionTelemetryFindings(result.captures);
  const rules = new Set(findings.map((f) => f.ruleId));
  assert.ok(rules.has("vision:horizontal-overflow"), "caught 520px overflow on 375px mobile");
  assert.ok(rules.has("vision:rendered-low-contrast"), "caught rendered low contrast");
  assert.ok(rules.has("vision:target-below-24px"), "caught 16x16px button target");
  assert.ok(rules.has("vision:clipped-text"), "caught clipped text");

  // Pixel diff between dark and light renders detects visual change.
  const cleanHtml = `<!doctype html><html><body style="margin:0;padding:24px;background:#0b0f14;color:#f1f5f9;"><h1>Dark Render</h1></body></html>`;
  const darkRes = await renderAndInspect({ html: cleanHtml, viewports: ["desktop"], colorScheme: "dark" });
  const pixelDiff = diffPngBuffers(result.captures[1].pngBuffer, darkRes.captures[0].pngBuffer);
  assert.ok(pixelDiff.diffPixels > 1000, "pixel diff detects substantial light vs dark change");
});

test("unified Ninerr Critic and bounded in-memory improveDesign reduce defects cleanly in one atomic batch", async () => {
  let doc = createDocument({ id: "doc-critic", name: "Critic" });
  doc = applyTransaction(doc, {
    id: "tx-1",
    baseRevision: 0,
    actor: "test",
    actorKind: "agent",
    intent: "seed",
    timestamp: "2026-11-27T00:00:00.000Z",
    operations: [
      {
        type: "insert-node",
        parentId: null,
        index: 0,
        node: {
          id: "card-1",
          type: "frame",
          props: {
            tag: "section",
            style: { "background-color": "#ffffff", padding: "13px", "box-shadow": "0 20px 60px rgba(0, 0, 0, 0.4)" },
            stylesheet: ".card { transition: width 400ms ease; }",
          },
        },
      },
      {
        type: "insert-node",
        parentId: "card-1",
        index: 0,
        node: {
          id: "p-1",
          type: "element",
          props: { tag: "p", text: "Faint copy", style: { color: "#cccccc", "background-color": "#ffffff" } },
        },
      },
      {
        type: "insert-node",
        parentId: "card-1",
        index: 1,
        node: {
          id: "btn-1",
          type: "element",
          props: { tag: "button", text: "Go", style: { height: "18px", width: "40px" } },
        },
      },
      {
        type: "insert-node",
        parentId: "card-1",
        index: 2,
        node: {
          id: "img-1",
          type: "element",
          props: { tag: "img", attributes: { src: "data:image/png;base64,iVBORw0KGgo=" } },
        },
      },
    ],
  }).document;

  const improved = await improveDesignInMemory(doc, {
    maxIterations: 3,
    evaluate: (candidate) => buildCritiqueReport({ document: candidate }),
  });

  assert.equal(improved.improved, true);
  assert.ok(improved.final.defectScore < improved.baseline.defectScore, `score dropped from ${improved.baseline.defectScore} to ${improved.final.defectScore}`);
  assert.equal(improved.final.errors, 0, "all deterministic errors resolved in memory");
  assert.ok(improved.operations.length >= 2, "collapsed into one atomic operations array");

  // Non-pixel units (rem / %) are preserved, not mistakenly deleted by target-size fix.
  const remDoc = applyTransaction(createDocument({ id: "doc-rem", name: "Rem" }), {
    id: "tx-rem",
    baseRevision: 0,
    actor: "test",
    actorKind: "agent",
    intent: "seed",
    timestamp: "2026-11-27T00:00:00.000Z",
    operations: [
      { type: "insert-node", parentId: null, index: 0, node: { id: "btn-rem", type: "element", props: { tag: "button", text: "Go", style: { height: "2.5rem", width: "100%" } } } },
    ],
  }).document;
  const remReport = buildCritiqueReport({
    document: remDoc,
    visionCaptures: [{ viewport: { id: "mobile", width: 375, height: 812 }, telemetry: { horizontalOverflow: false, overflowPx: 0, viewport: { width: 375, height: 812 }, documentSize: { scrollWidth: 375, scrollHeight: 400 }, overflowingElements: [], clippedText: [], lowContrast: [], smallTargets: [{ nodeId: "btn-rem", label: "btn-rem", tag: "button", width: 20, height: 20, severity: "error", threshold: 24 }], brokenImages: [], overlappingControls: [] } }],
  });
  const remImp = await improveDesignInMemory(remDoc, {
    maxIterations: 1,
    evaluate: (cand) => (cand.nodes["btn-rem"].props.style["min-height"] === "36px" ? buildCritiqueReport({ document: cand }) : remReport),
  });
  assert.equal(remImp.operations[0].set.style.height, "2.5rem", "rem height is preserved");
});

test("PR 486 review regressions: PNG pixel-bomb & NaN threshold guards, IPv6 loopback proxy, dark-surface contrast inheritance, comment-safe CSS transition repair, and CLI validation", async () => {
  // 1. Mismatched-dimension PNG diff bomb (16384x1 vs 1x16384 = 268M px > 25M limit) and NaN threshold rejected.
  const wideStrip = encodePng({ width: 16_384, height: 1, data: new Uint8Array(16_384 * 4) });
  const tallStrip = encodePng({ width: 1, height: 16_384, data: new Uint8Array(16_384 * 4) });
  assert.throws(() => diffPngBuffers(wideStrip, tallStrip), /exceed pixel limit/u);
  assert.throws(() => diffPngBuffers(wideStrip, wideStrip, { threshold: Number.NaN }), /finite/u);
  assert.throws(() => encodePng({ width: 16_384, height: 16_384, data: new Uint8Array(0) }), /invalid PNG encode dimensions/u);

  // 2. IPv6 loopback origin http://[::1]:8080 is accepted by containment proxy.
  const { startStrictContainmentProxy } = await import("@ninerr/vision");
  const ipv6Proxy = await startStrictContainmentProxy({ allowedOrigin: "http://[::1]:8080" });
  try {
    assert.equal(ipv6Proxy.allowedOrigin.host, "::1");
  } finally {
    await ipv6Proxy.close();
  }

  // 3. Dark-parent contrast inheritance picks #ffffff (never dark-on-dark), narrow width is fixed,
  //    and CSS comments + transition: none are preserved while rewriting thrashing transitions.
  const doc = applyTransaction(createDocument({ id: "doc-reg486", name: "Reg486" }), {
    id: "tx-reg486",
    baseRevision: 0,
    actor: "test",
    actorKind: "agent",
    intent: "seed",
    timestamp: "2026-11-27T00:00:00.000Z",
    operations: [
      {
        type: "insert-node",
        parentId: null,
        index: 0,
        node: {
          id: "dark-shell",
          type: "frame",
          props: {
            tag: "section",
            style: { "background-color": "#0f172a" },
            stylesheet: "/* example: transition: width 200ms */ .card { transition: width 400ms ease; } @media (prefers-reduced-motion: reduce) { .card { transition: none; } }",
          },
        },
      },
      {
        type: "insert-node",
        parentId: "dark-shell",
        index: 0,
        node: {
          id: "dark-text",
          type: "element",
          props: { tag: "p", text: "Dim dark text", style: { color: "#1e293b" } },
        },
      },
      {
        type: "insert-node",
        parentId: "dark-shell",
        index: 1,
        node: {
          id: "narrow-btn",
          type: "element",
          props: { tag: "button", text: "X", style: { width: "16px", height: "16px" } },
        },
      },
    ],
  }).document;

  const { evaluateTaste } = await import("@ninerr/design-intelligence");
  const imp = await improveDesignInMemory(doc, {
    maxIterations: 2,
    evaluate: (cand) => buildCritiqueReport({ document: cand, tasteFindings: evaluateTaste(cand).findings }),
  });
  const textOp = imp.operations.find((op) => op.nodeId === "dark-text");
  assert.equal(textOp?.set?.style?.color, "#ffffff", "dark-parent contrast repair chooses white ink, not dark-on-dark");
  const btnOp = imp.operations.find((op) => op.nodeId === "narrow-btn");
  assert.equal(btnOp?.set?.style?.width, undefined, "narrow <36px width is cleared");
  assert.equal(btnOp?.set?.style?.["min-width"], "36px");
  const sheetOp = imp.operations.find((op) => op.nodeId === "dark-shell");
  assert.match(sheetOp?.set?.stylesheet ?? "", /^\/\* example: transition: width 200ms \*\//u, "CSS comment preserved verbatim");
  assert.match(sheetOp?.set?.stylesheet ?? "", /transition:\s*none;/u, "reduced-motion transition: none preserved");
  assert.match(sheetOp?.set?.stylesheet ?? "", /transition:\s*transform 150ms/u, "thrashing transition rewritten safely");

  // 4. CLI --max-iterations without value exits 2.
  const { runCliCommand } = await import("../packages/studio-host/src/cli.ts");
  const badCode = await runCliCommand("improve", [".", "--max-iterations"], {
    version: "0.1.0",
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(badCode, 2, "missing --max-iterations value exits 2");
});
