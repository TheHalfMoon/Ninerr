// @ninerr/canvas: viewport, hit testing, selection and transforms over the Ninerr renderer.
//
// The canvas reads the document and never mutates it: every interaction ends in a list of
// history operations handed to `onCommit`, which the editor sends to the studio host as one
// transaction. Drags preview with a CSS translate and commit once, on release. Viewport,
// selection and command math are pure functions; `mountCanvas` adds the DOM. No imports of
// Node built-ins, so the browser loads this module as is.

import { mountSandboxedRenderer } from "../../renderer/src/index.mjs";
import { compileTokens, designSystemOf } from "../../document-model/src/tokens.mjs";

// Components and instances (ADR-0005): the operations the editor and the host's MCP tools send.
export { componentGraph, componentsFor, componentsOf, createComponent, detachInstance, drawsComponent, insertInstance, instanceLayers, overrideFor, parseDeclarations, resetInstance, setInstanceOverride } from "./components.mjs";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

// ---------- viewport (pure) ----------

/** A viewport maps world (document) coordinates to screen: screen = world * zoom + offset. */
export function createViewport({ x = 0, y = 0, zoom = 1 } = {}) {
  return Object.freeze({ x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0, zoom: clampZoom(zoom) });
}

export function clampZoom(zoom) {
  if (Number.isNaN(zoom) || typeof zoom !== "number") return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function worldToScreen(viewport, point) {
  return { x: point.x * viewport.zoom + viewport.x, y: point.y * viewport.zoom + viewport.y };
}

export function screenToWorld(viewport, point) {
  return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom };
}

export function panBy(viewport, dx, dy) {
  return createViewport({ x: viewport.x + dx, y: viewport.y + dy, zoom: viewport.zoom });
}

/** Zoom by `factor` keeping the world point under `screenPoint` fixed on screen. */
export function zoomAt(viewport, screenPoint, factor) {
  if (!Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y) || Number.isNaN(factor)) return viewport;
  const zoom = clampZoom(viewport.zoom * factor);
  const world = screenToWorld(viewport, screenPoint);
  return createViewport({ x: screenPoint.x - world.x * zoom, y: screenPoint.y - world.y * zoom, zoom });
}

/** The viewport that fits world `bounds` inside a `width` x `height` screen with `margin`. */
export function fitBounds(bounds, width, height, margin = 24) {
  const zoom = clampZoom(Math.min((width - margin * 2) / Math.max(bounds.width, 1), (height - margin * 2) / Math.max(bounds.height, 1)));
  return createViewport({ x: (width - bounds.width * zoom) / 2 - bounds.x * zoom, y: (height - bounds.height * zoom) / 2 - bounds.y * zoom, zoom });
}

// ---------- selection (pure) ----------

/**
 * The selection a click produces: replace, or (with `extend`) toggle `nodeId`. A null id
 * clears unless extending.
 */
export function selectNode(selection, nodeId, { extend = false } = {}) {
  if (nodeId === null) return extend ? selection : [];
  if (!extend) return [nodeId];
  return selection.includes(nodeId) ? selection.filter((id) => id !== nodeId) : [...selection, nodeId];
}

/** Keep only ids still in `document`, and drop any id whose ancestor is also selected. */
export function normalizeSelection(document, selection) {
  const alive = selection.filter((id) => Object.hasOwn(document.nodes, id));
  const chosen = new Set(alive);
  return alive.filter((id) => {
    for (let parent = document.nodes[id].parentId; parent !== null; parent = document.nodes[parent]?.parentId ?? null) {
      if (chosen.has(parent)) return false;
    }
    return true;
  });
}

// ---------- commands (pure: document state in, history operations out) ----------

const px = (value) => `${Math.round(value * 100) / 100}px`;
// A length in pixels, or 0, which CSS takes as a length without a unit.
const numeric = (value) => {
  const match = typeof value === "string" ? /^(-?\d+(?:\.\d+)?)px$|^-?(0)(?:\.0+)?$/u.exec(value.trim()) : null;
  return match ? Number(match[1] ?? match[2]) : null;
};
// A layer pinned to its parent's centre: `calc(50% + 12px)` or `calc(50% - 12px)`.
const CENTRED = /^calc\(50% ([+-]) (\d+(?:\.\d+)?)px\)$/u;
const centreOffset = (value) => {
  const match = typeof value === "string" ? CENTRED.exec(value.trim()) : null;
  return match ? (match[1] === "-" ? -1 : 1) * Number(match[2]) : null;
};
const centred = (offset) => {
  const rounded = Math.round(offset * 100) / 100;
  return `calc(50% ${rounded < 0 ? "-" : "+"} ${Math.abs(rounded)}px)`;
};
// Each axis's properties: where it starts, where it ends, and its size.
const AXES = { x: ["left", "right", "width"], y: ["top", "bottom", "height"] };
const set = (value) => typeof value === "string" && value.trim() !== "" && value.trim() !== "auto";
// `inset` written as its four longhands (one to four values, as CSS reads them), so a pin can be
// read and changed one edge at a time; a longhand already written wins, as it follows in the
// canvas's order. A value with a function in it is left as it is.
function withInsetExpanded(style) {
  if (typeof style.inset !== "string" || style.inset.includes("(")) return style;
  const parts = style.inset.trim().split(/\s+/u);
  if (parts.length < 1 || parts.length > 4 || parts[0] === "") return style;
  const [top, right = top, bottom = top, left = right] = parts;
  const { inset: _inset, ...rest } = style;
  return { top, right, bottom, left, ...rest };
}
const styleOf = (document, id) => {
  const style = document.nodes[id]?.props?.style;
  return style !== null && typeof style === "object" && !Array.isArray(style) ? style : {};
};

/**
 * Move nodes by (dx, dy) world pixels. A node already positioned absolutely moves by its
 * `left`/`top`; any other node becomes absolutely positioned where it was, plus the delta.
 * `measured[id]` = { left, top, width } gives that place: the `left`/`top` that keep the
 * node where it is once it is absolutely positioned, and the `width` it needs to keep its
 * size out of flow (an absolute box shrinks to fit). Its height stays content-driven.
 */
export function moveBy(document, ids, dx, dy, measured = {}) {
  return normalizeSelection(document, ids).map((id) => {
    const style = styleOf(document, id);
    // A positioned layer moves by what pins it on each axis (its constraint), which it keeps.
    const moved = style.position === "absolute" ? movePinned(movePinned(withInsetExpanded(style), "x", dx), "y", dy) : null;
    if (moved !== null) return { type: "set-props", nodeId: id, set: { style: moved } };
    const box = measured[id] ?? {};
    const next = { ...style, position: "absolute", left: px((box.left ?? 0) + dx), top: px((box.top ?? 0) + dy) };
    // right/bottom would now fight left/top; the measured size replaces what they implied.
    delete next.right;
    delete next.bottom;
    if (next.width === undefined && Number.isFinite(box.width)) next.width = px(box.width);
    return { type: "set-props", nodeId: id, set: { style: next } };
  });
}

/**
 * `style` moved by `delta` on `axis`, keeping how it is pinned, or null when that axis is not
 * pinned in pixels (or the centre): such a layer is measured and placed from where it is drawn.
 */
function movePinned(style, axis, delta) {
  if (style === null) return null;
  const [start, end] = AXES[axis];
  const from = numeric(style[start]);
  const to = numeric(style[end]);
  const centre = centreOffset(style[start]);
  if (from !== null) return { ...style, [start]: px(from + delta), ...(to !== null ? { [end]: px(to - delta) } : {}) };
  if (centre !== null) return { ...style, [start]: centred(centre + delta) };
  if (to !== null && !set(style[start])) return { ...style, [end]: px(to - delta) };
  return null;
}

/**
 * How a positioned layer is pinned to its parent on `axis` ("x" or "y"): "start" (left or top),
 * "end" (right or bottom), "both" (both edges: it stretches with its parent) or "centre". Null
 * for a layer that is not absolutely positioned.
 */
export function constraintOf(style, axis) {
  if (style?.position !== "absolute") return null;
  const [start, end, size] = AXES[axis];
  const expanded = withInsetExpanded(style);
  if (centreOffset(expanded[start]) !== null) return "centre";
  // With a size of its own as well, its start edge wins (the end inset is ignored): pinned to
  // the start, not stretched.
  if (set(expanded[start]) && set(expanded[end])) return set(expanded[size]) ? "start" : "both";
  if (set(expanded[end])) return "end";
  return "start";
}

/**
 * Pin a positioned layer to its parent on `axis` as `mode` ("start", "end", "both" or
 * "centre"), keeping where it is drawn now. `measured` is { start, end, size, parent } on that
 * axis: the inset it has from its parent's start and end edges (what CSS left and right would
 * be), its CSS size, and its parent's size (the containing block).
 */
export function setConstraint(document, id, axis, mode, measured) {
  const [start, end, size] = AXES[axis];
  const values = [measured?.start, measured?.end, measured?.size, measured?.parent];
  if (!AXES[axis] || !["start", "end", "both", "centre"].includes(mode) || !values.every(Number.isFinite)) return [];
  const style = { ...withInsetExpanded(styleOf(document, id)), position: "absolute" };
  delete style[start];
  delete style[end];
  if (mode === "start" || mode === "both") style[start] = px(measured.start);
  if (mode === "end" || mode === "both") style[end] = px(measured.end);
  if (mode === "centre") style[start] = centred(measured.start - measured.parent / 2);
  // Pinned to both edges its size follows its parent's; pinned to one, it keeps its own.
  if (mode === "both") delete style[size];
  else if (style[size] === undefined) style[size] = px(measured.size);
  return [{ type: "set-props", nodeId: id, set: { style } }];
}

/**
 * Set `id`'s CSS `width`/`height` (the box its `box-sizing` names), at least 1px. An inline
 * box ignores both, so `{ inline: true }` also makes it `inline-block`, which keeps it in the
 * line while honouring the size.
 */
export function resizeTo(document, id, width, height, { inline = false, from = null } = {}) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return [];
  const style = withInsetExpanded({ ...styleOf(document, id) });
  // `from` is its CSS size now. Its start edge stays put: pinned to both edges, it is resized by
  // its end inset (it has no size of its own); pinned to the end, that inset moves with it.
  for (const [axis, next, before] of [["x", Math.max(1, width), from?.width], ["y", Math.max(1, height), from?.height]]) {
    const [, end, size] = AXES[axis];
    const mode = constraintOf(style, axis);
    const inset = numeric(style[end]);
    if ((mode === "both" || mode === "end") && inset !== null && Number.isFinite(before)) style[end] = px(inset - (next - before));
    if (mode !== "both" || inset === null || !Number.isFinite(before)) style[size] = px(next);
  }
  if (inline) style.display = "inline-block";
  return [{ type: "set-props", nodeId: id, set: { style } }];
}

export function setStyle(document, id, changes) {
  const style = { ...styleOf(document, id) };
  for (const [name, value] of Object.entries(changes)) {
    if (value === null || value === "") delete style[name];
    else style[name] = String(value);
  }
  return [{ type: "set-props", nodeId: id, set: { style } }];
}

export function setText(id, text) {
  return [{ type: "set-props", nodeId: id, set: { text } }];
}

/** Move `id` by `delta` places among its siblings (clamped); [] when it cannot move. */
export function reorder(document, id, delta) {
  const node = Object.hasOwn(document.nodes, id) ? document.nodes[id] : null;
  if (node === null) return [];
  const siblings = node.parentId === null ? document.rootIds : document.nodes[node.parentId].children;
  const from = siblings.indexOf(id);
  const to = Math.min(siblings.length - 1, Math.max(0, from + delta));
  return to === from ? [] : [{ type: "move-node", nodeId: id, parentId: node.parentId, index: to }];
}

export function reparent(id, parentId, index) {
  return [{ type: "move-node", nodeId: id, parentId, index }];
}

export function removeNodes(document, ids) {
  return normalizeSelection(document, ids).map((id) => ({ type: "remove-node", nodeId: id }));
}

/** Insert a new leaf under `parentId` (null for a root) at `index`. */
export function insertNode(parentId, index, { id, type = "element", tag, text, style } = {}) {
  const props = {};
  if (tag !== undefined) props.tag = tag;
  if (text !== undefined) props.text = text;
  if (style !== undefined) props.style = style;
  return [{ type: "insert-node", node: { id, type, props }, parentId, index }];
}

// ---------- the mounted canvas (DOM) ----------

// A press that moves less than this many screen pixels is a click, not a drag.
const DRAG_THRESHOLD = 3;
const OVERLAY_STYLE = "position:absolute;inset:0;pointer-events:none;";
const STAGE_STYLE = "position:relative;overflow:hidden;width:100%;height:100%;outline:none;background:#e9e9ef;touch-action:none;user-select:none;-webkit-user-select:none;";

/**
 * Mount a canvas in `container`. `onCommit(operations, intent, { revision })` receives every
 * edit, computed from the document at `revision` (the one last given to `setDocument` or
 * `update`); the caller commits it with that base revision, so an edit computed from a
 * document that has since changed is refused rather than misapplied, and later calls
 * `update(document, affectedNodeIds)`. `onSelect(ids)` reports selection changes.
 */
export async function mountCanvas(container, { onCommit = () => {}, onSelect = () => {}, onTarget = () => {}, nudge = 1 } = {}) {
  const owner = container.ownerDocument;
  const stage = owner.createElement("div");
  stage.setAttribute("style", STAGE_STYLE);
  stage.setAttribute("tabindex", "0");
  stage.setAttribute("role", "application");
  stage.setAttribute("aria-label", "Canvas");
  const world = owner.createElement("div");
  world.setAttribute("style", "position:absolute;left:0;top:0;transform-origin:0 0;");
  const capture = owner.createElement("div");
  capture.setAttribute("style", "position:absolute;inset:0;cursor:default;");
  capture.dataset.ninerrCapture = "";
  const overlay = owner.createElement("div");
  overlay.setAttribute("style", OVERLAY_STYLE);
  stage.append(world, capture, overlay);
  container.appendChild(stage);
  const { frame, renderer } = await mountSandboxedRenderer(world);
  frame.setAttribute("style", "border:0;display:block;background:#fff;");
  // The frame is not a stop of its own: the canvas takes the keys, and the layers tree is
  // the design's accessible form.
  frame.setAttribute("tabindex", "-1");
  frame.setAttribute("aria-hidden", "true");
  const frameDocument = frame.contentDocument;

  let document = null;
  let viewport = createViewport({ x: 24, y: 24, zoom: 1 });
  let selection = [];
  let drag = null;

  const applyViewport = () => {
    world.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
    drawSelection();
  };
  const sizeFrame = () => {
    const root = frameDocument.querySelector("[data-ninerr-root]");
    frame.style.width = `${Math.max(320, Math.ceil(root.scrollWidth))}px`;
    frame.style.height = `${Math.max(240, Math.ceil(frameDocument.documentElement.scrollHeight))}px`;
  };
  // An element's rectangle in world coordinates (the frame sits at the world origin).
  const worldRect = (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  };
  const elementAt = (screenPoint) => {
    const stageRect = stage.getBoundingClientRect();
    const point = screenToWorld(viewport, { x: screenPoint.x - stageRect.left, y: screenPoint.y - stageRect.top });
    // Rendered content is inert (no focus or input inside the canvas), and inert content is
    // invisible to elementFromPoint, so it is lifted for this one synchronous query.
    const root = frameDocument.querySelector("[data-ninerr-root]");
    root.inert = false;
    try {
      return frameDocument.elementFromPoint(point.x, point.y);
    } finally {
      root.inert = true;
    }
  };
  const hitTest = (screenPoint) => {
    const element = elementAt(screenPoint);
    const id = renderer.nodeIdFor(element);
    return id !== null && Object.hasOwn(document?.nodes ?? {}, id) ? id : null;
  };
  // A layer inside the selected instance, picked by double-click (ADR-0005): edited as the
  // instance's override, never as a layer of its own.
  let target = null;
  const setTarget = (next) => {
    target = next;
    drawSelection();
    onTarget(target === null ? null : { ...target, path: [...target.path] });
  };
  const setSelection = (next) => {
    selection = document ? normalizeSelection(document, next) : [];
    // The target goes with its instance's selection, and with its layer: one the instance no
    // longer draws (an Undo, an agent's change to the component) is no target.
    const lost = target !== null && (!(selection.length === 1 && selection[0] === target.instanceId) || renderer.elementForTarget(target) === null);
    if (lost) target = null;
    drawSelection();
    onSelect([...selection]);
    if (lost) onTarget(null);
  };
  function drawSelection() {
    overlay.replaceChildren();
    for (const id of selection) {
      const element = renderer.elementFor(id);
      if (!element) continue;
      const rect = worldRect(element);
      const topLeft = worldToScreen(viewport, rect);
      const box = owner.createElement("div");
      box.dataset.ninerrSelection = id;
      box.setAttribute("style", `position:absolute;left:${topLeft.x}px;top:${topLeft.y}px;width:${rect.width * viewport.zoom}px;height:${rect.height * viewport.zoom}px;outline:2px solid #6d4aff;outline-offset:-1px;`);
      if (selection.length === 1) {
        const handle = owner.createElement("div");
        handle.dataset.ninerrHandle = "resize";
        handle.setAttribute("style", "position:absolute;right:-5px;bottom:-5px;width:10px;height:10px;background:#fff;border:2px solid #6d4aff;pointer-events:auto;cursor:nwse-resize;");
        box.appendChild(handle);
      }
      overlay.appendChild(box);
    }
    if (target !== null) {
      const element = renderer.elementForTarget(target);
      const rect = element ? worldRect(element) : null;
      // A layer hidden in this instance has no box to outline.
      if (element && rect.width > 0 && rect.height > 0) {
        const topLeft = worldToScreen(viewport, rect);
        const box = owner.createElement("div");
        box.dataset.ninerrTarget = target.nodeId;
        box.setAttribute("style", `position:absolute;left:${topLeft.x}px;top:${topLeft.y}px;width:${rect.width * viewport.zoom}px;height:${rect.height * viewport.zoom}px;outline:2px dashed #6d4aff;outline-offset:1px;`);
        overlay.appendChild(box);
      }
    }
  }
  // The size CSS width/height must hold for `element` to keep its current box, following its
  // box-sizing. Computed values are used when they are lengths; an inline box reports
  // "auto", so its rendered box less padding and border is used instead.
  const cssSize = (element) => {
    const computed = frameDocument.defaultView.getComputedStyle(element);
    let width = parseFloat(computed.width);
    let height = parseFloat(computed.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || computed.display === "inline") {
      const rect = element.getBoundingClientRect();
      const edges = computed.boxSizing === "border-box" ? [] : ["padding", "border"];
      const inset = (sides) => edges.reduce((sum, edge) => sum + sides.reduce((total, side) => total + (parseFloat(computed[edge === "border" ? `border${side}Width` : `${edge}${side}`]) || 0), 0), 0);
      width = rect.width - inset(["Left", "Right"]);
      height = rect.height - inset(["Top", "Bottom"]);
    }
    return { width: Math.max(1, width), height: Math.max(1, height) };
  };
  // Where each flow node must be placed to stay put once absolutely positioned, measured
  // after the change: the node is set to absolute at (0, 0) for one synchronous layout, and
  // the distance back to where it was is its left/top. That accounts for its margins, for
  // margins that collapsed through its parent, and for any change in its containing block;
  // the reflow of the nodes around it cannot be undone. Positioned nodes need no measuring.
  const measuredBoxes = (ids) => Object.fromEntries(ids.map((id) => {
    const element = renderer.elementFor(id);
    if (!element) return [id, { left: 0, top: 0 }];
    const before = element.getBoundingClientRect();
    const { width } = cssSize(element);
    const saved = ["position", "left", "top", "right", "bottom", "width"].map((name) => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]);
    element.style.setProperty("position", "absolute");
    element.style.setProperty("left", "0px");
    element.style.setProperty("top", "0px");
    element.style.removeProperty("right");
    element.style.removeProperty("bottom");
    element.style.setProperty("width", `${width}px`);
    const zero = element.getBoundingClientRect();
    for (const [name, value, priority] of saved) {
      if (value === "") element.style.removeProperty(name);
      else element.style.setProperty(name, value, priority);
    }
    return [id, { left: before.left - zero.left, top: before.top - zero.top, width }];
  }));
  const commit = (operations, intent) => {
    if (operations.length > 0) onCommit(operations, intent, { revision: document.revision });
  };

  capture.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || document === null) return;
    // No text selection or native drag may start from a canvas press: either would make the
    // browser cancel the pointer mid-drag.
    event.preventDefault();
    stage.focus();
    const id = hitTest({ x: event.clientX, y: event.clientY });
    const extend = event.shiftKey || event.metaKey || event.ctrlKey;
    if (id === null || !selection.includes(id) || extend) setSelection(selectNode(selection, id, { extend }));
    // While a committed drag's preview waits for its update, no new drag starts: it would be
    // computed from the document the preview has already moved past.
    if (id !== null && selection.includes(id) && held === null) {
      const ids = [...selection];
      drag = { kind: "move", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, ids, moved: false };
      // Capture on the stage, which outlives every move: the overlay is redrawn as it goes.
      stage.setPointerCapture?.(event.pointerId);
    }
  });
  // Double-click inside an instance picks the layer drawn there (the instance stays selected).
  // On the stage: a press captures the pointer there, so the click events arrive there.
  stage.addEventListener("dblclick", (event) => {
    if (document === null) return;
    const picked = renderer.instanceTargetFor(elementAt({ x: event.clientX, y: event.clientY }));
    if (picked === null || !Object.hasOwn(document.nodes, picked.instanceId)) return;
    if (!(selection.length === 1 && selection[0] === picked.instanceId)) setSelection([picked.instanceId]);
    setTarget(picked);
  });
  overlay.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target?.dataset?.ninerrHandle !== "resize" || selection.length !== 1 || held !== null) return;
    event.preventDefault();
    event.stopPropagation();
    stage.focus();
    const id = selection[0];
    const element = renderer.elementFor(id);
    const size = cssSize(element);
    drag = {
      kind: "resize", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, id, moved: false,
      width: size.width, height: size.height,
      inlineBox: frameDocument.defaultView.getComputedStyle(element).display === "inline",
      // The inline values the preview overwrites, restored when the drag ends.
      inline: Object.fromEntries(["width", "height", "display"].map((name) => [name, element.style.getPropertyValue(name)])),
    };
    stage.setPointerCapture?.(event.pointerId);
  });
  const deltas = (event, current) => ({ dx: (event.clientX - current.startX) / viewport.zoom, dy: (event.clientY - current.startY) / viewport.zoom });
  // Undo a drag's preview, leaving the elements as the document rendered them.
  const clearPreview = (current) => {
    if (current.kind === "move") {
      for (const id of current.ids) renderer.elementFor(id)?.style.removeProperty("translate");
    } else {
      const element = renderer.elementFor(current.id);
      for (const name of ["width", "height", "display"]) {
        if (current.inline[name] === "") element?.style.removeProperty(name);
        else element?.style.setProperty(name, current.inline[name]);
      }
    }
  };
  // A committed drag keeps its preview until the caller's next update or setDocument (or
  // clearPreview, when the edit was not applied), so the node does not snap back for the
  // host's round trip. An abandoned drag clears it at once.
  let held = null;
  const releaseHeld = () => {
    if (held !== null) clearPreview(held);
    held = null;
  };
  const endDrag = ({ keep = false } = {}) => {
    const current = drag;
    drag = null;
    if (current !== null) {
      if (keep) {
        releaseHeld();
        held = current;
      } else clearPreview(current);
      if (stage.hasPointerCapture?.(current.pointerId)) stage.releasePointerCapture(current.pointerId);
    }
    drawSelection();
    return current;
  };
  stage.addEventListener("pointermove", (event) => {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    // No button held means the release was missed (it happened outside the page): cancel.
    if (event.buttons === 0) {
      endDrag();
      return;
    }
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= DRAG_THRESHOLD) drag.moved = true;
    if (!drag.moved) return;
    const { dx, dy } = deltas(event, drag);
    if (drag.kind === "move") {
      for (const id of drag.ids) renderer.elementFor(id)?.style.setProperty("translate", `${dx}px ${dy}px`);
    } else {
      const element = renderer.elementFor(drag.id);
      if (drag.inlineBox) element?.style.setProperty("display", "inline-block");
      element?.style.setProperty("width", `${Math.max(1, drag.width + dx)}px`);
      element?.style.setProperty("height", `${Math.max(1, drag.height + dy)}px`);
    }
    drawSelection();
  });
  stage.addEventListener("pointerup", (event) => {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const { dx, dy } = deltas(event, drag);
    // Measure before the preview is cleared, while the elements are still in place.
    const boxes = drag.kind === "move" ? measuredBoxes(drag.ids) : null;
    let operations = [];
    let intent = null;
    if (drag.moved && (dx !== 0 || dy !== 0)) {
      if (drag.kind === "move") {
        const ids = drag.ids.filter((id) => Object.hasOwn(document.nodes, id));
        operations = ids.length > 0 ? moveBy(document, ids, dx, dy, boxes) : [];
        intent = ids.length === 1 ? "Move layer" : "Move layers";
      } else if (Object.hasOwn(document.nodes, drag.id)) {
        operations = resizeTo(document, drag.id, drag.width + dx, drag.height + dy, { inline: drag.inlineBox, from: { width: drag.width, height: drag.height } });
        intent = "Resize layer";
      }
    }
    endDrag({ keep: operations.length > 0 });
    commit(operations, intent);
  });
  stage.addEventListener("dragstart", (event) => event.preventDefault());
  // A cancelled pointer (touch scrolling, an interruption) or lost capture abandons the drag.
  stage.addEventListener("pointercancel", (event) => {
    if (drag !== null && event.pointerId === drag.pointerId) endDrag();
  });
  stage.addEventListener("lostpointercapture", (event) => {
    if (drag !== null && event.pointerId === drag.pointerId) endDrag();
  });

  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    const stageRect = stage.getBoundingClientRect();
    // Lines and pages (deltaMode 1 and 2) become pixels.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
    const deltaX = event.deltaX * unit;
    const deltaY = event.deltaY * unit;
    if (event.ctrlKey || event.metaKey) viewport = zoomAt(viewport, { x: event.clientX - stageRect.left, y: event.clientY - stageRect.top }, Math.exp(-Math.max(-600, Math.min(600, deltaY)) / 300));
    else viewport = panBy(viewport, -deltaX, -deltaY);
    applyViewport();
  }, { passive: false });

  // A visible focus ring when the canvas is reached from the keyboard (WCAG 2.4.7).
  stage.addEventListener("focus", () => {
    // Drawn on the overlay, the top layer, so the design never covers it.
    if (stage.matches(":focus-visible")) overlay.style.boxShadow = "inset 0 0 0 3px #1a5fd0";
  });
  stage.addEventListener("blur", () => {
    overlay.style.boxShadow = "";
  });
  stage.addEventListener("keydown", (event) => {
    if (document === null) return;
    const step = event.shiftKey ? nudge * 10 : nudge;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const modified = event.ctrlKey || event.metaKey || event.altKey;
    // With nothing selected, the arrows pan the view (40 px, 200 with Shift), so every part
    // of a zoomed-in design can be reached from the keyboard.
    if (Object.hasOwn(moves, event.key) && selection.length === 0 && !modified) {
      event.preventDefault();
      const [dx, dy] = moves[event.key].map((value) => -Math.sign(value) * (event.shiftKey ? 200 : 40));
      viewport = panBy(viewport, dx, dy);
      applyViewport();
      return;
    }
    if (Object.hasOwn(moves, event.key) && selection.length > 0 && !modified) {
      event.preventDefault();
      const [dx, dy] = moves[event.key];
      commit(moveBy(document, selection, dx, dy, measuredBoxes(selection)), "Nudge layer");
    } else if ((event.key === "Delete" || event.key === "Backspace") && selection.length > 0 && !modified) {
      event.preventDefault();
      commit(removeNodes(document, selection), selection.length === 1 ? "Delete layer" : "Delete layers");
    } else if (event.key === "Escape") {
      setSelection([]);
    } else if ((event.key === "=" || event.key === "+") && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      viewport = zoomAt(viewport, { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }, 1.25);
      applyViewport();
    } else if (event.key === "-" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      viewport = zoomAt(viewport, { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }, 0.8);
      applyViewport();
    }
  });

  applyViewport();
  return {
    stage,
    frame,
    renderer,
    /** Show `next` from scratch (opening a project). */
    setDocument(next) {
      releaseHeld();
      document = next;
      // Another document (a project opened): no layer of the last one is a target.
      if (target !== null) {
        target = null;
        onTarget(null);
      }
      renderer.setTokens(compileTokens(next));
      renderer.render(next);
      sizeFrame();
      setSelection(selection);
    },
    /** Apply a committed change: patch only `affectedNodeIds`. */
    update(next, affectedNodeIds) {
      releaseHeld();
      const before = document === null ? null : designSystemOf(document)?.id ?? null;
      document = next;
      // The token sheet changes only with the design system (ADR-0004).
      const after = designSystemOf(next)?.id ?? null;
      if (before !== after || affectedNodeIds.includes(after)) renderer.setTokens(compileTokens(next));
      renderer.patch(next, affectedNodeIds);
      sizeFrame();
      setSelection(selection);
    },
    get selection() {
      return [...selection];
    },
    /** The layer inside the selected instance being edited, or null. */
    get target() {
      return target === null ? null : { ...target, path: [...target.path] };
    },
    /** Pick (or with null, drop) a layer inside the selected instance. */
    setTarget(next) {
      if (next !== null && !(selection.length === 1 && selection[0] === next.instanceId)) return;
      setTarget(next === null ? null : { instanceId: next.instanceId, path: [...next.path], nodeId: next.nodeId });
    },
    select(ids) {
      setSelection(ids);
    },
    get viewport() {
      return viewport;
    },
    setViewport(next) {
      viewport = createViewport(next);
      applyViewport();
    },
    zoomBy(factor) {
      viewport = zoomAt(viewport, { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }, factor);
      applyViewport();
    },
    fit() {
      const root = frameDocument.querySelector("[data-ninerr-root]");
      viewport = fitBounds({ x: 0, y: 0, width: Math.max(1, root.scrollWidth), height: Math.max(1, frameDocument.documentElement.scrollHeight) }, stage.clientWidth, stage.clientHeight);
      applyViewport();
    },
    /**
     * Move the selection by (dx, dy), or resize the single selected layer by (dw, dh), as
     * a drag would: the single-pointer alternative to dragging (buttons in the editor).
     */
    nudge(dx, dy) {
      if (document !== null && selection.length > 0) commit(moveBy(document, selection, dx, dy, measuredBoxes(selection)), selection.length === 1 ? "Move layer" : "Move layers");
    },
    resizeBy(dw, dh) {
      if (document === null || selection.length !== 1 || !renderer.elementFor(selection[0])) return;
      const element = renderer.elementFor(selection[0]);
      const size = cssSize(element);
      const inline = frameDocument.defaultView.getComputedStyle(element).display === "inline";
      commit(resizeTo(document, selection[0], size.width + dw, size.height + dh, { inline, from: size }), "Resize layer");
    },
    /**
     * What setConstraint needs to pin layer `id` on `axis` where it is drawn: its insets from
     * its containing block's edges, its CSS size, and that block's size. Null when it is not
     * drawn or not absolutely positioned.
     */
    measureConstraint(id, axis) {
      const element = renderer.elementFor(id);
      if (!element) return null;
      const computed = frameDocument.defaultView.getComputedStyle(element);
      const block = element.offsetParent;
      if (computed.position !== "absolute" || block === null) return null;
      const [start, end] = AXES[axis];
      const capital = (name) => name[0].toUpperCase() + name.slice(1);
      // Its containing block's padding box, and its own margin box in it. The start inset is the
      // one it is drawn at (auto resolved); the end inset is what is left, since a written end
      // inset is ignored when the start and the size are set too.
      const parent = axis === "x" ? block.clientWidth : block.clientHeight;
      const before = parseFloat(computed[start]);
      const outer = (axis === "x" ? element.offsetWidth : element.offsetHeight) + parseFloat(computed[`margin${capital(start)}`]) + parseFloat(computed[`margin${capital(end)}`]);
      const size = cssSize(element)[AXES[axis][2]];
      return { start: before, end: parent - before - outer, size, parent };
    },
    /** Drop a held drag preview: the caller's commit of it was not applied. */
    clearPreview() {
      releaseHeld();
      drawSelection();
    },
    hitTest,
    destroy() {
      stage.remove();
    },
  };
}
