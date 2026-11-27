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
});
