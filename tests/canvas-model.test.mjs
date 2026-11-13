import test from "node:test";
import assert from "node:assert/strict";

import { createDocument } from "../packages/document-model/src/index.mjs";
import { applyTransaction } from "../packages/history/src/index.mjs";
import {
  MAX_ZOOM, MIN_ZOOM, clampZoom, createViewport, fitBounds, insertNode, moveBy, normalizeSelection, panBy, removeNodes,
  reorder, resizeTo, screenToWorld, selectNode, setStyle, setText, worldToScreen, zoomAt, constraintOf, setConstraint,
} from "../packages/canvas/src/index.mjs";

// PC3 (#146): the canvas's pure parts. Viewport math, selection rules, and commands that turn
// interactions into history operations (the canvas itself never mutates the document).

const doc = () => createDocument({
  id: "d",
  nodes: [
    { id: "page", type: "frame", children: ["card", "free"], props: { tag: "main" } },
    { id: "card", type: "element", parentId: "page", children: ["title"], props: { tag: "section", style: { padding: "8px" } } },
    { id: "title", type: "text", parentId: "card", props: { tag: "h2", text: "Hi" } },
    { id: "free", type: "element", parentId: "page", props: { style: { position: "absolute", left: "10px", top: "20px" } } },
  ],
});
const apply = (document, operations) => applyTransaction(document, { id: "t", actor: "u", operations }).document;

test("the viewport round-trips points and zooms about a fixed screen point", () => {
  const viewport = createViewport({ x: 30, y: -10, zoom: 2 });
  for (const point of [{ x: 0, y: 0 }, { x: 12.5, y: -7 }, { x: 1000, y: 400 }]) {
    const back = screenToWorld(viewport, worldToScreen(viewport, point));
    assert.ok(Math.abs(back.x - point.x) < 1e-9 && Math.abs(back.y - point.y) < 1e-9);
  }
  const anchor = { x: 200, y: 150 };
  const before = screenToWorld(viewport, anchor);
  const zoomed = zoomAt(viewport, anchor, 1.7);
  const after = screenToWorld(zoomed, anchor);
  assert.ok(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.y - before.y) < 1e-9, "the point under the cursor stays put");
  assert.equal(zoomAt(viewport, anchor, 1e9).zoom, MAX_ZOOM);
  assert.equal(zoomAt(viewport, anchor, 1e-9).zoom, MIN_ZOOM);
  assert.deepEqual(panBy(viewport, 5, -5), { x: 35, y: -15, zoom: 2 });
  // Non-finite input never reaches the transform.
  assert.equal(clampZoom(Infinity), MAX_ZOOM);
  assert.equal(clampZoom(-Infinity), MIN_ZOOM);
  assert.equal(clampZoom(Number.NaN), 1);
  assert.deepEqual(createViewport({ x: Number.NaN, y: Infinity, zoom: 2 }), { x: 0, y: 0, zoom: 2 });
  assert.equal(zoomAt(viewport, { x: Number.NaN, y: 0 }, 2), viewport, "a NaN anchor leaves the viewport alone");
  assert.equal(zoomAt(viewport, anchor, Infinity).zoom, MAX_ZOOM);
  const fitted = fitBounds({ x: 0, y: 0, width: 800, height: 400 }, 448, 248, 24);
  assert.equal(fitted.zoom, 0.5);
  assert.deepEqual(worldToScreen(fitted, { x: 400, y: 200 }), { x: 224, y: 124 }, "the content is centred");
});

test("selection: replace, extend, clear, and normalize away missing and nested ids", () => {
  assert.deepEqual(selectNode([], "a"), ["a"]);
  assert.deepEqual(selectNode(["a"], "b"), ["b"]);
  assert.deepEqual(selectNode(["a"], "b", { extend: true }), ["a", "b"]);
  assert.deepEqual(selectNode(["a", "b"], "a", { extend: true }), ["b"]);
  assert.deepEqual(selectNode(["a"], null), []);
  assert.deepEqual(selectNode(["a"], null, { extend: true }), ["a"]);
  assert.deepEqual(normalizeSelection(doc(), ["title", "card", "gone", "free"]), ["card", "free"]);
});

test("commands produce history operations that apply cleanly", () => {
  let d = doc();
  d = apply(d, moveBy(d, ["free"], 5, -3));
  assert.deepEqual(d.nodes.free.props.style, { position: "absolute", left: "15px", top: "17px" }, "a positioned node moves by its offsets");
  d = apply(d, moveBy(d, ["card", "title"], 4, 6, { card: { left: 100, top: 50, width: 180, height: 60 } }));
  assert.deepEqual(d.nodes.card.props.style, { padding: "8px", position: "absolute", left: "104px", top: "56px", width: "180px" }, "a flow node is positioned at its measured place plus the delta, keeping its measured width (its height stays content-driven); the nested title is not moved separately");
  assert.equal(d.nodes.title.props.style, undefined);
  // A node pinned to its parent's right and bottom keeps those pins (its constraints): it moves by them.
  const anchored = createDocument({ id: "a", nodes: [{ id: "n", type: "element", props: { style: { position: "absolute", right: "10px", bottom: "5px", width: "40px" } } }] });
  assert.deepEqual(apply(anchored, moveBy(anchored, ["n"], 1, 2, { n: { left: 50, top: 60, width: 40, height: 20 } })).nodes.n.props.style, { position: "absolute", right: "9px", bottom: "3px", width: "40px" });
  // One pinned in units it cannot move by (a percentage) is placed by left and top where it is drawn.
  const percent = createDocument({ id: "p", nodes: [{ id: "n", type: "element", props: { style: { position: "absolute", right: "10%", top: "5px", width: "40px" } } }] });
  assert.deepEqual(apply(percent, moveBy(percent, ["n"], 1, 2, { n: { left: 50, top: 5, width: 40, height: 20 } })).nodes.n.props.style, { position: "absolute", left: "51px", top: "7px", width: "40px" });
  assert.deepEqual(reorder(d, "missing", 1), [], "an unknown id cannot be reordered");
  assert.deepEqual(resizeTo(d, "card", Number.NaN, 10), [], "a non-finite size is never written");
  assert.equal(resizeTo(d, "title", 10, 10, { inline: true })[0].set.style.display, "inline-block");
  d = apply(d, resizeTo(d, "card", 240.256, 0));
  assert.equal(d.nodes.card.props.style.width, "240.26px");
  assert.equal(d.nodes.card.props.style.height, "1px", "sizes stay positive");
  d = apply(d, setStyle(d, "card", { padding: null, color: "red" }));
  assert.deepEqual(Object.keys(d.nodes.card.props.style).sort(), ["color", "height", "left", "position", "top", "width"]);
  d = apply(d, setText("title", "Plans"));
  assert.equal(d.nodes.title.props.text, "Plans");
  d = apply(d, reorder(d, "card", 1));
  assert.deepEqual(d.nodes.page.children, ["free", "card"]);
  assert.deepEqual(reorder(d, "card", 5), [], "already last");
  d = apply(d, insertNode("page", 0, { id: "new", tag: "p", text: "New" }));
  assert.deepEqual(d.nodes.page.children, ["new", "free", "card"]);
  d = apply(d, removeNodes(d, ["card", "title", "missing"]));
  assert.equal(d.nodes.card, undefined);
  assert.equal(d.nodes.title, undefined);
});

test("constraints: read, set, and kept by moves and resizes", () => {
  const box = (style) => createDocument({ id: "c", nodes: [
    { id: "page", type: "frame", children: ["b"], props: { style: { position: "relative", width: "400px", height: "200px" } } },
    { id: "b", type: "element", parentId: "page", props: { style } },
  ] });
  const styled = (d) => d.nodes.b.props.style;
  // Read from the style.
  assert.equal(constraintOf({ position: "static", left: "1px" }, "x"), null, "not positioned: no constraint");
  assert.equal(constraintOf({ position: "absolute", left: "1px" }, "x"), "start");
  assert.equal(constraintOf({ position: "absolute" }, "y"), "start");
  assert.equal(constraintOf({ position: "absolute", right: "4px" }, "x"), "end");
  assert.equal(constraintOf({ position: "absolute", left: "1px", right: "auto" }, "x"), "start");
  assert.equal(constraintOf({ position: "absolute", top: "1px", bottom: "2px" }, "y"), "both");
  assert.equal(constraintOf({ position: "absolute", left: "calc(50% - 80px)" }, "x"), "centre");
  assert.equal(constraintOf({ position: "absolute", left: "1px", right: "2px", width: "9px" }, "x"), "start", "with a width of its own, its left wins: not stretched");
  assert.equal(constraintOf({ position: "absolute", left: "auto", right: "2px" }, "x"), "end");
  assert.equal(constraintOf({ position: "absolute", inset: "0" }, "x"), "both", "inset is read as its four edges");
  assert.equal(constraintOf({ position: "absolute", inset: "0 auto auto 4px" }, "x"), "start");
  assert.equal(constraintOf({ position: "absolute", inset: "auto 4px 0 auto" }, "y"), "end");

  // Set, keeping the place: a 100-wide box 20 from the left of a 400-wide parent.
  const measured = { start: 20, end: 280, size: 100, parent: 400 };
  const doc = box({ position: "absolute", left: "20px", top: "30px", width: "100px", height: "50px" });
  const pin = (mode, d = doc) => apply(d, setConstraint(d, "b", "x", mode, measured));
  assert.deepEqual(styled(pin("end")), { position: "absolute", top: "30px", width: "100px", height: "50px", right: "280px" });
  assert.deepEqual(styled(pin("both")), { position: "absolute", top: "30px", height: "50px", left: "20px", right: "280px" }, "pinned to both edges it has no width of its own");
  assert.deepEqual(styled(pin("centre")), { position: "absolute", top: "30px", width: "100px", height: "50px", left: "calc(50% - 180px)" });
  assert.deepEqual(styled(pin("start", pin("both"))), { position: "absolute", top: "30px", height: "50px", left: "20px", width: "100px" }, "back to one edge, it takes its size again");
  assert.deepEqual(setConstraint(doc, "b", "x", "middle", measured), [], "an unknown mode changes nothing");
  assert.deepEqual(setConstraint(doc, "b", "x", "end", { ...measured, end: Number.NaN }), [], "nor an unmeasured layer");

  // A move keeps the constraint: each pinned inset moves with it.
  const moved = (d) => styled(apply(d, moveBy(d, ["b"], 5, -3)));
  assert.deepEqual([moved(pin("end")).right, moved(pin("end")).left, moved(pin("end")).top], ["275px", undefined, "27px"]);
  assert.deepEqual([moved(pin("both")).left, moved(pin("both")).right], ["25px", "275px"]);
  assert.equal(moved(pin("centre")).left, "calc(50% - 175px)");
  assert.equal(styled(apply(pin("centre"), moveBy(pin("centre"), ["b"], 200, 0))).left, "calc(50% + 20px)", "past the centre the sign turns");

  // auto is no pin: moved, a layer with left: auto keeps its right pin.
  const autoLeft = box({ position: "absolute", left: "auto", right: "40px", top: "10px" });
  assert.deepEqual(styled(apply(autoLeft, moveBy(autoLeft, ["b"], 5, 1))), { position: "absolute", left: "auto", right: "35px", top: "11px" });
  // inset becomes its four edges when a pin is moved or changed, so no edge is left behind.
  const inset = box({ position: "absolute", inset: "0 10px" });
  assert.deepEqual(styled(apply(inset, moveBy(inset, ["b"], 5, 2))), { top: "2px", right: "5px", bottom: "-2px", left: "15px", position: "absolute" });
  assert.deepEqual(styled(apply(inset, setConstraint(inset, "b", "x", "start", measured))), { top: "0", bottom: "0", position: "absolute", left: "20px", width: "100px" });

  // A resize keeps its start edge: pinned to both edges by the end inset alone; pinned to the end,
  // that inset moves with the new size.
  const resized = (d) => styled(apply(d, resizeTo(d, "b", 130, 60, { from: { width: 100, height: 50 } })));
  assert.deepEqual([resized(pin("both")).right, resized(pin("both")).width, resized(pin("both")).height], ["250px", undefined, "60px"]);
  assert.deepEqual([resized(pin("end")).right, resized(pin("end")).width], ["250px", "130px"]);
  assert.deepEqual([resized(doc).left, resized(doc).width], ["20px", "130px"], "pinned to the start, as before");
  // Left, right and a width: the width is what a resize changes (its right is ignored).
  const over = box({ position: "absolute", left: "10px", right: "10px", width: "100px", top: "0px", height: "50px" });
  assert.deepEqual([resized(over).width, resized(over).right], ["130px", "10px"]);
});
