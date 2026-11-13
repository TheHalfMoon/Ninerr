import test from "node:test";
import assert from "node:assert/strict";

import { createDocument } from "../packages/document-model/src/index.mjs";
import { TEST_ORIGIN, browserTestOptions, launchPage } from "./support/browser.mjs";

// Reduced motion on the canvas: when the system asks for it, a design's animations and
// transitions end at once, even ones its stylesheet marks important. The document keeps them.

const HARNESS = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="canvas"></div>
<script type="module">
  import * as renderer from "/packages/renderer/src/index.mjs";
  const mounted = await renderer.mountSandboxedRenderer(document.getElementById("canvas"));
  window.frame = mounted.frame;
  window.r = mounted.renderer;
  window.ready = true;
</script></body></html>`;

const doc = createDocument({ id: "d", nodes: [
  { id: "page", type: "frame", children: ["spin", "fade"], props: { tag: "main", stylesheet: "@keyframes turn { to { rotate: 1turn; } } .fade { transition: opacity 3s ease 1s !important; }" } },
  { id: "spin", type: "element", parentId: "page", props: { tag: "div", text: "spin", style: { animation: "turn 2s linear 500ms infinite" } } },
  { id: "fade", type: "element", parentId: "page", props: { tag: "div", text: "fade", attributes: { class: "fade" } } },
] });

async function timings(reducedMotion) {
  const session = await launchPage({ extraRoutes: { "/harness.html": { status: 200, contentType: "text/html", body: HARNESS } } });
  try {
    await session.page.emulateMedia({ reducedMotion });
    await session.page.goto(`${TEST_ORIGIN}/harness.html`);
    await session.page.waitForFunction(() => window.ready === true);
    return await session.page.evaluate((d) => {
      window.r.render(d);
      const frame = window.frame.contentDocument;
      const style = (id) => frame.defaultView.getComputedStyle(frame.querySelector(`[data-ninerr-id="${id}"]`));
      const spin = style("spin");
      const fade = style("fade");
      return { animation: [spin.animationDuration, spin.animationDelay, spin.animationIterationCount], transition: [fade.transitionDuration, fade.transitionDelay] };
    }, doc);
  } finally {
    await session.close();
  }
}

test("with reduced motion asked for, the canvas ends every animation and transition at once; otherwise they run as written", browserTestOptions(), async () => {
  assert.deepEqual(await timings("reduce"), { animation: ["0s", "0s", "1"], transition: ["0s", "0s"] }, "an important transition in the page's stylesheet ends at once too");
  assert.deepEqual(await timings("no-preference"), { animation: ["2s", "0.5s", "infinite"], transition: ["3s", "1s"] });
});
