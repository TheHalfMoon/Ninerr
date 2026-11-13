import test from "node:test";
import assert from "node:assert/strict";

import { createDocument } from "../packages/document-model/src/index.mjs";
import { compileTokens, renameToken } from "../packages/document-model/src/tokens.mjs";
import { applyTransaction } from "../packages/history/src/index.mjs";
import { MAX_EXPANDED_LAYERS, expandInstance, instancesDrawing } from "../packages/renderer/src/index.mjs";
import { TEST_ORIGIN, browserTestOptions, launchPage } from "./support/browser.mjs";

// Schema v2 at scale (P10-1; ADR-0004 and ADR-0005 budgets). Measured on the i5-13420H
// development machine on 2026-11-13: expanding 1,000 instances of a 20-layer component, 11 ms;
// finding the instances that draw a component among 10,000, 18.5 ms; renaming a token used by
// 4,999 layers, 39 ms; compiling 5,000 tokens, 9 ms; drawing 1,000 such instances on the canvas, 218 ms, and redrawing them all after one
// component edit, 243 ms. The budgets below carry about ten times
// that, so slower CI runners pass. Two scaling guards compare four times the work on one
// machine (1,000 and 4,000 instances; 2,500 and 10,000, the most a document may have) and catch a quadratic regression
// whatever its speed; the rename and compile have budgets only.

function componentDocument(instances, layersPer) {
  const nodes = [{ id: "page", type: "frame", children: [], props: { tag: "main" } }];
  const component = { id: "comp", type: "component-definition", parentId: "page", children: [], props: { name: "Card", properties: [{ id: "p", name: "Title", kind: "text", default: "Hi", target: { nodeId: "c0", field: "text" } }] } };
  nodes.push(component);
  nodes[0].children.push("comp");
  for (let index = 0; index < layersPer - 1; index += 1) {
    nodes.push({ id: `c${index}`, type: "element", parentId: "comp", children: [], props: { tag: "div", text: `t${index}`, style: { padding: "1px" } } });
    component.children.push(`c${index}`);
  }
  for (let index = 0; index < instances; index += 1) {
    nodes.push({ id: `i${index}`, type: "component-instance", parentId: "page", children: [], props: { componentId: "comp", propertyValues: { p: `Card ${index}` } } });
    nodes[0].children.push(`i${index}`);
  }
  return createDocument({ id: "d", nodes });
}

function tokenDocument(layers) {
  const nodes = [
    { id: "system", type: "design-system", children: [], props: { name: "DS", collections: [{ id: "base", name: "Base", modes: [{ id: "default", name: "Default" }], defaultMode: "default" }], tokens: [{ name: "--brand", type: "color", collection: "base", values: { default: "#2255ff" } }] } },
    { id: "page", type: "frame", children: [], props: {} },
  ];
  for (let index = 0; index < layers; index += 1) {
    nodes.push({ id: `l${index}`, type: "element", parentId: "page", children: [], props: { tag: "div", style: { color: "var(--brand)" } } });
    nodes[1].children.push(`l${index}`);
  }
  return createDocument({ id: "t", nodes });
}

// The best of three runs: one slow run (a GC pause, a busy runner) cannot set the figure.
function best(fn, runs = 3) {
  let fastest = Number.POSITIVE_INFINITY;
  let value;
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    value = fn();
    fastest = Math.min(fastest, performance.now() - started);
  }
  return { ms: fastest, value };
}

// Each count, once: what one expansion of every instance draws.
const expandAll = (doc, count) => () => {
  const size = (view) => 1 + view.children.reduce((sum, child) => sum + size(child), 0);
  let layers = 0;
  for (let index = 0; index < count; index += 1) layers += size(expandInstance(doc, `i${index}`));
  return layers;
};

test("1,000 instances of a 20-layer component expand within budget, and the cost grows linearly", () => {
  const large = best(expandAll(componentDocument(1_000, 20), 1_000));
  assert.equal(large.value, 20_000, "each instance draws its 20 layers");
  assert.ok(large.ms < 500, `expanding 1,000 instances took ${large.ms.toFixed(1)} ms (budget 500)`);
  // Four times the instances at sizes past the timer's noise: a linear cost takes about four
  // times as long; a quadratic one, sixteen.
  const fewer = best(expandAll(componentDocument(1_000, 20), 1_000));
  const more = best(expandAll(componentDocument(4_000, 20), 4_000));
  assert.ok(more.ms < fewer.ms * 8 + 5, `1,000 took ${fewer.ms.toFixed(1)} ms, 4,000 took ${more.ms.toFixed(1)} ms`);
  assert.equal(MAX_EXPANDED_LAYERS, 5_000, "one instance's own budget is unchanged");
});

test("finding the instances that draw a component among 10,000 is within budget and linear", () => {
  // 10,000 instances is the most a document may have (schema v2's limit).
  const doc2k = componentDocument(2_500, 5);
  const doc10k = componentDocument(10_000, 5);
  const fewer = best(() => instancesDrawing(doc2k, ["comp"]));
  const run = best(() => instancesDrawing(doc10k, ["comp"]));
  assert.deepEqual([fewer.value.length, run.value.length], [2_500, 10_000]);
  assert.ok(run.ms < 500, `10,000 instances took ${run.ms.toFixed(1)} ms (budget 500)`);
  assert.ok(run.ms < fewer.ms * 8 + 5, `2,500 took ${fewer.ms.toFixed(1)} ms, 10,000 took ${run.ms.toFixed(1)} ms`);
});

test("renaming a token used by 4,999 layers is one change within budget; more is refused, saying why", () => {
  const doc = tokenDocument(4_999);
  const { ms, value: operations } = best(() => renameToken(doc, "--brand", "--accent"));
  assert.ok(ms < 500, `renaming across 4,999 layers took ${ms.toFixed(1)} ms (budget 500)`);
  const renamed = applyTransaction(doc, { id: "rename", actor: "u", operations }).document;
  assert.equal(renamed.nodes.l4998.props.style.color, "var(--accent)");
  assert.equal(renamed.nodes.system.props.tokens[0].name, "--accent");
  assert.throws(() => renameToken(tokenDocument(10_000), "--brand", "--accent"), /used by 10000 layers; one change can rewrite at most 4999/u);
});

test("5,000 tokens in two modes, aliases among them, compile within budget", () => {
  const doc = createDocument({ id: "b", nodes: [{ id: "system", type: "design-system", children: [], props: { name: "DS", collections: [{ id: "base", name: "Base", modes: [{ id: "default", name: "Default" }, { id: "dark", name: "Dark" }], defaultMode: "default" }], tokens: Array.from({ length: 5_000 }, (_, index) => ({ name: `--t${index}`, type: "color", collection: "base", values: { default: "#000000", dark: index % 2 ? "var(--t0)" : "#ffffff" } })) } }] });
  const { ms, value: css } = best(() => compileTokens(doc));
  assert.ok(ms < 250, `compiling 5,000 tokens took ${ms.toFixed(1)} ms (budget 250)`);
  assert.match(css, /--t4999: #000000;/u);
  assert.match(css, /\[data-ninerr-mode~="base:dark"\] \{\n {2}--t0: #ffffff;\n {2}--t1: var\(--t0\);/u);
});

const HARNESS = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="canvas"></div>
<script type="module">
  import * as renderer from "/packages/renderer/src/index.mjs";
  window.ninerrRenderer = renderer;
  window.ready = true;
</script></body></html>`;

test("the canvas draws 1,000 instances of a 20-layer component and redraws them all after one component edit, within budget", browserTestOptions(), async () => {
  const session = await launchPage({ extraRoutes: { "/harness.html": { status: 200, contentType: "text/html", body: HARNESS } } });
  try {
    const { page } = session;
    await page.goto(`${TEST_ORIGIN}/harness.html`);
    await page.waitForFunction(() => window.ready === true);
    await page.evaluate(async () => {
      const mounted = await window.ninerrRenderer.mountSandboxedRenderer(document.getElementById("canvas"));
      window.frame = mounted.frame;
      window.r = mounted.renderer;
    });
    const doc = componentDocument(1_000, 20);
    const first = await page.evaluate((d) => {
      const started = performance.now();
      window.r.render(d);
      return { ms: performance.now() - started, drawn: window.frame.contentDocument.querySelectorAll("[data-ninerr-instance]").length };
    }, doc);
    assert.equal(first.drawn, 19_000, "each instance draws its 19 layers inside its own element");
    assert.ok(first.ms < 5_000, `first render took ${first.ms.toFixed(0)} ms (budget 5,000)`);
    // One edit to the component: every instance is drawn again, in its own element; the page and
    // the instances' elements are kept (a patch, not a whole new render).
    const result = applyTransaction(doc, { id: "t", actor: "u", operations: [{ type: "set-props", nodeId: "c5", set: { text: "changed" } }] });
    const patched = await page.evaluate(({ d, affected }) => {
      const before = { page: window.r.elementFor("page"), first: window.r.elementFor("i0"), last: window.r.elementFor("i999") };
      const started = performance.now();
      window.r.patch(d, affected);
      const ms = performance.now() - started;
      const kept = window.r.elementFor("page") === before.page && window.r.elementFor("i0") === before.first && window.r.elementFor("i999") === before.last;
      return { ms, kept, changed: [...window.frame.contentDocument.querySelectorAll('[data-ninerr-id="c5"][data-ninerr-instance]')].filter((element) => element.textContent === "changed").length };
    }, { d: result.document, affected: result.affectedNodeIds });
    assert.equal(patched.changed, 1_000, "each instance draws the change once");
    assert.equal(patched.kept, true, "the page and the instances' elements are the same ones");
    assert.ok(patched.ms < 5_000, `redrawing 1,000 instances took ${patched.ms.toFixed(0)} ms (budget 5,000)`);
    console.log(`# schema v2 canvas: first render ${first.ms.toFixed(0)} ms, redraw after a component edit ${patched.ms.toFixed(0)} ms`);
  } finally {
    await session.close();
  }
});
