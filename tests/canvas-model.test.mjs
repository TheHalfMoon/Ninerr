import test from "node:test";
import assert from "node:assert/strict";

import { createDocument } from "../packages/document-model/src/index.mjs";
import { applyTransaction } from "../packages/history/src/index.mjs";
import {
  ALIGN_EDGES, MAX_ZOOM, MIN_ZOOM, alignOffsets, clampZoom, constraintOf, createViewport, distributeOffsets, fitBounds,
  insertNode, moveBy, moveEach, normalizeSelection, panBy, removeNodes, reorder, resizeTo, screenToWorld, selectNode,
  setConstraint, setLayout, setStyle, setText, snapMove, worldToScreen, zoomAt,
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

test("a moving box snaps each axis to the nearest edge or centre within the distance, naming the lines it meets", () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };
  // Its right edge (10) is 3 from the target's left (13); nothing is near on y.
  assert.deepEqual(snapMove(box, [{ x: 13, y: 100, width: 20, height: 20 }], 4), { dx: 3, dy: 0, guides: { x: [13], y: [] } });
  // The nearest line wins: centre 5 to 6 (1) over left 0 to -2 (2); y snaps on its own.
  assert.deepEqual(snapMove(box, [{ x: -2, y: 30, width: 16, height: 8 }, { x: 50, y: 11, width: 4, height: 4 }], 4), { dx: 1, dy: 1, guides: { x: [6], y: [11] } });
  // Every line the snapped box then meets is a guide: two targets share the left edge.
  assert.deepEqual(snapMove(box, [{ x: 2, y: 40, width: 30, height: 5 }, { x: 2, y: 80, width: 40, height: 5 }], 4).guides.x, [2]);
  // Beyond the distance, or with no targets, nothing moves.
  assert.deepEqual(snapMove(box, [{ x: 15, y: 15, width: 5, height: 5 }], 4), { dx: 0, dy: 0, guides: { x: [], y: [] } });
  assert.deepEqual(snapMove(box, [], 4), { dx: 0, dy: 0, guides: { x: [], y: [] } });
});

test("auto layout on: a flex row or column, its free children joining the flow; off: the flex styles go", () => {
  const d = createDocument({ id: "d", nodes: [
    { id: "board", type: "frame", children: ["a", "b"], props: { style: { position: "relative", width: "300px", gap: "4px" } } },
    { id: "a", type: "element", parentId: "board", props: { style: { position: "absolute", left: "10px", top: "20px", width: "40px" } } },
    { id: "b", type: "element", parentId: "board", props: { style: { width: "50px" } } },
  ] });
  assert.deepEqual(setLayout(d, "board", "row"), [
    { type: "set-props", nodeId: "board", set: { style: { position: "relative", width: "300px", gap: "4px", display: "flex", "flex-direction": "row" } } },
    { type: "set-props", nodeId: "a", set: { style: { width: "40px" } } },
  ], "only the child placed by left and top changes");
  const column = applyTransaction(d, { id: "t", actor: "u", operations: setLayout(d, "board", "column") }).document;
  assert.equal(column.nodes.board.props.style["flex-direction"], "column");
  assert.deepEqual(setLayout(column, "board", "free"), [{ type: "set-props", nodeId: "board", set: { style: { position: "relative", width: "300px" } } }]);
  // Off, each measured child is kept where the row put it.
  const freed = setLayout(column, "board", "free", { a: { left: 0, top: 0, width: 40 }, b: { left: 0, top: 30, width: 50 } });
  assert.deepEqual(freed.slice(1).map((operation) => [operation.nodeId, operation.set.style.position, operation.set.style.left, operation.set.style.top]), [["a", "absolute", "0px", "0px"], ["b", "absolute", "0px", "30px"]]);
  // A reversed or inline flex keeps that when the direction changes.
  const reversed = createDocument({ id: "r", nodes: [{ id: "x", type: "frame", children: [], props: { style: { display: "inline-flex", "flex-direction": "row-reverse" } } }] });
  assert.deepEqual(setLayout(reversed, "x", "column")[0].set.style, { display: "inline-flex", "flex-direction": "column-reverse" });
  assert.deepEqual(setLayout(d, "missing", "row"), []);
  assert.throws(() => setLayout(d, "board", "grid"), /mode is one of free, row, column/u);
});

test("align moves each box to the outermost edge, or to the centre of their bounds", () => {
  const boxes = { a: { left: 10, top: 0, width: 20, height: 10 }, b: { left: 50, top: 30, width: 40, height: 20 } };
  assert.deepEqual(alignOffsets(boxes, "left"), { a: { dx: 0, dy: 0 }, b: { dx: -40, dy: 0 } });
  assert.deepEqual(alignOffsets(boxes, "right"), { a: { dx: 60, dy: 0 }, b: { dx: 0, dy: 0 } });
  assert.deepEqual(alignOffsets(boxes, "center"), { a: { dx: 30, dy: 0 }, b: { dx: -20, dy: 0 } });
  assert.deepEqual(alignOffsets(boxes, "top"), { a: { dx: 0, dy: 0 }, b: { dx: 0, dy: -30 } });
  assert.deepEqual(alignOffsets(boxes, "bottom"), { a: { dx: 0, dy: 40 }, b: { dx: 0, dy: 0 } });
  assert.deepEqual(alignOffsets(boxes, "middle"), { a: { dx: 0, dy: 20 }, b: { dx: 0, dy: -15 } });
  assert.deepEqual(alignOffsets({ a: boxes.a }, "left"), {}, "one box aligns with nothing");
  assert.throws(() => alignOffsets(boxes, "diagonal"), /edge is one of left, center, right, top, middle, bottom/u);
  assert.deepEqual([...ALIGN_EDGES], ["left", "center", "right", "top", "middle", "bottom"]);
});

test("distribute keeps the first and last where they are and makes the gaps between them equal", () => {
  // Widths 10, 30, 20 between 0 and 100: 40 of gaps, 20 each.
  const boxes = { c: { left: 80, top: 5, width: 20, height: 5 }, a: { left: 0, top: 0, width: 10, height: 5 }, b: { left: 15, top: 9, width: 30, height: 5 } };
  assert.deepEqual(distributeOffsets(boxes, "horizontal"), { a: { dx: 0, dy: 0 }, b: { dx: 15, dy: 0 }, c: { dx: 0, dy: 0 } });
  assert.deepEqual(distributeOffsets({ a: { left: 0, top: 0, width: 5, height: 10 }, b: { left: 0, top: 50, width: 5, height: 10 }, c: { left: 0, top: 12, width: 5, height: 10 } }, "vertical"),
    { a: { dx: 0, dy: 0 }, c: { dx: 0, dy: 13 }, b: { dx: 0, dy: 0 } });
  assert.deepEqual(distributeOffsets({ a: boxes.a, b: boxes.b }, "horizontal"), {}, "two boxes have one gap: nothing to even out");
  assert.throws(() => distributeOffsets(boxes, "diagonal"), /axis is horizontal or vertical/u);
  // One box holds the others: they cannot sit side by side, so their centres are spaced evenly.
  const held = distributeOffsets({ a: { left: 0, top: 0, width: 1000, height: 5 }, b: { left: 100, top: 0, width: 10, height: 5 }, c: { left: 200, top: 0, width: 10, height: 5 } }, "horizontal");
  assert.deepEqual(held, { a: { dx: 0, dy: 0 }, b: { dx: 247.5, dy: 0 }, c: { dx: 0, dy: 0 } });
});

test("moveEach moves each layer by its own offset, in one change, and skips what does not move", () => {
  const d = doc();
  const operations = moveEach(d, { free: { dx: 5, dy: -5 }, card: { dx: 0, dy: 0 }, gone: { dx: 1, dy: 1 } }, {});
  assert.deepEqual(operations, [{ type: "set-props", nodeId: "free", set: { style: { position: "absolute", left: "15px", top: "15px" } } }]);
  assert.equal(applyTransaction(d, { id: "t", actor: "u", operations }).document.nodes.free.props.style.left, "15px");
  // A layer taken out of the flow to measure the others is positioned too, where it is.
  const placed = moveEach(d, { card: { dx: 0, dy: 0 } }, { card: { left: 3, top: 4, width: 50 } }, new Set(["card"]));
  assert.deepEqual(placed.map((operation) => [operation.nodeId, operation.set.style.position, operation.set.style.left, operation.set.style.top]), [["card", "absolute", "3px", "4px"]]);
});
