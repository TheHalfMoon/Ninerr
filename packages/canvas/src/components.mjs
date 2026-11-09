// Components, instances and detaching (ADR-0005): the history operations the editor sends as one
// transaction each. Pure functions over the document; the canvas draws the result.
import { expandInstance, styleDeclarationProblem } from "../../renderer/src/index.mjs";

const siblingsOf = (document, node) => (node.parentId === null ? document.rootIds : document.nodes[node.parentId].children);
const ancestors = function* (document, node) {
  for (let parent = node?.parentId == null ? undefined : document.nodes[node.parentId], steps = 0; parent && steps <= 1_100; parent = parent.parentId === null ? undefined : document.nodes[parent.parentId], steps += 1) yield parent;
};

/** The document's components, by name. */
export function componentsOf(document) {
  return Object.values(document.nodes)
    .filter((node) => node.type === "component-definition")
    .map((node) => ({ id: node.id, name: typeof node.props.name === "string" && node.props.name !== "" ? node.props.name : "Unnamed component" }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// A layer's look, which a component made from it keeps: everything but what binds it to code.
const lookOf = (props) => {
  const { codeSource: _codeSource, ...look } = props;
  return look;
};

/**
 * Make a layer into a component: a component-definition takes its place, with its look (tag,
 * style, attributes, text, stylesheet) and its children, so the layer as it is becomes the main
 * component, with no wrapper in between. Refused for a design system, a component or an instance,
 * a layer inside a component, and a layer that holds a component.
 */
export function createComponent(document, nodeId, { id, name }) {
  const node = document.nodes[nodeId];
  if (!node) throw new Error("Select a layer first.");
  if (node.type === "design-system" || node.type === "component-instance" || node.type === "component-definition") throw new Error("That layer cannot become a component.");
  for (const parent of ancestors(document, node)) if (parent.type === "component-definition") throw new Error("That layer is already inside a component.");
  const stack = [...node.children];
  while (stack.length > 0) {
    const inner = document.nodes[stack.pop()];
    if (!inner) continue;
    if (inner.type === "component-definition") throw new Error("That layer holds a component; make the component from a layer that does not.");
    stack.push(...inner.children);
  }
  if (typeof id !== "string" || id === "" || Object.hasOwn(document.nodes, id)) throw new Error("A new component needs an unused id.");
  const label = typeof name === "string" && name.trim() !== "" ? name.trim() : typeof node.props.name === "string" && node.props.name !== "" ? node.props.name : "Component";
  const index = siblingsOf(document, node).indexOf(nodeId);
  return [
    { type: "insert-node", parentId: node.parentId, index, node: { id, type: "component-definition", props: { ...lookOf(node.props), name: label, properties: [] } } },
    ...node.children.map((childId, at) => ({ type: "move-node", nodeId: childId, parentId: id, index: at })),
    { type: "remove-node", nodeId },
  ];
}

/** Whether `componentId`, drawn, draws `targetId`: itself, or through the instances it holds. */
export function drawsComponent(document, componentId, targetId) {
  const seen = new Set();
  const queue = [componentId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === targetId) return true;
    if (seen.has(id) || !document.nodes[id]) continue;
    seen.add(id);
    const component = (value) => typeof value === "string" && document.nodes[value]?.type === "component-definition";
    // Its swap and slot defaults, and every instance inside it with its swap and slot values.
    for (const property of document.nodes[id].props.properties ?? []) if ((property.kind === "instance-swap" || property.kind === "slot") && component(property.default)) queue.push(property.default);
    const stack = [...document.nodes[id].children];
    while (stack.length > 0) {
      const node = document.nodes[stack.pop()];
      if (!node) continue;
      if (node.type === "component-instance") {
        queue.push(node.props.componentId);
        for (const value of Object.values(node.props.propertyValues ?? {})) if (component(value)) queue.push(value);
      }
      stack.push(...node.children);
    }
  }
  return false;
}

/**
 * Place an instance of a component after `afterId` (or at the end of the top level). One that
 * would draw itself, inside its own component or one it draws, goes beside that component instead.
 */
export function insertInstance(document, componentId, { id, afterId = null }) {
  const component = document.nodes[componentId];
  if (!component || component.type !== "component-definition") throw new Error("Choose a component.");
  if (typeof id !== "string" || id === "" || Object.hasOwn(document.nodes, id)) throw new Error("A new instance needs an unused id.");
  const after = afterId === null ? undefined : document.nodes[afterId];
  let parentId = after ? after.parentId : null;
  let place = after;
  const parent = parentId === null ? undefined : document.nodes[parentId];
  for (const holder of [parent, ...ancestors(document, parent)].filter(Boolean)) {
    if (holder.type === "component-definition" && drawsComponent(document, componentId, holder.id)) {
      parentId = holder.parentId;
      place = holder;
    }
  }
  const siblings = parentId === null ? document.rootIds : document.nodes[parentId].children;
  const index = place && place.parentId === parentId ? siblings.indexOf(place.id) + 1 : siblings.length;
  // An absolutely placed component's new instance is set off from it, not drawn on top of it.
  const style = component.props.style ?? {};
  const offset = (value) => (typeof value === "string" && /^-?\d+(\.\d+)?px$/u.test(value) ? `${Number.parseFloat(value) + 24}px` : undefined);
  const placed = (style.position === "absolute" || style.position === "fixed") ? Object.fromEntries([["left", offset(style.left)], ["top", offset(style.top)]].filter(([, value]) => value !== undefined)) : {};
  return [{ type: "insert-node", parentId, index, node: { id, type: "component-instance", props: { componentId, propertyValues: {}, overrides: [], ...(Object.keys(placed).length > 0 ? { style: placed } : {}) } } }];
}

/**
 * Detach an instance: one transaction that writes what it draws as real layers in its place, with
 * fresh ids from `mint`, and removes the instance. The layers keep the look they were drawn with,
 * and nothing that binds a component's layer to code. Undo puts the instance back.
 */
export function detachInstance(document, instanceId, mint) {
  const instance = document.nodes[instanceId];
  if (!instance || instance.type !== "component-instance") throw new Error("Select an instance.");
  const view = expandInstance(document, instanceId);
  if (view === null) throw new Error("Its component is missing or draws too many layers, so there is nothing to detach.");
  const nodes = [];
  const add = (entry, parentId) => {
    const id = mint();
    if (Object.hasOwn(document.nodes, id)) throw new Error("A detached layer needs an unused id.");
    const record = { id, type: entry.type === "component-instance" ? "frame" : entry.type, parentId, children: [], props: lookOf(structuredClone(entry.props)), metadata: {} };
    nodes.push(record);
    record.children = entry.children.map((child) => add(child, id));
    return id;
  };
  const rootId = add({ ...view, type: "frame" }, instance.parentId);
  const index = siblingsOf(document, instance).indexOf(instanceId);
  return { rootId, operations: [{ type: "remove-node", nodeId: instanceId }, { type: "restore-subtree", rootId, parentId: instance.parentId, index, nodes }] };
}

const samePath = (a, b) => Array.isArray(a) && a.length === b.length && a.every((id, index) => id === b[index]);

/** The layers an instance draws, as targets with a label and depth, for picking one by keyboard. */
export function instanceLayers(document, instanceId) {
  const view = expandInstance(document, instanceId);
  if (view === null) return [];
  // Its root first: the component's root node, drawn as the instance itself.
  const componentId = document.nodes[instanceId].props.componentId;
  const rootNode = document.nodes[componentId];
  const hidden = (props) => props.attributes?.hidden !== undefined;
  const layers = [{ instanceId, path: [], nodeId: componentId, mainId: componentId, label: `${rootNode?.props?.name ?? "Component"} (its root)`, depth: 0, text: typeof view.props.text === "string" ? view.props.text : null, hidden: hidden(view.props), stale: false }];
  const walk = (entry, depth) => {
    for (const child of entry.children) {
      const node = document.nodes[child.id];
      // A drawn instance root (a nested instance, or what a slot draws) is its component's root.
      const main = child.type === "component-instance" && typeof child.componentId === "string" ? child.componentId : child.id;
      const label = document.nodes[main]?.props?.name ?? node?.props?.name ?? (typeof child.props.text === "string" && child.props.text !== "" ? child.props.text : child.props.tag ?? child.type);
      layers.push({ instanceId, path: child.chain.slice(1), nodeId: child.id, mainId: main, label: String(label).slice(0, 60), depth, text: typeof child.props.text === "string" ? child.props.text : null, hidden: hidden(child.props), stale: child.stale === true });
      walk(child, depth + 1);
    }
  };
  walk(view, 1);
  return layers;
}

/** The instance's own override for one of its layers, or null. */
export function overrideFor(document, instanceId, { path, nodeId }) {
  const overrides = document.nodes[instanceId]?.props?.overrides ?? [];
  return overrides.find((override) => override.nodeId === nodeId && samePath(override.path, path)) ?? null;
}

// Declarations split at the semicolons that end them: not one inside a string or brackets.
function declarationsOf(text) {
  const parts = [];
  let current = "";
  let quote = null;
  let depth = 0;
  for (const character of String(text)) {
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === ";" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/**
 * A style written as CSS declarations ("color: red; padding: 4px; --brand: blue") as a record. A
 * declaration the canvas would not draw is refused, saying why, so nothing is dropped silently;
 * one that `kept` already holds with that value stands as it is (an agent's, say).
 */
export function parseDeclarations(text, kept = {}) {
  const style = {};
  for (const declaration of declarationsOf(text)) {
    const colon = declaration.indexOf(":");
    const raw = colon === -1 ? "" : declaration.slice(0, colon).trim();
    const name = raw.startsWith("--") ? raw : raw.toLowerCase();
    const value = colon === -1 ? "" : declaration.slice(colon + 1).trim();
    if (colon === -1 || name === "" || value === "") throw new Error(`"${declaration.slice(0, 60)}" is not a CSS declaration`);
    if (kept[name] !== value) {
      const problem = styleDeclarationProblem(name, value);
      if (problem !== null) throw new Error(`"${declaration.slice(0, 60)}": ${problem}`);
    }
    style[name] = value;
  }
  return style;
}

/**
 * Set what an instance shows on one of its layers: text, a style (merged with what was set
 * before; a property set to "" is taken off), or shown. One set-props on the instance; the
 * component is untouched. Structure inside an instance stays locked: nothing is added or removed.
 */
export function setInstanceOverride(document, instanceId, { path, nodeId }, change) {
  const instance = document.nodes[instanceId];
  if (!instance || instance.type !== "component-instance") throw new Error("Select an instance.");
  const overrides = Array.isArray(instance.props.overrides) ? instance.props.overrides : [];
  const existing = overrides.find((override) => override.nodeId === nodeId && samePath(override.path, path));
  const set = { ...(existing?.set ?? {}) };
  if (change.text !== undefined) {
    if (change.text === null) delete set.text;
    else set.text = String(change.text);
  }
  if (change.style !== undefined) {
    const style = { ...(set.style ?? {}), ...change.style };
    for (const [name, value] of Object.entries(style)) if (value === "") delete style[name];
    if (Object.keys(style).length === 0) delete set.style;
    else set.style = style;
  }
  if (change.visible !== undefined) {
    if (change.visible === null) delete set.visible;
    else set.visible = change.visible === true;
  }
  const rest = overrides.filter((override) => override !== existing);
  const next = Object.keys(set).length === 0 ? rest : [...rest, { path: [...path], nodeId, set }];
  return [{ type: "set-props", nodeId: instanceId, set: { overrides: next } }];
}

/** Take off an instance's overrides: of one layer, or (with no target) all; property values stay. */
export function resetInstance(document, instanceId, target = null) {
  const instance = document.nodes[instanceId];
  if (!instance || instance.type !== "component-instance") throw new Error("Select an instance.");
  const overrides = Array.isArray(instance.props.overrides) ? instance.props.overrides : [];
  const next = target === null ? [] : overrides.filter((override) => !(override.nodeId === target.nodeId && samePath(override.path, target.path)));
  return [{ type: "set-props", nodeId: instanceId, set: { overrides: next } }];
}
